#!/usr/bin/env python3
"""Xiaobu LAN: static UI and local data; selected speech text may use Edge TTS."""
import argparse
import datetime
import ipaddress
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs, unquote

from pledges import Pledges, RULES, FORM_NAMES, form_for_lifetime, form_thresholds_for
from local_speech import LocalSpeech
from photos import Photos

def award_points(task, task_id):
    """Per-task difficulty EXP from payload.exp_award; itinerary/default fallback. Cap 50."""
    raw = task.get('exp_award')
    if type(raw) is int:
        return max(0, min(RULES.get('max_task_exp', 50), raw))
    if task.get('itinerary') or str(task_id).startswith('itinerary-'):
        return RULES.get('itinerary_exp', 1)
    return RULES.get('task_exp', 3)


def lifetime_exp(con, child):
    total = 0
    for (payload,) in con.execute('SELECT payload FROM progress.pledge_progress WHERE key LIKE ?', ('task:' + child + ':%',)):
        total += int(json.loads(payload).get('points') or 0)
    return total


PREFIX = '/lan/family/'
CHILDREN = {'child_a', 'child_b'}
KINDS = {'paper', 'reading', 'audio', 'legacy'}


class Rejected(Exception):
    def __init__(self, code, error):
        self.code, self.error = code, error


def require(value, error='invalid_input', code=400):
    if not value:
        raise Rejected(code, error)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def selection(day, child):
    require(child in CHILDREN)
    require(isinstance(day, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', day))
    try:
        datetime.date.fromisoformat(day)
    except ValueError:
        raise Rejected(400, 'invalid_day')


def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', value))
    return value


def fields(body):
    out = {}
    for key, limit, required in [('title', 100, True), ('first_step', 4000, False),
                                  ('parent_note', 4000, False), ('material_url', 2000, False),
                                  ('audio_url', 2000, False)]:
        val = body.get(key, '')
        require(isinstance(val, str) and len(val) <= limit and (not required or val.strip()))
        out[key] = val.strip() if required else val
    # Device-local blob/data links cannot be shared. Only existing local assets or HTTPS/HTTP links.
    for key in ('material_url', 'audio_url'):
        val = out[key]
        require(not val or val.startswith(('assets/', 'audio/', 'https://', 'http://')), 'unsupported_link')
    out['task_kind'] = body.get('task_kind', 'paper')
    out['assignment_state'] = body.get('assignment_state', 'verified')
    require(out['task_kind'] in KINDS and out['assignment_state'] in {'verified', 'pending', 'legacy_assigned'})
    return out


# Daily homework rolls by projection, never by duplicating or rewriting the task date.
UNFINISHED = {'todo', 'doing', 'paused', 'help', 'pending_parent'}
def daily_homework(task):
    return (not task.get('plan') and not task.get('itinerary')
            and not str(task.get('id', '')).startswith('itinerary-')
            and task.get('home_group') not in {'flow', 'itinerary'}
            and not re.search(r'-(bag-open|bag-pack|shubao)$', task.get('id', ''))
            and task.get('task_kind') in KINDS
            and not task.get('optional') and task.get('carry') is not False)


class Tasks:
    def __init__(self, db, photos=None):
        self.db = Path(db)
        self.photos = photos

    def initialize(self):
        """Explicit startup only. Never migrate existing databases, never initialize on GET."""
        self.db.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.db.exists():
            with self.connect() as con:
                require(con.execute('PRAGMA user_version').fetchone()[0] == 1, 'database_version_mismatch', 503)
                con.execute('SELECT id, day, child, version, payload FROM tasks LIMIT 0')
                con.execute('SELECT id, request FROM operations LIMIT 0')
            return
        # Exclusive creation prevents mistaking an existing file for a new empty store.
        fd = os.open(self.db, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        with sqlite3.connect(self.db) as con:
            con.executescript('''
                CREATE TABLE tasks(id TEXT PRIMARY KEY, day TEXT NOT NULL, child TEXT NOT NULL,
                                   version INTEGER NOT NULL, payload TEXT NOT NULL);
                CREATE TABLE operations(id TEXT PRIMARY KEY, request TEXT NOT NULL);
                CREATE INDEX tasks_selection ON tasks(day, child);
                PRAGMA user_version=1;
            ''')

    def connect(self):
        # mode=rw fails if the database disappears: no silent recreation.
        con = sqlite3.connect(self.db.resolve().as_uri() + '?mode=rw', uri=True, timeout=5)
        con.execute('PRAGMA synchronous=FULL')
        try:
            con.execute('ATTACH DATABASE ? AS progress', (self.db.with_name('pledges_progress.sqlite3').resolve().as_uri()+'?mode=rw',))
            con.execute('PRAGMA progress.synchronous=FULL')
        except Exception:
            con.close(); raise
        return con

    @staticmethod
    def pack(con, role, day, child, task_id=None, history=False):
        # Projection only: reading/rolling a plan never writes or initializes storage.
        all_tasks = [json.loads(row[0]) for row in con.execute(
            'SELECT payload FROM tasks WHERE child=? ORDER BY day,rowid', (child,))]
        def project(t):
            t = dict(t)
            if t.get('plan') or daily_homework(t):
                t['planned_day'] = t['day']
                t['day'] = day
            if t.get('planned_day', day) < day and t.get('status') in UNFINISHED:
                t['carried_over'] = True
            if (t.get('title') == '自己选一本书读一会儿' and t.get('task_kind') == 'reading'
                    and t.get('planned_day', day) < day and t.get('status') in UNFINISHED):
                t['carried_over'] = True
                t['first_step'] = '昨天没读完，今天补上；读完再点完成。' + (t.get('first_step') or '')
            if role == 'child':
                t.pop('parent_note', None)
            return t
        def visible(t):
            if role == 'child' and (t['status'] in {'archived', 'cancelled', 'canceled', 'deleted'} or t['assignment_state'] == 'pending'):
                return False
            if task_id is not None:
                return t['id'] == task_id and (t['day'] == day or (t['day'] <= day and (bool(t.get('plan')) or daily_homework(t))))
            if history:
                return t['day'] == day or t.get('completed_day') == day
            plan = t.get('plan')
            if not plan:
                return (t['day'] == day or (daily_homework(t) and t['day'] < day
                        and (t['status'] in UNFINISHED or (t['status'] == 'done' and t.get('completed_day') == day))))
            if t['day'] > day or plan.get('optional') or t['status'] in {'archived', 'cancelled', 'canceled', 'deleted'}:
                return False
            if t['status'] in UNFINISHED:
                return True
            # Saturday and later: only unfinished tasks; completion remains in the overview.
            return day < plan['end'] and (t.get('completed_day', t['day']) == day)
        planned = [t for t in all_tasks if t.get('plan') and t['plan']['start'] <= day
                   and t['status'] != 'archived' and t['assignment_state'] != 'pending']
        return {'dataset': 'lan', 'day': day, 'child_id': child,
                'tasks': [project(t) for t in all_tasks if visible(t)],
                'week': [project(t) for t in planned] if task_id is None else []}

    @staticmethod
    def reward_receipt(con, child, task_id, operation_id):
        row = con.execute('SELECT payload FROM progress.pledge_progress WHERE key=?', ('task:'+child+':'+task_id,)).fetchone()
        if not row:
            return {'points': 0, 'reason': 'not_eligible'}
        award = json.loads(row[0])
        same = award.get('operation_id') == operation_id
        points = award['points'] if same else 0
        receipt = {
            'points': points,
            'reason': 'awarded' if same else 'already_awarded',
            'day': award['day'],
            'exp_award': award.get('points'),
        }
        lifetime = lifetime_exp(con, child)
        form_id = form_for_lifetime(lifetime, child)
        receipt['lifetime_exp'] = lifetime
        receipt['form_id'] = form_id
        receipt['form_name'] = FORM_NAMES[form_id]
        receipt['form_changed'] = False
        # Replay the original crossing, not a crossing inferred from today's later total.
        if same and award.get('form_receipt'):
            receipt.update(award['form_receipt'])
            receipt['event_id'] = operation_id
        return receipt

    def request(self, method, path, body=None):
        try:
            url = urlsplit(path)
            require(url.path.startswith(PREFIX), 'not_found', 404)
            parts = url.path[len(PREFIX):].split('/')
            require(len(parts) == 2 and parts[0] in {'parent', 'child'}, 'not_found', 404)
            role, op = parts
            if method == 'GET' and op == 'mistakes':
                require(role == 'parent', 'operation_not_available', 403)
                require(parse_qs(url.query) == {'child': ['child_a']}, 'invalid_input')
                with self.connect() as con:
                    entries = []
                    for (payload,) in con.execute("SELECT payload FROM tasks WHERE child='child_a'"):
                        t = json.loads(payload)
                        mark = t.get('mistake_review')
                        if t.get('status') != 'done' or t.get('task_kind') != 'paper' or not mark:
                            continue
                        t['planned_day'] = t['day']
                        t['day'] = mark['marked_day']
                        entries.append(t)
                entries.sort(key=lambda t: (t['day'], t['id']), reverse=True)
                return 200, {'dataset': 'lan', 'child_id': 'child_a', 'tasks': entries}
            if method == 'GET':
                require(op in {'tasks', 'task'}, 'operation_not_available', 405)
                q = parse_qs(url.query, keep_blank_values=True)
                history = q.pop('history', None)
                require(history is None or (history == ['1'] and op == 'tasks' and role == 'child' and q.get('child') == ['child_a']))
                require(set(q) == ({'day', 'child', 'id'} if op == 'task' else {'day', 'child'}) and all(len(v) == 1 for v in q.values()))
                day, child = q['day'][0], q['child'][0]
                selection(day, child)
                with self.connect() as con:
                    return 200, self.pack(con, role, day, child, identifier(q['id'][0]) if op == 'task' else None, history=bool(history))
            require(method == 'POST' and not url.query, 'operation_not_available', 405)
            require(op in ({'create', 'update', 'delete', 'assign', 'feedback'} if role == 'parent' else {'feedback'}),
                    'operation_not_available', 405)
            require(type(body) is dict)
            day, child = body.get('day'), body.get('child_id')
            selection(day, child)
            task_id = identifier(body.get('id' if op == 'create' else 'task_id'))
            op_id = ('create:' + task_id) if op == 'create' else 'op:' + identifier(body.get('operation_id'))
            request = canonical({'role': role, 'op': op, 'body': body})
            with self.connect() as con:
                con.execute('BEGIN IMMEDIATE')
                prior = con.execute('SELECT request FROM operations WHERE id=?', (op_id,)).fetchone()
                if prior:
                    require(prior[0] == request, 'conflict', 409)
                    result = self.pack(con, role, day, child)
                    if op == 'feedback' and body.get('status') == 'done':
                        result['reward'] = self.reward_receipt(con, child, task_id, body['operation_id'])
                    return 200, result
                row = con.execute('SELECT payload FROM tasks WHERE id=?', (task_id,)).fetchone()
                if op == 'create':
                    require(not row, 'conflict', 409)
                    task = dict(fields(body), id=task_id, day=day, child_id=child, version=0, status='todo')
                    con.execute('INSERT INTO tasks VALUES(?,?,?,?,?)', (task_id, day, child, 0, canonical(task)))
                else:
                    require(row is not None, 'not_found', 404)
                    task = json.loads(row[0])
                    require(task['child_id'] == child and (task['day'] == day or ((task.get('plan') or daily_homework(task)) and task['day'] <= day)), 'not_found', 404)
                    require(type(body.get('expected_version')) is int and body['expected_version'] == task['version'], 'conflict', 409)
                    if role == 'child':
                        require(task['assignment_state'] != 'pending' and task['status'] != 'archived', 'task_not_available', 403)
                    if op == 'update':
                        task.update(fields(body))
                    elif op == 'assign':
                        require(body.get('task_kind') in KINDS)
                        task.update(task_kind=body['task_kind'], assignment_state='verified')
                    elif op == 'feedback':
                        status = body.get('status')
                        allowed = {'done', 'todo', 'archived'} if role == 'parent' else {'pending_parent', 'done', 'help', 'paused'}
                        require(status in allowed)
                        require(not (role == 'child' and task['task_kind'] in {'paper', 'legacy'} and status == 'done'),
                                'parent_confirmation_required', 403)
                        # 纸笔：孩子待确认 / 家长确认完成前必须至少有 1 张作业照片。
                        if child == 'child_a' and task['task_kind'] in {'paper', 'legacy'} and (
                            (role == 'child' and status == 'pending_parent') or
                            (role == 'parent' and status == 'done')
                        ):
                            require(getattr(self, 'photos', None) is not None, 'storage_unavailable', 503)
                            require(self.photos.count(day if task.get('plan') else task['day'], child, task_id) >= 1, 'photos_required', 403)
                        if task['task_kind'] in {'paper', 'legacy'}:
                            if role == 'parent' and status == 'done':
                                require(not task.get('photo_needs_resubmit'), 'photos_resubmit_required', 409)
                            if role == 'child' and status == 'pending_parent':
                                task.pop('photo_needs_resubmit', None)
                        if 'reading_minutes' in body:
                            require(role == 'child' and child == 'child_a' and task['task_kind'] == 'reading' and status == 'done', 'invalid_reading_minutes')
                            minutes = body['reading_minutes']
                            require(minutes is None or (type(minutes) is int and 1 <= minutes <= 1440), 'invalid_reading_minutes')
                            task['reading_minutes'] = minutes
                        if 'has_mistake' in body or 'mistake_note' in body:
                            require(role == 'parent' and child == 'child_a' and
                                    task['task_kind'] == 'paper' and status == 'done',
                                    'mistake_review_not_allowed', 403)
                            require(type(body.get('has_mistake')) is bool, 'invalid_mistake_review')
                            note = body.get('mistake_note', '')
                            require(isinstance(note, str) and len(note.strip()) <= 500, 'invalid_mistake_note')
                            if body['has_mistake']:
                                task['mistake_review'] = {'note': note.strip(), 'status': 'pending_review', 'marked_day': day}
                            else:
                                task.pop('mistake_review', None)
                        if 'help_note' in body:
                            note = body['help_note']
                            require(isinstance(note, str), 'invalid_help_note')
                            note = note.strip()
                            require(len(note) <= 500, 'invalid_help_note')
                            task['help_note'] = note
                        task['status'] = status
                        if task.get('plan') or daily_homework(task):
                            if status == 'done':
                                task['completed_day'] = day
                            else:
                                task.pop('completed_day', None)
                    if op == 'delete':
                        con.execute('DELETE FROM tasks WHERE id=?', (task_id,))
                    else:
                        task['version'] += 1
                        con.execute('UPDATE tasks SET version=?,payload=? WHERE id=?', (task['version'], canonical(task), task_id))
                if op == 'feedback' and task['status'] == 'done':
                    is_itinerary = bool(task.get('itinerary')) or str(task_id).startswith('itinerary-')
                    points = award_points(task, task_id)
                    award={'kind':'task','child_id':child,'task_id':task_id,'day':day,'points':points,'operation_id':body['operation_id'],'source':'itinerary' if is_itinerary else 'task'}
                    # Persist the crossing with the award, in the existing payload and transaction.
                    before = lifetime_exp(con, child)
                    after = before + points
                    previous, current = form_for_lifetime(before, child), form_for_lifetime(after, child)
                    event = {'lifetime_exp': after, 'form_id': current, 'form_name': FORM_NAMES[current],
                             'form_changed': previous != current}
                    if previous != current:
                        event.update(form_from=previous, form_from_name=FORM_NAMES[previous],
                                     celebrate=('太乐巴戈斯' if child == 'child_a' else '喷火龙')+'变成'+FORM_NAMES[current]+'啦！')
                    award['form_receipt'] = event
                    con.execute('INSERT OR IGNORE INTO progress.pledge_progress VALUES(?,?,?)',('task:'+child+':'+task_id,1,canonical(award)))
                con.execute('INSERT INTO operations VALUES(?,?)', (op_id, request))
                result = self.pack(con, role, day, child)
                if op == 'feedback' and task['status'] == 'done':
                    result['reward'] = self.reward_receipt(con, child, task_id, body['operation_id'])
            # Exiting the transaction commits before success is sent. Commit failure returns 503.
            return 200, result
        except Rejected as e:
            return e.code, {'error': e.error}
        except (sqlite3.Error, OSError):
            return 503, {'error': 'storage_unavailable'}
        except (TypeError, ValueError, KeyError):
            return 400, {'error': 'invalid_input'}


def handler(root, tasks, lan_ip, pledges=None, photos=None):
    root = Path(root).resolve()
    speech = LocalSpeech(cache_dir=tasks.db.parent / 'speech-cache', natural_enabled=True)
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def log_message(self, fmt, *args):
            # Avoid task names, query selections, or request bodies in the access log.
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            super().end_headers()

        def reply(self, status, data):
            data = canonical(data).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(data)

        def allowed_request(self):
            host = self.headers.get('Host', '')
            allowed = {f'{h}:{self.server.server_port}' for h in ('127.0.0.1', 'localhost', lan_ip)}
            if host not in allowed or not ipaddress.ip_address(self.client_address[0]).is_private:
                self.reply(403, {'error': 'local_network_only'})
                return False
            if self.headers.get('Origin') not in (None, 'http://' + host):
                self.reply(403, {'error': 'same_origin_required'})
                return False
            return True

        def do_GET(self):
            if not self.allowed_request():
                return
            path = urlsplit(self.path).path
            if path == '/lan/speech/task':
                code, result = tasks.request('GET', '/lan/family/child/task?' + urlsplit(self.path).query)
                if code != 200 or len(result.get('tasks', [])) != 1:
                    self.reply(code if code != 200 else 404, {'error':'task_unavailable'})
                    return
                try:
                    audio = speech.render(result['tasks'][0])
                except (OSError, ValueError, subprocess.SubprocessError):
                    self.reply(503, {'error':'speech_unavailable'})
                    return
                self.send_response(200)
                natural = not audio.startswith(b'RIFF')
                self.send_header('Content-Type', 'audio/mpeg' if natural else 'audio/wav')
                self.send_header('X-Speech-Voice', 'zh-CN-XiaoyiNeural' if natural else 'local-fallback')
                self.send_header('Content-Length', str(len(audio)))
                self.end_headers()
                if self.command != 'HEAD':
                    try: self.wfile.write(audio)
                    except (BrokenPipeError, ConnectionResetError): pass
                return
            if path == '/lan/health':
                self.reply(200, {'service': 'xiaobu-lan', 'dataset': 'lan', 'version': 1})
                return
            if path.startswith(PREFIX) and (
                path.endswith('/photos') or path.endswith('/photos/zip') or path.endswith('/photo') or path.endswith('/photo-library')
            ):
                if not photos:
                    self.reply(503, {'error': 'storage_unavailable'})
                    return
                code, result = photos.request('GET', self.path)
                if isinstance(result, dict) and '__raw__' in result:
                    data = result['__raw__']
                    self.send_response(code)
                    self.send_header('Content-Type', result.get('__ctype__', 'application/octet-stream'))
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    if self.command != 'HEAD':
                        try:
                            self.wfile.write(data)
                        except (BrokenPipeError, ConnectionResetError):
                            pass
                    return
                self.reply(code, result)
                return
            if path.startswith(PREFIX):
                store = pledges if path.endswith(('/pledge', '/pledge_progress', '/progress')) else tasks
                self.reply(*(store.request('GET', self.path) if store else (503, {'error':'storage_unavailable'})))
                return
            self.static()

        def do_HEAD(self):
            self.do_GET()

        def static(self):
            path = unquote(urlsplit(self.path).path)
            if path == '/':
                self.path = '/index.html'
                path = '/index.html'
            target = (root / path.lstrip('/')).resolve()
            allowed = path == '/index.html' or (path.split('/')[1] in {'js', 'css', 'audio', 'assets', 'games'}
                      and target.suffix.lower() in {'.js', '.css', '.mp3', '.wav', '.ogg', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.html', '.woff2', '.pdf'})
            if not allowed or not target.is_relative_to(root) or not target.is_file():
                self.reply(404, {'error': 'not_found'})
                return
            if self.command == 'HEAD':
                super().do_HEAD()
            else:
                super().do_GET()

        def do_POST(self):
            if not self.allowed_request():
                return
            path = urlsplit(self.path).path
            ctype = self.headers.get('Content-Type', '').split(';')[0].strip()
            # Child homework photo upload: raw image body (not JSON).
            if path.endswith('/photos') and path.startswith(PREFIX) and '/child/' in path and ctype.startswith('image/'):
                if not photos:
                    self.reply(503, {'error': 'storage_unavailable'})
                    return
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                    require(0 < length <= 8 * 1024 * 1024 and not self.headers.get('Transfer-Encoding'))
                    self.connection.settimeout(30)
                    raw = self.rfile.read(length)
                    require(len(raw) == length, 'invalid_request')
                except (Rejected, ValueError, OSError):
                    self.close_connection = True
                    self.reply(400, {'error': 'invalid_request'})
                    return
                self.reply(*photos.request('POST', self.path, raw=raw, content_type=ctype))
                return
            if ctype != 'application/json':
                self.reply(400, {'error': 'json_required'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                require(0 < length <= 32768 and not self.headers.get('Transfer-Encoding'))
                self.connection.settimeout(10)
                body = json.loads(self.rfile.read(length))
            except (Rejected, ValueError, OSError):
                self.close_connection = True
                self.reply(400, {'error': 'invalid_request'})
                return
            if path.endswith(('/photos/sent', '/photos/delete')) and path.startswith(PREFIX):
                if not photos:
                    self.reply(503, {'error': 'storage_unavailable'})
                    return
                self.reply(*photos.request('POST', self.path, body=body))
                return
            store = pledges if path.endswith(('/pledge', '/pledge_progress', '/progress')) else tasks
            self.reply(*(store.request('POST', self.path, body) if store else (503, {'error':'storage_unavailable'})))
    return Handler


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--root', required=True)
    p.add_argument('--db', required=True)
    p.add_argument('--lan-ip', required=True)
    p.add_argument('--port', type=int, default=8766)
    args = p.parse_args()
    require(ipaddress.ip_address(args.lan_ip).is_private)
    pledges = Pledges(Path(args.db).with_name('pledges.sqlite3'))
    pledges.initialize()
    photo_root = Path(args.db).resolve().parent / 'photos'
    photo_store = Photos(photo_root, Path(args.db))
    photo_store.initialize()
    store = Tasks(args.db, photos=photo_store)
    store.initialize()
    server = ThreadingHTTPServer(('0.0.0.0', args.port), handler(args.root, store, args.lan_ip, pledges, photo_store))
    print(f'Xiaobu LAN ready: http://{args.lan_ip}:{args.port}/index.html?transport=lan', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
