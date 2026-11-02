/* 状态与“保存语义”——这是本前端最重要的约定（与交接包 child-1.js / parent-*.js 相同）：
   1) 每次修改都带 expected_version + operation_id；
   2) 收到 200 后再 GET 读回，读回结果与意图一致才算“存好”；
   3) 503 / 网络异常 / 读回不一致 = “结果未知”：保留同一个 pending（同一 operation_id），只允许“再试一次”，绝不显示成功；
   4) 400 / 403 / 404 / 409 = 被拒：丢弃 pending，重新读取，让人看最新状态再决定。 */
(function(){
const { TaskAdapter, RecordAdapter, uuid } = window.API;
const C = window.APP_CONFIG;
const day = () => (typeof C.today === "function" ? C.today() : C.DEMO_DAY);

const Store = {
  parentDay: null,
  jaredDay: null,
  loads: {},
  tasks: {},        // `${role}:${child}` → {status:'loading'|'ok'|'error', tasks:[], error}
  pending: {},      // key → {kind, role, body, verify}
  listeners: new Set(),
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); },
  emit() { this.listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } }); },
  sel: (child, role) => {
    const selected = role === 'parent' ? Store.parentDay || day() : child === 'child_a' ? Store.jaredDay || day() : day();
    return { day: selected, child_id: child, ...(C.TRANSPORT === 'lan' && role === 'child' && child === 'child_a' && selected < day() ? { history: true } : {}) };
  },

  async load(role, child) {
    const k = role + ':' + child, request = this.loads[k] = (this.loads[k] || 0) + 1;
    this.tasks[k] = { ...(this.tasks[k] || {}), status: 'loading' };
    this.emit();
    let r;
    try { r = await TaskAdapter.list(role, this.sel(child, role)); }
    catch (_) { r = { ok:false, status:0, error:'network' }; }
    if (request !== this.loads[k]) return this.get(role, child);
    if (r.ok && r.data && Array.isArray(r.data.tasks)) this.tasks[k] = { ...r.data, status: 'ok' };
    else this.tasks[k] = { status: 'error', tasks: [], error: r.error || ('http_' + r.status) };
    this.emit();
    return this.tasks[k];
  },
  get(role, child) { return this.tasks[role + ':' + child] || { status: 'idle', tasks: [] }; },
  find(role, child, id) { return this.get(role, child).tasks.find(t => t.id === id); },

  /* 任务状态反馈（孩子：pending_parent/done/help/paused；家长：done/archived/todo） */
  feedback(role, task, status, extra = {}) {
    const body = { day: task.day, child_id: task.child_id, task_id: task.id, status, expected_version: task.version, operation_id: uuid() };
    if (Object.prototype.hasOwnProperty.call(extra, 'help_note')) body.help_note = typeof extra.help_note === 'string' ? extra.help_note.trim() : extra.help_note;
    if (Object.prototype.hasOwnProperty.call(extra, 'has_mistake')) { body.has_mistake = extra.has_mistake; body.mistake_note = (extra.mistake_note || '').trim(); }
    if (Object.prototype.hasOwnProperty.call(extra, 'reading_minutes')) body.reading_minutes = extra.reading_minutes;
    const op = { key: 'task:' + task.id, kind: 'feedback', role, body,
      verify: list => { const t = list.find(x => x.id === task.id); return !!t && t.status === status && t.version >= task.version + 1 && (!Object.prototype.hasOwnProperty.call(body, 'reading_minutes') || t.reading_minutes === body.reading_minutes) && (!Object.prototype.hasOwnProperty.call(body, 'help_note') || t.help_note === body.help_note) && (!Object.prototype.hasOwnProperty.call(body, 'has_mistake') || (body.has_mistake ? t.mistake_review?.note === body.mistake_note && t.mistake_review?.status === 'pending_review' : !t.mistake_review)); } };
    return this.run(op);
  },
  assign(task, task_kind) {
    const body = { day: task.day, child_id: task.child_id, task_id: task.id, task_kind, expected_version: task.version, operation_id: uuid() };
    const op = { key: 'task:' + task.id, kind: 'assign', role: 'parent', body,
      verify: list => { const t = list.find(x => x.id === task.id); return !!t && t.task_kind === task_kind && t.assignment_state === 'verified'; } };
    return this.run(op);
  },
  create(fields) {
    const body = { day: this.parentDay || day(), id: uuid(), ...fields };
    const op = { key: 'create:' + body.id, kind: 'create', role: 'parent', body,
      verify: list => list.some(x => x.id === body.id && Object.entries(body).every(([k, v]) => x[k] === v)) };
    return this.run(op);
  },
  update(task, fields) {
    const body = {
      day: task.day, child_id: task.child_id, task_id: task.id,
      title: fields.title, first_step: fields.first_step,
      parent_note: fields.parent_note != null ? fields.parent_note : (task.parent_note || ''),
      material_url: fields.material_url != null ? fields.material_url : (task.material_url || ''),
      audio_url: fields.audio_url != null ? fields.audio_url : (task.audio_url || ''),
      task_kind: fields.task_kind || task.task_kind,
      assignment_state: fields.assignment_state || task.assignment_state,
      expected_version: task.version, operation_id: uuid()
    };
    const op = { key: 'task:' + task.id, kind: 'update', role: 'parent', body,
      verify: list => { const t = list.find(x => x.id === task.id); return !!t && ['title', 'first_step', 'parent_note', 'material_url', 'audio_url', 'task_kind', 'assignment_state', 'day', 'child_id'].every(k => t[k] === body[k]) && t.version >= task.version + 1; } };
    return this.run(op);
  },
  remove(task) {
    const body = { day: task.day, child_id: task.child_id, task_id: task.id, expected_version: task.version, operation_id: uuid() };
    const op = { key: 'task:' + task.id, kind: 'delete', role: 'parent', body,
      verify: list => !list.some(x => x.id === task.id) };
    return this.run(op);
  },
  retry(key) { const op = this.pending[key]; return op?.state === 'saving' ? Promise.resolve({ result: 'saving', op }) : op ? this.run(op) : Promise.resolve({ result: 'none' }); },
  abandon(key) { const op = this.pending[key]; if (op) { op.abandoned = true; delete this.pending[key]; } this.emit(); },
  pendingFor(key) { return this.pending[key]; },

  async run(op) {
    this.pending[op.key] = op; op.state = 'saving'; this.emit();
    try {
    const send = op.kind === 'feedback' ? TaskAdapter.feedback(op.role, op.body)
               : op.kind === 'assign' ? TaskAdapter.assign(op.body)
               : op.kind === 'update' ? TaskAdapter.update(op.body)
               : op.kind === 'delete' ? TaskAdapter.remove(op.body)
               : TaskAdapter.create(op.body);
    const r = await send;
    if (op.abandoned) return { result: 'abandoned', op };
    const child = op.body.child_id;
    if (r.status === 200) {
      const rb = await TaskAdapter.readback(op.role, { day: op.body.day, child_id: child }, op.body.task_id || op.body.id);   // 按 ID 读回，周六完成项可退出今日列表
      if (op.abandoned) return { result: 'abandoned', op };
      if (rb.ok && op.verify(rb.data.tasks)) {
        delete this.pending[op.key];
        if (C.TRANSPORT === 'lan') await this.load(op.role, child);
        else this.tasks[op.role + ':' + child] = { status: 'ok', tasks: rb.data.tasks };
        this.emit();
        return { result: 'saved', op, reward: r.data?.reward || null };
      }
      op.state = 'unknown'; this.emit();
      return { result: 'unknown', op, reason: 'readback' };
    }
    if ([400, 401, 403, 404, 405, 409, 429].includes(r.status)) {
      delete this.pending[op.key];
      await this.load(op.role, child);
      return { result: 'rejected', op, status: r.status, code: r.error };
    }
    op.state = 'unknown'; this.emit();                          // 503 / 网络
    return { result: 'unknown', op, status: r.status, code: r.error };
    } catch (_) {
      if (op.abandoned) return { result: 'abandoned', op };
      op.state = 'unknown'; this.emit();
      return { result: 'unknown', op, reason: 'response' };
    }
  },

  /* ---- records（content / schedule / instance / availability） ---- */
  async records(kind, d, child) {
    const r = await RecordAdapter.list(kind, d, child);
    if (!r.ok || !r.data) throw Object.assign(new Error('read'), { status: r.status });
    return r.data.records;
  },
  async saveRecord(rec) {   // rec 已含 operation_id；未知结果时由调用方用同一 rec 重试
    const r = await RecordAdapter.save(rec);
    if (r.status === 200) {
      try {
        const list = await this.records(rec.kind, rec.day, rec.child_id);
        const x = list.find(y => y.id === rec.id);
        if (x && x.version === rec.expected_version + 1 && JSON.stringify(x.payload) === JSON.stringify(rec.payload)) return { result: 'saved' };
      } catch (e) {}
      return { result: 'unknown', reason: 'readback' };
    }
    if ([400, 403, 404, 409].includes(r.status)) return { result: 'rejected', status: r.status, code: r.error };
    return { result: 'unknown', status: r.status };
  }
};
/* 多标签/他页写入本机存档后，重新拉取当前已加载的列表 */
window.addEventListener('xb-mock-sync', () => {
  const keys = Object.keys(Store.tasks);
  if (!keys.length) { Store.emit(); return; }
  Promise.all(keys.map(k => {
    const [role, child] = k.split(':');
    return Store.load(role, child);
  })).catch(() => {}).then(() => Store.emit());
});
// A tablet left open overnight picks up the next day on focus or the next minute.
function refreshChildDay() {
  if (C.TRANSPORT !== 'lan' || document.hidden) return;
  for (const [key, state] of Object.entries(Store.tasks)) {
    if (key.startsWith('child:') && state.status === 'ok' && state.day !== Store.sel(key.split(':')[1], 'child').day) Store.load('child', key.split(':')[1]);
  }
}
window.addEventListener('focus', refreshChildDay);
document.addEventListener('visibilitychange', refreshChildDay);
setInterval(refreshChildDay, 60000);
window.Store = Store;
})();
