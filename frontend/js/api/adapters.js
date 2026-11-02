/* 适配层：UI 只调用这里的 5 个适配器，永远不直接拼 URL。
   边界与交接包建议一致：TaskAdapter / RecordAdapter / PhotoAdapter / DraftStore / SessionAdapter。
   所有路径、参数、请求体字段与 docs/CONTRACT.md 逐字一致（/demo/family/<role>/<op>）。 */
(function(){
const C = window.APP_CONFIG;
const transport = () => C.TRANSPORT === 'lan' ? window.lanTransport : window.demoTransport;
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x'?r:(r&3|8)).toString(16); }));
const qs = o => Object.entries(o).filter(([,v]) => v != null).map(([k,v]) => encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');

/* 统一返回 {status, ok, data, error}；网络异常 → status 0（视为“结果未知”，不可当成功） */
async function call(role, op, { query, json, blob, raw } = {}) {
  const url = C.API_PREFIX + role + '/' + op + (query ? '?' + qs(query) : '');
  const opt = json ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json), cache: 'no-store' }
            : blob ? { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob, cache: 'no-store' }
            : { method: 'GET', cache: 'no-store' };
  try {
    const r = await transport()(url, opt);
    if (raw && r.status === 200) return { status: 200, ok: true, blob: await r.blob() };
    let data = null; try { data = await r.json(); } catch (e) {}
    return { status: r.status, ok: r.status === 200, data, error: data && data.error };
  } catch (e) { return { status: 0, ok: false, data: null, error: 'network' }; }
}

const TaskAdapter = {
  /* role: 'child' | 'parent'；sel: {day, child_id} */
  list: (role, sel) => call(role, 'tasks', { query: { day: sel.day, child: sel.child_id, ...(sel.history ? { history: '1' } : {}) } }),
  readback: (role, sel, id) => C.TRANSPORT === 'lan' ? call(role, 'task', { query: { day: sel.day, child: sel.child_id, id } }) : TaskAdapter.list(role, sel),
  /* body: {day, child_id, task_id, status, expected_version, operation_id} */
  feedback: (role, body) => call(role, 'feedback', { json: body }),
  /* body: {day, child_id, id, title, first_step, parent_note, material_url, audio_url, task_kind, assignment_state} */
  create: body => call('parent', 'create', { json: body }),
  /* body: {day, child_id, task_id, task_kind, expected_version, operation_id} */
  assign: body => call('parent', 'assign', { json: body }),
  /* body: {day, child_id, task_id, title, first_step, parent_note?, material_url?, audio_url?, task_kind?, assignment_state?, expected_version, operation_id} */
  update: body => call('parent', 'update', { json: body }),
  /* body: {day, child_id, task_id, expected_version, operation_id} */
  remove: body => call('parent', 'delete', { json: body })
};
const RecordAdapter = {
  list: (kind, day, child) => call('parent', 'records', { query: { kind, day, child } }),
  /* rec: {id, kind, day, child_id, payload, expected_version, operation_id} → {saved:true}|{replayed:true} */
  save: rec => call('parent', 'records', { json: rec })
};
const PhotoAdapter = {
  list: (role, sel, task) => call(role, 'photos', { query: { day: sel.day, child: sel.child_id, task } }),
  /* 一张一张传；photo = 本地草稿 id（重试时用同一个 id，服务端按 sha256 去重） */
  upload: (sel, task, photo, blob, edit = {}) => call('child', 'photos', { query: { day: sel.day, child: sel.child_id, task, photo, ...edit }, blob }),
  remove: (body, role = 'child') => call(role, 'photos/delete', { json: body }),
  library: (day, child = 'all') => call('parent', 'photo-library', { query: { day, child } }),
  downloadZip: (role, sel, task) => call(role, 'photos/zip', { query: { day: sel.day, child: sel.child_id, task }, raw: true }),
  /* body: {day, child_id, task_id, value, expected_revision, operation_id} */
  markSent: body => call('parent', 'photos/sent', { json: body })
};

/* 草稿只在本设备（内存；真实环境建议 IndexedDB）。确认上传前绝不发送。 */
const drafts = new Map();
const DraftStore = {
  key: (sel, task) => JSON.stringify([sel.day, sel.child_id, task]),
  read: (sel, task) => (drafts.get(DraftStore.key(sel, task)) || []).slice(),
  add(sel, task, im) { const k = DraftStore.key(sel, task); drafts.set(k, [...(drafts.get(k) || []), im]); },
  replace(sel, task, id, im) { const k = DraftStore.key(sel, task); drafts.set(k, (drafts.get(k) || []).map(x => x.id === id ? im : x)); },
  setRemoved(sel, task, id, removed) { const k = DraftStore.key(sel, task); drafts.set(k, (drafts.get(k) || []).map(x => x.id === id ? { ...x, removed } : x)); },
  drop(sel, task, id) { const k = DraftStore.key(sel, task); drafts.set(k, (drafts.get(k) || []).filter(x => x.id !== id)); }
};

/* ⚠ 没有真实登录。这里只是“这台设备当前在谁的界面”，不是认证；家长门也不是认证。 */
const SessionAdapter = {
  getSession: () => ({ authenticated: false, mode: C.TRANSPORT, note: 'demo-no-auth' }),
  login: async () => { throw new Error('未实现：真实登录由后端负责人提供'); },
  logout: async () => {}
};

window.API = { TaskAdapter, RecordAdapter, PhotoAdapter, DraftStore, SessionAdapter, uuid };
})();
