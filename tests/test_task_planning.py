"""Task planning regression tests. All stores and image bytes are synthetic."""
import base64
import datetime
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest


SERVER_DIR = Path(__file__).resolve().parents[1] / 'lan-server'
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))
spec = importlib.util.spec_from_file_location('xiaobu_test_server', SERVER_DIR / 'server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
from photos import Photos
from pledges import Pledges


PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')


class TaskPlanningTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='xiaobu-task-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        Pledges(self.root / 'pledges.sqlite3').initialize()
        self.photos = Photos(self.root / 'photos', self.root / 'tasks.sqlite3')
        self.photos.initialize()
        self.tasks = server.Tasks(self.root / 'tasks.sqlite3', self.photos)
        self.tasks.initialize()
        self.today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date()
        self.day = self.today.isoformat()
        self.yesterday = (self.today - datetime.timedelta(days=1)).isoformat()
        self.future = (self.today + datetime.timedelta(days=2)).isoformat()
        self.due = (self.today + datetime.timedelta(days=6)).isoformat()
        self.seq = 0

    def call(self, role, op, body, expected=200):
        code, result = self.tasks.request('POST', f'/lan/family/{role}/{op}', body)
        self.assertEqual(code, expected, result)
        return result

    def get(self, day=None, role='parent', task_id=None, child='child_a', history=False):
        path = f'/lan/family/{role}/' + ('task' if task_id else 'tasks')
        path += f'?day={day or self.day}&child={child}'
        if task_id:
            path += '&id=' + task_id
        if history:
            path += '&history=1'
        code, result = self.tasks.request('GET', path)
        self.assertEqual(code, 200, result)
        return result

    def stored(self, task_id):
        with self.tasks.connect() as con:
            row = con.execute('SELECT day,payload FROM tasks WHERE id=?', (task_id,)).fetchone()
        return row[0], json.loads(row[1])

    def count(self):
        with self.tasks.connect() as con:
            return con.execute('SELECT count(*) FROM tasks').fetchone()[0]

    def awards(self):
        with self.tasks.connect() as con:
            return [(key, json.loads(payload)) for key, payload in con.execute(
                "SELECT key,payload FROM progress.pledge_progress WHERE key LIKE 'task:%'")]

    def create(self, task_id='one', **changes):
        body = dict(id=task_id, day=self.day, child_id='child_a', title='Synthetic task',
                    task_kind='paper', photo_required=False, exp_award=4)
        body.update(changes)
        self.call('parent', 'create', body)
        return body

    def change(self, task_id, op='update', role='parent', day=None, expected=200, **changes):
        self.seq += 1
        _, task = self.stored(task_id)
        body = dict(task_id=task_id, day=day or self.day, child_id=task['child_id'],
                    expected_version=task['version'], operation_id='operation-' + str(self.seq))
        body.update(changes)
        return self.call(role, op, body, expected)

    def weekly(self, group='week-one', count=10, **changes):
        portions = [{'id': f'{group}-unit-{i}', 'label': f'Portion {i}',
                     'planned_day': self.day, 'exp_award': 2, 'photo_required': False}
                    for i in range(1, count + 1)]
        body = dict(id=group, day=self.day, child_id='child_a', title='Synthetic weekly assignment',
                    work_type='weekly', due_day=self.due, original_requirement='Ten fixed portions',
                    task_kind='paper', portions=portions)
        body.update(changes)
        self.call('parent', 'create', body)
        return body

    def upload(self, task_id, day=None, pid='image-one', **params):
        _, task = self.stored(task_id)
        query = '&'.join(f'{key}={value}' for key, value in params.items())
        path = f'/lan/family/child/photos?day={day or self.day}&child={task["child_id"]}&task={task_id}&photo={pid}'
        if query:
            path += '&' + query
        code, result = self.photos.request('POST', path, raw=PNG, content_type='image/png')
        self.assertEqual(code, 200, result)
        return result

    def test_new_metadata_survives_partial_update_and_uses_actual_creation_day(self):
        materials = [{'kind': 'exercise', 'title': 'Sheet', 'url': 'https://example.org/sheet.pdf',
                      'page_from': 2, 'page_to': 4}]
        self.create(day=self.yesterday, planned_day=self.future, due_day=self.due,
                    work_type='school', original_requirement='Keep the teacher wording', materials=materials)
        task = self.get(task_id='one')['tasks'][0]
        self.assertEqual(task['created_day'], self.day)
        self.assertEqual(task['storage_day'], self.yesterday)
        self.assertEqual(task['planned_day'], self.future)
        self.change('one', parent_note='A parent-only note')
        saved = server.Tasks(self.tasks.db, self.photos).request(
            'GET', f'/lan/family/parent/task?day={self.day}&child=child_a&id=one')[1]['tasks'][0]
        self.assertEqual(saved['materials'], materials)
        self.assertEqual(saved['original_requirement'], 'Keep the teacher wording')
        self.assertEqual(saved['due_day'], self.due)
        self.assertEqual(saved['title'], 'Synthetic task')
        self.assertEqual(saved['exp_award'], 4)
        with self.tasks.connect() as con:
            self.assertEqual(con.execute('PRAGMA user_version').fetchone()[0], 1)

    def test_ten_fixed_portions_complete_one_replan_nine_no_duplicate_reward(self):
        self.weekly()
        self.assertEqual(self.count(), 10)
        self.assertEqual(len(self.get(task_id='week-one')['tasks']), 10)
        first = 'week-one-unit-1'
        self.change(first, op='feedback', role='child', status='doing', progress_note='First two lines checked')
        self.assertEqual(self.awards(), [])
        self.change(first, op='feedback', role='child', status='pending_parent')
        result = self.change(first, op='feedback', status='done')
        self.assertEqual(result['reward']['points'], 2)
        for i in range(2, 11):
            self.change(f'week-one-unit-{i}', planned_day=None if i == 10 else self.future)
        pack = self.get()
        self.assertEqual([t['id'] for t in pack['tasks']], [first])
        self.assertEqual(len(pack['week']), 10)
        self.assertEqual(len(pack['adjusted']), 9)
        self.assertEqual(pack['groups'][0]['total'], 10)
        self.assertEqual(pack['groups'][0]['done'], 1)
        self.assertEqual(pack['groups'][0]['pending'], 0)
        self.assertEqual(pack['groups'][0]['remaining'], 9)
        self.assertEqual(pack['groups'][0]['due_day'], self.due)
        self.assertEqual(self.count(), 10)
        self.assertEqual(len(self.awards()), 1)
        self.assertEqual(self.awards()[0][1]['points'], 2)
        for task in pack['week']:
            self.assertEqual(task['storage_day'], self.day)
            self.assertEqual(task['due_day'], self.due)
        self.assertEqual(pack['week'][0]['progress_note'], 'First two lines checked')

    def test_weekly_create_exact_retry_conflicts_and_rolls_back(self):
        body = self.weekly(count=2)
        self.call('parent', 'create', body)
        self.assertEqual(self.count(), 2)
        self.call('parent', 'create', dict(body, title='Different content'), 409)
        conflict = dict(body, id='another-group', portions=[dict(body['portions'][0], id='new-unit'), body['portions'][1]])
        self.call('parent', 'create', conflict, 409)
        self.assertEqual(self.count(), 2)
        with self.tasks.connect() as con:
            self.assertIsNone(con.execute("SELECT id FROM operations WHERE id='create:another-group'").fetchone())

    def test_weekly_create_database_error_rolls_back_all_rows(self):
        with self.tasks.connect() as con:
            con.execute("""CREATE TRIGGER fail_unit BEFORE INSERT ON tasks WHEN NEW.id='failure-2'
                           BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END""")
        body = dict(id='failure', day=self.day, child_id='child_a', title='Synthetic batch', work_type='weekly',
                    portions=[{'id': 'failure-1', 'label': 'One', 'exp_award': 1},
                              {'id': 'failure-2', 'label': 'Two', 'exp_award': 1}])
        self.call('parent', 'create', body, 503)
        self.assertEqual(self.count(), 0)

    def test_weekly_materials_are_per_portion_and_unplanned_is_not_today(self):
        common = [{'kind': 'link', 'title': 'Common', 'url': 'https://example.org/common'}]
        unit = [{'kind': 'exercise', 'title': 'Only first', 'url': 'https://example.org/one'}]
        self.weekly(count=2, materials=common, portions=[
            {'id': 'part-one', 'label': 'One', 'exp_award': 1, 'materials': unit},
            {'id': 'part-two', 'label': 'Two', 'exp_award': 1}])
        pack = self.get()
        self.assertEqual(pack['tasks'], [])
        self.assertEqual([t['materials'] for t in pack['week']], [unit, []])
        self.assertTrue(all(t['planned_day'] is None for t in pack['week']))
        self.assertEqual(len(self.get(task_id='week-one')['tasks']), 2)

    def test_weekly_prior_units_have_no_debt_flag_and_completion_ignores_legacy_end(self):
        self.weekly(count=1, portions=[{'id': 'past-unit', 'label': 'One', 'exp_award': 2,
                                     'planned_day': self.yesterday, 'task_kind': 'audio'}])
        task = self.get()['tasks'][0]
        self.assertFalse(task.get('carried_over', False))
        self.change('past-unit', op='feedback', role='child', status='done')
        self.assertEqual(self.get()['tasks'][0]['completed_day'], self.day)
        _, old = self.stored('past-unit')
        old.pop('work_type')
        old.pop('due_day', None)
        old['plan'] = {'start': self.yesterday, 'end': self.yesterday}
        with self.tasks.connect() as con:
            con.execute('UPDATE tasks SET payload=? WHERE id=?', (json.dumps(old), 'past-unit'))
        task = self.get()['tasks'][0]
        self.assertIsNone(task['due_day'])
        self.assertEqual(task['work_type'], 'weekly')
        self.assertFalse(self.get(day=self.future)['tasks'])

    def test_progress_replan_preserves_dates_and_blocks_completed_or_pending(self):
        self.weekly(count=1)
        task_id = 'week-one-unit-1'
        self.change(task_id, op='feedback', role='child', status='doing', progress_note='Stopped at question 3')
        self.change(task_id, planned_day=self.future)
        task = self.get(task_id=task_id)['tasks'][0]
        self.assertEqual(task['progress_note'], 'Stopped at question 3')
        self.assertEqual(task['status'], 'doing')
        self.assertEqual(task['day'], self.day)
        self.assertEqual(task['planned_day'], self.future)
        self.assertEqual(task['due_day'], self.due)
        self.assertEqual(task['storage_day'], self.day)
        self.change(task_id, planned_day=self.day)
        self.change(task_id, op='feedback', role='child', status='pending_parent')
        self.change(task_id, planned_day=self.future, expected=409)
        self.assertFalse(self.get()['tasks'][0].get('deadline_passed', False))
        self.change(task_id, op='feedback', status='done')
        self.change(task_id, planned_day=None, expected=409)
        self.change(task_id, op='delete', expected=409)
        self.change(task_id, op='feedback', status='archived', expected=409)

    def test_legacy_weekly_portions_cannot_be_deleted_or_archived(self):
        ids = [f'legacy-part-{i}' for i in range(1, 4)]
        for task_id in ids:
            self.create(task_id)
            _, task = self.stored(task_id)
            task.pop('work_type')
            task['plan'] = {'start': self.yesterday, 'end': self.due}
            with self.tasks.connect() as con:
                con.execute('UPDATE tasks SET payload=? WHERE id=?', (json.dumps(task), task_id))
            for op, fields in [('delete', {}), ('feedback', {'status': 'archived'})]:
                with self.subTest(task_id=task_id, op=op):
                    result = self.change(task_id, op=op, expected=409, **fields)
                    self.assertEqual(result['error'], 'weekly_portion_required')
                    self.assertEqual(self.stored(task_id)[1], task)
        self.assertEqual(self.count(), 3)
        pack = self.get()
        self.assertEqual([t['id'] for t in pack['week']], ids)
        self.assertEqual(pack['groups'], [])  # A shared plan range does not invent a group.
        self.create('school-delete')
        self.change('school-delete', op='delete')
        self.create('school-archive')
        self.change('school-archive', op='feedback', status='archived')
        self.assertEqual(self.count(), 4)
        self.assertEqual(self.stored('school-archive')[1]['status'], 'archived')
        self.assertEqual([t['id'] for t in self.get()['week']], ids)

    def test_weekly_overview_closes_old_groups_without_losing_totals_or_history(self):
        earlier = (self.today - datetime.timedelta(days=7)).isoformat()
        for group, planned, count in [('old-complete', earlier, 2), ('current-complete', self.day, 2),
                                      ('old-active', earlier, 3)]:
            self.weekly(group=group, day=planned, task_kind='audio', portions=[
                {'id': f'{group}-{i}', 'label': str(i), 'planned_day': planned, 'exp_award': 2}
                for i in range(1, count + 1)])
        for task_id in ['old-complete-1', 'old-complete-2', 'old-active-1']:
            self.change(task_id, op='feedback', role='child', day=earlier, status='done')
        self.change('old-active-2', op='feedback', role='child', day=earlier, status='pending_parent')
        for task_id in ['current-complete-1', 'current-complete-2']:
            self.change(task_id, op='feedback', role='child', status='done')

        before = {t: self.stored(t) for t in ['old-complete-1', 'old-complete-2']}
        for role in ['parent', 'child']:
            pack = self.get(role=role)
            self.assertEqual({t['assignment_id'] for t in pack['week']}, {'current-complete', 'old-active'})
            active = next(g for g in pack['groups'] if g['id'] == 'old-active')
            self.assertEqual((active['total'], active['done'], active['pending'], active['remaining']), (3, 1, 1, 1))
            self.assertEqual(len([t for t in pack['week'] if t['assignment_id'] == 'old-active']), 3)
            self.assertTrue(any(t['id'] == 'old-active-3' for t in pack['tasks']))
            self.assertFalse(any(t.get('carried_over') for t in pack['week']))
        historical = self.get(day=earlier, role='child', history=True)
        self.assertEqual({g['id'] for g in historical['groups']}, {'old-complete', 'old-active'})
        self.assertEqual(len(historical['tasks']), 5)
        self.assertEqual(len(historical['week']), 5)
        closed = self.get(task_id='old-complete')
        self.assertEqual(len(closed['tasks']), 2)
        self.assertEqual(closed['groups'][0]['total'], 2)
        self.assertEqual(len(self.get(task_id='old-complete-1', role='child')['tasks']), 1)
        self.assertEqual(self.count(), 7)
        self.assertEqual({t: self.stored(t) for t in before}, before)

    def test_completed_weekly_group_keeps_known_plan_submission_and_completion_days(self):
        for group, planned, submitted, completed in [
            ('plan-today', self.day, self.yesterday, self.yesterday),
            ('submitted-today', self.yesterday, self.day, self.future),
            ('completed-today', self.yesterday, self.yesterday, self.day),
        ]:
            self.weekly(group=group, count=1, day=self.yesterday, portions=[
                {'id': group + '-1', 'label': 'One', 'planned_day': planned, 'exp_award': 2,
                 'photo_required': False}])
            self.change(group + '-1', op='feedback', role='child', day=submitted, status='pending_parent')
            self.change(group + '-1', op='feedback', day=completed, status='done')
        self.assertEqual({g['id'] for g in self.get()['groups']},
                         {'plan-today', 'submitted-today', 'completed-today'})
        self.assertEqual(self.get(day=self.due)['groups'], [])

    def test_ungrouped_legacy_weekly_overview_uses_only_its_known_dates(self):
        for task_id in ['legacy-done', 'legacy-active']:
            self.create(task_id, day=self.yesterday, task_kind='audio')
            _, task = self.stored(task_id)
            for key in ['work_type', 'planned_day', 'created_day', 'due_day']:
                task.pop(key)
            task['plan'] = {'start': self.yesterday, 'end': self.due}
            with self.tasks.connect() as con:
                con.execute('UPDATE tasks SET payload=? WHERE id=?', (json.dumps(task), task_id))
        self.change('legacy-done', op='feedback', role='child', day=self.yesterday, status='done')
        pack = self.get()
        self.assertEqual([t['id'] for t in pack['week']], ['legacy-active'])
        self.assertEqual(pack['groups'], [])
        self.assertIsNone(pack['week'][0]['created_day'])
        self.assertIsNone(pack['week'][0]['due_day'])
        self.assertEqual(len(self.get(day=self.yesterday, role='child', history=True)['week']), 2)
        self.assertEqual(len(self.get(task_id='legacy-done')['tasks']), 1)

    def test_adjustment_is_only_projection_and_replanning_after_due_warns(self):
        self.create(due_day=self.yesterday)
        self.assertTrue(self.get()['tasks'][0]['deadline_passed'])
        result = self.change('one', planned_day=self.future)
        self.assertEqual(result['tasks'], [])
        self.assertEqual(result['adjusted'][0]['planned_day'], self.future)
        self.assertNotIn('status', result['adjusted'][0])
        self.assertNotIn('exp_award', result['adjusted'][0])
        task = self.get(task_id='one')['tasks'][0]
        self.assertEqual(task['planning_warning'], 'planned_after_due')
        self.assertEqual(task['due_day'], self.yesterday)
        self.assertEqual(self.awards(), [])

    def test_child_forbidden_schedule_and_reward_fields_are_rejected(self):
        self.create(task_kind='audio')
        for key, value in [('planned_day', self.future), ('due_day', self.due),
                           ('work_type', 'weekly'), ('exp_award', 50), ('exp_award_locked', False),
                           ('assignment_id', 'wrong'), ('photo_required', False),
                           ('created_day', self.yesterday), ('materials', [])]:
            with self.subTest(key=key):
                self.change('one', op='feedback', role='child', status='doing', expected=403, **{key: value})
        self.assertEqual(self.stored('one')[1]['version'], 0)

    def test_photo_gate_is_typed_and_paper_confirmation_is_always_required(self):
        self.create(photo_required=False)
        self.change('one', op='feedback', role='child', status='done', expected=403)
        self.change('one', op='feedback', role='child', status='pending_parent')
        self.change('one', op='feedback', status='done')
        self.create('needs-photo', photo_required=True)
        self.change('needs-photo', op='feedback', role='child', status='pending_parent', expected=403)
        for kind in ('reading', 'audio'):
            self.create(kind, task_kind=kind, photo_required=True)
            self.change(kind, op='feedback', role='child', status='done')
        self.create('younger', child_id='child_b', photo_required=True)
        self.change('younger', op='feedback', role='child', status='pending_parent')
        self.change('younger', op='feedback', status='done')

    def test_legacy_absent_photo_flag_keeps_gate_and_creation_date_unknown(self):
        self.create()
        _, task = self.stored('one')
        for key in ('photo_required', 'created_day', 'planned_day', 'work_type', 'due_day'):
            task.pop(key, None)
        with self.tasks.connect() as con:
            con.execute('UPDATE tasks SET payload=? WHERE id=?', (json.dumps(task), 'one'))
        self.change('one', op='feedback', role='child', status='pending_parent', expected=403)
        projected = self.get()['tasks'][0]
        self.assertIsNone(projected.get('created_day'))
        self.assertTrue(projected['photo_required'])

    def test_undo_online_completion_reverses_and_restores_single_ledger_row(self):
        def assert_progress(day, count, points, rated):
            code, pack = Pledges(self.root / 'pledges.sqlite3').request(
                'GET', f'/lan/family/child/progress?day={day}&child=child_a')
            self.assertEqual(code, 200, pack)
            self.assertEqual((pack['today']['task_count'], pack['today']['task_exp'], pack['today']['rated']),
                             (count, points, rated))

        self.create(task_kind='audio', exp_award=7)
        self.assertFalse(self.get(task_id='one')['tasks'][0]['exp_award_locked'])
        done = self.change('one', op='feedback', role='child', status='done')
        self.assertEqual(done['reward']['points'], 7)
        assert_progress(self.day, 1, 7, True)
        undo = self.change('one', op='feedback', role='child', status='todo')
        self.assertEqual(undo['reward']['points'], -7)
        self.assertEqual(len(self.awards()), 1)
        self.assertEqual(self.awards()[0][1]['points'], 0)
        self.assertTrue(self.awards()[0][1]['reversed'])
        assert_progress(self.day, 0, 0, False)
        version = self.stored('one')[1]['version']
        rejected = self.change('one', exp_award=30, expected=409)
        self.assertEqual(rejected['error'], 'reward_amount_locked')
        self.assertEqual(self.stored('one')[1]['version'], version)
        self.assertEqual(self.stored('one')[1]['exp_award'], 7)
        task = self.get(task_id='one')['tasks'][0]
        self.assertTrue(task['exp_award_locked'])
        self.assertEqual(task['exp_award'], 7)
        self.change('one', planned_day=self.future, exp_award=7)
        self.assertEqual(self.get(task_id='one')['tasks'][0]['planned_day'], self.future)
        done_again = self.change('one', op='feedback', role='child', day=self.future, status='done')
        self.assertEqual(done_again['reward']['points'], 7)
        self.assertEqual(done_again['reward']['lifetime_exp'], 7)
        self.assertEqual(len(self.awards()), 1)
        self.assertEqual(self.awards()[0][1]['points'], 7)
        self.assertFalse(self.awards()[0][1]['reversed'])
        assert_progress(self.day, 0, 0, False)
        assert_progress(self.future, 1, 7, True)
        repeated = self.change('one', op='feedback', role='child', day=self.future, status='done')
        self.assertEqual(repeated['reward']['points'], 0)
        self.assertEqual(len(self.awards()), 1)
        assert_progress(self.future, 1, 7, True)

    def test_reward_amount_is_editable_before_award_and_zero_award_also_locks(self):
        for task_id, points in [('positive', 9), ('zero', 0)]:
            self.create(task_id, task_kind='audio', exp_award=4)
            self.assertFalse(self.get(task_id=task_id)['tasks'][0]['exp_award_locked'])
            self.change(task_id, exp_award=points)
            self.assertEqual(self.get(task_id=task_id)['tasks'][0]['exp_award'], points)
            self.change(task_id, op='feedback', role='child', status='done')
            self.assertTrue(self.get(task_id=task_id)['tasks'][0]['exp_award_locked'])
            rejected = self.change(task_id, exp_award=3, expected=409)
            self.assertEqual(rejected['error'], 'reward_amount_locked')
            self.assertEqual(self.get(task_id=task_id)['tasks'][0]['exp_award'], points)

    def test_reward_projection_uses_original_ledger_amount_without_rewriting_metadata(self):
        self.create(task_kind='audio', exp_award=7)
        self.change('one', op='feedback', role='child', status='done')
        self.change('one', op='feedback', role='child', status='todo')
        _, task = self.stored('one')
        task['exp_award'] = 30  # Historical update/undo could already leave inconsistent metadata.
        with self.tasks.connect() as con:
            con.execute('UPDATE tasks SET payload=? WHERE id=?', (json.dumps(task), 'one'))
            before = con.execute('SELECT version,payload FROM tasks WHERE id=?', ('one',)).fetchone()
        for role in ['parent', 'child']:
            projected = self.get(task_id='one', role=role)['tasks'][0]
            self.assertEqual(projected['exp_award'], 7)
            self.assertTrue(projected['exp_award_locked'])
        with self.tasks.connect() as con:
            self.assertEqual(con.execute('SELECT version,payload FROM tasks WHERE id=?', ('one',)).fetchone(), before)
        # A date-only edit remains valid even if old stored metadata disagrees.
        self.change('one', planned_day=self.future)
        projected = self.get(task_id='one')['tasks'][0]
        self.assertEqual(projected['planned_day'], self.future)
        self.assertEqual(projected['exp_award'], 7)
        self.assertEqual(self.stored('one')[1]['exp_award'], 30)

    def test_reward_projection_reads_child_ledger_once_and_supports_legacy_amount(self):
        self.weekly(count=3, task_kind='audio')
        self.change('week-one-unit-1', op='feedback', role='child', status='done')
        with self.tasks.connect() as con:
            key = 'task:child_a:week-one-unit-1'
            award = json.loads(con.execute('SELECT payload FROM progress.pledge_progress WHERE key=?', (key,)).fetchone()[0])
            award.pop('original_points')  # A pre-lock receipt has points but no original_points.
            con.execute('UPDATE progress.pledge_progress SET payload=? WHERE key=?', (json.dumps(award), key))
        with self.tasks.connect() as con:
            queries = []
            con.set_trace_callback(queries.append)
            pack = server.Tasks.pack(con, 'parent', self.day, 'child_a')
        ledger_reads = [q for q in queries if 'FROM progress.pledge_progress' in q]
        self.assertEqual(len(ledger_reads), 1)
        for rows in [pack['tasks'], pack['week']]:
            first = next(t for t in rows if t['id'] == 'week-one-unit-1')
            self.assertTrue(first['exp_award_locked'])
            self.assertEqual(first['exp_award'], 2)
        self.assertFalse(pack['week'][1]['exp_award_locked'])
        self.assertEqual(self.change('week-one-unit-1', exp_award=10, expected=409)['error'], 'reward_amount_locked')

    def test_confirmed_or_unknown_completion_cannot_be_child_undone(self):
        self.create(task_kind='audio')
        self.change('one', op='feedback', status='done')
        self.change('one', op='feedback', role='child', status='todo', expected=403)
        _, task = self.stored('one')
        task.pop('completed_by')
        with self.tasks.connect() as con:
            con.execute('UPDATE tasks SET payload=? WHERE id=?', (json.dumps(task), 'one'))
        self.change('one', op='feedback', role='child', status='todo', expected=403)
        self.assertEqual(self.awards()[0][1]['points'], 4)

    def test_next_day_parent_confirmation_preserves_submission_day(self):
        self.create(day=self.yesterday)
        self.change('one', op='feedback', role='child', day=self.yesterday, status='pending_parent')
        self.change('one', op='feedback', status='done')
        task = self.get()['tasks'][0]
        self.assertEqual(task['submitted_day'], self.yesterday)
        self.assertEqual(task['completed_day'], self.day)
        self.assertEqual(task['confirmed_day'], self.day)
        self.assertEqual(task['completed_by'], 'parent')

    def test_parent_queue_includes_cross_day_habit_and_unplanned_weekly_submissions(self):
        self.create('habit', day=self.yesterday, work_type='habit', planned_day=self.yesterday)
        self.change('habit', op='feedback', role='child', day=self.yesterday, status='pending_parent')
        self.weekly(count=1, portions=[{'id': 'unplanned', 'label': 'One', 'planned_day': None,
                                     'exp_award': 2, 'photo_required': False}])
        self.change('unplanned', op='feedback', role='child', day=self.yesterday, status='pending_parent')
        self.create('later-submission', planned_day=self.yesterday)
        self.change('later-submission', op='feedback', role='child', day=self.future, status='pending_parent')
        parent = self.get()['tasks']
        self.assertEqual({t['id'] for t in parent}, {'habit', 'unplanned'})
        self.assertTrue(all(t['submitted_day'] == self.yesterday for t in parent))
        self.assertFalse(any(t['deadline_passed'] for t in parent))
        self.assertEqual(self.awards(), [])

    def test_child_history_uses_planned_and_actual_dates_not_creation_storage(self):
        earlier = (self.today - datetime.timedelta(days=2)).isoformat()
        self.create(day=earlier, planned_day=self.yesterday)
        def history(day):
            code, pack = self.tasks.request('GET', f'/lan/family/child/tasks?day={day}&child=child_a&history=1')
            self.assertEqual(code, 200, pack)
            return pack['tasks']
        self.assertEqual([t['id'] for t in history(self.yesterday)], ['one'])
        self.assertEqual(history(earlier), [])
        self.change('one', op='feedback', role='child', day=self.yesterday, status='pending_parent')
        self.change('one', op='feedback', status='done')
        self.assertEqual([t['id'] for t in history(self.yesterday)], ['one'])
        self.assertEqual([t['id'] for t in history(self.day)], ['one'])
        self.assertEqual(history(earlier), [])
        self.create('unplanned-history', day=earlier, planned_day=None)
        self.assertEqual(history(earlier), [])
        self.create('legacy-history', day=earlier)
        _, legacy = self.stored('legacy-history')
        legacy.pop('planned_day')
        with self.tasks.connect() as con:
            con.execute('UPDATE tasks SET payload=? WHERE id=?', (json.dumps(legacy), 'legacy-history'))
        self.assertEqual([t['id'] for t in history(earlier)], ['legacy-history'])

    def test_new_operation_repeated_done_preserves_completion_and_submission_evidence(self):
        self.create(task_kind='audio', day=self.yesterday)
        self.change('one', op='feedback', role='child', day=self.yesterday, status='pending_parent')
        self.change('one', op='feedback', role='child', day=self.yesterday, status='done')
        before = self.stored('one')[1]
        repeat = self.change('one', op='feedback', role='child', status='done')
        after = self.stored('one')[1]
        for key in ('completed_day', 'completed_by', 'submitted_day', 'submitted_by'):
            self.assertEqual(after[key], before[key])
        self.assertEqual(repeat['reward']['points'], 0)
        self.assertEqual(self.get()['tasks'], [])
        self.change('one', op='feedback', status='done')
        latest = self.stored('one')[1]
        self.assertEqual(latest['completed_by'], 'child')
        self.assertEqual(latest['completed_day'], self.yesterday)
        self.assertNotIn('confirmed_day', latest)
        self.assertEqual(self.awards()[0][1]['day'], self.yesterday)

    def test_reward_restore_keeps_original_award_evidence_without_second_morph(self):
        with self.tasks.connect() as con:
            con.execute('INSERT INTO progress.pledge_progress VALUES(?,?,?)',
                        ('task:child_a:synthetic-prior', 1, json.dumps({'day': self.yesterday, 'points': 295})))
        self.create(task_kind='audio', exp_award=7)
        first = self.change('one', op='feedback', role='child', status='done')
        self.assertTrue(first['reward']['form_changed'])
        first_event = first['reward']['event_id']
        self.change('one', op='feedback', role='child', status='todo')
        restored = self.change('one', op='feedback', role='child', status='done')
        self.assertEqual(restored['reward']['points'], 7)
        self.assertFalse(restored['reward']['form_changed'])
        self.assertNotIn('celebrate', restored['reward'])
        record = dict(self.awards())['task:child_a:one']
        self.assertEqual(record['original_operation_id'], first_event)
        self.assertTrue(record['original_form_receipt']['form_changed'])

    def test_moving_a_carried_task_leaves_a_note_on_the_viewed_day(self):
        self.create(day=self.yesterday)
        self.assertTrue(self.get()['tasks'][0]['carried_over'])
        result = self.change('one', planned_day=self.future)
        self.assertEqual(result['tasks'], [])
        self.assertEqual([t['id'] for t in result['adjusted']], ['one'])

    def test_feedback_retry_has_no_second_reward_and_pending_undo_has_none(self):
        self.create(task_kind='audio')
        body = dict(task_id='one', day=self.day, child_id='child_a', expected_version=0,
                    operation_id='same-feedback', status='done')
        self.call('child', 'feedback', body)
        retry = self.call('child', 'feedback', body)
        self.assertEqual(retry['reward']['points'], 0)
        self.assertTrue(retry['reward']['replayed'])
        self.assertEqual(len(self.awards()), 1)
        self.create('paper-two')
        self.change('paper-two', op='feedback', role='child', status='pending_parent')
        self.change('paper-two', op='feedback', role='child', status='todo')
        self.assertEqual(len(self.awards()), 1)
        self.change('paper-two', op='feedback', role='child', status='pending_parent')
        self.change('paper-two', op='feedback', status='done')
        self.change('paper-two', op='feedback', role='child', status='todo', expected=403)

    def test_photo_uploaded_yesterday_is_reviewable_today_after_replan(self):
        self.create(day=self.yesterday, photo_required=True)
        self.upload('one', day=self.yesterday)
        self.change('one', planned_day=self.day)
        path = f'/lan/family/parent/photos?day={self.day}&child=child_a&task=one'
        code, pack = self.photos.request('GET', path)
        self.assertEqual(code, 200, pack)
        self.assertEqual(pack['storage_day'], self.yesterday)
        self.assertEqual(pack['day'], self.day)
        self.assertEqual(len(pack['photos']), 1)
        self.assertEqual(self.photos.count(self.day, 'child_a', 'one'), len(pack['photos']))
        self.assertEqual(self.photos.request('GET', pack['photos'][0]['url'])[1]['__raw__'], PNG)
        self.change('one', op='feedback', role='child', status='pending_parent')
        self.change('one', op='feedback', status='done')
        self.assertTrue((self.root / 'photos' / self.yesterday / 'child_a' / 'one' / 'image-one.png').is_file())

    def test_legacy_weekly_photos_in_later_folder_stay_discoverable(self):
        self.create(day=self.yesterday, photo_required=True)
        _, task = self.stored('one')
        task['plan'] = {'start': self.yesterday, 'end': self.due}
        task.pop('work_type', None)
        with self.tasks.connect() as con:
            con.execute('UPDATE tasks SET payload=? WHERE id=?', (json.dumps(task), 'one'))
        folder = self.root / 'photos' / self.day / 'child_a' / 'one'
        folder.mkdir(parents=True)
        (folder / 'legacy-image.png').write_bytes(PNG)
        (folder / 'meta.json').write_text(json.dumps({'revision': 4, 'photos': [
            {'id': 'legacy-image', 'file': 'legacy-image.png', 'size': len(PNG)}]}))
        self.upload('one', pid='new-image')
        code, pack = self.photos.request('GET', f'/lan/family/parent/photos?day={self.future}&child=child_a&task=one')
        self.assertEqual(code, 200, pack)
        self.assertEqual(pack['storage_day'], self.yesterday)
        self.assertEqual(len(pack['photos']), 2)
        self.assertEqual(self.photos.count(self.future, 'child_a', 'one'), 2)
        for photo in pack['photos']:
            self.assertEqual(self.photos.request('GET', photo['url'])[1]['__raw__'], PNG)
        self.assertTrue((folder / 'legacy-image.png').is_file())
        self.assertTrue((self.root / 'photos' / self.yesterday / 'child_a' / 'one' / 'new-image.png').is_file())
        revision = pack['revision']
        code, removed = self.photos.request('POST', '/lan/family/child/photos/delete', body={
            'day': self.future, 'child_id': 'child_a', 'task_id': 'one', 'photo_id': 'legacy-image',
            'expected_revision': revision})
        self.assertEqual(code, 200, removed)
        self.assertEqual(removed['revision'], revision + 1)
        self.assertEqual(self.photos.count(self.day, 'child_a', 'one'), 1)
        code, reread = self.photos.request('GET', f'/lan/family/parent/photos?day={self.day}&child=child_a&task=one')
        self.assertEqual(code, 200, reread)
        self.assertEqual(reread['revision'], revision + 1)
        self.assertEqual([p['id'] for p in reread['photos']], ['new-image'])
        self.assertTrue((folder / 'legacy-image.png').is_file())
        code, library = self.photos.request('GET', f'/lan/family/parent/photo-library?day={self.yesterday}&child=child_a')
        self.assertEqual(code, 200, library)
        self.assertEqual(library['days'], [{'day': self.yesterday, 'count': 1}])
        self.assertEqual(len(library['posts'][0]['pack']['photos']), 1)
        self.change('one', op='feedback', role='child', day=self.future, status='pending_parent')
        self.change('one', op='feedback', day=self.future, status='done')

    def test_photo_revision_and_task_version_still_protect_parent_review(self):
        self.create(photo_required=True)
        initial = self.upload('one')['pack']
        self.change('one', op='feedback', role='child', status='pending_parent')
        pending = self.stored('one')[1]
        self.upload('one', pid='image-two')
        self.call('parent', 'feedback', dict(task_id='one', day=self.day, child_id='child_a',
            expected_version=pending['version'], operation_id='stale-confirmation', status='done'), 409)
        self.change('one', op='feedback', status='done', expected=409)
        code, result = self.photos.request('POST', '/lan/family/child/photos/delete', body={
            'day': self.day, 'child_id': 'child_a', 'task_id': 'one', 'photo_id': 'image-one',
            'expected_revision': initial['revision']})
        self.assertEqual(code, 409, result)
        self.assertEqual(self.photos.count(self.day, 'child_a', 'one'), 2)
        self.change('one', op='feedback', role='child', status='pending_parent')
        self.change('one', op='feedback', status='done')

    def legacy_photo_sources(self, anchor_sent=False, later_sent=False):
        self.create(day=self.yesterday, photo_required=True)
        for day, pid, sent in ((self.yesterday, 'anchor-photo', anchor_sent), (self.day, 'later-photo', later_sent)):
            folder = self.root / 'photos' / day / 'child_a' / 'one'
            folder.mkdir(parents=True)
            (folder / (pid + '.png')).write_bytes(PNG)
            (folder / 'meta.json').write_text(json.dumps({'revision': 1, 'teacher_sent': sent,
                'sent_at': day + 'T01:00:00Z' if sent else None,
                'photos': [{'id': pid, 'file': pid + '.png', 'size': len(PNG)}]}))

    def photo_pack(self, day=None):
        code, pack = self.photos.request('GET', f'/lan/family/parent/photos?day={day or self.day}&child=child_a&task=one')
        self.assertEqual(code, 200, pack)
        return pack

    def photo_card(self, day):
        code, library = self.photos.request('GET', f'/lan/family/parent/photo-library?day={day}&child=child_a')
        self.assertEqual(code, 200, library)
        return library['posts'][0]['pack']

    def mark_sent(self, day=None, expected=200, **changes):
        self.seq += 1
        body = {'day': day or self.day, 'child_id': 'child_a', 'task_id': 'one', 'value': True,
                'expected_revision': self.photo_pack()['revision'], 'operation_id': 'sent-' + str(self.seq)}
        body.update(changes)
        code, pack = self.photos.request('POST', '/lan/family/parent/photos/sent', body=body)
        self.assertEqual(code, expected, pack)
        return pack

    def test_photo_sent_aggregate_cannot_hide_an_unsent_legacy_source(self):
        self.legacy_photo_sources(anchor_sent=True)
        self.assertFalse(self.photo_pack()['teacher_sent'])
        self.assertTrue(self.photo_card(self.yesterday)['teacher_sent'])
        self.assertFalse(self.photo_card(self.day)['teacher_sent'])
        # The previous compatibility layer could already have copied a reference
        # into the anchor without a per-photo flag. Its original source still wins.
        anchor_path = self.root / 'photos' / self.yesterday / 'child_a' / 'one' / 'meta.json'
        anchor = json.loads(anchor_path.read_text())
        anchor['photos'].append({'id': 'later-photo', 'file': 'later-photo.png',
                                 'size': len(PNG), 'storage_day': self.day})
        anchor_path.write_text(json.dumps(anchor))
        self.assertFalse(self.photo_pack()['teacher_sent'])

    def test_photo_sent_scope_preserves_other_date_cards_and_old_date_subset(self):
        self.legacy_photo_sources()
        card = self.photo_card(self.day)
        self.assertEqual([p['id'] for p in card['photos']], ['later-photo'])
        marked = self.mark_sent(photo_ids=['later-photo'])
        self.assertTrue(marked['teacher_sent'])
        self.assertEqual(marked['scope_photo_ids'], ['later-photo'])
        self.assertEqual([p['id'] for p in marked['photos']], ['later-photo'])
        self.assertTrue(self.photo_card(self.day)['teacher_sent'])
        self.assertFalse(self.photo_card(self.yesterday)['teacher_sent'])
        self.assertFalse(self.photo_pack()['teacher_sent'])
        self.mark_sent(day=self.yesterday)  # A pre-photo_ids client identifies this exact date card.
        self.assertTrue(self.photo_pack()['teacher_sent'])
        self.mark_sent(value=False, photo_ids=['later-photo'])
        self.assertTrue(self.photo_card(self.yesterday)['teacher_sent'])
        self.assertFalse(self.photo_card(self.day)['teacher_sent'])
        revision = self.photo_pack()['revision']
        self.mark_sent(day=self.future, expected=409)  # Ambiguous old client must refresh, never mark all.
        self.assertEqual(self.photo_pack()['revision'], revision)
        self.mark_sent(photo_ids=['missing-photo'], expected=409)
        self.mark_sent(photo_ids=[], expected=400)
        self.mark_sent(photo_ids=['later-photo'], expected_revision=revision - 1, expected=409)
        self.assertEqual(self.photo_pack()['revision'], revision)
        for day, pid in ((self.yesterday, 'anchor-photo'), (self.day, 'later-photo')):
            self.assertTrue((self.root / 'photos' / day / 'child_a' / 'one' / (pid + '.png')).is_file())

    def test_input_validation_rejects_bad_dates_materials_and_reward_values(self):
        for changes in ({'planned_day': '2026-02-30'}, {'due_day': 'tomorrow'}, {'exp_award': True},
                        {'exp_award': 51}, {'photo_required': 'yes'}, {'work_type': 'unknown'},
                        {'materials': [{'kind': 'answer', 'title': 'Bad', 'url': 'javascript:alert(1)'}]}):
            body = dict(id='bad', day=self.day, child_id='child_a', title='Invalid synthetic task', **changes)
            self.call('parent', 'create', body, 400)
        self.assertEqual(self.count(), 0)


if __name__ == '__main__':
    unittest.main()
