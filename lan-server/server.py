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
from photos import Photos, Rejected as PhotoRejected
import task_planning as planning

def award_points(task, task_id):
    """Per-task difficulty EXP from payload.exp_award; itinerary/default fallback. Cap 50."""
    raw = task.get('exp_award')
    if type(raw) is int:
        return max(0, min(RULES.get('max_task_exp', 50), raw))
    if task.get('itinerary') or str(task_id).startswith('itinerary-'):
        return RULES.get('itinerary_exp', 1)
    return RULES.get('task_exp', 3)


def original_award_points(award):
    return award.get('original_points', award.get('points', 0))


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
def daily_homework(task):
    return (planning.work_type(task) == 'school' and not task.get('plan') and not task.get('itinerary')
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
        all_tasks = [dict(json.loads(row[1]), storage_day=row[0]) for row in con.execute(
            'SELECT day,payload FROM tasks WHERE child=? ORDER BY day,rowid', (child,))]
        reward_prefix = 'task:' + child + ':'
        rewards = {key[len(reward_prefix):]: json.loads(payload) for key, payload in con.execute(
            'SELECT key,payload FROM progress.pledge_progress WHERE key GLOB ?', (reward_prefix + '*',))}
        def project(t):
            t = dict(t)
            t['planned_day'] = planning.planned_day(t)
            t['day'] = day
            t['work_type'] = planning.work_type(t)
            t.setdefault('created_day', None)
            t.setdefault('due_day', None)
            t.setdefault('original_requirement', '')
            t.setdefault('progress_note', '')
            t.setdefault('materials', [])
            t['exp_award_locked'] = t['id'] in rewards
            t['exp_award'] = (original_award_points(rewards[t['id']]) if t['exp_award_locked']
                              else award_points(t, t['id']))
            t.setdefault('photo_required', planning.photo_required(t))
            t.pop('carried_over', None)
            if (daily_homework(t) and t['planned_day'] and t['planned_day'] < day
                    and t.get('status') in planning.UNFINISHED):
                t['carried_over'] = True
            if (t.get('title') == '自己选一本书读一会儿' and t.get('task_kind') == 'reading'
                    and t.get('carried_over')):
                t['first_step'] = '昨天没读完，今天补上；读完再点完成。' + (t.get('first_step') or '')
            t['deadline_passed'] = bool(planning.deadline_passed(t) and t.get('status') in planning.ACTIVE)
            warning = planning.planning_warning(t)
            if warning:
                t['planning_warning'] = warning
            if role == 'child':
                t.pop('parent_note', None)
            return t
        def available(t):
            return not (role == 'child' and (t['status'] in planning.REMOVED
                        or t.get('assignment_state') == 'pending'))
        def visible(t):
            if not available(t):
                return False
            if task_id is not None:
                # A parent can verify any stable task or entire assignment after a move.
                if role == 'parent':
                    return t['id'] == task_id or t.get('assignment_id') == task_id
                return t['id'] == task_id
            if history:
                return planning.relates_to_day(t, day)
            if t['status'] in planning.REMOVED:
                return role == 'parent' and planning.planned_day(t) == day
            if role == 'parent' and t.get('status') == 'pending_parent':
                # A submitted task needs review regardless of its arrangement. Do
                # not project a known later submission into an earlier view day.
                return not t.get('submitted_day') or t['submitted_day'] <= day
            if t.get('completed_day') == day or (t.get('status') == 'pending_parent' and t.get('submitted_day') == day):
                return True
            if t.get('status') == 'done':
                return not t.get('completed_day') and planning.planned_day(t) == day
            planned = planning.planned_day(t)
            if not planned or planned > day:
                return False
            if planning.work_type(t) == 'weekly':
                return t.get('status') in planning.UNFINISHED and not (t.get('plan') or {}).get('optional')
            if planned == day:
                return True
            return daily_homework(t) and t.get('status') in planning.UNFINISHED
        planned = [t for t in all_tasks if planning.work_type(t) == 'weekly'
                   and t['status'] not in planning.REMOVED and available(t)]
        if task_id is None:
            planned = planning.weekly_overview(planned, day, history=history)
        adjusted = []
        if task_id is None and not history:
            for task in all_tasks:
                if not available(task) or task.get('status') in planning.REMOVED or planning.planned_day(task) == day:
                    continue
                if any(a.get('from_day') == day or a.get('view_day') == day for a in task.get('adjustments', [])):
                    adjusted.append({'id': task['id'], 'title': task['title'], 'work_type': planning.work_type(task),
                                     'assignment_id': task.get('assignment_id'), 'from_day': day,
                                     'planned_day': planning.planned_day(task), 'note': '安排已调整'})
        selected_groups = planned if task_id is None else [t for t in planned if visible(t)]
        return {'dataset': 'lan', 'day': day, 'child_id': child,
                'tasks': [project(t) for t in all_tasks if visible(t)],
                'week': [project(t) for t in planned] if task_id is None else [],
                'groups': planning.groups(selected_groups), 'adjusted': adjusted}

    @staticmethod
    def reward_receipt(con, child, task_id, operation_id, replayed=False):
        row = con.execute('SELECT payload FROM progress.pledge_progress WHERE key=?', ('task:'+child+':'+task_id,)).fetchone()
        if not row:
            return {'points': 0, 'reason': 'not_eligible'}
        award = json.loads(row[0])
        same = award.get('operation_id') == operation_id
        original_points = award.get('last_delta', award['points']) if same else 0
        points = original_points if same and not replayed else 0
        receipt = {
            'points': points,
            'reason': ('replayed' if replayed else award.get('last_event', 'awarded')) if same else 'already_awarded',
            'day': award['day'],
            'exp_award': original_award_points(award),
            'original_points': original_points,
            'replayed': replayed,
        }
        lifetime = lifetime_exp(con, child)
        form_id = form_for_lifetime(lifetime, child)
        receipt['lifetime_exp'] = lifetime
        receipt['form_id'] = form_id
        receipt['form_name'] = FORM_NAMES[form_id]
        receipt['form_changed'] = False
        # Replay the original crossing, not a crossing inferred from today's later total.
        if same and not replayed and award.get('form_receipt'):
            receipt.update(award['form_receipt'])
            receipt['event_id'] = operation_id
        return receipt

    @staticmethod
    def create_tasks(con, body, task_id, day, child):
        existing = [json.loads(row[0]) for row in con.execute('SELECT payload FROM tasks')]
        reserved = {t['id'] for t in existing} | {t.get('assignment_id') for t in existing}
        require(task_id not in reserved, 'conflict', 409)
        base = dict(fields(body), child_id=child)
        if body.get('work_type') != 'weekly':
            require('portions' not in body, 'weekly_portions_required')
            task = dict(base, id=task_id, day=day, version=0, status='todo')
            task.update(planning.metadata(body, task, new=True))
            created = [task]
        else:
            portions = body.get('portions')
            require(isinstance(portions, list) and 1 <= len(portions) <= 50, 'invalid_portions')
            # Validate even common materials, but only explicitly per-portion materials are attached.
            planning.metadata(body, base)
            created, ids = [], set()
            for portion in portions:
                require(isinstance(portion, dict), 'invalid_portions')
                require(set(portion) <= {'id', 'label', 'planned_day', 'exp_award', 'materials',
                        'first_step', 'task_kind', 'photo_required', 'material_url', 'audio_url'}, 'invalid_portions')
                unit_id = identifier(portion.get('id'))
                require(unit_id not in reserved and unit_id not in ids and unit_id != task_id, 'conflict', 409)
                ids.add(unit_id)
                label = portion.get('label')
                require(isinstance(label, str) and 0 < len(label.strip()) <= 60, 'invalid_portion_label')
                require('exp_award' in portion, 'invalid_exp_award')
                unit_body = dict(body, **portion)
                unit_body.update(title=base['title'] + ' · ' + label.strip(),
                                 planned_day=portion.get('planned_day'),
                                 materials=portion.get('materials', []),
                                 material_url=portion.get('material_url', ''), audio_url=portion.get('audio_url', ''))
                task = dict(fields(unit_body), id=unit_id, day=day, child_id=child, version=0, status='todo',
                            assignment_id=task_id, assignment_title=base['title'], portion_label=label.strip())
                task.update(planning.metadata(unit_body, task, new=True))
                created.append(task)
        for task in created:
            con.execute('INSERT INTO tasks VALUES(?,?,?,?,?)', (task['id'], day, child, 0, canonical(task)))
        return created

    @staticmethod
    def change_reward(con, task, child, day, operation_id, undo=False):
        """One fixed ledger key per portion, including a reversible undo record."""
        key = 'task:' + child + ':' + task['id']
        row = con.execute('SELECT version,payload FROM progress.pledge_progress WHERE key=?', (key,)).fetchone()
        award = json.loads(row[1]) if row else None
        if award and award.get('form_receipt'):
            award.setdefault('original_form_receipt', dict(award['form_receipt']))
            award.setdefault('original_operation_id', award.get('operation_id'))
        if undo:
            if not award or award.get('reversed'):
                return
            original = original_award_points(award)
            delta, event = -int(award.get('points') or 0), 'reversed'
            award.update(points=0, original_points=original, reversed=True)
        else:
            if award and not award.get('reversed'):
                return
            original = original_award_points(award) if award else award_points(task, task['id'])
            delta, event = original, 'restored' if award else 'awarded'
            if award is None:
                award = {'kind': 'task', 'child_id': child, 'task_id': task['id'],
                         'source': 'itinerary' if planning.work_type(task) == 'itinerary' else 'task'}
            award.update(points=original, original_points=original, reversed=False)
        before = lifetime_exp(con, child)
        award.update(day=day, operation_id=operation_id, last_delta=delta, last_event=event)
        after = before + delta
        previous, current = form_for_lifetime(before, child), form_for_lifetime(after, child)
        receipt = {'lifetime_exp': after, 'form_id': current, 'form_name': FORM_NAMES[current],
                   'form_changed': event == 'awarded' and delta > 0 and previous != current}
        if receipt['form_changed']:
            receipt.update(form_from=previous, form_from_name=FORM_NAMES[previous],
                           celebrate=('太乐巴戈斯' if child == 'child_a' else '喷火龙') + '变成' + FORM_NAMES[current] + '啦！')
        award['form_receipt'] = receipt
        if event == 'awarded':
            award['original_form_receipt'] = dict(receipt)
            award['original_operation_id'] = operation_id
        award.setdefault('history', []).append({'day': day, 'operation_id': operation_id, 'points': delta,
                                               'event': event, 'form_receipt': dict(receipt)})
        if row:
            con.execute('UPDATE progress.pledge_progress SET version=?,payload=? WHERE key=?',
                        (row[0] + 1, canonical(award), key))
        else:
            con.execute('INSERT INTO progress.pledge_progress VALUES(?,?,?)', (key, 1, canonical(award)))

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
                        t['storage_day'] = t['day']
                        t['planned_day'] = planning.planned_day(t)
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
            if role == 'child':
                require(not (set(body) & planning.PARENT_FIELDS), 'parent_fields_forbidden', 403)
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
                    if op == 'feedback' and body.get('status') in {'done', 'todo'}:
                        result['reward'] = self.reward_receipt(con, child, task_id, body['operation_id'], replayed=True)
                    return 200, result
                row = con.execute('SELECT payload FROM tasks WHERE id=?', (task_id,)).fetchone()
                if op == 'create':
                    require(not row, 'conflict', 409)
                    self.create_tasks(con, body, task_id, day, child)
                else:
                    require(row is not None, 'not_found', 404)
                    task = json.loads(row[0])
                    require(task['child_id'] == child, 'not_found', 404)
                    require(type(body.get('expected_version')) is int and body['expected_version'] == task['version'], 'conflict', 409)
                    if role == 'child':
                        require(task['assignment_state'] != 'pending' and task['status'] != 'archived', 'task_not_available', 403)
                    if op == 'update':
                        for key in ('created_day', 'storage_day', 'assignment_id', 'assignment_title', 'portion_label'):
                            require(key not in body or body[key] == task.get(key), 'immutable_task_field', 409)
                        require(not (set(body) & {'portions', 'plan', 'adjustments', 'adjusted_dates'}), 'immutable_task_field', 409)
                        updates = planning.metadata(body, task)
                        if 'exp_award' in updates:
                            awarded = con.execute('SELECT payload FROM progress.pledge_progress WHERE key=?',
                                                  ('task:' + child + ':' + task_id,)).fetchone()
                            require(not awarded or updates['exp_award'] == original_award_points(json.loads(awarded[0])),
                                    'reward_amount_locked', 409)
                        current_type = planning.work_type(task)
                        next_type = updates.get('work_type', current_type)
                        require(next_type == current_type or (current_type != 'weekly' and next_type != 'weekly'),
                                'weekly_portion_fixed', 409)
                        if 'planned_day' in updates and updates['planned_day'] != planning.planned_day(task):
                            require(task['status'] not in {'done', 'pending_parent'}, 'task_replan_locked', 409)
                            task.setdefault('adjustments', []).append({'from_day': planning.planned_day(task),
                                'to_day': updates['planned_day'], 'view_day': day, 'changed_day': planning.today(),
                                'operation_id': body['operation_id']})
                        task.update(fields(dict(task, **body)))
                        task.update(updates)
                    elif op == 'assign':
                        require(body.get('task_kind') in KINDS)
                        task.update(task_kind=body['task_kind'], assignment_state='verified')
                    elif op == 'feedback':
                        status = body.get('status')
                        allowed = {'done', 'todo', 'archived'} if role == 'parent' else {'pending_parent', 'done', 'todo', 'doing', 'help', 'paused'}
                        require(status in allowed)
                        already_done = task['status'] == 'done' and status == 'done'
                        require(not (status == 'archived' and planning.work_type(task) == 'weekly'),
                                'weekly_portion_required', 409)
                        if role == 'child' and task['status'] == 'done':
                            require(task.get('completed_by') == 'child' and task['task_kind'] not in {'paper', 'legacy'}
                                    and status in {'todo', 'done'}, 'parent_confirmation_locked', 403)
                        require(not (role == 'child' and task['task_kind'] in {'paper', 'legacy'} and status == 'done'),
                                'parent_confirmation_required', 403)
                        # Photo requirements are typed; paper still always needs parent confirmation.
                        if not already_done and planning.photo_required(task) and (
                            (role == 'child' and status == 'pending_parent') or
                            (role == 'parent' and status == 'done')
                        ):
                            require(getattr(self, 'photos', None) is not None, 'storage_unavailable', 503)
                            require(self.photos.count(task['day'], child, task_id) >= 1, 'photos_required', 403)
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
                        if 'progress_note' in body:
                            task.update(planning.metadata({'progress_note': body['progress_note']}))
                        if status == 'todo' and task['status'] == 'done':
                            self.change_reward(con, task, child, day, body['operation_id'], undo=True)
                        task['status'] = status
                        if status == 'pending_parent':
                            task.update(submitted_day=day, submitted_by=role)
                        if status == 'done':
                            if not already_done:
                                task.update(completed_day=day, completed_by=role)
                                if role == 'parent':
                                    task['confirmed_day'] = day
                        else:
                            task.pop('completed_day', None)
                            task.pop('completed_by', None)
                            task.pop('confirmed_day', None)
                        if status == 'todo':
                            task.pop('submitted_day', None)
                            task.pop('submitted_by', None)
                    if op == 'delete':
                        require(planning.work_type(task) != 'weekly', 'weekly_portion_required', 409)
                        con.execute('DELETE FROM tasks WHERE id=?', (task_id,))
                    else:
                        task['version'] += 1
                        con.execute('UPDATE tasks SET version=?,payload=? WHERE id=?', (task['version'], canonical(task), task_id))
                if op == 'feedback' and task['status'] == 'done':
                    self.change_reward(con, task, child, day, body['operation_id'])
                con.execute('INSERT INTO operations VALUES(?,?)', (op_id, request))
                result = self.pack(con, role, day, child)
                if op == 'feedback' and task['status'] in {'done', 'todo'}:
                    result['reward'] = self.reward_receipt(con, child, task_id, body['operation_id'])
                if op == 'update' and planning.planning_warning(task):
                    result['planning_warning'] = planning.planning_warning(task)
            # Exiting the transaction commits before success is sent. Commit failure returns 503.
            return 200, result
        except (Rejected, PhotoRejected, planning.PlanningError) as e:
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
                # Material-rich tasks accepted on creation must remain editable.
                limit = 512 * 1024 if path in {PREFIX + 'parent/create', PREFIX + 'parent/update'} else 32768
                require(0 < length <= limit and not self.headers.get('Transfer-Encoding'))
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
