"""LAN homework photos: store under local-data/photos/{day}/{child}/{task}/."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

MAX_BYTES = 8 * 1024 * 1024
MAX_PER_TASK = 12
PHOTO_ID = re.compile(r'[a-zA-Z0-9_-]{1,100}')
DAY_RE = re.compile(r'\d{4}-\d{2}-\d{2}')
CHILDREN = {'child_a', 'child_b'}
PAPERISH = {'paper', 'legacy'}
JPEG_MAGIC = b'\xff\xd8\xff'
PNG_MAGIC = b'\x89PNG\r\n\x1a\n'
WEBP_RIFF = b'RIFF'
WEBP_WEBP = b'WEBP'


class Rejected(Exception):
    def __init__(self, code, error):
        self.code, self.error = code, error


def require(value, error='invalid_input', code=400):
    if not value:
        raise Rejected(code, error)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def sent_state(items):
    """The claim applies only to this exact, nonempty displayed photo set."""
    sent = bool(items) and all(item.get('teacher_sent') is True for item in items)
    sent_at = max((item.get('sent_at') or '' for item in items), default='') or None
    return sent, sent_at if sent else None


class Photos:
    def __init__(self, root: Path, tasks_db: Path):
        self.root = Path(root)
        self.tasks_db = Path(tasks_db)
        self._local = threading.local()

    def initialize(self):
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def _task_dir(self, day, child, task_id):
        return self.root / day / child / task_id

    def _meta_path(self, day, child, task_id):
        return self._task_dir(day, child, task_id) / 'meta.json'

    def _load_meta(self, day, child, task_id):
        path = self._meta_path(day, child, task_id)
        if not path.is_file():
            return {'revision': 0, 'teacher_sent': False, 'sent_at': None, 'photos': []}
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError, TypeError):
            raise Rejected(503, 'storage_unavailable')
        require(isinstance(data, dict) and isinstance(data.get('photos'), list), 'storage_unavailable', 503)
        data.setdefault('revision', 0)
        data.setdefault('teacher_sent', False)
        data.setdefault('sent_at', None)
        return data

    def _save_meta(self, day, child, task_id, meta):
        path = self._meta_path(day, child, task_id)
        if getattr(self._local, 'con', None) is not None:
            self._local.undo.setdefault(path, path.read_bytes() if path.exists() else None)
        folder = self._task_dir(day, child, task_id)
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        tmp = folder / '.meta.json.tmp'
        tmp.write_text(canonical(meta), encoding='utf-8')
        os.chmod(tmp, 0o600)
        os.replace(tmp, self._meta_path(day, child, task_id))

    def _load_task_meta(self, day, child, task_id):
        """Read every legacy folder, preserving each image's original file location.

        Subsequent metadata lives at the immutable task day. References to older
        files and tombstones are copied there; original image bytes are never moved.
        The sum of folder revisions remains a single optimistic-concurrency token.
        """
        anchor = self._load_meta(day, child, task_id)
        sources = [(day, anchor)]
        for path in sorted(self.root.glob(f'*/{child}/{task_id}/meta.json')):
            source_day = path.parts[-4]
            if (source_day == day or not DAY_RE.fullmatch(source_day)
                    or not path.resolve().is_relative_to(self.root.resolve())):
                continue
            sources.append((source_day, self._load_meta(source_day, child, task_id)))
        deleted, photos = {}, {}
        source_meta = dict(sources)
        other_revisions = sum(int(meta.get('revision') or 0) for d, meta in sources if d != day)
        for source_day, meta in sources:
            for item in meta.get('deleted', []):
                if isinstance(item, dict) and isinstance(item.get('id'), str) and PHOTO_ID.fullmatch(item['id']):
                    deleted[item['id']] = dict(item, storage_day=item.get('storage_day', source_day))
        for source_day, meta in sources:
            for item in meta.get('photos', []):
                if not isinstance(item, dict):
                    continue
                pid = item.get('id')
                if not isinstance(pid, str) or not PHOTO_ID.fullmatch(pid) or pid in deleted:
                    continue
                item = dict(item, storage_day=item.get('storage_day', source_day))
                require(isinstance(item['storage_day'], str) and DAY_RE.fullmatch(item['storage_day']), 'storage_unavailable', 503)
                if type(item.get('teacher_sent')) is not bool:
                    # Imported references must inherit their actual source's old
                    # flag, never an unrelated flag on the anchor folder.
                    origin = source_meta.get(item['storage_day'], {})
                    item['teacher_sent'] = bool(origin.get('teacher_sent'))
                    item['sent_at'] = origin.get('sent_at') if item['teacher_sent'] else None
                elif not item['teacher_sent']:
                    item['sent_at'] = None
                if pid in photos:
                    previous = photos[pid]
                    require(previous.get('sha256') == item.get('sha256') and previous.get('file') == item.get('file'),
                            'photo_id_conflict', 409)
                    continue
                photos[pid] = item
        combined = dict(anchor, photos=list(photos.values()), deleted=list(deleted.values()),
                        revision=int(anchor.get('revision') or 0) + other_revisions,
                        _other_revisions=other_revisions)
        combined['teacher_sent'], combined['sent_at'] = sent_state(combined['photos'])
        return combined

    def _save_task_meta(self, day, child, task_id, meta):
        saved = dict(meta)
        saved['revision'] = int(saved['revision']) - saved.pop('_other_revisions', 0)
        saved['teacher_sent'], saved['sent_at'] = sent_state(saved['photos'])
        self._save_meta(day, child, task_id, saved)

    def _lookup_task(self, day, child, task_id):
        try:
            owned = getattr(self._local, 'con', None) is None
            con = sqlite3.connect(self.tasks_db.resolve().as_uri() + '?mode=rw', uri=True, timeout=5) if owned else self._local.con
        except sqlite3.Error:
            raise Rejected(503, 'storage_unavailable')
        try:
            row = con.execute('SELECT day,payload FROM tasks WHERE id=?', (task_id,)).fetchone()
        finally:
            if owned: con.close()
        require(row is not None, 'not_found', 404)
        task = json.loads(row[1])
        task['day'] = row[0]
        require(task.get('child_id') == child, 'not_found', 404)
        return task

    def count(self, day, child, task_id):
        day, child, task_id = self._selection(day, child, task_id)
        return len(self._load_task_meta(day, child, task_id)['photos'])

    def _sniff_ext(self, raw: bytes):
        if raw.startswith(JPEG_MAGIC):
            return '.jpg', 'image/jpeg'
        if raw.startswith(PNG_MAGIC):
            return '.png', 'image/png'
        if len(raw) >= 12 and raw[:4] == WEBP_RIFF and raw[8:12] == WEBP_WEBP:
            return '.webp', 'image/webp'
        raise Rejected(400, 'unsupported_image')

    def _parent_task(self, day, child, task_id):
        try:
            return self._lookup_task(day, child, task_id)
        except Rejected as e:
            if e.code != 404: raise
            # Keep local photos discoverable even after the task was removed.
            return {'id': task_id, 'child_id': child, 'day': day, 'title': '已移除作业的照片',
                    'task_kind': 'paper', 'status': 'archived', 'version': 0, 'photo_orphan': True}

    def library(self, day, child):
        counts, posts, seen = {}, [], set()
        for path in sorted(self.root.glob('*/*/*/meta.json')):
            if not path.resolve().is_relative_to(self.root.resolve()): continue
            d, c, task_id = path.parts[-4:-1]
            if not DAY_RE.fullmatch(d) or c not in CHILDREN or not PHOTO_ID.fullmatch(task_id): continue
            if child != 'all' and c != child: continue
            if (c, task_id) in seen: continue
            seen.add((c, task_id))
            anchor, _, _ = self._selection(d, c, task_id)
            meta = self._load_task_meta(anchor, c, task_id)
            for photo in meta['photos']:
                source_day = photo['storage_day']
                counts[source_day] = counts.get(source_day, 0) + 1
            displayed = [photo for photo in meta['photos'] if photo['storage_day'] == day]
            if displayed:
                task = dict(self._parent_task(anchor, c, task_id))
                task['storage_day'] = anchor
                task.setdefault('planned_day', task['day'])
                task['day'] = day
                pack = self._pack('parent', anchor, c, task_id, dict(meta, photos=displayed))
                pack.update(day=day, storage_day=anchor)
                posts.append({'task': task, 'pack': pack})
        return {'dataset': 'lan', 'day': day, 'child_id': child,
                'days': [{'day': d, 'count': counts[d]} for d in sorted(counts, reverse=True)], 'posts': posts}

    def _pack(self, role, day, child, task_id, meta=None):
        meta = meta or self._load_task_meta(day, child, task_id)
        photos = []
        for item in meta.get('photos') or []:
            pid = item.get('id')
            if not isinstance(pid, str) or not PHOTO_ID.fullmatch(pid):
                continue
            photos.append({
                'id': pid,
                'sha256': item.get('sha256'),
                'size': item.get('size'),
                'width': item.get('width') or 0,
                'height': item.get('height') or 0,
                'created_at': item.get('created_at'),
                'storage_day': item.get('storage_day', day),
                'teacher_sent': item.get('teacher_sent') is True,
                'sent_at': item.get('sent_at') if item.get('teacher_sent') is True else None,
                'url': f'/lan/family/{role}/photo?day={day}&child={child}&task={task_id}&id={pid}',
            })
        task = self._parent_task(day, child, task_id) if role == 'parent' else self._lookup_task(day, child, task_id)
        teacher_sent, sent_at = sent_state(photos)
        return {
            'editable': task.get('status') not in {'done', 'archived'} and task.get('assignment_state') != 'pending',
            'task_status': task.get('status'),
            'task_version': task.get('version'),
            'task_id': task_id,
            'day': day,
            'child_id': child,
            'revision': int(meta.get('revision') or 0),
            'teacher_sent': teacher_sent,
            'sent_at': sent_at,
            'photos': photos,
        }

    def _selection(self, day, child, task_id):
        require(child in CHILDREN)
        require(isinstance(day, str) and DAY_RE.fullmatch(day))
        require(isinstance(task_id, str) and PHOTO_ID.fullmatch(task_id))
        if self.tasks_db.exists():
            with sqlite3.connect(self.tasks_db.resolve().as_uri()+'?mode=ro', uri=True) as con:
                row = con.execute('SELECT day,payload FROM tasks WHERE id=?', (task_id,)).fetchone()
            if row:
                task = json.loads(row[1])
                require(task.get('child_id') == child, 'not_found', 404)
                day = row[0]
        return day, child, task_id

    def _changed(self, task):
        # Same SQLite writer lock as parent confirmation. A stale parent view cannot
        # confirm a photo set that the child has since changed.
        task['version'] += 1
        task['photo_needs_resubmit'] = True
        if task['status'] == 'pending_parent':
            task['status'] = 'todo'
        self._local.con.execute('UPDATE tasks SET version=?,payload=? WHERE id=?',
                                (task['version'], canonical(task), task['id']))

    @staticmethod
    def _editable(task):
        require(task.get('task_kind') in PAPERISH, 'paper_task_required', 403)
        require(task.get('status') not in {'done', 'archived'} and task.get('assignment_state') != 'pending',
                'photo_locked', 403)

    def request(self, method, path, body=None, raw=None, content_type=None):
        result = self._stored_request(method, path, body, raw, content_type)
        status, data = result
        if status != 200 or not isinstance(data, dict):
            return result
        # Storage uses the original task day. The API envelope keeps the requested
        # view day so strict client scope checks still apply, including upload retry.
        query = parse_qs(urlsplit(path).query, keep_blank_values=True)
        view_day = body.get('day') if isinstance(body, dict) else query.get('day', [None])[0]
        def view_pack(pack):
            if not isinstance(pack, dict) or 'task_id' not in pack or not isinstance(pack.get('photos'), list):
                return pack
            return dict(pack, storage_day=pack['day'], day=view_day)
        if 'pack' in data:
            data = dict(data, pack=view_pack(data['pack']))
        else:
            data = view_pack(data)
        return status, data

    def _stored_request(self, method, path, body=None, raw=None, content_type=None):
        if method != 'POST':
            return self._request(method, path, body, raw, content_type)
        con = None
        self._local.undo = {}
        try:
            con = sqlite3.connect(self.tasks_db.resolve().as_uri() + '?mode=rw', uri=True, timeout=5)
            con.execute('BEGIN IMMEDIATE')
            self._local.con = con
            result = self._request(method, path, body, raw, content_type)
            if result[0] >= 400:
                con.rollback()
                self._restore_meta()
            else:
                con.commit()
            return result
        except (OSError, sqlite3.Error):
            if con: con.rollback()
            self._restore_meta()
            return 503, {'error': 'storage_unavailable'}
        finally:
            self._local.con = None
            self._local.undo = {}
            if con: con.close()

    def _restore_meta(self):
        for path, data in self._local.undo.items():
            if data is None:
                path.unlink(missing_ok=True)
            else:
                tmp = path.with_suffix('.rollback')
                tmp.write_bytes(data)
                os.chmod(tmp, 0o600)
                os.replace(tmp, path)

    def _request(self, method, path, body=None, raw=None, content_type=None):
        try:
            url = urlsplit(path)
            parts = url.path.strip('/').split('/')
            # lan/family/{role}/photos|/photos/zip|/photos/sent|/photo
            require(len(parts) >= 4 and parts[0] == 'lan' and parts[1] == 'family', 'not_found', 404)
            role = parts[2]
            require(role in {'parent', 'child'}, 'not_found', 404)
            op = '/'.join(parts[3:])
            q = parse_qs(url.query, keep_blank_values=True)
            if op == 'photo-library':
                require(method == 'GET' and role == 'parent', 'operation_not_available', 403)
                require(set(q) == {'day', 'child'} and all(len(v) == 1 for v in q.values()))
                day, child = q['day'][0], q['child'][0]
                require(DAY_RE.fullmatch(day) and child in CHILDREN | {'all'})
                return 200, self.library(day, child)

            if op == 'photo' and method == 'GET':
                require(set(q) == {'day', 'child', 'task', 'id'} and all(len(v) == 1 for v in q.values()))
                day, child, task_id = self._selection(q['day'][0], q['child'][0], q['task'][0])
                pid = q['id'][0]
                require(PHOTO_ID.fullmatch(pid), 'invalid_input')
                meta = self._load_task_meta(day, child, task_id)
                item = next((p for p in meta.get('photos') or [] if p.get('id') == pid), None)
                require(item, 'not_found', 404)
                file_name = item.get('file') or (pid + '.jpg')
                source_dir = self._task_dir(item.get('storage_day', day), child, task_id)
                target = (source_dir / file_name).resolve()
                require(target.is_relative_to(source_dir.resolve()) and target.is_file(),
                        'not_found', 404)
                data = target.read_bytes()
                ctype = 'image/jpeg'
                if file_name.endswith('.png'):
                    ctype = 'image/png'
                elif file_name.endswith('.webp'):
                    ctype = 'image/webp'
                return 200, {'__raw__': data, '__ctype__': ctype}

            if op == 'photos/zip':
                return 501, {'error': 'zip_not_available'}

            if op == 'photos/sent':
                require(method == 'POST' and role == 'parent', 'operation_not_available', 405)
                require(type(body) is dict)
                day, child, task_id = self._selection(body.get('day'), body.get('child_id'), body.get('task_id'))
                self._lookup_task(day, child, task_id)
                require(type(body.get('value')) is bool)
                require(type(body.get('expected_revision')) is int)
                require(isinstance(body.get('operation_id'), str) and PHOTO_ID.fullmatch(body['operation_id']))
                meta = self._load_task_meta(day, child, task_id)
                require(meta['revision'] == body['expected_revision'], 'photo_conflict', 409)
                by_id = {photo['id']: photo for photo in meta['photos']}
                if 'photo_ids' in body:
                    photo_ids = body['photo_ids']
                    require(isinstance(photo_ids, list) and photo_ids and all(
                        isinstance(pid, str) and PHOTO_ID.fullmatch(pid) for pid in photo_ids), 'invalid_photo_ids')
                    require(len(set(photo_ids)) == len(photo_ids), 'invalid_photo_ids')
                    require(set(photo_ids) <= set(by_id), 'photo_conflict', 409)
                else:
                    # An old date card has a determinable subset. A task detail
                    # from another view day must refresh with explicit IDs.
                    photo_ids = [photo['id'] for photo in meta['photos'] if photo['storage_day'] == body['day']]
                    require(photo_ids, 'photo_scope_empty', 409)
                marked_at = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z' if body['value'] else None
                for pid in photo_ids:
                    by_id[pid]['teacher_sent'] = body['value']
                    by_id[pid]['sent_at'] = marked_at
                meta['revision'] = int(meta['revision']) + 1
                self._save_task_meta(day, child, task_id, meta)
                selected = dict(meta, photos=[by_id[pid] for pid in photo_ids])
                return 200, dict(self._pack(role, day, child, task_id, selected), scope_photo_ids=photo_ids)

            if op == 'photos/delete':
                require(method == 'POST' and role in {'child', 'parent'}, 'operation_not_available', 405)
                require(type(body) is dict)
                day, child, task_id = self._selection(body.get('day'), body.get('child_id'), body.get('task_id'))
                task = self._parent_task(day, child, task_id) if role == 'parent' else self._lookup_task(day, child, task_id)
                if role == 'child': self._editable(task)
                pid = body.get('photo_id')
                require(isinstance(pid, str) and PHOTO_ID.fullmatch(pid))
                meta = self._load_task_meta(day, child, task_id)
                # Tombstones preserve original bytes and make retries idempotent.
                if any(p['id'] == pid for p in meta.get('deleted', [])):
                    return 200, self._pack(role, day, child, task_id, meta)
                require(type(body.get('expected_revision')) is int and meta['revision'] == body['expected_revision'], 'photo_conflict', 409)
                old = next((p for p in meta['photos'] if p['id'] == pid), None)
                require(old is not None, 'not_found', 404)
                meta['photos'].remove(old)
                meta.setdefault('deleted', []).append(old)
                meta['revision'] += 1
                meta['teacher_sent'], meta['sent_at'] = False, None
                if not task.get('photo_orphan'):
                    if role == 'parent' and task['status'] in {'done', 'archived'}:
                        # Parent removes an image, not an already confirmed task/reward.
                        task['version'] += 1
                        self._local.con.execute('UPDATE tasks SET version=?,payload=? WHERE id=?',
                                                (task['version'], canonical(task), task_id))
                    else:
                        self._changed(task)
                self._save_task_meta(day, child, task_id, meta)
                return 200, self._pack(role, day, child, task_id, meta)

            if op != 'photos':
                return 404, {'error': 'not_found'}

            if method == 'GET':
                require(set(q) == {'day', 'child', 'task'} and all(len(v) == 1 for v in q.values()))
                day, child, task_id = self._selection(q['day'][0], q['child'][0], q['task'][0])
                if role == 'child': self._lookup_task(day, child, task_id)
                return 200, self._pack(role, day, child, task_id)

            require(method == 'POST' and role == 'child', 'operation_not_available', 405)
            require(set(q) >= {'day', 'child', 'task', 'photo'} and all(len(v) == 1 for v in q.values()))
            day, child, task_id = self._selection(q['day'][0], q['child'][0], q['task'][0])
            pid = q['photo'][0]
            require(PHOTO_ID.fullmatch(pid), 'invalid_input')
            task = self._lookup_task(day, child, task_id)
            self._editable(task)
            require(raw is not None and isinstance(raw, (bytes, bytearray)), 'invalid_request')
            raw = bytes(raw)
            require(0 < len(raw) <= MAX_BYTES, 'photo_upload_limit', 429)
            # Prefer sniffed type; clients usually send image/jpeg after normalize().
            if content_type and content_type.split(';')[0].strip() not in {
                'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/octet-stream'
            }:
                raise Rejected(400, 'unsupported_image')
            ext, _ctype = self._sniff_ext(raw)
            sha = hashlib.sha256(raw).hexdigest()
            meta = self._load_task_meta(day, child, task_id)
            existing = next((p for p in meta['photos'] if p.get('id') == pid), None)
            if existing:
                require(existing.get('sha256') == sha, 'photo_conflict', 409)
                return 200, {
                    'photo': {'id': existing['id'], 'sha256': existing['sha256'], 'size': existing['size']},
                    'pack': self._pack(role, day, child, task_id, meta),
                }
            require(not any(p['id'] == pid for p in meta.get('deleted', [])), 'photo_conflict', 409)
            replacing = q.get('replace', [None])[0]
            old = next((p for p in meta['photos'] if p['id'] == replacing), None) if replacing else None
            if replacing:
                require(old is not None, 'photo_conflict', 409)
                require(int(q.get('expected_revision', ['-1'])[0]) == meta['revision'], 'photo_conflict', 409)
            require(old is not None or len(meta['photos']) < MAX_PER_TASK, 'photo_upload_limit', 429)
            folder = self._task_dir(day, child, task_id)
            folder.mkdir(parents=True, exist_ok=True, mode=0o700)
            file_name = pid + ext
            target = folder / file_name
            tmp = folder / ('.' + file_name + '.tmp')
            tmp.write_bytes(raw)
            os.chmod(tmp, 0o600)
            os.replace(tmp, target)
            created = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
            if old:
                meta['photos'].remove(old)
                meta.setdefault('deleted', []).append(old)
            meta['photos'].append({
                'id': pid,
                'sha256': sha,
                'size': len(raw),
                'width': 0,
                'height': 0,
                'created_at': created,
                'file': file_name,
                'storage_day': day,
                'teacher_sent': False,
                'sent_at': None,
            })
            meta['revision'] = int(meta.get('revision') or 0) + 1
            meta['teacher_sent'] = False
            meta['sent_at'] = None
            self._changed(task)
            try:
                self._save_task_meta(day, child, task_id, meta)
            except OSError:
                try:
                    target.unlink(missing_ok=True)
                except OSError:
                    pass
                raise Rejected(503, 'storage_unavailable')
            return 200, {
                'photo': {'id': pid, 'sha256': sha, 'size': len(raw)},
                'pack': self._pack(role, day, child, task_id, meta),
            }
        except Rejected as e:
            return e.code, {'error': e.error}
        except (OSError, sqlite3.Error):
            return 503, {'error': 'storage_unavailable'}
        except (TypeError, ValueError, KeyError):
            return 400, {'error': 'invalid_input'}
