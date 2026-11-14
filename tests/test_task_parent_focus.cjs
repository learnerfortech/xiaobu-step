// Parent interaction checks with synthetic tasks; this is not browser/layout acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, task, byTestId, today } = require('./task_ui_fixture.cjs');

const yesterday = '2026-11-11';
const tomorrow = '2026-11-13';
const settle = () => new Promise(resolve => setImmediate(resolve));
const taskRow = (root, id) => root.querySelector('[data-task-id="' + id + '"]');
const insideClosedDetails = node => {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (parent.tagName === 'DETAILS' && !parent.open) return true;
  }
  return false;
};

function packs(f, values) {
  const states = Object.fromEntries(['child_a', 'child_b'].map(child => [child, {
    status: 'ok', day: today, tasks: [], week: [], groups: [], ...(values[child] || {})
  }]));
  f.Store.get = (_, child) => states[child];
  f.Store.find = (_, child, id) => [...states[child].tasks, ...states[child].week].find(t => t.child_id === child && t.id === id);
  return states;
}

function captureUpdates(f) {
  const updates = [];
  f.Store.update = async (t, values) => {
    updates.push({ id: t.id, values: { ...values } });
    Object.assign(t, values);
    t.version++;
    return { result: 'saved' };
  };
  return updates;
}

test('help and pending review open by default while sibling pages and other-task folds remain separate', () => {
  const helpA = task({ id: 'help-a', status: 'help', title: '甲的求助', help_note: '这道题不知道从哪里开始' });
  const helpB = task({ id: 'help-b', child_id: 'child_b', status: 'help', title: '乙的求助', help_note: '请再示范一次' });
  const pending = task({ id: 'pending-a', status: 'pending_parent', title: '甲的待检查' });
  const ordinary = task({ id: 'ordinary-a', title: '甲的当天任务' });
  const f = fixture([helpA, helpB, pending, ordinary]);
  f.route('parent');
  const responses = byTestId(f.root, 'response-tasks-child_a');
  assert.ok(responses);
  assert.match(responses.textContent, /需要我处理/);
  assert.ok(taskRow(responses, helpA.id));
  assert.ok(taskRow(responses, pending.id));
  assert.equal(insideClosedDetails(taskRow(responses, helpA.id)), false);
  assert.equal(insideClosedDetails(taskRow(responses, pending.id)), false);
  assert.equal(byTestId(responses, 'help-snippet').textContent, '孩子说：这道题不知道从哪里开始');
  assert.match(byTestId(f.root, 'pending-tasks-child_a').textContent, /待确认/);
  assert.doesNotMatch(responses.textContent, /已领奖|已获奖励/);
  assert.equal(taskRow(f.root, helpB.id), null);
  const others = byTestId(f.root, 'other-tasks-child_a');
  assert.ok(others);
  assert.equal(others.open, false);
  assert.equal(taskRow(others, helpA.id), null);
  assert.equal(taskRow(others, pending.id), null);
  assert.ok(taskRow(others, ordinary.id));
  assert.ok(byTestId(f.root, 'tab-today'));
  assert.ok(byTestId(f.root, 'tab-more'));

  byTestId(f.root, 'parent-kid-child_b').click();
  assert.ok(taskRow(byTestId(f.root, 'response-tasks-child_b'), helpB.id));
  assert.equal(taskRow(f.root, helpA.id), null);
  assert.equal(byTestId(f.root, 'parent-child-child_a'), null);
});

test('needs-planning collects deduplicated daily and weekly tasks without adding them to the today workload', () => {
  const old = task({ id: 'old', assignment_id: 'week-a', planned_day: yesterday, status: 'paused' });
  const unplanned = task({ id: 'unplanned', assignment_id: 'week-a', planned_day: null });
  const help = task({ id: 'old-help', assignment_id: 'week-a', planned_day: yesterday, status: 'help', help_note: '今天做不完' });
  const pending = task({ id: 'old-pending', assignment_id: 'week-a', planned_day: yesterday, status: 'pending_parent' });
  const later = task({ id: 'later', assignment_id: 'week-a', planned_day: tomorrow });
  const done = task({ id: 'old-done', assignment_id: 'week-a', planned_day: yesterday, status: 'done' });
  const school = task({ id: 'school-today', work_type: 'school' });
  const sibling = task({ id: 'sibling-unplanned', child_id: 'child_b', planned_day: null });
  const f = fixture();
  packs(f, { child_a: {
    tasks: [old, help, pending, school],
    week: [{ ...old }, unplanned, help, pending, later, done, sibling],
    groups: [{ id: 'week-a', title: '合成周作业', total: 6, done: 1, pending: 1, remaining: 4 }]
  } });
  f.route('parent');
  const plan = byTestId(f.root, 'replan-tasks-child_a');
  assert.ok(plan);
  assert.match(plan.querySelector('summary').textContent, /待重新安排3/);
  assert.deepEqual(plan.querySelectorAll('[data-task-id]').map(n => n.dataset.taskId), ['old', 'old-help', 'unplanned']);
  assert.equal(taskRow(plan, sibling.id), null);
  assert.equal(taskRow(plan, pending.id), null);
  assert.equal(taskRow(plan, later.id), null);
  assert.equal(taskRow(plan, done.id), null);
  assert.match(byTestId(f.root, 'status-child_a-paused').textContent, /^0暂停$/);
  const others = byTestId(f.root, 'other-tasks-child_a');
  assert.deepEqual(others.querySelectorAll('[data-task-id]').map(n => n.dataset.taskId), [school.id]);
  const responses = byTestId(f.root, 'response-tasks-child_a');
  assert.ok(taskRow(responses, help.id));
  assert.ok(taskRow(responses, pending.id));
  const week = byTestId(f.root, 'parent-week-overview');
  assert.match(week.textContent, /总量 6 · 已确认\/完成 1 · 待检查 1 · 剩余 4/);
  assert.ok(byTestId(taskRow(week, unplanned.id), 'needs-planning'));
  assert.equal(old.planned_day, yesterday);
  assert.equal(unplanned.planned_day, null);
});

test('responding to help does not approve a date change, complete a task, or award it', async () => {
  const t = task({ id: 'help-response', status: 'help', planned_day: yesterday, help_note: '今天少做一点', exp_award: 3 });
  const f = fixture([t]), updates = captureUpdates(f);
  f.route('parent');
  taskRow(byTestId(f.root, 'response-tasks-child_a'), t.id).click();
  const d = f.dialogs.at(-1), primary = byTestId(d.el, 'detail-primary');
  assert.equal(primary.textContent, '已回应，继续做');
  assert.equal(byTestId(d.el, 'help-response-note').textContent, '回应不等于已调整；日期以保存安排为准。');
  await primary.click();
  assert.deepEqual(f.feedbacks.map(x => [x.id, x.status]), [[t.id, 'todo']]);
  assert.equal(updates.length, 0);
  assert.equal(t.planned_day, yesterday);
  assert.equal(t.exp_award, 3);
  assert.equal(t.help_note, '今天少做一点');
});

test('missing paper photos still block confirmation in both the pending list and task detail', async () => {
  const t = task({ id: 'paper-no-photo', task_kind: 'paper', status: 'pending_parent', photo_required: true });
  const f = fixture([t]);
  f.route('parent');
  await settle();
  const pending = byTestId(f.root, 'pending-tasks-child_a');
  pending.querySelector('input[aria-label="选择：' + t.title + '"]').chooseChecked(true);
  assert.equal(byTestId(f.root, 'confirm-done').disabled, true);
  taskRow(f.root, t.id).click();
  const d = f.dialogs.at(-1);
  assert.ok(byTestId(d.el, 'confirm-need-photo'));
  assert.equal(byTestId(d.el, 'detail-primary'), null);
  await byTestId(d.el, 'more-done').click();
  assert.equal(t.status, 'pending_parent');
  assert.equal(f.feedbacks.length, 0);
  assert.match(f.toasts.at(-1), /补拍/);
});

test('selected pending tasks preserve the photo gate for the whole batch and only submit the eligible selection once', async () => {
  const missing = task({ id: 'missing', title: '没有照片', task_kind: 'paper', status: 'pending_parent', photo_required: true });
  const ready = task({ id: 'ready', title: '照片已齐', task_kind: 'paper', status: 'pending_parent', photo_required: true });
  const f = fixture([missing, ready]);
  f.window.API.PhotoAdapter.list = async (_, __, id) => ({ ok: true, data: { photos: id === ready.id ? [{ id: 'photo', url: 'assets/synthetic.png' }] : [] } });
  f.route('parent');
  await settle();
  const choose = (t, value) => byTestId(f.root, 'pending-tasks-child_a').querySelector('input[aria-label="选择：' + t.title + '"]').chooseChecked(value);
  choose(missing, true); choose(ready, true);
  await byTestId(f.root, 'confirm-done').click();
  assert.equal(f.feedbacks.length, 0, 'one missing photo must not silently confirm only the other selected task');
  assert.match(f.toasts.at(-1), /没有照片/);
  choose(missing, false);
  await byTestId(f.root, 'confirm-done').click();
  assert.deepEqual(f.feedbacks.map(x => [x.id, x.status]), [[ready.id, 'done']]);
  assert.equal(missing.status, 'pending_parent');
  assert.equal(byTestId(f.root, 'confirm-done').disabled, true);
});

test('a week-only pending task stays actionable and its photos are read before confirmation', async () => {
  const t = task({ id: 'week-pending', title: '周份待检查', task_kind: 'paper', status: 'pending_parent', planned_day: yesterday, photo_required: true });
  const f = fixture(), listed = [];
  packs(f, { child_a: { week: [t] } });
  f.window.API.PhotoAdapter.list = async (_, __, id) => {
    listed.push(id);
    return { ok: true, data: { photos: [{ id: 'photo', url: 'assets/synthetic.png' }] } };
  };
  f.route('parent');
  await settle();
  assert.ok(listed.includes(t.id));
  const pending = byTestId(f.root, 'pending-tasks-child_a');
  assert.ok(taskRow(pending, t.id));
  pending.querySelector('input[aria-label="选择：' + t.title + '"]').chooseChecked(true);
  assert.equal(byTestId(f.root, 'confirm-done').disabled, false);
  await byTestId(f.root, 'confirm-done').click();
  assert.deepEqual(f.feedbacks.map(x => [x.id, x.status]), [[t.id, 'done']]);
});

test('reviewing an earlier day does not add a later weekly submission to its action queue', () => {
  const later = task({ id: 'submitted-later', title: '较晚提交', day: yesterday, planned_day: yesterday, submitted_day: today, status: 'pending_parent' });
  const earlier = task({ id: 'submitted-earlier', title: '当天已提交', day: yesterday, planned_day: yesterday, submitted_day: yesterday, status: 'pending_parent' });
  const f = fixture();
  f.Store.parentDay = yesterday;
  packs(f, { child_a: { day: yesterday, tasks: [earlier], week: [earlier, later] } });
  f.route('parent');
  const pending = byTestId(f.root, 'pending-tasks-child_a');
  assert.ok(taskRow(pending, earlier.id));
  assert.equal(taskRow(pending, later.id), null);
  assert.equal(taskRow(byTestId(f.root, 'response-tasks-child_a'), later.id), null);
  assert.match(byTestId(f.root, 'status-child_a-pending_parent').textContent, /^1待确认$/);
  assert.match(byTestId(f.root, 'summary-wait-child_a').textContent, /^待确认 1$/);
  assert.equal(f.feedbacks.length, 0);
  assert.equal(later.status, 'pending_parent');
  assert.equal(later.submitted_day, today);
});

test('exact teacher deadlines remain read-only and normalize the date only when the parent saves', async () => {
  const exact = '2026-11-12T16:30:00Z';
  const t = task({ id: 'exact-deadline', status: 'help', due_day: today, plan: { deadline: exact }, first_step: '' });
  const f = fixture([t]), updates = captureUpdates(f);
  f.route('parent');
  taskRow(f.root, t.id).click();
  const detail = f.dialogs.at(-1);
  assert.equal(byTestId(detail.el, 'teacher-deadline').textContent, '老师截止：2026-11-13 00:30');
  assert.ok(byTestId(detail.el, 'deadline-conflict'));
  byTestId(detail.el, 'detail-edit').click();
  const edit = f.dialogs.at(-1), due = edit.el.querySelector('[name=due_day]');
  assert.equal(due.value, tomorrow);
  assert.equal(due.readOnly, true);
  assert.match(byTestId(edit.el, 'exact-deadline-locked').textContent, /2026-11-13 00:30/);
  assert.ok(byTestId(edit.el, 'deadline-conflict'));
  assert.equal(t.due_day, today, 'opening the editor must not mutate the existing task');
  assert.equal(updates.length, 0);
  assert.equal(!!edit.el.querySelector('[name=first_step]').required, false);
  edit.el.querySelector('[name=planned_day]').value = '2026-11-14';
  due.value = '2026-11-15'; // A read-only date is also protected at the form-read boundary.
  await byTestId(edit.el, 'edit-submit').click();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].values.planned_day, '2026-11-14');
  assert.equal(updates[0].values.due_day, tomorrow);
  assert.equal(updates[0].values.first_step, '');
  assert.equal(t.plan.deadline, exact);
  assert.equal(t.status, 'help');
  assert.equal(f.feedbacks.length, 0);
});

test('date-only deadlines remain date-only and editable', async () => {
  const t = task({ id: 'date-only', due_day: tomorrow });
  const f = fixture([t]), updates = captureUpdates(f);
  f.route('parent');
  taskRow(f.root, t.id).click();
  const detail = f.dialogs.at(-1);
  assert.equal(byTestId(detail.el, 'teacher-deadline').textContent, '老师截止：' + tomorrow);
  byTestId(detail.el, 'detail-edit').click();
  const edit = f.dialogs.at(-1), due = edit.el.querySelector('[name=due_day]');
  assert.equal(due.readOnly, false);
  assert.equal(byTestId(edit.el, 'exact-deadline-locked'), null);
  due.value = '2026-11-14';
  await byTestId(edit.el, 'edit-submit').click();
  assert.equal(updates[0].values.due_day, '2026-11-14');
});

test('scheduling uses only loaded workload and keeps unqueried dates and submitted portions explicit', async () => {
  const active = task({ id: 'active-portion', assignment_id: 'assignment', portion_label: '第一份', progress_note: '已经做完前半页' });
  const pending = task({ id: 'locked-portion', assignment_id: 'assignment', portion_label: '第二份', status: 'pending_parent' });
  const school = task({ id: 'school', work_type: 'school', title: '合成学校作业' });
  const course = task({ id: 'itinerary-course', work_type: 'itinerary', title: '合成课程' });
  const sibling = task({ id: 'itinerary-sibling', child_id: 'child_b', work_type: 'itinerary', title: '另一孩子的行程' });
  const f = fixture();
  packs(f, { child_a: { tasks: [school, course, active, pending, sibling], week: [active, pending], groups: [{ id: 'assignment', title: '合成两份' }] } });
  const updates = captureUpdates(f);
  f.route('parent');
  byTestId(f.root, 'schedule-portions').click();
  const d = f.dialogs.at(-1), rows = d.el.querySelectorAll('.p-schedule-row');
  assert.match(d.el.textContent, /先看学校作业和课程；留出休息和睡前准备/);
  const known = byTestId(d.el, 'schedule-loaded-load').textContent;
  assert.match(known, /今天：学校任务 1 项/);
  assert.match(known, /已知行程：合成课程/);
  assert.doesNotMatch(known, /另一孩子/);
  assert.match(rows[0].textContent, /已经做完前半页/);
  assert.equal(rows[1].querySelector('input[type=date]').disabled, true);
  const date = rows[0].querySelector('input[type=date]');
  date.value = tomorrow; date.onchange({ target: date });
  assert.match(rows[0].textContent, /未核对当天负担（2026-11-13）/);
  assert.doesNotMatch(rows[0].textContent, /空闲|没有课|无课/);
  await byTestId(d.el, 'schedule-save').click();
  assert.deepEqual(updates, [{ id: active.id, values: { planned_day: tomorrow } }]);
  assert.equal(active.progress_note, '已经做完前半页');
  assert.equal(active.status, 'todo');
  assert.equal(pending.planned_day, today);
  assert.equal(pending.status, 'pending_parent');
  assert.equal(f.feedbacks.length, 0);
});
