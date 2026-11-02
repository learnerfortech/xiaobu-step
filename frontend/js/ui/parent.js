/* 家长区（受众：家长；只能经家长门进入）。只有标签和数据，没有说明文字。
   对标（截图见 docs/refs/）：
   - 底部标签栏：Brili / ClassDojo（brili-3.jpg、classdojo-3.jpg）
   - 今天：数字卡 = Brili Celebrate（brili-7.jpg）；分段状态条 + 按状态分组的名单 = Seesaw 报告（seesaw-5.jpg）；
           待确认勾选 + 全选 + 一个按钮 = Khan Academy Kids Teacher Tools「Assign」（khankids-8.jpg）；
           孩子切换 = ClassDojo 头像（classdojo-1.jpg）/ Seesaw「All Students」下拉
   - 照片：ClassDojo Class Story 动态卡（classdojo-3.jpg）
   - 管理：Brili「Build Your Routines」表单（brili-6.jpg）
   - 设置：开关列表（Brili More） */
(function(){
const { h, icon, dialog, confirmDialog, toast, Prefs, KIND, kindOf } = window.UI;
const { PhotoAdapter, uuid } = window.API;
const S = window.Store, C = window.APP_CONFIG;
const KIDS = Object.keys(C.CHILDREN), NAME = id => (C.CHILDREN[id] || {}).name || '?';
const ST = { todo: '没开始', doing: '进行中', paused: '暂停', help: '求助', pending_parent: '待确认', done: '完成', archived: '已归档' };
const TONE = { todo: 'todo', doing: 'doing', paused: 'paused', help: 'help', pending_parent: 'wait', done: 'ok', archived: 'muted' };
const GROUPS = ['help', 'pending_parent', 'paused', 'doing', 'todo', 'done'];
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const today = () => S.parentDay || (typeof C.today === 'function' ? C.today() : C.DEMO_DAY);
const dayLabel = d => { const x = new Date(d + 'T00:00:00Z'); return `${x.getUTCMonth() + 1}月${x.getUTCDate()}日 ${WD[x.getUTCDay()]}`; };
const short = s => s.length > 14 ? s.slice(0, 14) + '…' : s;
const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: C.TIMEZONE }) : '';
const log = [];
let root = null, tab = 'today', who = 'all', photoInfo = {}, content = {}, showArchived = false, picked = new Set();
let statusFilters = {}, photoRequest = 0, albumRequest = 0, album = { key: null };
const otherTasksOpen = {};
const requiresPhoto = t => t.child_id === 'child_a' && paperish(t);
const chip = s => h('span.p-chip.' + (TONE[s] || ''), {}, ST[s] || s);
const needsKind = t => t.task_kind === 'legacy' || !t.task_kind || t.assignment_state !== 'verified';
const paperish = t => ['paper', 'legacy'].includes(t.task_kind);
const hasPhotos = t => !!(photoInfo[t.id] && photoInfo[t.id].photos && photoInfo[t.id].photos.length);

async function loadAll() {
  await Promise.all(KIDS.map(c => S.load('parent', c)));
  if (C.TRANSPORT === 'mock') for (const c of KIDS) { try { content[c] = await S.records('content', today(), c); } catch (e) { content[c] = null; } }
  await refreshPhotos();
}
async function refreshPhotos() {
  if (!['mock', 'lan'].includes(C.TRANSPORT)) return;
  const token = ++photoRequest, day = today(), next = {};
  const tasks = KIDS.flatMap(c => S.get('parent', c).tasks.filter(t => paperish(t) && t.status !== 'archived'));
  await Promise.all(tasks.map(async t => {
    const r = await PhotoAdapter.list('parent', { day: t.day, child_id: t.child_id }, t.id);
    next[t.id] = r.ok ? r.data : null;
  }));
  if (token !== photoRequest || day !== today()) return;
  photoInfo = next;
  if (['today', 'photos'].includes(tab) && !document.querySelector('.dlg')) render();
}
function chooseDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  S.parentDay = day; photoInfo = {}; picked.clear(); album = { key: null }; ++albumRequest; ++photoRequest;
  loadAll(); render();
}
function loadAlbum() {
  const day = today(), child = who, key = day + ':' + child, token = ++albumRequest;
  album = { key, loading: true };
  PhotoAdapter.library(day, child).then(r => {
    if (token !== albumRequest || key !== today() + ':' + who) return;
    album = r.ok && r.data?.dataset === 'lan' && r.data.day === day && r.data.child_id === child && Array.isArray(r.data.posts) && Array.isArray(r.data.days)
      ? { key, data: r.data } : { key, error: true };
    if (tab === 'photos' && !document.querySelector('.dlg')) render();
  }).catch(() => { if (token === albumRequest) { album = { key, error: true }; if (tab === 'photos') render(); } });
}

/* 保存结果统一反馈：成功（读回一致）才说“已保存”；未知 → 可重试；被拒 → 已重读 */
async function setStatus(t, status, extra = {}) {
  const from = t.status;
  const r = await S.feedback('parent', t, status, extra);
  report(r, `${NAME(t.child_id)} · ${short(t.title)} · ${ST[from]} → ${ST[status]}`, () => {
    const now = S.find('parent', t.child_id, t.id); if (now) setStatus(now, from);
  });
  return r;
}
function report(r, what, undo) {
  if (r.result === 'saved') { log.unshift({ at: new Date(), what }); toast('已保存', { undo }); }
  else if (r.result === 'rejected') toast(r.status === 409 ? '已被修改，已刷新' : '未保存，已刷新');
  else toast('未确认保存 · 可重试');
  render();
}

/* ================= 今天 ================= */
function todayTab() {
  const kids = who === 'all' ? KIDS : [who];
  const out = [];
  if (C.TRANSPORT === 'lan') out.push(h('section.p-day-summary', { 'aria-label': '今日任务摘要', 'data-testid': 'parent-summary' }, ...kids.map(c => {
    const st = S.get('parent', c);
    if (st.status !== 'ok') return h('p.p-summary-row', {}, h('strong', {}, NAME(c)), h('span', { role: 'status' }, st.status === 'error' ? '读取失败' : '读取中…'));
    const live = st.tasks.filter(t => t.status !== 'archived'), count = status => live.filter(t => t.status === status).length;
    return h('div.p-summary-row', {}, h('strong', {}, NAME(c)), h('span', {}, '完成 ' + count('done')),
      h('button.p-summary-wait', { type: 'button', 'data-testid': 'summary-wait-' + c, 'aria-pressed': String(statusFilters[c] === 'pending_parent'), onclick: () => toggleStatusFilter(c, 'pending_parent') }, '待确认 ' + count('pending_parent')),
      h('span', {}, '求助 ' + count('help')));
  })));
  const retry = Object.values(S.pending).filter(op => op.state === 'unknown');
  if (retry.length) out.push(h('div.p-alert', { 'data-testid': 'parent-retry-bar' }, h('span', {}, `未确认保存 ${retry.length}`),
    h('button.p-btn', { type: 'button', 'data-testid': 'parent-retry', onclick: async () => { for (const op of retry) { const r = await S.retry(op.key); report(r, '重试'); } } }, icon('refresh'), '重试')));
  for (const c of kids) out.push(childBlock(c));
  return out;
}
function toggleStatusFilter(c, status) {
  statusFilters[c] = statusFilters[c] === status ? null : status;
  S.get('parent', c).tasks.forEach(t => picked.delete(t.id));
  render();
}
function childBlock(c) {
  const st = S.get('parent', c);
  const head = h('div.p-child-head', {}, h('span.p-avatar.' + c, { 'aria-hidden': 'true' }, NAME(c).slice(0, 1)), h('h2.p-child-name', {}, NAME(c)));
  if (st.status === 'error') return h('section.p-card', { 'data-testid': 'parent-error-' + c }, head,
    h('div.p-alert', {}, h('span', {}, '读取失败'), h('button.p-btn', { type: 'button', onclick: () => S.load('parent', c).then(render) }, icon('refresh'), '重试')));
  if (st.status !== 'ok') return h('section.p-card', {}, head, h('div.spinner.sm', { role: 'status', 'aria-label': '加载中' }));
  const live = st.tasks.filter(t => t.status !== 'archived');
  const filter = statusFilters[c] || null;
  const shown = live.filter(t => !filter || t.status === filter);
  const n = s => live.filter(t => t.status === s).length;
  const tiles = h('div.p-tiles', {},
    ...[['done', '完成'], ['pending_parent', '待确认'], ['help', '求助'], ['paused', '暂停']].map(([s, l]) => h('button.p-tile.' + TONE[s], { type: 'button', 'data-testid': 'status-' + c + '-' + s, 'aria-pressed': String(filter === s), onclick: () => toggleStatusFilter(c, s) }, h('b', {}, String(n(s))), h('span', {}, l))));
  const bar = h('div.p-stack', { role: 'img', 'aria-label': GROUPS.map(s => `${ST[s]} ${n(s)}`).join('，') },
    ...GROUPS.filter(s => n(s)).map(s => h('i.' + TONE[s], { style: { flexGrow: n(s) } })));
  const blocks = [];
  if (filter) blocks.push(h('div.p-filter-note', { role: 'status' }, '只看' + ST[filter] + ' · ' + shown.length + ' 项', h('button.p-btn', { type: 'button', 'data-testid': 'clear-filter-' + c, onclick: () => { delete statusFilters[c]; render(); } }, '查看全部')));
  if (!live.length) blocks.push(h('p.p-empty', { 'data-testid': 'parent-empty' }, '今天没有任务'));
  /* 待确认：勾选 + 全选 + 确认完成（Khan Kids Assign） */
  const waiting = shown.filter(t => t.status === 'pending_parent');
  if (waiting.length) {
    const all = waiting.every(t => picked.has(t.id));
    blocks.push(h('section.p-group.wait', { 'aria-label': '待确认' },
      h('div.p-group-head', {}, chip('pending_parent'), h('span.p-count', {}, String(waiting.length)),
        h('label.p-check-all', {}, h('input', { type: 'checkbox', checked: all, onchange: e => { waiting.forEach(t => e.target.checked ? picked.add(t.id) : picked.delete(t.id)); render(); } }), '全选')),
      h('ul.p-rows', {}, ...waiting.map(t => h('li.p-row-li', {},
        h('label.p-check', {}, h('input', { type: 'checkbox', 'aria-label': '选择：' + t.title, checked: picked.has(t.id), onchange: e => { e.target.checked ? picked.add(t.id) : picked.delete(t.id); render(); } })),
        row(t)))),
      h('button.p-btn.primary.wide', { type: 'button', 'data-testid': 'confirm-done',
        disabled: !waiting.some(t => picked.has(t.id) && (!requiresPhoto(t) || hasPhotos(t))),
        onclick: async () => {
          const chosen = waiting.filter(t => picked.has(t.id));
          const missing = chosen.filter(t => requiresPhoto(t) && !hasPhotos(t));
          if (missing.length) {
            toast('还有作业没照片，请先让孩子补拍：' + missing.map(t => short(t.title)).join('、'));
            return;
          }
          const keepY = window.scrollY;
          for (const t of chosen) { const now = S.find('parent', c, t.id); picked.delete(t.id); await setStatus(now, 'done'); }
          window.scrollTo(0, keepY);
          requestAnimationFrame(() => window.scrollTo(0, keepY));
        } },
        icon('check'), `确认完成（${waiting.filter(t => picked.has(t.id) && (!requiresPhoto(t) || hasPhotos(t))).length}）`)));
  }
  /* 家里入口：待确认保持展开；其余任务归入一个默认收起的分组。 */
  const others = [];
  for (const s of GROUPS.filter(s => s !== 'pending_parent')) {
    const rows = shown.filter(t => t.status === s);
    if (!rows.length) continue;
    others.push(h('section.p-group', { 'aria-label': ST[s] }, h('div.p-group-head', {}, chip(s), h('span.p-count', {}, String(rows.length))), h('ul.p-rows', {}, ...rows.map(t => h('li.p-row-li', {}, row(t))))));
  }
  const arch = st.tasks.filter(t => t.status === 'archived');
  if (C.TRANSPORT === 'lan') {
    if (arch.length && !filter) others.push(h('section.p-group', { 'aria-label': ST.archived }, h('div.p-group-head', {}, chip('archived'), h('span.p-count', {}, String(arch.length))), h('ul.p-rows', {}, ...arch.map(t => h('li.p-row-li', {}, row(t))))));
    if (filter) blocks.push(...others);
    else if (others.length) blocks.push(h('details.p-group.p-other-tasks', { 'data-testid': 'other-tasks-' + c, open: !!otherTasksOpen[c], ontoggle: e => { if (e.target.isConnected) otherTasksOpen[c] = e.target.open; } },
      h('summary.p-group-head', {}, '其他任务', h('span.p-count', {}, String(st.tasks.filter(t => t.status !== 'pending_parent').length))), ...others));
  } else {
    blocks.push(...others);
    if (arch.length && !filter) blocks.push(h('details.p-group', { open: showArchived, ontoggle: e => showArchived = e.target.open }, h('summary.p-group-head', {}, chip('archived'), h('span.p-count', {}, String(arch.length))),
    h('ul.p-rows', {}, ...arch.map(t => h('li.p-row-li', {}, row(t))))));
  }
  return h('section.p-card', { 'data-testid': 'parent-child-' + c, id: 'parent-tasks-' + c, role: C.TRANSPORT === 'lan' ? 'tabpanel' : null, 'aria-labelledby': C.TRANSPORT === 'lan' ? 'parent-kid-' + c : null }, head, live.length ? tiles : null, live.length ? bar : null, ...blocks);
}
function row(t) {
  const flags = [];
  if (needsKind(t)) flags.push(h('span.p-flag', {}, t.assignment_state === 'pending' ? '待核对 · 孩子不可见' : '类型待核对'));
  const ph = photoInfo[t.id];
  if (ph && ph.photos.length) flags.push(h('span.p-flag.photo', {}, icon('image'), String(ph.photos.length), ph.teacher_sent ? ' · 已发老师' : ''));
  else if (requiresPhoto(t) && t.status === 'pending_parent') flags.push(h('span.p-flag', { 'data-testid': 'photo-missing' }, '缺照片'));
  const rec = (content[t.child_id] || []).find(r => r.payload.task_id === t.id && r.payload.review === 'pending');
  if (rec) flags.push(h('span.p-flag', {}, '内容待核验'));
  return h('button.p-row', { type: 'button', 'data-testid': 'p-row', onclick: () => detail(t) },
    h('span.p-kind', { 'aria-hidden': 'true' }, icon(kindOf(t).icon)), h('span.p-row-main', {}, h('span.p-row-title', {}, t.title), flags.length ? h('span.p-row-flags', {}, ...flags) : null),
    h('span.p-row-go', { 'aria-hidden': 'true' }, icon('chevron')));
}

/* ================= 任务详情 ================= */
function detail(t0) {
  const t = S.find('parent', t0.child_id, t0.id) || t0, sp = t.support;
  const kv = (k, v) => v ? h('div.p-kv', {}, h('dt', {}, k), h('dd', {}, v)) : null;
  const rows = [h('p.p-detail-meta', {}, NAME(t.child_id), ' · ', (KIND[t.task_kind] || KIND.legacy).parent, ' · ', chip(t.status))];
  if (t.help_note) rows.push(h('p', { 'data-testid': 'help-note', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: '12px', background: '#fff6db', borderRadius: '12px' } }, '孩子说：' + t.help_note));
  rows.push(h('dl.p-dl', {}, kv('老师原要求', t.original_requirement), kv('第一步', t.first_step), kv('备注', t.parent_note), t.adult_required ? kv('陪同', '需要') : null));
  if (t.material_url || t.audio_url) rows.push(h('div.p-media', {},
    t.material_url ? h('button.p-btn', { type: 'button', onclick: () => window.Media.openMaterial(t.material_url, t.title, { audience: 'parent', backLabel: '返回' }) }, icon('book'), '材料') : null,
    t.audio_url ? h('audio', { controls: true, preload: 'none', src: t.audio_url, 'aria-label': '音频' }) : null));
  if (sp) rows.push(h('details.p-sub', {}, h('summary', {}, '成人支持'),
    h('dl.p-dl', {}, kv('示范', sp.adult_demo), kv('可接受', sp.acceptable_response), kv('简化', sp.simplify), kv('停止', sp.stop_rule), kv('给孩子', sp.child_demo), kv('来源', sp.source))));
  if (['mock', 'lan'].includes(C.TRANSPORT) && paperish(t)) rows.push(photoPost(t, { compact: true, onChanged: () => { d.close(); detail(S.find('parent', t.child_id, t.id) || t); } }));
  const canConfirm = !(requiresPhoto(t) && t.status === 'pending_parent' && !hasPhotos(t));
  const primary = t.status === 'pending_parent' ? (canConfirm ? ['done', '确认完成'] : null) : t.status === 'help' ? ['todo', '已处理'] : t.status === 'archived' ? ['todo', '恢复'] : needsKind(t) ? ['assign', '核对类型'] : null;
  if (t.status === 'pending_parent' && requiresPhoto(t) && !hasPhotos(t)) rows.push(h('p.p-warn', { 'data-testid': 'confirm-need-photo' }, '还没有作业照片，请先让孩子补拍后再确认。'));
  let mistakeCheck = null, mistakeNote = null;
  if (C.TRANSPORT === 'lan' && t.child_id === 'child_a' && t.task_kind === 'paper' && t.status === 'pending_parent') {
    mistakeCheck = h('input', { type: 'checkbox', 'data-testid': 'mark-mistake' });
    mistakeNote = h('textarea', { maxlength: 500, rows: 2, placeholder: '错因（选填）', 'aria-label': '错因（选填）', 'data-testid': 'mistake-note', hidden: true });
    mistakeCheck.addEventListener('change', () => { mistakeNote.hidden = !mistakeCheck.checked; });
    rows.push(h('section.p-mistake-mark', {}, h('label', {}, mistakeCheck, '有错题／记入错题本'), mistakeNote));
  }
  const more = [];
  if (['mock', 'lan'].includes(C.TRANSPORT)) more.push(['edit', '修改内容', false]);
  if (!['done', 'archived'].includes(t.status) && !(primary && primary[0] === 'done')) more.push(['done', '标记完成', false]);
  if (['done', 'pending_parent', 'paused', 'doing'].includes(t.status)) more.push(['todo', '改回没开始', true]);
  if (t.status !== 'archived') more.push(['archived', '归档', true]);
  if (['mock', 'lan'].includes(C.TRANSPORT)) more.push(['delete', '删除', true]);
  if (needsKind(t) && !(primary && primary[0] === 'assign')) more.push(['assign', '核对类型', false]);
  let d;
  const run = async (s, danger) => {
    if (s === 'assign') { d.close(); return assignDialog(t); }
    if (s === 'edit') { d.close(); return editDialog(t); }
    if (s === 'delete') {
      if (!(await confirmDialog({ title: '删除这条任务？', text: `${NAME(t.child_id)} · ${t.title}`, ok: '删除', danger: true }))) return;
      d.close();
      const now = t; // 使用表单打开时的版本；后台刷新后也不能静默覆盖别人的修改。
      const r = await S.remove(now);
      report(r, `${NAME(t.child_id)} · 删除 ${short(t.title)}`);
      return;
    }
    if (s === 'done' && requiresPhoto(t) && !hasPhotos(t)) {
      toast('还没有作业照片，请先让孩子补拍');
      return;
    }
    if (danger && !(await confirmDialog({ title: s === 'archived' ? '归档？' : '改回没开始？', text: `${NAME(t.child_id)} · ${t.title}`, ok: s === 'archived' ? '归档' : '改回', danger: true }))) return;
    const extra = s === 'done' && mistakeCheck ? { has_mistake: mistakeCheck.checked, mistake_note: mistakeNote.value } : {};
    const keepY = window.scrollY;
    d.close();
    await setStatus(t, s, extra);
    window.scrollTo(0, keepY);
    requestAnimationFrame(() => window.scrollTo(0, keepY));
  };
  rows.push(h('div.p-detail-acts', {},
    ['mock', 'lan'].includes(C.TRANSPORT) ? h('button.p-btn', { type: 'button', 'data-testid': 'detail-edit', onclick: () => run('edit', false) }, icon('pencil'), '修改') : h('p.p-muted', {}, '共享任务暂不支持修改或删除，可使用归档。'),
    primary ? h('button.p-btn.primary', { type: 'button', 'data-testid': 'detail-primary', onclick: () => run(primary[0], false) }, primary[1]) : null,
    more.length ? h('details.p-more', {}, h('summary.p-btn', { 'data-testid': 'detail-more' }, '更多'),
      h('div.p-more-list', {}, ...more.map(([s, l, danger]) => h('button.p-btn' + (danger ? '.danger-ghost' : ''), { type: 'button', 'data-testid': 'more-' + s, onclick: () => run(s, danger) }, l)))) : null));
  const hist = log.filter(x => x.what.includes(short(t.title)));
  rows.push(h('details.p-sub', {}, h('summary', {}, `记录（${hist.length}）`), hist.length ? h('ul.p-log', {}, ...hist.map(x => h('li', {}, x.at.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + ' · ' + x.what))) : h('p.p-muted', {}, '—')));
  rows.push(h('details.p-sub.tech', {}, h('summary', {}, '技术信息'), h('dl.p-dl.mono', {}, kv('task_id', t.id), kv('version', String(t.version)), kv('status', t.status), kv('task_kind', t.task_kind), kv('assignment_state', t.assignment_state))));
  d = dialog({ title: t.title, body: h('div.p-detail', {}, ...rows), cls: 'p-drawer', actions: [h('button.p-btn', { type: 'button', onclick: () => d.close() }, '关闭')] });
}
function assignDialog(t) {
  let pick = t.task_kind === 'legacy' ? 'paper' : t.task_kind;
  let d;
  d = dialog({ title: '核对类型', body: h('div', {}, h('p.p-muted', {}, `${NAME(t.child_id)} · ${t.title}`),
      h('div.p-seg', { role: 'radiogroup', 'aria-label': '类型' }, ...['paper', 'audio', 'reading'].map(k => h('label.p-seg-opt', {}, h('input', { type: 'radio', name: 'kind', value: k, checked: pick === k, onchange: () => pick = k }), h('span', {}, KIND[k].parent))))),
    actions: [h('button.p-btn', { type: 'button', onclick: () => d.close() }, '取消'),
      h('button.p-btn.primary', { type: 'button', 'data-testid': 'assign-ok', onclick: async () => { d.close(); const r = await S.assign(t, pick); report(r, `${NAME(t.child_id)} · ${short(t.title)} · 类型 ${KIND[pick].parent}`); } }, '确认')] });
}

/* ================= 照片（ClassDojo Class Story） ================= */
/* 新增/修改共用保存反馈。未确认时只重试原操作，保留输入，防止重复新增。 */
function taskFormSave(form, button, make, onSaved, pending) {
  const msg = form.querySelector('.p-form-msg');
  let busy = false, unresolved = pending || null;
  form.noValidate = true;
  const lock = value => {
    form.querySelectorAll('input,select,textarea').forEach(el => { el.disabled = value; });
    button.disabled = value;
    form.setAttribute('aria-busy', String(busy));
  };
  const rejectedMessage = r => {
    if (r.status === 409) return '这条任务已在别处修改，本次没有覆盖。请关闭后重新打开，查看最新内容。';
    if (r.status === 404) return '这条任务已不存在，本次未保存。请返回今天查看。';
    if (r.code === 'unsupported_link') return '未保存：材料或音频链接不支持。请使用网页链接，或把链接留空。';
    if (r.status === 400) return '未保存：请检查任务名称、文字长度和链接。选填项可以留空。';
    return '未保存：当前操作未被允许。输入内容已保留，请刷新后查看。';
  };
  const unknown = () => {
    lock(true);
    const retry = h('button.p-btn', { type: 'button', 'data-testid': 'task-form-retry', onclick: () => go(true) }, '再确认一次');
    msg.replaceChildren(h('span', {}, '暂时无法确认是否保存。输入已保留，请检查电脑和 Wi-Fi，再点“再确认一次”。 '), retry);
  };
  async function go(retry = false) {
    if (busy || (!retry && unresolved)) return;
    const values = Object.fromEntries(new FormData(form));
    if (!retry) {
      if (!(values.title || '').trim()) { msg.textContent = '还没保存：请填写任务名称；第一步和其他选填项可以留空。'; form.querySelector('[name=title]').focus(); return; }
      if (!form.checkValidity()) { msg.textContent = '还没保存：请检查输入内容，名称最多 100 字。'; return; }
    }
    busy = true; lock(true); button.textContent = '正在保存…'; msg.textContent = retry ? '正在确认上次保存，请稍候…' : '正在保存，请稍候…';
    let result;
    try { result = await (retry ? (S.pendingFor(unresolved.key) ? S.retry(unresolved.key) : S.run(unresolved)) : make(values)); }
    catch (_) { result = { result: 'unknown', op: unresolved }; }
    busy = false; button.textContent = '保存';
    if (result.result === 'saved') {
      unresolved = null; lock(false); msg.textContent = '已保存。'; onSaved(result); return;
    }
    if (result.result === 'rejected') {
      unresolved = null; lock(false); msg.textContent = rejectedMessage(result);
      // 编辑仍保留打开表单时的版本，冲突后要求重新打开，绝不自动套用新版本覆盖。
      if (result.status === 409 || result.status === 404) button.disabled = true;
      return;
    }
    unresolved = result.op || unresolved;
    if (unresolved) unknown();
    else { lock(false); msg.textContent = '暂未确认保存，请返回今天查看最新状态。'; }
  }
  if (unresolved) unknown();
  return () => go(false);
}
const taskFields = v => ({ title: (v.title || '').trim(), first_step: (v.first_step || '').trim(),
  parent_note: v.parent_note || '', material_url: (v.material_url || '').trim(), audio_url: (v.audio_url || '').trim(), task_kind: v.kind });

function editDialog(t0) {
  const t = S.find('parent', t0.child_id, t0.id) || t0;
  const f = h('form.p-form', { 'data-testid': 'edit-form' },
    field('名称', inp({ name: 'title', required: true, maxlength: 100, value: t.title || '' })),
    field('第一步（选填）', inp({ name: 'first_step', placeholder: '作业已明确可留空', value: t.first_step || '' })),
    field('备注（选填）', inp({ name: 'parent_note', value: t.parent_note || '' })),
    h('div.p-field', {}, h('span', {}, '类型'), h('div.p-seg', { role: 'radiogroup', 'aria-label': '类型' },
      ...['paper', 'audio', 'reading', 'legacy'].map(k => h('label.p-seg-opt', {},
        h('input', { type: 'radio', name: 'kind', value: k, checked: (t.task_kind || 'legacy') === k }),
        h('span', {}, (KIND[k] || KIND.legacy).parent))))),
    h('details.p-sub', { open: !!(t.material_url || t.audio_url) }, h('summary', {}, '链接'),
      field('材料（选填）', inp({ name: 'material_url', value: t.material_url || '', placeholder: 'assets/… 或 https://…' })),
      field('音频（选填）', inp({ name: 'audio_url', value: t.audio_url || '', placeholder: 'assets/… 或 https://…' }))),
    h('p.p-form-msg', { role: 'status', 'aria-live': 'polite' }));
  const pending = S.pendingFor('task:' + t.id);
  if (pending?.kind === 'update') {
    for (const key of ['title', 'first_step', 'parent_note', 'material_url', 'audio_url']) f.elements[key].value = pending.body[key] || '';
    f.querySelectorAll('[name=kind]').forEach(el => { el.checked = el.value === pending.body.task_kind; });
  }
  let save;
  const button = h('button.p-btn.primary', { type: 'button', 'data-testid': 'edit-submit', onclick: () => save() }, '保存');
  const d = dialog({ title: '修改任务', body: f, cls: 'p-drawer', actions: [
    h('button.p-btn', { type: 'button', onclick: () => d.close() }, '取消'), button
  ] });
  save = taskFormSave(f, button, v => S.update(t, taskFields(v)), () => {
    d.close(); log.unshift({ at: new Date(), what: `${NAME(t.child_id)} · 修改任务` }); toast('已保存'); render();
  }, pending?.kind === 'update' ? pending : null);
  f.onsubmit = e => { e.preventDefault(); save(); };
}

function photosTab() {
  if (C.TRANSPORT === 'lan') {
    if (album.key !== today() + ':' + who) loadAlbum();
    if (album.loading) return [h('p', { role: 'status', 'data-testid': 'photos-loading' }, '正在读取照片日期…')];
    if (album.error) return [h('div.p-alert', {}, '照片暂时没读到，请重试。', h('button.p-btn', { type: 'button', onclick: () => { loadAlbum(); render(); } }, '重试'))];
    const data = album.data;
    return [h('section.p-card', { 'data-testid': 'photo-days' }, h('h2', {}, '有照片的日期'),
      h('nav.date-buttons', {}, ...data.days.map(d => h('button.p-btn', { type: 'button', 'aria-pressed': String(d.day === today()), 'data-photo-day': d.day, onclick: () => chooseDay(d.day) }, d.day + ' · ' + d.count + '张')))),
      ...(data.posts.length ? data.posts.map(p => photoPost(p.task, { pack: p.pack })) : [h('p.p-empty', { 'data-testid': 'photos-empty' }, today() + ' 没有照片。' + (data.days.length ? '点上方日期查看已有照片。' : '还没有存下的作业照片。'))])];
  }
  const posts = [];
  for (const c of (who === 'all' ? KIDS : [who])) for (const t of S.get('parent', c).tasks.filter(t => paperish(t) && t.status !== 'archived'))
    if (photoInfo[t.id] && photoInfo[t.id].photos.length) posts.push(photoPost(t));
  return posts.length ? posts : [h('p.p-empty', { 'data-testid': 'photos-empty' }, '暂无照片')];
}
function photoPost(t, { compact, pack, onChanged } = {}) {
  const sel = { day: t.day, child_id: t.child_id };
  const box = h('article.p-post', { 'data-testid': 'photo-post' });
  let deleting = false;
  const paint = p => {
    box.replaceChildren();
    if (!compact) box.append(h('header.p-post-head', {}, h('span.p-avatar.' + t.child_id, { 'aria-hidden': 'true' }, NAME(t.child_id).slice(0, 1)),
      h('div', {}, h('b', {}, NAME(t.child_id)), h('span.p-muted', {}, ' · ' + fmtTime(p.photos.length ? p.photos[p.photos.length - 1].created_at : ''))), h('span.p-post-task', {}, t.title)));
    else box.append(h('h3.p-sub-h', {}, '照片'));
    if (!p.photos.length) { box.append(h('p.p-muted', {}, '0')); return; }
    box.append(h('div.p-thumbs', {}, ...p.photos.map((x, i) => h('figure.p-photo-item', {},
      h('img', { src: x.url, alt: `${t.title} 第 ${i + 1} 张`, style: { cursor: 'zoom-in' }, onclick: () => window.Media && window.Media.openMaterial(x.url, t.title + ' · 第 ' + (i + 1) + ' 张', { audience: 'parent', backLabel: '返回' }) }),
      C.TRANSPORT === 'lan' ? h('button.p-btn.danger-ghost', { type: 'button', disabled: deleting, 'data-testid': 'parent-photo-delete', onclick: async () => {
        if (deleting) return;
        if (!(await confirmDialog({ title: '删除这张照片？', text: ['done', 'archived'].includes(t.status) ? '只删照片，已确认的任务和经验保持不变。' : '删除后请让孩子核对照片并重新提交。', ok: '删除照片', danger: true }))) return;
        deleting = true; paint(p);
        try {
          const r = await PhotoAdapter.remove({ ...sel, task_id: t.id, photo_id: x.id, expected_revision: p.revision }, 'parent');
          const rb = await PhotoAdapter.list('parent', sel, t.id);
          if (rb.ok) { photoInfo[t.id] = rb.data; pack = rb.data; }
          if (!r.ok || !rb.ok || rb.data.photos.some(ph => ph.id === x.id)) {
            toast(r.status === 409 ? '照片已变动，已重新读取，请核对后再删。' : '还没确认删除成功，请重新核对。');
          } else { toast('照片已删除'); }
          await S.load('parent', t.child_id);
          await refreshPhotos();
          album = { key: null }; ++albumRequest;
          if (onChanged) onChanged(); else render();
        } catch (_) { toast('还没确认删除成功，请重新打开照片核对。'); }
        finally { deleting = false; if (box.isConnected) paint(pack || p); }
      } }, '删除照片') : null))));
    const foot = [h('span.p-sent', { 'data-testid': 'sent-state' }, p.teacher_sent ? `已发老师 · ${fmtTime(p.sent_at)}` : `${p.photos.length} 张`)];
    if (C.TRANSPORT === 'mock') {
      foot.push(h('button.p-btn', { type: 'button', 'data-testid': 'zip', onclick: async () => {
        const z = await PhotoAdapter.downloadZip('parent', sel, t.id);
        if (!z.ok) return toast('下载失败');
        const a = h('a', { href: URL.createObjectURL(z.blob), download: `photos-${t.day}.zip` }); document.body.append(a); a.click(); a.remove();
      } }, icon('download'), `下载（${p.photos.length}）`));
      foot.push(h('button.p-btn' + (p.teacher_sent ? '' : '.primary'), { type: 'button', 'data-testid': 'mark-sent', onclick: async () => {
        if (!p.teacher_sent && !(await confirmDialog({ title: '标记已发老师？', text: `${NAME(t.child_id)} · ${t.title} · ${p.photos.length} 张`, ok: '标记' }))) return;
        const v = !p.teacher_sent;
        if (await setSent(t, v)) { paint(photoInfo[t.id]); render(); toast(v ? '已标记' : '已取消标记', { undo: v ? async () => { await setSent(t, false); render(); } : null }); }
      } }, icon('send'), p.teacher_sent ? '取消已发' : '已发老师'));
    }
    box.append(h('footer.p-post-foot', {}, ...foot));
  };
  if (pack || photoInfo[t.id]) paint(pack || photoInfo[t.id]);
  else { box.append(h('div.spinner.sm', { role: 'status', 'aria-label': '加载中' }));
    PhotoAdapter.list('parent', sel, t.id).then(r => { if (r.ok) { photoInfo[t.id] = r.data; paint(r.data); } else box.replaceChildren(h('p.p-warn', {}, '读取失败')); }); }
  return box;
}
async function setSent(t, value) {
  const sel = { day: t.day, child_id: t.child_id };
  const cur = await PhotoAdapter.list('parent', sel, t.id);
  if (!cur.ok) { toast('读取失败'); return false; }
  const body = { day: t.day, child_id: t.child_id, task_id: t.id, value, expected_revision: cur.data.revision, operation_id: uuid() };
  for (let i = 0; i < 2; i++) {          // 结果未知 → 同一 operation_id 重试一次
    const r = await PhotoAdapter.markSent(body);
    if (r.ok) { const b = await PhotoAdapter.list('parent', sel, t.id); if (b.ok && b.data.teacher_sent === value) { photoInfo[t.id] = b.data; log.unshift({ at: new Date(), what: `${NAME(t.child_id)} · ${short(t.title)} · ${value ? '已发老师' : '取消已发'}` }); return true; } }
    if (r.status === 409) { toast('已被修改，已刷新'); const b = await PhotoAdapter.list('parent', sel, t.id); if (b.ok) photoInfo[t.id] = b.data; render(); return false; }
    if ([400, 403, 404].includes(r.status)) { toast('未保存'); return false; }
  }
  toast('未确认保存 · 可重试'); return false;
}

/* ================= 管理（Brili Build Your Routines 表单结构） ================= */
const field = (label, input) => h('label.p-field', {}, h('span', {}, label), input);
const inp = (attrs) => h('input.p-input', attrs);
const sel = (name, opts, val) => h('select.p-input', { name }, ...opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l)));
/* 记录保存对话框：未知结果时保留同一条记录（同 operation_id）供“重试” */
function saveFlow(d, rec, done) {
  const msg = d.box.querySelector('.p-form-msg');
  const go = async () => {
    msg.replaceChildren('…');
    const r = await S.saveRecord(rec);
    if (r.result === 'saved') { d.close(); log.unshift({ at: new Date(), what: '保存 ' + rec.kind }); toast('已保存'); done && done(); return; }
    if (r.result === 'rejected') { msg.replaceChildren(r.status === 409 ? '已被修改，请重开' : '未保存：内容不完整'); return; }
    msg.replaceChildren(h('span', {}, '未确认保存 '), h('button.p-btn', { type: 'button', 'data-testid': 'record-retry', onclick: go }, icon('refresh'), '重试'));
  };
  go();
}
function manageTab() {
  const box = h('div.p-manage');
  box.append(h('details.p-card.p-fold', { 'data-testid': 'fold-create' }, h('summary', {}, icon('plus'), '新增任务'), createForm()));
  if (C.TRANSPORT !== 'mock') return [box];
  const sched = h('div', {}, h('div.spinner.sm', { role: 'status', 'aria-label': '加载中' }));
  box.append(h('details.p-card.p-fold', { 'data-testid': 'fold-schedule', ontoggle: e => e.target.open && scheduleList(sched) }, h('summary', {}, icon('clock'), '安排'), sched));
  const cont = h('div', {}, h('div.spinner.sm', { role: 'status', 'aria-label': '加载中' }));
  box.append(h('details.p-card.p-fold', { 'data-testid': 'fold-content', ontoggle: e => e.target.open && contentList(cont) }, h('summary', {}, icon('book'), '内容与成人支持'), cont));
  return [box];
}
function createForm() {
  const f = h('form.p-form', { 'data-testid': 'create-form' },
    field('孩子', sel('child', KIDS.map(c => [c, NAME(c)]), who === 'all' ? KIDS[0] : who)),
    field('名称', inp({ name: 'title', required: true, maxlength: 100 })),
    field('第一步（选填）', inp({ name: 'first_step', placeholder: '作业已明确可留空' })),
    h('div.p-field', {}, h('span', {}, '类型'), h('div.p-seg', { role: 'radiogroup', 'aria-label': '类型' }, ...['paper', 'audio', 'reading'].map((k, i) => h('label.p-seg-opt', {}, h('input', { type: 'radio', name: 'kind', value: k, checked: i === 0 }), h('span', {}, KIND[k].parent))))),
    h('label.p-switch', {}, h('input', { type: 'checkbox', name: 'verified', checked: true }), h('span', {}, '已核对（孩子可见）')),
    field('备注（选填）', inp({ name: 'parent_note' })),
    h('details.p-sub', {}, h('summary', {}, '链接'), field('材料（选填）', inp({ name: 'material_url', placeholder: 'assets/… 或 https://…' })), field('音频（选填）', inp({ name: 'audio_url', placeholder: 'assets/… 或 https://…' }))),
    h('p.p-form-msg', { role: 'status', 'aria-live': 'polite' }),
    h('button.p-btn.primary.wide', { type: 'submit', 'data-testid': 'create-submit' }, '保存'));
  const pending = Object.values(S.pending).find(op => op.kind === 'create');
  if (pending) {
    const body = pending.body;
    for (const key of ['title', 'first_step', 'parent_note', 'material_url', 'audio_url']) f.elements[key].value = body[key] || '';
    f.elements.child.value = body.child_id;
    f.elements.verified.checked = body.assignment_state === 'verified';
    f.querySelectorAll('[name=kind]').forEach(el => { el.checked = el.value === body.task_kind; });
  }
  const save = taskFormSave(f, f.querySelector('[data-testid=create-submit]'), v => S.create({
    ...taskFields(v), child_id: v.child, assignment_state: v.verified ? 'verified' : 'pending'
  }), r => {
    f.reset(); f.elements.verified.checked = true;
    f.querySelector('.p-form-msg').textContent = '已保存。可继续新增任务。';
    log.unshift({ at: new Date(), what: `${NAME(r.op.body.child_id)} · 新增 ${short(r.op.body.title)}` });
    toast('已保存');
  }, pending);
  f.onsubmit = e => { e.preventDefault(); save(); };
  return f;
}
const KINDS = { accompany: '陪伴', prepare: '备课' }, INST = { done: '已完成', cancelled: '已取消', rescheduled: '已改期' };
const WEEKEND = { morning_pending: '上午待定', outdoors: '户外' };
async function scheduleList(host) {
  host.replaceChildren(h('div.spinner.sm', { role: 'status', 'aria-label': '加载中' }));
  try {
    const wd = new Date(today() + 'T00:00:00Z').getUTCDay();
    const out = [];
    for (const c of KIDS) {
      const rules = await S.records('schedule', 'weekly', c), inst = await S.records('instance', today(), c);
      out.push(h('h3.p-sub-h', {}, NAME(c)));
      out.push(h('ul.p-rows', {}, ...rules.map(r => { const p = r.payload, i = inst.find(x => x.payload.schedule_id === r.id);
        return h('li.p-row-li', {}, h('div.p-row.static', {}, h('span.p-kind', { 'aria-hidden': 'true' }, icon('clock')),
          h('span.p-row-main', {}, h('span.p-row-title', {}, `${WD[p.weekday]} ${p.start || '--:--'} · ${p.duration ? p.duration + '分钟' : '--'} · ${KINDS[p.kind] || p.kind}`),
            h('span.p-row-flags', {}, h('span.p-flag', {}, p.enabled ? '启用' : '停用'), i ? h('span.p-flag', {}, '今天 ' + (INST[i.payload.status] || i.payload.status)) : null)),
          h('span.p-row-btns', {}, h('button.p-btn', { type: 'button', onclick: () => scheduleDialog(c, r, () => scheduleList(host)) }, '编辑'),
            p.weekday === wd && p.enabled ? h('details.p-more', {}, h('summary.p-btn', {}, '今天'), h('div.p-more-list', {},
              ...[['done', '完成本次'], ['cancelled', '取消本次'], ['rescheduled', '改期']].map(([s, l]) => h('button.p-btn', { type: 'button', onclick: () => instanceDialog(c, r, i, s, () => scheduleList(host)) }, l)))) : null))); })),
        h('button.p-btn', { type: 'button', onclick: () => scheduleDialog(c, null, () => scheduleList(host)) }, icon('plus'), '新增'));
    }
    const av = await S.records('availability', 'weekly', 'parent'), a = av[0];
    out.push(h('h3.p-sub-h', {}, '空闲时段'), h('div.p-row.static', {}, h('span.p-row-main', {}, h('span.p-row-title', {}, a ? `${a.payload.weekdays.map(d => WD[d].slice(1)).join('')} ${a.payload.start}–${a.payload.end}` : '未设置'),
      a ? h('span.p-row-flags', {}, h('span.p-flag', {}, '周六 ' + (WEEKEND[a.payload.saturday] || a.payload.saturday)), h('span.p-flag', {}, '周日 ' + (WEEKEND[a.payload.sunday] || a.payload.sunday))) : null),
      h('button.p-btn', { type: 'button', onclick: () => availabilityDialog(a, () => scheduleList(host)) }, '编辑')));
    host.replaceChildren(...out);
  } catch (e) { host.replaceChildren(h('div.p-alert', {}, h('span', {}, '读取失败'), h('button.p-btn', { type: 'button', onclick: () => scheduleList(host) }, icon('refresh'), '重试'))); }
}
function scheduleDialog(c, r, done) {
  const p = r ? r.payload : { weekday: 1, kind: 'accompany', start: '', duration: '', enabled: true };
  const f = h('form.p-form', {}, field('星期', sel('weekday', WD.map((w, i) => [i, w]), p.weekday)), field('类型', sel('kind', Object.entries(KINDS), p.kind)),
    field('开始', inp({ name: 'start', type: 'time', value: p.start || '' })), field('分钟', inp({ name: 'duration', type: 'number', min: 1, max: 180, value: p.duration || '' })),
    h('label.p-switch', {}, h('input', { type: 'checkbox', name: 'enabled', checked: p.enabled }), h('span', {}, '启用')), h('p.p-form-msg', { role: 'status', 'aria-live': 'polite' }));
  let d;
  d = dialog({ title: `${NAME(c)} · 安排`, body: f, actions: [h('button.p-btn', { type: 'button', onclick: () => d.close() }, '取消'), h('button.p-btn.primary', { type: 'button', onclick: () => {
    const v = Object.fromEntries(new FormData(f));
    saveFlow(d, { id: r ? r.id : uuid(), kind: 'schedule', day: 'weekly', child_id: c, payload: { weekday: Number(v.weekday), kind: v.kind, start: v.start || null, duration: v.duration ? Number(v.duration) : null, enabled: !!v.enabled, timezone: C.TIMEZONE }, expected_version: r ? r.version : 0, operation_id: uuid() }, done);
  } }, '保存')] });
}
function instanceDialog(c, r, i, status, done) {
  const p = i ? i.payload : r.payload;
  const f = h('form.p-form', {}, status === 'rescheduled' ? [field('开始', inp({ name: 'start', type: 'time', value: p.start || '' })), field('分钟', inp({ name: 'duration', type: 'number', min: 1, value: p.duration || '' }))] : null,
    field('原因', inp({ name: 'reason' })), h('p.p-form-msg', { role: 'status', 'aria-live': 'polite' }));
  let d;
  d = dialog({ title: `${NAME(c)} · ${INST[status]}`, body: f, actions: [h('button.p-btn', { type: 'button', onclick: () => d.close() }, '取消'), h('button.p-btn.primary', { type: 'button', onclick: () => {
    const v = Object.fromEntries(new FormData(f));
    saveFlow(d, { id: i ? i.id : uuid(), kind: 'instance', day: today(), child_id: c, payload: { schedule_id: r.id, start: v.start || p.start, duration: v.duration ? Number(v.duration) : p.duration, status, task_id: null, reason: v.reason || '' }, expected_version: i ? i.version : 0, operation_id: uuid() }, done);
  } }, '保存')] });
}
function availabilityDialog(a, done) {
  const p = a ? a.payload : { weekdays: [1, 2, 3, 4, 5], start: '18:00', end: '19:30', saturday: 'morning_pending', sunday: 'outdoors' };
  const f = h('form.p-form', {}, h('div.p-field', {}, h('span', {}, '星期'), h('div.p-days', {}, ...[1, 2, 3, 4, 5, 6, 0].map(d => h('label.p-day', {}, h('input', { type: 'checkbox', name: 'wd', value: d, checked: p.weekdays.includes(d) }), h('span', {}, WD[d].slice(1)))))),
    field('开始', inp({ name: 'start', type: 'time', value: p.start })), field('结束', inp({ name: 'end', type: 'time', value: p.end })), h('p.p-form-msg', { role: 'status', 'aria-live': 'polite' }));
  let d;
  d = dialog({ title: '空闲时段', body: f, actions: [h('button.p-btn', { type: 'button', onclick: () => d.close() }, '取消'), h('button.p-btn.primary', { type: 'button', onclick: () => {
    const fd = new FormData(f);
    saveFlow(d, { id: a ? a.id : '90000000-0000-4000-8000-000000000001', kind: 'availability', day: 'weekly', child_id: 'parent', payload: { weekdays: fd.getAll('wd').map(Number).sort(), start: fd.get('start'), end: fd.get('end'), saturday: p.saturday, sunday: p.sunday }, expected_version: a ? a.version : 0, operation_id: uuid() }, done);
  } }, '保存')] });
}
async function contentList(host) {
  host.replaceChildren(h('div.spinner.sm', { role: 'status', 'aria-label': '加载中' }));
  const out = [];
  for (const c of KIDS) {
    let recs; try { recs = await S.records('content', today(), c); content[c] = recs; } catch (e) { out.push(h('div.p-alert', {}, h('span', {}, NAME(c) + ' 读取失败'))); continue; }
    out.push(h('h3.p-sub-h', {}, NAME(c)), h('ul.p-rows', {}, ...recs.map(r => h('li.p-row-li', {}, h('button.p-row', { type: 'button', onclick: () => contentDialog(c, r, () => contentList(host)) },
      h('span.p-kind', { 'aria-hidden': 'true' }, icon('book')), h('span.p-row-main', {}, h('span.p-row-title', {}, r.payload.title),
        h('span.p-row-flags', {}, h('span.p-flag' + (r.payload.review === 'verified' ? '.ok' : ''), {}, r.payload.review === 'verified' ? '已核验' : '待核验'), h('span.p-flag', {}, r.payload.content_kind === 'school' ? '学校' : '陪伴'), h('span.p-flag', {}, '修订 ' + r.payload.revision))),
      h('span.p-row-go', { 'aria-hidden': 'true' }, icon('chevron')))))),
      h('button.p-btn', { type: 'button', onclick: () => contentDialog(c, null, () => contentList(host)) }, icon('plus'), '新增'));
  }
  host.replaceChildren(...out);
}
function contentDialog(c, r, done) {
  const p = r ? r.payload : {};
  const tasks = S.get('parent', c).tasks;
  const ta = (name, label) => field(label, h('textarea.p-input', { name, rows: 2 }, p[name] || ''));
  const f = h('form.p-form', {}, field('任务', sel('task_id', [['', '—'], ...tasks.map(t => [t.id, short(t.title)])], p.task_id || '')), field('标题', inp({ name: 'title', value: p.title || '' })),
    field('类别', sel('content_kind', [['school', '学校'], ['companionship', '陪伴']], p.content_kind || 'school')), field('来源', inp({ name: 'source', value: p.source || '' })),
    field('来源日期', inp({ name: 'source_day', type: 'date', value: p.source_day || '' })), ta('source_text', '原文'), ta('adult_demo', '示范'), ta('acceptable_response', '可接受'), ta('simplify', '简化'), ta('stop_rule', '停止'), ta('child_demo', '给孩子'),
    h('label.p-switch', {}, h('input', { type: 'checkbox', name: 'verified', checked: p.review === 'verified' }), h('span', {}, '已核验')),
    h('details.p-sub', {}, h('summary', {}, '高级'), field('business_key', inp({ name: 'business_key', value: p.business_key || '' }))), h('p.p-form-msg', { role: 'status', 'aria-live': 'polite' }));
  let d;
  d = dialog({ title: `${NAME(c)} · 内容`, body: f, cls: 'p-drawer', actions: [h('button.p-btn', { type: 'button', onclick: () => d.close() }, '取消'), h('button.p-btn.primary', { type: 'button', onclick: () => {
    const v = Object.fromEntries(new FormData(f));
    const payload = { content_kind: v.content_kind, task_id: v.task_id || null, title: v.title, source: v.source, source_day: v.source_day, verified_day: v.verified ? today() : null, review: v.verified ? 'verified' : 'pending', revision: (p.revision || 0) + 1,
      business_key: v.business_key, source_text: v.source_text, adult_demo: v.adult_demo, acceptable_response: v.acceptable_response, simplify: v.simplify, stop_rule: v.stop_rule, child_demo: v.child_demo };
    saveFlow(d, { id: r ? r.id : uuid(), kind: 'content', day: today(), child_id: c, payload, expected_version: r ? r.version : 0, operation_id: uuid() }, () => { done && done(); S.load('parent', c); });
  } }, '保存')] });
}

/* ================= 设置 ================= */
function settingsTab() {
  const talkOn = !Prefs.get('muteBuddy', false), showOn = !Prefs.get('hideBuddy', false);
  const dev = Prefs.get('deviceChild', '');
  return [h('section.p-card.p-settings', {},
    h('label.p-switch.row', {}, h('span', {}, '团团说话'), h('input', { type: 'checkbox', role: 'switch', checked: talkOn, 'data-testid': 'set-talk', onchange: e => { Prefs.set('muteBuddy', !e.target.checked); if (!e.target.checked) Voice.stop(); } })),
    h('div.p-set-row', {}, h('span', {}, '试听'), h('button.p-btn', { type: 'button', 'data-testid': 'sound-test', onclick: () => { Voice.unlock(); Voice.muted = false; Voice.play('你好呀，我是团团！想玩哪个？点一点！'); } }, icon('sound'), '播放')),
    h('label.p-switch.row', {}, h('span', {}, '显示团团'), h('input', { type: 'checkbox', role: 'switch', checked: showOn, onchange: e => Prefs.set('hideBuddy', !e.target.checked) })),
    h('label.p-set-row', {}, h('span', {}, '这台设备'), sel('device', [['', '选择孩子'], ...KIDS.map(c => [c, NAME(c)])], dev)),
    h('div.p-set-row', {}, h('span', {}, '收工时间'), h('b', { 'data-testid': 'boundary' }, C.EVENING_BOUNDARY || '已关闭（不关入口）')),
    h('div.p-set-row', {}, h('span', {}, '数据'), h('b', {}, C.TRANSPORT === 'mock' ? '本机存档（不同设备不互通）' : '家里共享（保存在 Mac）')),
    h('p.p-muted', {}, '家里共享与本机存档分开保存，不自动导入或覆盖。共享仅含任务；照片仍在原本机模式。'),
    h('div.p-set-row', {}, h('span', {}, '共享任务'), h('a.p-btn', { href: window.SharedConnection.modeURL(C.TRANSPORT === 'mock' ? 'lan' : 'mock'), 'data-testid': 'switch-transport' }, C.TRANSPORT === 'mock' ? '打开家里共享（不搬存档）' : '切回本机存档（不搬数据）')),
    C.TRANSPORT === 'mock' ? h('div.p-set-row', {}, h('span', {}, '演示数据'), h('button.p-btn', {
      type: 'button',
      'data-testid': 'reset-demo',
      onclick: () => {
        if (!window.confirm('恢复成最初的演示数据？当前本机进度会清掉。')) return;
        if (window.MockControl && window.MockControl.resetPersisted) window.MockControl.resetPersisted();
        location.reload();
      }
    }, '恢复演示数据')) : null
  )];
}

/* Confirmed paper mistakes for Jared; photos stay in the existing local photo store. */
function mistakesTab() {
  const box = h('section.p-card', { 'data-testid': 'mistake-book' }, h('h2', {}, 'Jared · 错题本'));
  const list = h('div', { role: 'status' }, '正在读取…'); box.append(list);
  async function load() {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/lan/family/parent/mistakes?child=child_a', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw Error('错题本暂时没读到，请重试。');
      const data = await response.json();
      if (data.dataset !== 'lan' || data.child_id !== 'child_a' || !Array.isArray(data.tasks)) throw Error('错题本返回不完整，请重试。');
      const tasks = data.tasks.filter(t => t.child_id === 'child_a' && t.task_kind === 'paper' && t.status === 'done' && t.mistake_review);
      if (!box.isConnected) return;
      list.replaceChildren(...(tasks.length ? tasks.map(t => h('button.p-row', { type: 'button', 'data-testid': 'mistake-entry', onclick: () => mistakeDetail(t) },
        h('span.p-row-main', {}, h('strong', {}, t.title), h('span.p-muted', {}, t.day + ' · 待复习'), t.mistake_review.note ? h('span.p-mistake-note', {}, t.mistake_review.note) : null), icon('chevron')))
        : [h('p.p-empty', {}, '还没有记入错题本的作业。确认哥哥纸笔作业时，可勾选“有错题／记入错题本”。')]));
    } catch (e) {
      if (box.isConnected) list.replaceChildren(h('p.p-warn', {}, e.name === 'AbortError' ? '读取超时，请重试。' : e.message), h('button.p-btn', { onclick: load }, '重试'));
    } finally { clearTimeout(timer); }
  }
  load(); return [box];
}
function mistakeDetail(t) {
  const photos = h('div.p-mistake-photos', { 'data-testid': 'mistake-photos' }, '正在读取照片…');
  let d;
  d = dialog({ title: t.title, cls: 'p-drawer', body: h('div', {},
    h('p', {}, t.day + ' · Jared · 待复习'),
    h('p.p-mistake-note', {}, '错因：' + (t.mistake_review.note || '未填写')), photos),
    actions: [h('button.p-btn', { onclick: () => d.close() }, '关闭')] });
  async function load() {
    try {
      const r = await PhotoAdapter.list('parent', { day: t.day, child_id: 'child_a' }, t.id);
      if (!photos.isConnected) return;
      if (!r.ok || !r.data || !Array.isArray(r.data.photos)) throw Error('照片暂时没读到');
      photos.replaceChildren(...(r.data.photos.length ? r.data.photos.map((p,i) => h('img', { src: p.url, alt: t.title + ' 作业照 ' + (i+1), loading: 'lazy', style: { cursor: 'zoom-in' }, onclick: () => window.Media && window.Media.openMaterial(p.url, t.title + ' · 作业照 ' + (i+1), { audience: 'parent', backLabel: '返回' }) })) : [h('p', {}, '暂无可读取的作业照')]));
    } catch (_) {
      if (photos.isConnected) photos.replaceChildren(h('p.p-warn', {}, '照片暂时没读到，请重试。'), h('button.p-btn', { onclick: load }, '重试'));
    }
  }
  load();
}

/* ================= 外框 ================= */
function openParentTab(next) {
  tab = next;
  if (next === 'photos') { album = { key: null }; ++albumRequest; }
  render(); window.scrollTo(0, 0);
  if (next === 'photos' || next === 'today') refreshPhotos();
}
function moreTab() {
  const entries = [['photos', '照片', 'image'], ['mistakes', '错题本', 'book'], ['create', '新增任务', 'plus'], ['pledge', '每日约定', 'check'], ['progress', '闯关详情', 'star'], ['settings', '设置', 'gear']];
  return [h('section.p-card.p-menu', { 'data-testid': 'parent-more' }, h('h2.p-child-name', {}, '更多'), ...entries.map(([key, label, ic]) =>
    h('button.p-row', { type: 'button', 'data-testid': 'more-entry-' + key, onclick: () => openParentTab(key) }, h('span.p-kind', { 'aria-hidden': 'true' }, icon(ic)), h('span.p-row-main', {}, label), h('span.p-row-go', {}, icon('chevron')))))];
}
function parentPage() {
  if (tab === 'today') return todayTab();
  if (tab === 'more' && C.TRANSPORT === 'lan') return moreTab();
  let page;
  switch (tab) {
    case 'photos': page = photosTab(); break;
    case 'mistakes': page = mistakesTab(); break;
    case 'create': page = [h('section.p-card.p-manage', {}, h('h2.p-child-name', {}, '新增任务'), createForm())]; break;
    case 'pledge': page = [Pledge.parentCard(today())]; break;
    case 'progress': page = (who === 'all' ? KIDS : [who]).map(c => Progress.card(c, today(), true)); break;
    case 'manage': page = manageTab(); break;
    default: page = settingsTab();
  }
  return C.TRANSPORT === 'lan' ? [h('div.p-more-back', {}, h('button.p-btn', { type: 'button', 'data-testid': 'back-more', onclick: () => openParentTab('more') }, icon('back'), '返回更多')), ...page] : page;
}
function render() {
  if (!root || !location.hash.startsWith('#/parent')) return;
  const separateToday = C.TRANSPORT === 'lan' && tab === 'today';
  if (separateToday && !KIDS.includes(who)) who = KIDS[0];
  const y = window.scrollY;
  const tabs = C.TRANSPORT === 'lan' ? [['today', '今天', 'home'], ['more', '更多', 'more']] : [['today', '今天', 'home'], ...(C.TRANSPORT === 'mock' ? [['photos', '照片', 'image']] : []), ['manage', '管理', 'pencil'], ['settings', '设置', 'gear']];
  const activeTab = C.TRANSPORT === 'lan' && tab !== 'today' ? 'more' : tab;
  const kidOptions = [...(separateToday ? [] : [['all', '全部']]), ...KIDS.map(c => [c, NAME(c)])];
  const kidsSel = tab === 'today' || tab === 'photos' || (C.TRANSPORT === 'lan' && tab === 'progress') ? h('div.p-who', { class: separateToday ? 'p-kid-pages' : null, role: 'tablist', 'aria-label': '孩子' },
    ...kidOptions.map(([v, l]) => h('button.p-who-opt', { type: 'button', role: 'tab', id: 'parent-kid-' + v, 'data-testid': 'parent-kid-' + v, 'aria-controls': separateToday ? 'parent-tasks-' + v : null, 'aria-selected': String(who === v), onclick: () => { who = v; render(); } },
      v === 'all' ? null : h('span.p-avatar.sm.' + v, { 'aria-hidden': 'true' }, l.slice(0, 1)), l))) : null;
  const body = parentPage();
  root.replaceChildren(h('div.p-shell', { 'data-audience': 'parent', 'data-screen': 'parent-' + tab, id: 'main' },
    h('header.p-top', {}, h('div.p-top-l', {}, h('span.p-badge', {}, '家长'), h('label.p-date', {}, tab === 'photos' ? '照片日期 ' : '任务日期 ', h('input', { type: 'date', 'aria-label': tab === 'photos' ? '照片日期' : '任务日期', 'data-testid': 'parent-day', value: today(), onchange: e => chooseDay(e.target.value) }))),
      h('button.p-btn.ghost', { type: 'button', 'data-testid': 'parent-exit', onclick: () => { window.Gate.revoke(); App.go('#/'); } }, icon('door'), '退出')),
    kidsSel, h('main.p-main', { class: separateToday ? 'p-one-child' : null }, ...body),
    h('nav.p-tabs', { 'aria-label': '家长区' }, ...tabs.map(([k, l, ic]) => h('button.p-tab', { type: 'button', 'aria-current': activeTab === k ? 'page' : null, 'data-testid': 'tab-' + k, onclick: () => openParentTab(k) }, icon(ic), h('span', {}, l))))));
  const dev = root.querySelector('select[name=device]'); if (dev) dev.onchange = e => Prefs.set('deviceChild', e.target.value);
  const restore = () => window.scrollTo(0, y);
  restore();
  requestAnimationFrame(() => { restore(); requestAnimationFrame(restore); });
}
window.Parent = {
  route(r) {
    root = r;
    if (C.TRANSPORT === 'lan') tab = 'today';
    if (!S._parentSub) S._parentSub = S.on(() => { if (location.hash.startsWith('#/parent') && ['today', 'photos'].includes(tab) && !document.querySelector('.dlg')) render(); });
    render(); loadAll();
  },
  setTab(t) { tab = t; render(); }
};
})();
