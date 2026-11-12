"""Optional browser acceptance for task planning, using only temporary synthetic data.

Run explicitly with Python Playwright and Chromium installed:
    python3 tests/browser_task_planning.py
No production database, family upload, or external website is opened.
"""
import argparse
import base64
import datetime
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

try:
    from playwright.sync_api import expect, sync_playwright
except ImportError:
    expect = sync_playwright = None


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'lan-server'))
spec = importlib.util.spec_from_file_location('xiaobu_browser_server', REPO / 'lan-server/server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
from photos import Photos
from pledges import Pledges

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')


class Acceptance:
    def __init__(self, root, screenshots):
        self.root = root
        self.screenshots = screenshots
        self.today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date()
        self.day = self.today.isoformat()
        self.future = (self.today + datetime.timedelta(days=2)).isoformat()
        self.due = (self.today + datetime.timedelta(days=5)).isoformat()
        self.pledges = Pledges(root / 'pledges.sqlite3')
        self.pledges.initialize()
        self.photos = Photos(root / 'photos', root / 'tasks.sqlite3')
        self.photos.initialize()
        self.tasks = server.Tasks(root / 'tasks.sqlite3', self.photos)
        self.tasks.initialize()
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.handler(
            REPO / 'frontend', self.tasks, '127.0.0.1', self.pledges, self.photos))
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.origin = 'http://127.0.0.1:' + str(self.http.server_port)
        self.checks = []
        self.errors = []
        self.contrasts = []

    def close(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join(timeout=5)

    def api(self, path, body=None, expected=200):
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        req = Request(self.origin + path, data=data,
                      headers={'Content-Type': 'application/json'} if data else {})
        try:
            response = urlopen(req, timeout=5)
        except HTTPError as e:
            response = e
        with response:
            result = json.load(response)
            assert response.status == expected, (path, response.status, result)
        return result

    def task(self, task_id, child='child_a'):
        packet = self.api(f'/lan/family/parent/task?day={self.day}&child={child}&id={task_id}')
        assert len(packet['tasks']) == 1, packet
        return packet['tasks'][0]

    def wait_status(self, task_id, status, child='child_a'):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            task = self.task(task_id, child)
            if task['status'] == status:
                return task
            time.sleep(.05)
        raise AssertionError((task_id, status, task))

    def reward(self, task_id, child='child_a'):
        with self.tasks.connect() as con:
            rows = con.execute('SELECT payload FROM progress.pledge_progress WHERE key=?',
                               ('task:' + child + ':' + task_id,)).fetchall()
        assert len(rows) <= 1, rows
        return json.loads(rows[0][0]) if rows else None

    def change(self, task_id, op='feedback', role='child', child='child_a', expected=200, **changes):
        task = self.task(task_id, child)
        body = {'day': self.day, 'child_id': child, 'task_id': task_id,
                'expected_version': task['version'], 'operation_id': 'qa-' + str(time.time_ns()), **changes}
        return self.api('/lan/family/' + role + '/' + op, body, expected), body

    def http_lifecycle(self):
        """The HTTP path is independently runnable when a browser cannot start."""
        self.seed()
        health = self.api('/lan/health')
        assert health['service'] == 'xiaobu-lan' and health['dataset'] == 'lan'
        task = self.task('qa-level-1')
        assert task['created_day'] == self.day and task['planned_day'] == self.day
        assert task['due_day'] == self.due
        self.change('qa-level-1', status='doing', progress_note='已做一部分，稍后继续')
        assert self.reward('qa-level-1') is None
        self.change('qa-level-1', op='update', role='parent', planned_day=self.future)
        task = self.task('qa-level-1')
        assert task['planned_day'] == self.future and task['due_day'] == self.due
        assert task['progress_note'] == '已做一部分，稍后继续'
        self.change('qa-level-1', status='doing', planned_day=self.day, expected=403)
        assert self.task('qa-level-1')['planned_day'] == self.future
        result, body = self.change('qa-level-1', status='done')
        assert result['reward']['points'] == 2
        repeat = self.api('/lan/family/child/feedback', body)
        assert repeat['reward']['points'] == 0 and repeat['reward']['replayed']
        self.change('qa-level-1', status='todo')
        assert self.reward('qa-level-1')['points'] == 0
        self.change('qa-level-1', status='done')
        assert self.reward('qa-level-1')['points'] == 2
        self.change('qa-level-1', op='update', role='parent', planned_day=self.day, expected=409)
        self.change('qa-paper-optional', status='pending_parent')
        assert self.reward('qa-paper-optional') is None
        self.change('qa-paper-optional', role='parent', status='done')
        assert self.reward('qa-paper-optional')['points'] == 4
        self.change('qa-paper-optional', status='todo', expected=403)
        self.change('qa-paper-required', status='pending_parent', expected=403)
        request = Request(self.origin + '/lan/family/child/photos?day=' + self.day
                          + '&child=child_a&task=qa-paper-required&photo=qa-upload',
                          data=PNG, headers={'Content-Type': 'image/png'})
        with urlopen(request, timeout=5) as response:
            assert response.status == 200, response.status
            photo = json.load(response)
            assert photo['photo']['id'] == 'qa-upload'
        self.change('qa-paper-required', status='pending_parent')
        assert self.reward('qa-paper-required') is None
        self.change('qa-paper-required', role='parent', status='done')
        assert self.reward('qa-paper-required')['points'] == 4
        self.change('qa-younger-paper', child='child_b', status='pending_parent')
        assert self.reward('qa-younger-paper', 'child_b') is None
        packet = self.api(f'/lan/family/parent/tasks?day={self.day}&child=child_a')
        group = next(g for g in packet['groups'] if g['id'] == 'qa-week')
        assert group['total'] == 3 and group['done'] == 1 and group['remaining'] == 2
        assert len([t for t in packet['week'] if t['assignment_id'] == 'qa-week']) == 3
        with self.tasks.connect() as con:
            counts = con.execute('SELECT count(*) FROM tasks').fetchone()[0]
        assert counts == 7, counts
        # Reopen stores from durable files, without a schema migration or reseed.
        reopened = server.Tasks(self.root / 'tasks.sqlite3', Photos(self.root / 'photos', self.root / 'tasks.sqlite3'))
        reopened.initialize()
        code, saved = reopened.request('GET', f'/lan/family/parent/task?day={self.day}&child=child_a&id=qa-level-1')
        assert code == 200 and saved['tasks'][0]['status'] == 'done'
        assert saved['tasks'][0]['progress_note'] == '已做一部分，稍后继续'
        self.checks.append('Real HTTP: fixed portions, parent-only rescheduling, partial persistence, explicit deadlines, deduplicated rewards/undo')
        self.checks.append('Real HTTP: paper photo gate/upload/parent confirmation, younger photo exemption, durable store reopen')
        return {'mode': 'http-only', 'checks': self.checks, 'browser_verified': False}

    def seed(self):
        self.api('/lan/family/parent/create', {
            'id': 'qa-week', 'day': self.day, 'child_id': 'child_a',
            'title': '验证英语单词', 'task_kind': 'reading', 'work_type': 'weekly',
            'original_requirement': '在原网站完成指定关卡，回来记录实际完成部分。',
            'due_day': self.due,
            'portions': [
                {'id': 'qa-level-1', 'label': '第1关', 'planned_day': self.day, 'exp_award': 2,
                 'materials': [{'kind': 'link', 'title': '本关练习', 'url': 'https://example.org/level-1'}]},
                {'id': 'qa-level-2', 'label': '第2关', 'planned_day': self.day, 'exp_award': 2},
                {'id': 'qa-level-3', 'label': '第3关', 'planned_day': None, 'exp_award': 2},
            ]})
        samples = [
            ('qa-paper-optional', '验证可选拍照', 'child_a', False),
            ('qa-paper-required', '验证需要拍照', 'child_a', True),
            ('qa-younger-paper', '验证弟弟纸笔', 'child_b', True),
        ]
        for task_id, title, child, required in samples:
            self.api('/lan/family/parent/create', {
                'id': task_id, 'day': self.day, 'child_id': child, 'title': title,
                'task_kind': 'paper', 'work_type': 'school', 'planned_day': self.day,
                'photo_required': required, 'exp_award': 4})
        self.api('/lan/family/parent/create', {
            'id': 'qa-materials', 'day': self.day, 'child_id': 'child_a',
            'title': '验证英语三图写作', 'task_kind': 'paper', 'photo_required': False,
            'planned_day': self.day, 'work_type': 'school',
            'due_day': (self.today - datetime.timedelta(days=1)).isoformat(),
            'original_requirement': '至少35词。课堂限时8分钟；家庭作业没有每日限时要求。',
            'materials': [
                {'kind': 'prompt', 'title': '本任务题图', 'url': 'https://example.org/prompt.pdf', 'page_from': 1, 'page_to': 1},
                {'kind': 'model', 'title': '本任务范文', 'url': 'https://example.org/model.pdf'},
                {'kind': 'answer', 'title': '本任务答案', 'url': 'https://example.org/answer.pdf'},
            ]})

    def go_task(self, page, task_id, child='jared'):
        page.goto(self.origin + '/index.html?transport=lan&mute=1#/' + child + '/task/' + task_id)
        expect(page.get_by_test_id('task-title')).to_be_visible()

    def parent(self, page):
        if not page.get_by_test_id('parent-lock').count():
            page.goto(self.origin + '/index.html?transport=lan&mute=1#/')
        page.get_by_test_id('parent-lock').click()
        expect(page.get_by_test_id('parent-summary')).to_be_visible()

    def screenshot(self, page, name):
        page.screenshot(path=str(self.screenshots / (name + '.png')), full_page=True)

    def no_overflow(self, page, label):
        dims = page.evaluate('({width:innerWidth, body:document.body.scrollWidth, root:document.documentElement.scrollWidth})')
        assert max(dims['body'], dims['root']) <= dims['width'] + 1, (label, dims)

    def child_progress(self, page):
        self.go_task(page, 'qa-level-1')
        expect(page.get_by_test_id('teacher-deadline')).to_contain_text(self.due)
        expect(page.get_by_test_id('photo-open')).to_have_count(0)
        page.get_by_test_id('record-progress').click()
        page.get_by_test_id('progress-note-input').fill('已练习前半，还剩听辨')
        page.get_by_test_id('save-progress').click()
        self.wait_status('qa-level-1', 'doing')
        expect(page.get_by_test_id('partial-progress')).to_contain_text('已练习前半')
        assert self.reward('qa-level-1') is None
        page.reload()
        expect(page.get_by_test_id('partial-progress')).to_contain_text('已练习前半')
        page.get_by_test_id('act-done').click()
        expect(page.get_by_test_id('result-done')).to_be_visible()
        assert self.wait_status('qa-level-1', 'done')['completed_day'] == self.day
        assert self.reward('qa-level-1')['points'] == 2
        page.get_by_test_id('undo-completion').click()
        expect(page.get_by_test_id('act-done')).to_be_visible()
        assert self.wait_status('qa-level-1', 'todo')['progress_note'] == '已练习前半，还剩听辨'
        assert self.reward('qa-level-1')['points'] == 0
        page.get_by_test_id('act-done').click()
        expect(page.get_by_test_id('result-done')).to_be_visible()
        assert self.reward('qa-level-1')['points'] == 2
        page.get_by_test_id('result-home').click()
        page.get_by_test_id('jared-group-card').filter(has_text='KET').click()
        completed = page.locator('li.rcard').filter(has_text='验证英语单词 · 第1关')
        expect(completed.locator('.task-title-content.is-complete')).to_be_visible()
        assert 'line-through' in completed.locator('.task-title-copy').evaluate('(el) => getComputedStyle(el).textDecorationLine')
        expect(completed).to_contain_text('已完成')
        expect(page.locator('li.rcard').filter(has_text='验证英语单词 · 第2关')).to_be_visible()
        self.screenshot(page, 'jared-completed-list')
        self.no_overflow(page, 'jared completed list')
        self.checks.append('Partial progress survives refresh; online completion, undo/redo, one reward, retained struck-through list item')

    def paper_submission(self, page):
        self.go_task(page, 'qa-paper-optional')
        page.get_by_test_id('act-done').click()
        expect(page.get_by_test_id('result-pending_parent')).to_be_visible()
        assert self.wait_status('qa-paper-optional', 'pending_parent')['photo_required'] is False
        assert self.reward('qa-paper-optional') is None
        page.get_by_test_id('result-home').click()
        page.get_by_test_id('jared-group-card').filter(has_text='School Work').click()
        pending = page.locator('li.rcard').filter(has_text='验证可选拍照')
        expect(pending.locator('.task-title-content.is-complete')).to_be_visible()
        expect(pending).to_contain_text('等妈妈检查')
        self.parent(page)
        page.get_by_test_id('p-row').filter(has_text='验证可选拍照').click()
        page.get_by_test_id('detail-primary').click()
        self.wait_status('qa-paper-optional', 'done')
        assert self.reward('qa-paper-optional')['points'] == 4
        self.go_task(page, 'qa-paper-optional')
        expect(page.get_by_test_id('undo-completion')).to_have_count(0)

        self.go_task(page, 'qa-paper-required')
        page.get_by_test_id('act-done').click()
        expect(page.locator('.ps')).to_be_visible()
        expect(page.get_by_test_id('photo-send')).to_be_disabled()
        assert self.task('qa-paper-required')['status'] == 'todo'
        page.get_by_test_id('photo-input').set_input_files({'name': 'synthetic.png', 'mimeType': 'image/png', 'buffer': PNG})
        expect(page.get_by_test_id('photo-drafts')).to_be_visible()
        expect(page.get_by_test_id('photo-send')).to_be_enabled()
        page.get_by_test_id('photo-send').click()
        expect(page.get_by_test_id('result-pending_parent')).to_be_visible()
        self.wait_status('qa-paper-required', 'pending_parent')
        assert self.reward('qa-paper-required') is None
        photo_pack = self.api(f'/lan/family/parent/photos?day={self.day}&child=child_a&task=qa-paper-required')
        assert len(photo_pack['photos']) == 1
        self.parent(page)
        page.get_by_test_id('p-row').filter(has_text='验证需要拍照').click()
        expect(page.locator('.p-detail .p-photo-item')).to_have_count(1)
        page.get_by_test_id('detail-primary').click()
        self.wait_status('qa-paper-required', 'done')
        assert self.reward('qa-paper-required')['points'] == 4
        self.checks.append('Paper optional/required photo gates, real photo upload/readback, parent confirmation controls reward')

    def younger(self, page):
        self.go_task(page, 'qa-younger-paper', 'joey')
        page.get_by_test_id('act-done').click()
        page.get_by_test_id('done-confirm-yes').click()
        self.wait_status('qa-younger-paper', 'pending_parent', 'child_b')
        expect(page.locator('.ps')).to_have_count(0)
        assert self.reward('qa-younger-paper', 'child_b') is None
        self.go_task(page, 'qa-younger-paper', 'joey')
        expect(page.get_by_test_id('task-title').locator('.task-title-content.is-complete')).to_be_visible()
        expect(page.locator('.task-completion-status')).to_contain_text('检查')
        self.no_overflow(page, 'younger submitted task')
        self.screenshot(page, 'joey-submitted-mobile')
        self.checks.append('Younger child paper submission has no photo gate, pending label/check/strike remain')

    def materials(self, page):
        self.go_task(page, 'qa-materials')
        expect(page.get_by_test_id('original-requirement')).to_contain_text('课堂限时8分钟')
        expect(page.get_by_test_id('deadline-support')).to_be_visible()
        expect(page.get_by_test_id('task-material')).to_have_count(3)
        assert not page.locator('details.task-answers').evaluate('(el) => el.open')
        requirement = page.get_by_test_id('original-requirement').bounding_box()
        material = page.get_by_test_id('task-material').first.bounding_box()
        assert requirement['y'] < material['y']
        contrast = page.get_by_test_id('task-material').first.evaluate('''el => {
          const style = getComputedStyle(el);
          const parse = x => x.match(/[\\d.]+/g).slice(0,3).map(Number);
          const lum = rgb => rgb.map(v => v/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4).reduce((n,v,i) => n+v*[.2126,.7152,.0722][i],0);
          const text = lum(parse(style.color));
          const stops = style.backgroundImage.match(/rgba?\\([^)]*\\)/g) || [style.backgroundColor];
          return Math.min(...stops.map(s => { const bg=lum(parse(s)); return (Math.max(text,bg)+.05)/(Math.min(text,bg)+.05); }));
        }''')
        assert contrast >= 4.5, contrast
        self.contrasts.append(round(contrast, 2))
        self.no_overflow(page, 'materials mobile')
        self.screenshot(page, 'materials-mobile')
        self.checks.append('Teacher wording precedes typed materials; answer is separate; real deadline support; material contrast >=4.5')

    def run(self, core_only=False):
        if sync_playwright is None:
            raise RuntimeError('Browser acceptance requires Python Playwright; --http-only uses the standard library.')
        self.seed()
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get('XIAOBU_CHROMIUM', '/usr/bin/chromium'),
                                        headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
            context = browser.new_context(viewport={'width': 390, 'height': 844}, locale='zh-CN', timezone_id='Asia/Shanghai')
            def intercept(route):
                url = route.request.url
                if '/lan/speech/task' in url:
                    route.fulfill(status=503, content_type='application/json', body='{"error":"synthetic_test_no_speech"}')
                elif urlsplit(url).netloc != urlsplit(self.origin).netloc:
                    route.fulfill(status=204, body='')
                else:
                    route.continue_()
            context.route('**/*', intercept)
            page = context.new_page()
            page.set_default_timeout(10000)
            page.on('pageerror', lambda e: self.errors.append(str(e)))
            try:
                self.child_progress(page)
                self.paper_submission(page)
                self.younger(page)
                self.materials(page)
                if not core_only:
                    self.parent_planning(page)
                page.set_viewport_size({'width': 1024, 'height': 768})
                self.go_task(page, 'qa-materials')
                self.no_overflow(page, 'materials tablet')
                self.screenshot(page, 'materials-tablet')
                assert not self.errors, self.errors
            except Exception:
                self.screenshot(page, 'failure')
                raise
            finally:
                context.close()
                browser.close()
        return {'checks': self.checks, 'page_errors': self.errors,
                'material_contrast_min': min(self.contrasts), 'screenshots': str(self.screenshots)}

    def parent_planning(self, page):
        self.parent(page)
        page.get_by_test_id('tab-more').click()
        page.get_by_test_id('more-entry-create').click()
        form = page.get_by_test_id('create-form')
        form.locator('[name=title]').fill('验证家长周安排')
        form.locator('[name=work_type]').select_option('weekly')
        form.locator('[name=child]').select_option('child_a')
        form.locator('[name=due_day]').fill(self.due)
        form.locator('[name=original_requirement]').fill('三份练习，总量保留；先看讲解，独立练习，再对答案。')
        labels = form.get_by_label('这一份的内容', exact=True)
        dates = form.get_by_label('这一份计划日期', exact=True)
        points = form.get_by_label('这一份经验', exact=True)
        expect(labels).to_have_count(3)
        for i, title in enumerate(['第一份', '第二份', '第三份']):
            labels.nth(i).fill(title)
            points.nth(i).fill(str((i + 1) * 2))
        dates.nth(0).fill(self.day)
        dates.nth(1).fill(self.future)
        expect(dates.nth(2)).to_have_value('')
        self.no_overflow(page, 'parent create mobile')
        self.screenshot(page, 'parent-create-mobile')
        page.get_by_test_id('create-submit').click()
        expect(page.locator('.p-form-msg')).to_contain_text('已保存固定的小份')
        packet = self.api(f'/lan/family/parent/tasks?day={self.day}&child=child_a')
        parts = [t for t in packet['week'] if t.get('assignment_title') == '验证家长周安排']
        assert len(parts) == 3
        parts.sort(key=lambda t: t['portion_label'])
        by_label = {t['portion_label']: t for t in parts}
        first, second, third = [by_label[label] for label in ['第一份', '第二份', '第三份']]
        assert len({t['assignment_id'] for t in parts}) == 1
        assert all(t['created_day'] == self.day and t['due_day'] == self.due for t in parts)
        assert first['exp_award'] == 2 and second['exp_award'] == 4 and third['exp_award'] == 6
        assert third['planned_day'] is None

        self.go_task(page, first['id'])
        page.get_by_test_id('act-done').click()
        expect(page.get_by_test_id('result-pending_parent')).to_be_visible()
        self.parent(page)
        page.get_by_test_id('p-row').filter(has_text=first['title']).first.click()
        page.get_by_test_id('detail-primary').click()
        self.wait_status(first['id'], 'done')
        self.go_task(page, second['id'])
        page.get_by_test_id('act-done').click()
        expect(page.get_by_test_id('result-pending_parent')).to_be_visible()
        self.wait_status(second['id'], 'pending_parent')

        self.parent(page)
        overview = page.get_by_test_id('parent-week-overview')
        if not overview.evaluate('(el) => el.open'):
            overview.locator(':scope > summary').click()
        group = page.locator('.p-week-assignment').filter(has_text='验证家长周安排')
        group.get_by_test_id('schedule-portions').click()
        expect(page.get_by_label('第一份计划日期', exact=True)).to_be_disabled()
        expect(page.get_by_label('第二份计划日期', exact=True)).to_be_disabled()
        page.get_by_label('第三份计划日期', exact=True).fill(self.future)
        self.no_overflow(page, 'parent schedule mobile')
        self.screenshot(page, 'parent-schedule-mobile')
        page.get_by_test_id('schedule-save').click()
        expect(page.get_by_test_id('schedule-save')).to_have_count(0)
        assert self.task(first['id'])['planned_day'] == self.day
        assert self.task(second['id'])['planned_day'] == self.future
        assert self.task(third['id'])['planned_day'] == self.future
        assert all(self.task(t['id'])['due_day'] == self.due for t in parts)
        assert self.reward(first['id'])['points'] == 2
        assert self.reward(second['id']) is None and self.reward(third['id']) is None
        page.reload()
        expect(page.get_by_test_id('parent-week-overview')).to_be_visible()
        saved = self.api(f'/lan/family/parent/tasks?day={self.day}&child=child_a')
        saved_group = next(g for g in saved['groups'] if g['id'] == first['assignment_id'])
        assert (saved_group['total'], saved_group['done'], saved_group['pending'], saved_group['remaining']) == (3, 1, 1, 1)
        self.checks.append('Parent UI creates fixed portions; completed/pending dates locked; remaining date changes preserve deadlines, total and XP')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--core-only', action='store_true', help='Run completed child/confirmation flows only')
    parser.add_argument('--http-only', action='store_true', help='Verify actual HTTP lifecycle without claiming browser acceptance')
    parser.add_argument('--screenshots', type=Path)
    args = parser.parse_args()
    screenshots = args.screenshots or Path(tempfile.mkdtemp(prefix='xiaobu-browser-shots-'))
    screenshots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='xiaobu-browser-data-') as directory:
        acceptance = Acceptance(Path(directory), screenshots)
        try:
            result = acceptance.http_lifecycle() if args.http_only else acceptance.run(args.core_only)
            print(json.dumps(result, ensure_ascii=False, indent=2))
        finally:
            acceptance.close()


if __name__ == '__main__':
    main()
