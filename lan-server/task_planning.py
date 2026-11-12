"""Payload-only task planning helpers; no schema or historical-data migration."""
import datetime
import re
from urllib.parse import urlsplit


WORK_TYPES = {'school', 'habit', 'weekly', 'itinerary'}
MATERIAL_KINDS = {'explanation', 'exercise', 'prompt', 'model', 'answer', 'audio', 'link'}
REMOVED = {'archived', 'cancelled', 'canceled', 'deleted'}
ACTIVE = {'todo', 'doing', 'paused', 'help'}
UNFINISHED = ACTIVE | {'pending_parent'}
PARENT_FIELDS = {
    'planned_day', 'due_day', 'work_type', 'photo_required', 'original_requirement',
    'materials', 'exp_award', 'exp_award_locked', 'created_day', 'storage_day', 'assignment_id',
    'assignment_title', 'portion_label', 'portions', 'plan', 'adjustments',
    'adjusted_dates', 'title', 'first_step', 'task_kind', 'assignment_state',
    'material_url', 'audio_url', 'parent_note', 'itinerary', 'carry', 'optional',
    'home_group', 'completed_day', 'submitted_day', 'parent_confirmed',
    'completed_by', 'submitted_by', 'confirmed_day',
}


class PlanningError(ValueError):
    def __init__(self, error, code=400):
        self.error, self.code = error, code


def check(value, error='invalid_input', code=400):
    if not value:
        raise PlanningError(error, code)


def today():
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date().isoformat()


def date_value(value, field):
    if value is None:
        return None
    check(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value), 'invalid_' + field)
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        raise PlanningError('invalid_' + field)
    return value


def work_type(task):
    if task.get('work_type') in WORK_TYPES:
        return task['work_type']
    if task.get('plan'):
        return 'weekly'
    if task.get('itinerary') or str(task.get('id', '')).startswith('itinerary-') or task.get('home_group') == 'itinerary':
        return 'itinerary'
    return 'school'


def planned_day(task):
    return task['planned_day'] if 'planned_day' in task else task['day']


def relates_to_day(task, day):
    return day in (planned_day(task), task.get('submitted_day'), task.get('completed_day'))


def weekly_overview(tasks, day, history=False):
    """Select complete groups, keeping fixed totals without accumulating old done work."""
    def group_key(task):
        # Legacy plan dates alone do not prove two tasks belong to one assignment.
        return ('assignment', task['assignment_id']) if task.get('assignment_id') else ('task', task['id'])

    selected = {group_key(task) for task in tasks
                if relates_to_day(task, day) or (task.get('assignment_id') and task.get('plan', {}).get('start', '9999') <= day <= task.get('plan', {}).get('end', '0000')) or (not history and task.get('status') != 'done')}
    return [task for task in tasks if group_key(task) in selected]


def photo_required(task):
    return (task.get('child_id') == 'child_a' and task.get('task_kind') in {'paper', 'legacy'}
            and task.get('photo_required', True) is not False)


def materials(value):
    check(isinstance(value, list) and len(value) <= 50, 'invalid_materials')
    result = []
    for item in value:
        check(isinstance(item, dict) and set(item) <= {'kind', 'title', 'url', 'page_from', 'page_to'}, 'invalid_materials')
        check(item.get('kind') in MATERIAL_KINDS, 'invalid_material_kind')
        title, url = item.get('title'), item.get('url')
        check(isinstance(title, str) and 0 < len(title.strip()) <= 100, 'invalid_material_title')
        check(isinstance(url, str) and 0 < len(url) <= 2000 and not any(c.isspace() for c in url), 'unsupported_link')
        parsed = urlsplit(url)
        check((parsed.scheme in {'http', 'https'} and bool(parsed.netloc))
              or (not parsed.scheme and url.startswith(('assets/', 'audio/')) and '..' not in parsed.path.split('/')),
              'unsupported_link')
        clean = {'kind': item['kind'], 'title': title.strip(), 'url': url}
        for key in ('page_from', 'page_to'):
            if key in item and item[key] is not None:
                check(type(item[key]) is int and 1 <= item[key] <= 100000, 'invalid_material_pages')
                clean[key] = item[key]
        check(not ('page_from' in clean and 'page_to' in clean) or clean['page_from'] <= clean['page_to'],
              'invalid_material_pages')
        result.append(clean)
    return result


def metadata(body, task=None, new=False):
    """Validate only supplied edits, leaving absent legacy facts genuinely unknown."""
    task = task or {}
    result = {}
    for key in ('planned_day', 'due_day'):
        if key in body:
            result[key] = date_value(body[key], key)
    if 'work_type' in body:
        check(body['work_type'] in WORK_TYPES, 'invalid_work_type')
        result['work_type'] = body['work_type']
    if 'photo_required' in body:
        check(type(body['photo_required']) is bool, 'invalid_photo_required')
        result['photo_required'] = body['photo_required']
    for key, limit in (('original_requirement', 8000), ('progress_note', 2000)):
        if key in body:
            check(isinstance(body[key], str) and len(body[key]) <= limit, 'invalid_' + key)
            result[key] = body[key]
    if 'materials' in body:
        result['materials'] = materials(body['materials'])
    if 'exp_award' in body:
        check(type(body['exp_award']) is int and 0 <= body['exp_award'] <= 50, 'invalid_exp_award')
        result['exp_award'] = body['exp_award']
    if new:
        result['created_day'] = today()
        result.setdefault('planned_day', body.get('day'))
        result.setdefault('due_day', None)
        result.setdefault('work_type', work_type(dict(task, **result)))
        result.setdefault('photo_required', photo_required(dict(task, **result)))
        result.setdefault('original_requirement', '')
        result.setdefault('progress_note', '')
        result.setdefault('materials', [])
        result.setdefault('exp_award', 1 if result['work_type'] == 'itinerary' else 3)
    return result


def planning_warning(task):
    due, planned = task.get('due_day'), planned_day(task)
    if due and planned and planned > due:
        return 'planned_after_due'
    if due and planned is None and task.get('status') in ACTIVE:
        return 'unplanned'
    return None


def groups(tasks):
    collected = {}
    for task in tasks:
        group_id = task.get('assignment_id')
        if not group_id:
            continue
        collected.setdefault(group_id, []).append(task)
    result = []
    for group_id, portions in collected.items():
        done = sum(t.get('status') == 'done' for t in portions)
        pending = sum(t.get('status') == 'pending_parent' for t in portions)
        dues = set(t.get('due_day') for t in portions)
        group = {'id': group_id, 'title': portions[0].get('assignment_title', ''),
                 'total': len(portions), 'done': done, 'pending': pending,
                 'remaining': len(portions) - done - pending,
                 'due_day': next(iter(dues)) if len(dues) == 1 else None}
        if len(dues) > 1:
            group.update(deadline_conflict=True, due_days=sorted(d for d in dues if d))
        result.append(group)
    return result


def deadline_passed(task, now=None):
    now = now or datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
    raw = (task.get('plan') or {}).get('deadline')
    if raw:
        try:
            due = datetime.datetime.fromisoformat(raw)
            if due.tzinfo is not None:
                return now > due
        except (ValueError, TypeError):
            pass
    return bool(task.get('due_day') and task['due_day'] < now.date().isoformat())
