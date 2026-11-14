// Source-level UI behavior checks with synthetic nodes, not browser/layout acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, task, byTestId, deferred, Node, today } = require('./task_ui_fixture.cjs');

for (const [name, child, status] of [['child-jared', 'child_a', 'todo'], ['child-jared', 'child_a', 'doing'], ['child-joey', 'child_b', 'todo']]) {
  test(name + ' retry of ' + status + ' returns to the task and preserves the pending operation', async () => {
    const t = task({ child_id: child, status: 'done', completed_by: 'child' });
    const f = fixture([t]);
    f.pending['task:' + t.id] = { key: 'task:' + t.id, kind: 'feedback', state: 'unknown', body: { task_id: t.id, child_id: child, status, operation_id: 'original-operation' } };
    f.route(name, t.id);
    const retry = byTestId(f.root, 'save-retry');
    assert.ok(retry, 'the main task retry control is available');
    await retry.click();
    assert.deepEqual(f.retries, [{ key: 'task:' + t.id, operation_id: 'original-operation' }]);
    assert.equal(t.status, status);
    assert.equal(f.root.querySelector('main').getAttribute('data-screen'), child === 'child_a' ? 'jared-task' : 'joey-task');
    assert.equal(byTestId(f.root, 'result-' + status), null);
  });
}

test('portion recording freezes selection before the first awaited save', async () => {
  const a = task({ id: 'a' }), b = task({ id: 'b' }), c = task({ id: 'c' });
  const f = fixture([a, b, c]), wait = deferred();
  f.Store.feedback = async (_, t, status) => { f.feedbacks.push(t.id); if (t.id === 'a') await wait.promise; t.status = status; return { result: 'saved' }; };
  f.window.TaskPlanning.recordGroup({ title: '合成关卡' }, [a, b, c]);
  const d = f.dialogs.at(-1), checks = d.el.querySelectorAll('input[type=checkbox]');
  checks[0].chooseChecked(true); checks[1].chooseChecked(true);
  const saving = byTestId(d.el, 'save-completed-portions').click();
  assert.ok(checks.every(x => x.disabled), 'all selection inputs must freeze while the first save is pending');
  checks[1].chooseChecked(false); checks[2].chooseChecked(true);
  assert.deepEqual(checks.map(x => x.checked), [true, true, false]);
  wait.resolve(); await saving;
  assert.deepEqual(f.feedbacks, ['a', 'b']);
  assert.equal(c.status, 'todo');
  assert.equal(d.closed, true);
});

test('an unknown portion save retries its original operation and skips already saved portions', async () => {
  const a = task({ id: 'a' }), b = task({ id: 'b' }), c = task({ id: 'c' });
  const f = fixture([a, b, c]);
  f.Store.feedback = async (_, t, status) => {
    f.feedbacks.push(t.id);
    if (t.id === 'a') { t.status = status; return { result: 'saved' }; }
    const op = { key: 'task:' + t.id, state: 'unknown', kind: 'feedback', body: { task_id: t.id, status, operation_id: 'portion-b-original' } };
    f.pending[op.key] = op;
    return { result: 'unknown', op };
  };
  f.window.TaskPlanning.recordGroup({ title: '合成关卡' }, [a, b, c]);
  const d = f.dialogs.at(-1), checks = d.el.querySelectorAll('input[type=checkbox]');
  checks[0].chooseChecked(true); checks[1].chooseChecked(true);
  const button = byTestId(d.el, 'save-completed-portions');
  await button.click();
  assert.equal(d.closed, false);
  assert.ok(checks.every(x => x.disabled), 'unresolved saved intent must remain frozen');
  await button.click();
  assert.deepEqual(f.feedbacks, ['a', 'b']);
  assert.deepEqual(f.retries, [{ key: 'task:b', operation_id: 'portion-b-original' }]);
  assert.equal(c.status, 'todo');
  assert.equal(d.closed, true);
});

test('a rejected portion save stops the batch and leaves already saved work intact', async () => {
  const a = task({ id: 'a' }), b = task({ id: 'b' }), c = task({ id: 'c' });
  const f = fixture([a, b, c]);
  f.Store.feedback = async (_, t, status) => {
    f.feedbacks.push(t.id);
    if (t.id === 'b') return { result: 'rejected', status: 409 };
    t.status = status; return { result: 'saved' };
  };
  f.window.TaskPlanning.recordGroup({ title: '合成关卡' }, [a, b, c]);
  const d = f.dialogs.at(-1), checks = d.el.querySelectorAll('input[type=checkbox]');
  checks.forEach(input => input.chooseChecked(true));
  const button = byTestId(d.el, 'save-completed-portions');
  await button.click();
  assert.deepEqual(f.feedbacks, ['a', 'b']);
  assert.deepEqual([a.status, b.status, c.status], ['done', 'todo', 'todo']);
  assert.equal(button.disabled, true);
  assert.equal(d.closed, false);
  assert.match(d.el.textContent, /查看最新任务/);
});

test('partial-progress text stays locked while the exact save is unresolved', async () => {
  const t = task(), f = fixture([t]), wait = deferred();
  f.Store.feedback = async (_, current, status, extra) => {
    f.feedbacks.push({ id: current.id, status, note: extra.progress_note });
    await wait.promise;
    const op = { key: 'task:' + t.id, state: 'unknown', kind: 'feedback', body: { task_id: t.id, status, operation_id: 'progress-original' } };
    f.pending[op.key] = op;
    return { result: 'unknown', op };
  };
  f.window.TaskPlanning.progress(t);
  const d = f.dialogs.at(-1), input = byTestId(d.el, 'progress-note-input'), button = byTestId(d.el, 'save-progress');
  input.value = '第一题做完了';
  const saving = button.click();
  assert.equal(input.disabled, true);
  wait.resolve(); await saving;
  assert.equal(input.disabled, true);
  await button.click();
  assert.deepEqual(f.feedbacks, [{ id: t.id, status: 'doing', note: '第一题做完了' }]);
  assert.deepEqual(f.retries, [{ key: 'task:' + t.id, operation_id: 'progress-original' }]);
  assert.equal(d.closed, true);
});

function openParentDetail(f) {
  f.route('parent');
  const row = byTestId(f.root, 'p-row');
  assert.ok(row); row.click();
  return f.dialogs.at(-1);
}

for (const name of ['child-jared', 'child-joey', 'parent']) {
  test(name + ' keeps original worksheet and audio alongside a typed answer', () => {
    const t = task({ child_id: name === 'child-joey' ? 'child_b' : 'child_a', task_kind: 'audio', material_url: 'assets/original.png', audio_url: 'audio/original.mp3', materials: [{ kind: 'answer', title: '答案', url: 'assets/answer.pdf' }, { kind: 'audio', title: '新录音', url: 'audio/extra.mp3' }] });
    const f = fixture([t]);
    let surface;
    if (name === 'parent') surface = openParentDetail(f).el;
    else { f.route(name, t.id); surface = f.root; }
    const originalAudio = surface.querySelector('audio[src="audio/original.mp3"]');
    assert.ok(originalAudio, 'legacy audio stays available');
    assert.ok(surface.querySelector('audio[src="audio/extra.mp3"]'), 'typed audio stays available');
    const answer = surface.querySelector('[data-kind=answer]');
    assert.ok(answer); answer.click();
    assert.ok(f.opened.some(x => x.url === 'assets/answer.pdf'));
    const originalImage = surface.querySelector('img[src="assets/original.png"]');
    if (!originalImage) {
      const before = f.opened.length;
      for (const button of surface.querySelectorAll('button').filter(n => /^(材料|故事)$/.test(n.textContent))) button.click();
      assert.ok(f.opened.slice(before).some(x => x.url === 'assets/original.png'), 'original worksheet remains reachable');
    }
    if (name !== 'parent') {
      assert.ok(surface.querySelector('details.task-answers'), 'child answers are grouped separately');
      const stopsBeforeLeaving = f.players.map(p => p.stops);
      f.window[name === 'child-jared' ? 'Jared' : 'Joey'].stop();
      assert.ok(f.players.every((p, i) => p.stops > stopsBeforeLeaving[i]), 'leaving the task stops every audio player');
    } else {
      assert.ok(originalAudio.pauseCount > 0, 'opening typed material pauses the original native audio');
      const pausesBeforeClosing = originalAudio.pauseCount, stopsBeforeClosing = f.players.map(p => p.stops);
      f.dialogs.at(-1).close();
      assert.ok(originalAudio.pauseCount > pausesBeforeClosing, 'closing details pauses the original audio');
      assert.ok(f.players.every((p, i) => p.stops > stopsBeforeClosing[i]), 'closing details stops typed audio');
    }
  });
}

for (const name of ['child-jared', 'child-joey', 'parent']) {
  test(name + ' keeps the legacy whole PDF when typed material covers only some pages', () => {
    const t = task({ child_id: name === 'child-joey' ? 'child_b' : 'child_a', material_url: 'assets/whole.pdf', materials: [{ kind: 'exercise', title: '第1份', url: 'assets/whole.pdf', page_from: 1, page_to: 2 }] });
    const f = fixture([t]);
    let surface;
    if (name === 'parent') surface = openParentDetail(f).el;
    else { f.route(name, t.id); surface = f.root; }
    if (name === 'child-joey') assert.ok(surface.querySelector('iframe[src="assets/whole.pdf"]'), 'the full original document is still embedded');
    else {
      const original = name === 'child-jared' ? byTestId(surface, 'open-material') : surface.querySelectorAll('button').find(n => n.textContent === '材料');
      assert.ok(original, 'the full original document still has an entry'); original.click();
      assert.ok(f.opened.some(x => x.url === 'assets/whole.pdf'));
    }
    surface.querySelector('[data-kind=exercise]').click();
    assert.ok(f.opened.some(x => x.url === 'assets/whole.pdf#page=1'));
  });
}

test('new parent tasks offer only the supported school and weekly creation flows', () => {
  const f = fixture(); f.route('parent'); f.window.Parent.setTab('create');
  const kind = f.root.querySelector('select[name=work_type]');
  assert.ok(kind);
  assert.deepEqual(kind.children.map(x => x.value), ['school', 'weekly']);
});

for (const work_type of ['habit', 'itinerary']) {
  test('existing ' + work_type + ' records remain editable without conversion', () => {
    const t = task({ work_type }), f = fixture([t]);
    const detail = openParentDetail(f); byTestId(detail.el, 'detail-edit').click();
    const kind = f.dialogs.at(-1).el.querySelector('select[name=work_type]');
    assert.equal(kind.value, work_type);
    assert.equal(kind.disabled, true);
  });
}

test('legacy weekly details preserve required work while school tasks retain removal controls', () => {
  const f = fixture([task({ work_type: undefined, plan: { start: today, end: '2026-11-18' } })]);
  const weekly = openParentDetail(f);
  assert.equal(!!byTestId(weekly.el, 'more-delete'), false);
  assert.equal(!!byTestId(weekly.el, 'more-archived'), false);
  const school = fixture([task({ work_type: 'school' })]), detail = openParentDetail(school);
  assert.ok(byTestId(detail.el, 'more-delete'));
  assert.ok(byTestId(detail.el, 'more-archived'));
});

for (const locked of [false, true]) {
  test('parent experience amount is ' + (locked ? 'read-only after first award' : 'editable before first award'), () => {
    const f = fixture([task({ exp_award: 2, exp_award_locked: locked })]);
    const detail = openParentDetail(f); byTestId(detail.el, 'detail-edit').click();
    const xp = f.dialogs.at(-1).el.querySelector('input[name=exp_award]');
    assert.equal(xp.value, '2');
    assert.equal(xp.readOnly || xp.disabled, locked);
  });
}

test('weekly summary respects its selected window and separates pending review', () => {
  const f = fixture();
  const plan = {id:'synthetic-window',start:'2026-01-05',end:'2026-01-10',deadline:'2026-01-10T13:00:00+08:00'};
  const items = ['todo','pending_parent','done'].map((status,i)=>task({id:'part-'+i,home_group:'英语作业',plan,status}));
  const summary=f.window.TaskPlanning.weekSummary(items,'2026-01-08');
  assert.match(summary.textContent,/01\/05–01\/10 · 2026-01-10 13:00 前交/);
  assert.match(summary.textContent,/已完成 1 项 · 还剩 1 项 · 待家长检查 1 项/);
  assert.equal(f.window.TaskPlanning.weekSummary(items,'2026-01-11'),null);
});

test('Joey weekly tasks never inherit stale carry labels', () => {
 const f=fixture([task({child_id:'child_b',carried_over:true})]);
 f.route('child-joey');
 assert.doesNotMatch(f.root.textContent,/顺延/);
});
