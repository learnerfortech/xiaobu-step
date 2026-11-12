const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture() {
  let next = 0, rows = [], sent = [], fail = false;
  const clone = x => JSON.parse(JSON.stringify(x));
  const pack = () => ({ ok: true, status: 200, data: { dataset: 'lan', day: '2026-11-12', child_id: 'child_a', tasks: clone(rows), week: clone(rows) } });
  const adapter = {
    list: async () => pack(),
    readback: async () => pack(),
    create: async body => {
      sent.push(clone(body));
      rows = body.portions ? body.portions.map(p => ({ ...body, ...p, materials: p.materials || [], id: p.id, title: body.title + ' · ' + p.label, portion_label: p.label, assignment_id: body.id, assignment_title: body.title, version: 0, status: 'todo' })) : [{ ...clone(body), version: 0, status: 'todo' }];
      return fail ? { status: 503 } : pack();
    },
    update: async body => {
      sent.push(clone(body));
      rows = [{ ...rows[0], ...clone(body), id: body.task_id, version: body.expected_version + 1 }];
      return pack();
    },
    feedback: async (role, body) => {
      sent.push(clone(body));
      rows = [{ ...rows[0], ...clone(body), id: body.task_id, version: body.expected_version + 1 }];
      return pack();
    }
  };
  const window = { API: { TaskAdapter: adapter, RecordAdapter: {}, uuid: () => 'synthetic-' + (++next) }, APP_CONFIG: { TRANSPORT: 'lan', today: () => '2026-11-12' }, addEventListener() {} };
  const ctx = vm.createContext({ window, document: { hidden: false, addEventListener() {} }, setInterval() {}, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/state/store.js'), 'utf8'), ctx);
  return { store: window.Store, adapter, sent, setRows: value => { rows = clone(value); }, setFailure: value => { fail = value; } };
}
const base = { day: '2026-11-12', id: 'portion-1', child_id: 'child_a', title: '合成练习', first_step: '', parent_note: '', material_url: '', audio_url: '', task_kind: 'reading', assignment_state: 'verified', version: 1, status: 'todo' };

test('saving material metadata verifies its content after a JSON round trip', async () => {
  const f = fixture();
  const r = await f.store.create({ child_id: 'child_a', title: '合成材料', materials: [{ kind: 'exercise', title: '题目', url: 'assets/synthetic.pdf', page_from: 1, page_to: 2 }] });
  assert.equal(r.result, 'saved');
});

test('moving a portion verifies its new plan and preserves materials and teacher deadline', async () => {
  const f = fixture(); f.setRows([base]);
  const r = await f.store.update(base, { title: base.title, first_step: '', planned_day: '2026-11-14', due_day: '2026-11-15', photo_required: false, materials: [{ kind: 'answer', title: '答案区', url: 'assets/answers.pdf' }] });
  assert.equal(f.sent[0].planned_day, '2026-11-14');
  assert.equal(f.sent[0].due_day, '2026-11-15');
  assert.equal(f.sent[0].materials[0].kind, 'answer');
  assert.equal(r.result, 'saved');
});

test('partial progress is included in the saved intent and readback check', async () => {
  const f = fixture(); f.setRows([base]);
  const r = await f.store.feedback('child', base, 'doing', { progress_note: '已做第一小题' });
  assert.equal(f.sent[0].progress_note, '已做第一小题');
  assert.equal(r.result, 'saved');
});

test('a date-only edit preserves the task text and can verify its save', async () => {
  const f = fixture();
  const task = { ...base, title: '已固定的一份', first_step: '保留原步骤', planned_day: '2026-11-12', progress_note: '已做第1题' };
  f.setRows([task]);
  const r = await f.store.update(task, { planned_day: '2026-11-14' });
  assert.equal(r.result, 'saved');
  assert.equal(f.sent[0].title, task.title);
  assert.equal(f.sent[0].first_step, task.first_step);
  assert.equal(f.store.find('parent', 'child_a', task.id).progress_note, task.progress_note);
});

test('weekly create verifies fixed portion IDs rather than a nonexistent parent task', async () => {
  const f = fixture();
  const r = await f.store.create({ child_id: 'child_a', title: '合成周练习', work_type: 'weekly', portions: [{ label: '第1份', planned_day: null }, { label: '第2份', planned_day: '2026-11-14' }] });
  assert.equal(r.result, 'saved');
  assert.equal(f.sent[0].portions.length, 2);
  assert.ok(f.sent[0].portions.every(p => typeof p.id === 'string' && p.id.length));
  assert.notEqual(f.sent[0].portions[0].id, f.sent[0].portions[1].id);
});

test('unknown weekly create retries the same group and portion IDs', async () => {
  const f = fixture(); f.setFailure(true);
  const first = await f.store.create({ child_id: 'child_a', title: '合成周练习', work_type: 'weekly', portions: [{ label: '第1份', planned_day: null }] });
  assert.equal(first.result, 'unknown');
  f.setFailure(false);
  const second = await f.store.retry(first.op.key);
  assert.equal(second.result, 'saved');
  assert.deepEqual(f.sent[0], f.sent[1]);
});

test('readback mismatch cannot become a saved result', async () => {
  const f = fixture();
  f.adapter.readback = async () => ({ ok: true, status: 200, data: { tasks: [] } });
  const result = await f.store.create({ child_id: 'child_a', title: '合成任务' });
  assert.equal(result.result, 'unknown');
  assert.ok(f.store.pendingFor(result.op.key));
});

for (const mismatch of ['planned_day', 'nested material', 'progress_note']) {
  test('a populated readback with mismatched ' + mismatch + ' remains unknown', async () => {
    const f = fixture();
    f.setRows([base]);
    const originalReadback = f.adapter.readback;
    f.adapter.readback = async () => {
      const reply = await originalReadback();
      const task = reply.data.tasks[0];
      assert.equal(task.id, base.id);
      assert.equal(task.version, base.version + 1);
      if (mismatch === 'planned_day') task.planned_day = '2026-11-12';
      else if (mismatch === 'nested material') task.materials[0].page_to = 9;
      else task.progress_note = '旧进度';
      return reply;
    };
    const result = mismatch === 'progress_note'
      ? await f.store.feedback('child', base, 'doing', { progress_note: '已做第一小题' })
      : await f.store.update(base, {
        planned_day: '2026-11-14',
        materials: [{ kind: 'exercise', title: '本份题目', url: 'assets/synthetic.pdf', page_from: 1, page_to: 2 }]
      });
    assert.equal(result.result, 'unknown');
    assert.equal(result.reason, 'readback');
    assert.equal(f.store.pendingFor(result.op.key).body.operation_id, f.sent[0].operation_id);
    f.adapter.readback = originalReadback;
    const retried = await f.store.retry(result.op.key);
    assert.equal(retried.result, 'saved');
    assert.deepEqual(f.sent[0], f.sent[1]);
  });
}

test('a different action cannot overwrite an unresolved operation on the same portion', async () => {
  const f = fixture(); f.setRows([base]);
  f.adapter.feedback = async (role, body) => { f.sent.push(JSON.parse(JSON.stringify(body))); return { status: 503 }; };
  const first = await f.store.feedback('child', base, 'doing', { progress_note: '已做一部分' });
  const second = await f.store.feedback('child', base, 'done');
  assert.equal(first.result, 'unknown');
  assert.equal(second.result, 'rejected');
  assert.equal(second.code, 'unresolved_operation');
  assert.equal(f.sent.length, 1);
  assert.equal(f.store.pendingFor(first.op.key).body.operation_id, first.op.body.operation_id);
});
