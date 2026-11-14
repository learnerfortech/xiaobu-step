// Behavior checks use synthetic tasks and nodes; these are not browser/layout acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, task, byTestId, today } = require('./task_ui_fixture.cjs');
const ids = tasks => Array.from(tasks, t => t.id);

function withWeek(f, tasks, week = []) {
  f.Store.get = (_, child) => ({ status: 'ok', day: today,
    tasks: tasks.filter(t => t.child_id === child), week: week.filter(t => t.child_id === child), groups: [] });
}

test('today view separates weekly planning gaps and courses without mutating or copying portions', () => {
  const tasks = [
    task({ id: 'now' }),
    task({ id: 'past', planned_day: '2026-11-11', progress_note: '第4题' }),
    task({ id: 'unplanned', planned_day: null }),
    task({ id: 'future', planned_day: '2026-11-13' }),
    task({ id: 'school', work_type: 'school', planned_day: '2026-11-11' }),
    task({ id: 'waiting', status: 'pending_parent', planned_day: '2026-11-11' }),
    task({ id: 'done', status: 'done', planned_day: '2026-11-13' }),
    task({ id: 'course', work_type: 'itinerary' }),
    task({ id: 'removed', status: 'archived' })
  ];
  const before = JSON.stringify(tasks), f = fixture(tasks), planning = f.window.TaskPlanning;
  const view = planning.dayView([...tasks, tasks[0], tasks[1]], today);
  assert.deepEqual(ids(view.today), ['now', 'school', 'waiting', 'done']);
  assert.deepEqual(ids(view.needsPlan), ['past', 'unplanned']);
  assert.deepEqual(ids(view.itineraries), ['course']);
  assert.equal(view.needsPlan[0], tasks[1], 'the view keeps the original task identity');
  assert.equal(JSON.stringify(tasks), before, 'viewing never changes dates, progress, statuses or rewards');
  for (const status of ['pending_parent', 'done', 'archived']) {
    assert.equal(planning.needsPlanning(task({ status, planned_day: null }), today), false);
  }
});

test('deadline display uses the recorded instant in family time and keeps date-only information date-only', () => {
  const { TaskPlanning: planning } = fixture().window;
  const exact = planning.deadlineInfo(task({ due_day: '2026-11-13', plan: { deadline: '2026-11-12T18:30:00Z' } }));
  assert.equal(exact.date, '2026-11-13');
  assert.equal(exact.label, '2026-11-13 02:30');
  assert.equal(exact.exact, true);
  assert.equal(exact.conflict, false);
  const conflict = planning.deadlineInfo(task({ due_day: '2026-11-12', plan: { deadline: '2026-11-12T18:30:00Z' } }));
  assert.equal(conflict.conflict, true);
  const dateOnly = planning.deadlineInfo(task({ due_day: '2026-11-14', plan: { deadline: '2026-11-14T12:00:00' } }));
  assert.equal(dateOnly.label, '2026-11-14');
  assert.equal(dateOnly.exact, false, 'a time without an explicit timezone is not assumed');
  assert.equal(planning.deadlineInfo(task()).label, '');
});

test('older timestamp separators retain the precise deadline and original source text', () => {
  const { TaskPlanning: planning } = fixture().window;
  for (const separator of ['T', 't', ' ']) {
    const raw = '2026-11-14' + separator + '18:30:00+08:00';
    const t = task({ due_day: '2026-11-14', plan: { deadline: raw } });
    const deadline = planning.deadlineInfo(t);
    assert.equal(deadline.exact, true);
    assert.equal(deadline.label, '2026-11-14 18:30');
    assert.equal(deadline.date, t.due_day);
    assert.equal(t.plan.deadline, raw);
  }
});

test('Joey listening failure keeps a readable retry action and restores its normal style on retry', () => {
  const t = task({ child_id: 'child_b', title: '合成朗读任务' }), f = fixture([t]);
  let callbacks, attempts = 0;
  f.window.Voice.play = (_, __, options) => { callbacks = options; attempts++; };
  f.route('child-joey', t.id);
  const button = byTestId(f.root, 'listen-homework');
  button.click();
  callbacks.onFailure();
  assert.match(button.textContent, /点我听作业/);
  assert.match(byTestId(f.root, 'listen-homework-status').textContent, /再试一次/);
  const luminance = hex => {
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const linear = rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return linear.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  };
  const levels = [button.style.color, button.style.background].map(luminance).sort((a, b) => b - a);
  assert.ok((levels[0] + 0.05) / (levels[1] + 0.05) >= 4.5, 'the explicit failure foreground and background must remain readable');
  const beforeRetry = attempts;
  button.click();
  assert.equal(attempts, beforeRetry + 1);
  assert.equal(button.style.color, '');
  assert.equal(button.style.background, '');
  callbacks.onStart();
  assert.match(button.textContent, /再听一遍/);
  assert.equal(button.style.color, '');
  assert.equal(button.style.background, '');
});

test('deadline conflicts are explicit to parents and are not child-facing coordination work', () => {
  const f = fixture(), t = task({ due_day: '2026-11-12', plan: { deadline: '2026-11-12T18:30:00Z' } });
  const parent = f.window.UI.h('div', {}, ...f.window.TaskPlanning.details(t, true));
  const child = f.window.UI.h('div', {}, ...f.window.TaskPlanning.details(t));
  assert.match(byTestId(parent, 'deadline-conflict').textContent, /不一致/);
  assert.match(byTestId(child, 'teacher-deadline').textContent, /2026-11-13 02:30/);
  assert.equal(byTestId(child, 'deadline-conflict'), null);
});

test('Jared resumes actual today work and keeps older or unplanned portions out of today counts', () => {
  const todo = task({ id: 'todo', home_group: '学校作业', work_type: 'school' });
  const doing = task({ id: 'doing', home_group: '英语作业', status: 'doing', progress_note: '第4关已完成' });
  const past = task({ id: 'past', home_group: '英语作业', planned_day: '2026-11-11', status: 'doing', progress_note: '旧进度' });
  const unplanned = task({ id: 'unplanned', home_group: '英语作业', planned_day: null });
  const course = task({ id: 'course', work_type: 'itinerary', title: '课程' });
  const f = fixture([todo, doing, past, unplanned, course]);
  withWeek(f, [todo, doing, past, course], [doing, past, unplanned]);
  f.route('child-jared');
  assert.equal(byTestId(f.root, 'resume-task').getAttribute('data-task-id'), 'doing');
  assert.match(byTestId(f.root, 'resume-task').textContent, /第4关已完成/);
  assert.equal(byTestId(f.root, 'today-count').textContent, '待做 2 · 待检查 0 · 已完成 0');
  assert.match(byTestId(f.root, 'weekly-needs-plan').textContent, /2份/);
  assert.equal(f.root.querySelectorAll('[data-testid=jared-group-card]').length, 3);
  byTestId(f.root, 'resume-go').click();
  assert.equal(f.window.location.hash, '#/jared/task/doing');
  assert.deepEqual(f.feedbacks, []);
});

test('Jared has no invented resume choice when only todo, submitted, future or unplanned work exists', () => {
  const todo = task({ id: 'todo' }), pending = task({ id: 'waiting', status: 'pending_parent', progress_note: '已提交' });
  const unplanned = task({ id: 'unplanned', planned_day: null, status: 'doing' });
  const future = task({ id: 'future', planned_day: '2026-11-13', status: 'doing' });
  const f = fixture([todo, pending, unplanned, future]);
  withWeek(f, [todo, pending], [unplanned, future]);
  f.route('child-jared');
  assert.equal(byTestId(f.root, 'resume-task'), null);
});

test('Jared reading and itinerary stay separate and neither creates another task', () => {
  const reading = task({ id: 'read', work_type: 'habit', title: '自己选一本书读一会儿' });
  const course = task({ id: 'course', work_type: 'itinerary', title: '课程' });
  const f = fixture([reading, course]);
  f.route('child-jared');
  assert.match(byTestId(f.root, 'today-reading').textContent, /自己选一本书/);
  assert.doesNotMatch(byTestId(f.root, 'today-itineraries').textContent, /自己选一本书/);
  assert.match(byTestId(f.root, 'today-count').textContent, /待做 1/);
  assert.equal(f.feedbacks.length, 0);
});

test('Jared submitted-only day stays visible and says it still needs review', () => {
  const t = task({ home_group: '英语作业', status: 'pending_parent', exp_award: 3 });
  const f = fixture([t]);
  f.route('child-jared');
  assert.match(byTestId(f.root, 'state-alldone').textContent, /已提交/);
  assert.match(byTestId(f.root, 'state-alldone').textContent, /等妈妈检查/);
  assert.doesNotMatch(byTestId(f.root, 'state-alldone').textContent, /都做完|安排已完成/);
  f.window.Jared.route(f.root, ['group', encodeURIComponent('英语作业')]);
  assert.equal(byTestId(f.root, 'group-day-count').textContent, '待做 0 · 待检查 1 · 已完成 0');
  assert.ok(f.root.querySelector('.task-title-content.is-complete'));
  assert.match(f.root.textContent, /经验待确认/);
  assert.doesNotMatch(f.root.textContent, /\+3 经验/);
});

test('a lightening request saves only help intent without changing dates, totals, progress or XP', async () => {
  const t = task({ home_group: '英语作业', exp_award: 4, assignment_id: 'fixed-total', progress_note: '第4关' });
  const f = fixture([t]), initial = [];
  f.window.UI.helpNoteDialog = async text => { initial.push(text); return text; };
  f.Store.update = () => assert.fail('a child request must never reschedule');
  f.Store.create = () => assert.fail('a child request must never create another portion');
  f.route('child-jared', t.id);
  await byTestId(f.root, 'request-less-today').click();
  assert.deepEqual(initial, ['今天安排有点多，请帮我调整。']);
  assert.equal(f.feedbacks.length, 1);
  assert.equal(f.feedbacks[0].status, 'help');
  assert.deepEqual(JSON.parse(JSON.stringify(f.feedbacks[0].extra)), { help_note: initial[0] });
  assert.equal(t.planned_day, today);
  assert.equal(t.assignment_id, 'fixed-total');
  assert.equal(t.exp_award, 4);
  assert.equal(t.progress_note, '第4关');
  assert.equal(byTestId(f.root, 'adjusted-today'), null);
  assert.doesNotMatch(f.root.textContent, /已调整|已批准|今天不用做/);
});

test('lightening is absent for school, unknown, submitted, past and unplanned tasks; normal help remains', () => {
  for (const change of [
    { work_type: 'school', home_group: '英语作业' },
    { work_type: 'weekly', home_group: '学校作业' },
    { home_group: undefined },
    { home_group: '英语作业', planned_day: null },
    { home_group: '英语作业', planned_day: '2026-11-11' },
    { home_group: '英语作业', status: 'pending_parent' },
    { home_group: '高途', status: 'done' }
  ]) {
    const t = task(change), f = fixture([t]);
    f.route('child-jared', t.id);
    assert.equal(byTestId(f.root, 'request-less-today'), null);
    if (!['pending_parent', 'done'].includes(t.status)) assert.ok(byTestId(f.root, 'act-help'));
  }
});

test('Joey counts and spoken completion distinguish a submitted task from acceptance', () => {
  const t = task({ child_id: 'child_b', status: 'pending_parent', title: '语文合成作业' });
  const course = task({ id: 'course', child_id: 'child_b', work_type: 'itinerary', title: '课程' });
  const f = fixture([t, course]), speech = [];
  f.window.UI.say = line => speech.push(line);
  f.route('child-joey');
  assert.match(byTestId(f.root, 'joey-school-door').textContent, /待做 0 · 待检查 1 · 已完成 0/);
  assert.match(speech.join(' '), /已经提交，1项等妈妈检查/);
  assert.doesNotMatch(speech.join(' '), /全部完成|安排已完成/);
  assert.ok(f.root.querySelector('[data-testid=joey-itinerary]'));
});

test('Joey keeps planning gaps visible without adding them to the school count or losing carry compatibility', () => {
  const current = task({ child_id: 'child_b', work_type: 'school', title: '数学当前作业', carried_over: true });
  const past = task({ id: 'past', child_id: 'child_b', title: '语文旧周份', planned_day: '2026-11-11' });
  const unplanned = task({ id: 'unplanned', child_id: 'child_b', title: '语文待安排', planned_day: null });
  const f = fixture([current, past, unplanned]);
  withWeek(f, [current, past], [past, unplanned]);
  f.route('child-joey');
  assert.match(byTestId(f.root, 'joey-school-door').textContent, /待做 1 · 待检查 0 · 已完成 0/);
  assert.match(byTestId(f.root, 'joey-needs-plan').textContent, /有2份等妈妈安排/);
  f.window.Joey.route(f.root, ['school']);
  assert.match(f.root.textContent, /顺延/);
  assert.doesNotMatch(f.root.textContent, /旧周份|语文待安排/);
});

for (const [name, child] of [['child-jared', 'child_a'], ['child-joey', 'child_b']]) {
  test(name + ' labels the existing first step without requiring or inventing one', () => {
    const t = task({ child_id: child, first_step: '打开对应讲解', original_requirement: '独立练习后核对' });
    const f = fixture([t]);
    f.route(name, t.id);
    assert.equal(byTestId(f.root, 'task-first-step').textContent, '先做这一步打开对应讲解');
    const blank = fixture([task({ child_id: child })]);
    blank.route(name, 'synthetic-portion');
    assert.equal(byTestId(blank.root, 'task-first-step'), null);
  });
}
