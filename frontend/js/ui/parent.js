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
const weekOpen = {};
const planningOpen = {};
const requiresPhoto = t => window.TaskPlanning.needsPhoto(t);
const chip = s => h('span.p-chip.' + (TONE[s] || ''), {}, ST[s] || s);
const needsKind = t => t.task_kind === 'legacy' || !t.task_kind || t.assignment_state !== 'verified';
const paperish = window.TaskPlanning.paper;
const hasPhotos = t => !!(photoInfo[t.id] && photoInfo[t.id].photos && photoInfo[t.id].photos.length);
const needsPlanning = t => window.TaskPlanning.needsPlanning(t, today());
const needsResponse = t => ['help', 'pending_parent'].includes(t.status);
function childTasks(c, st = S.get('parent', c)) {
  const tasks = new Map();
  for (const t of [...(st.tasks || []), ...(st.week || [])]) {
    if (t.child_id === c && !tasks.has(t.id)) tasks.set(t.id, t);
  }
  return [...tasks.values()];
}
function todayTasks(c, st = S.get('parent', c)) {
  const day = st.day || today();
  const dailyIds = new Set((st.tasks || []).map(t => t.id));
  return childTasks(c, st).filter(t => t.status !== 'archived' &&
    // Match the server's review queue: a known later submission is not part
    // of an earlier date's actions, even when the week overview includes it.
    (t.status !== 'pending_parent' || !t.submitted_day || t.submitted_day <= day) &&
    (needsResponse(t) || (dailyIds.has(t.id) && !needsPlanning(t))));
}

async function loadAll() {
  await Promise.all(KIDS.map(c => S.load('parent', c)));
  if (C.TRANSPORT === 'mock') for (const c of KIDS) { try { content[c] = await S.records('content', today(), c); } catch (e) { content[c] = null; } }
  await refreshPhotos();
}
async function refreshPhotos() {
  if (!['mock', 'lan'].includes(C.TRANSPORT)) return;
  const token = ++photoRequest, day = today(), next = {};
  const tasks = KIDS.flatMap(c => childTasks(c).filter(t => paperish(t) && t.status !== 'archived'));
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
    const live = todayTasks(c, st), count = status => live.filter(t => t.status === status).length;
    return h('div.p-summary-row', {}, h('strong', {}, NAME(c)), h('span', {}, '完成 ' + count('done')),
      h('button.p-summary-wait', { type: 'button', 'data-testid': 'summary-wait-' + c, 'aria-pressed': String(statusFilters[c] === 'pending_parent'), onclick: () => toggleStatusFilter(c, 'pending_parent') }, '待确认 ' + count('pending_parent')),
      h('span', {}, '求助 ' + count('help')));
  })));
  const retry = Object.values(S.pending).filter(op => op.state === 'unknown');
  if (retry.length) out.push(h('div.p-alert', { 'data-testid': 'parent-retry-bar' }, h('span', {}, `未确认保存 ${retry.length}`),
    h('button.p-btn', { type: 'button', 'data-testid': 'parent-retry', onclick: async () => { for (const op of retry) { const r = await S.retry(op.key); report(r, '重试'); } } }, icon('refresh'), '重试')));
  for (const c of kids) {
    out.push(childBlock(c));
    if (C.TRANSPORT === 'lan') out.push(weekOverview(c));
  }
  return out;
}
function toggleStatusFilter(c, status) {
  statusFilters[c] = statusFilters[c] === status ? null : status;
  childTasks(c).forEach(t => picked.delete(t.id));
  render();
}
function childBlock(c) {
  const st = S.get('parent', c);
  const head = h('div.p-child-head', {}, h('span.p-avatar.' + c, { 'aria-hidden': 'true' }, NAME(c).slice(0, 1)), h('h2.p-child-name', {}, NAME(c)));
  if (st.status === 'error') return h('section.p-card', { 'data-testid': 'parent-error-' + c }, head,
    h('div.p-alert', {}, h('span', {}, '读取失败'), h('button.p-btn', { type: 'button', onclick: () => S.load('parent', c).then(render) }, icon('refresh'), '重试')));
  if (st.status !== 'ok') return h('section.p-card', {}, head, h('div.spinner.sm', { role: 'status', 'aria-label': '加载中' }));
  const live = todayTasks(c, st);
  const toPlan = childTasks(c, st).filter(needsPlanning);
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
  const responses = [];
  const help = shown.filter(t => t.status === 'help');
  if (help.length) responses.push(h('section.p-group.help', { 'aria-label': '求助', 'data-testid': 'help-tasks-' + c },
    h('div.p-group-head', {}, chip('help'), h('span.p-count', {}, String(help.length))),
    h('ul.p-rows', {}, ...help.map(t => h('li.p-row-li', {}, row(t))))));
  /* 待确认：勾选 + 全选 + 确认完成（Khan Kids Assign） */
  const waiting = shown.filter(t => t.status === 'pending_parent');
  if (waiting.length) {
    const all = waiting.every(t => picked.has(t.id));
    responses.push(h('section.p-group.wait', { 'aria-label': '待确认', 'data-testid': 'pending-tasks-' + c },
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
  if (responses.length) blocks.push(h('section', { 'aria-label': '需要我处理', 'data-testid': 'response-tasks-' + c },
    h('h3.p-sub-h', {}, '需要我处理'), ...responses));
  if (toPlan.length && !filter) blocks.push(h('details.p-group', { 'data-testid': 'replan-tasks-' + c, open: !!planningOpen[c], ontoggle: e => { if (e.target.isConnected) planningOpen[c] = e.target.open; } },
    h('summary.p-group-head', {}, '待重新安排', h('span.p-count', {}, String(toPlan.length))),
    h('p.p-muted', {}, '这些周作业还没安排，或原计划已过；不计入今天要做的份额。求助仍在上方处理。'),
    h('ul.p-rows', {}, ...toPlan.map(t => h('li.p-row-li', {}, row(t))))));
  /* 求助与待确认保持展开；其余当天任务归入一个默认收起的分组。 */
  const others = [];
  for (const s of GROUPS.filter(s => !['help', 'pending_parent'].includes(s))) {
    const rows = shown.filter(t => t.status === s);
    if (!rows.length) continue;
    others.push(h('section.p-group', { 'aria-label': ST[s] }, h('div.p-group-head', {}, chip(s), h('span.p-count', {}, String(rows.length))), h('ul.p-rows', {}, ...rows.map(t => h('li.p-row-li', {}, row(t))))));
  }
  const arch = (st.tasks || []).filter(t => t.child_id === c && t.status === 'archived');
  if (C.TRANSPORT === 'lan') {
    if (arch.length && !filter) others.push(h('section.p-group', { 'aria-label': ST.archived }, h('div.p-group-head', {}, chip('archived'), h('span.p-count', {}, String(arch.length))), h('ul.p-rows', {}, ...arch.map(t => h('li.p-row-li', {}, row(t))))));
    if (filter) blocks.push(...others);
    else if (others.length) blocks.push(h('details.p-group.p-other-tasks', { 'data-testid': 'other-tasks-' + c, open: !!otherTasksOpen[c], ontoggle: e => { if (e.target.isConnected) otherTasksOpen[c] = e.target.open; } },
      h('summary.p-group-head', {}, '其他任务', h('span.p-count', {}, String(live.filter(t => !needsResponse(t)).length + arch.length))), ...others));
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
  if (needsPlanning(t)) flags.push(h('span.p-flag', { 'data-testid': 'needs-planning' }, '待重新安排' + (t.planned_day ? ' · 原计划 ' + t.planned_day : ' · 未排日期')));
  const note = t.status === 'help' && t.help_note ? t.help_note.trim().replace(/\s+/g, ' ') : '';
  return h('button.p-row', { type: 'button', 'data-testid': 'p-row', 'data-task-id': t.id, onclick: () => detail(t) },
    h('span.p-kind', { 'aria-hidden': 'true' }, icon(kindOf(t).icon)), h('span.p-row-main', {}, h('span.p-row-title', {}, t.title),
      note ? h('span.p-row-flags', { 'data-testid': 'help-snippet' }, '孩子说：' + (note.length > 72 ? note.slice(0, 72) + '…' : note)) : null,
      flags.length ? h('span.p-row-flags', {}, ...flags) : null),
    h('span.p-row-go', { 'aria-hidden': 'true' }, icon('chevron')));
}

function weekOverview(child) {
  const st = S.get('parent', child), items = (st.week || []).filter(t => t.child_id === child);
  if (st.status !== 'ok' || !items.length) return null;
  const groups = (st.groups || []).map(g => ({ ...g, portions: items.filter(t => t.assignment_id === g.id) })).filter(g => g.portions.length);
  const legacy = items.filter(t => !t.assignment_id);
  if (legacy.length) groups.push({ id: 'legacy', title: '已有周作业', portions: legacy });
  return h('details.p-card.p-week-overview', { 'data-testid': 'parent-week-overview', open: !!weekOpen[child], ontoggle: e => { if (e.target.isConnected) weekOpen[child] = e.target.open; } },
    h('summary', {}, '周作业与安排 · ' + NAME(child)), window.TaskPlanning.weekSummary(items, st.day),
    h('p.p-muted', {}, '每份只计算一次。未安排的内容也保留在这里；已提交的份继续等检查。'),
    ...groups.map(g => h('section.p-week-assignment', { 'data-assignment-id': g.id },
      h('h3', {}, g.title),
      g.total != null ? h('p', {}, '总量 ' + g.total + ' · 已确认/完成 ' + g.done + ' · 待检查 ' + g.pending + ' · 剩余 ' + g.remaining) : null,
      g.due_day ? h('p', {}, '老师截止：' + g.due_day) : null,
      g.deadline_conflict ? h('p.p-warn', {}, '各份截止日期不同，请查看每份的老师要求。') : null,
      ...g.portions.map(t => h('div.p-week-portion', {},
        row(t), h('p.p-muted', {}, '计划：' + (t.planned_day || '待安排') + ' · ' + (ST[t.status] || t.status)),
        t.progress_note ? h('p.planning-progress', {}, '已做到：' + t.progress_note) : null,
        t.planning_warning ? h('p.p-warn', {}, t.planning_warning === 'planned_after_due' ? '安排已晚于老师截止日，需要协调。' : '有截止日，尚待安排。') : null)),
      g.portions.some(t => !['done', 'pending_parent', 'archived'].includes(t.status)) ? h('button.p-btn', { type: 'button', 'data-testid': 'schedule-portions', onclick: () => schedulePortions(g) }, '调整剩余部分的日期') : null)));
}

function schedulePortions(group) {
  const message = h('p.p-form-msg', { role: 'status' });
  const child = group.portions[0]?.child_id;
  const st = child ? S.get('parent', child) : null;
  const loadedDay = st?.status === 'ok' ? st.day || null : null;
  const loaded = loadedDay ? todayTasks(child, st) : [];
  const schoolCount = loaded.filter(t => t.work_type === 'school').length;
  const itinerary = loaded.filter(t => t.work_type === 'itinerary' || t.itinerary || t.id?.startsWith('itinerary-') || t.home_group === 'itinerary');
  const realToday = typeof C.today === 'function' ? C.today() : C.DEMO_DAY;
  const loadLabel = loadedDay === realToday ? '今天' : loadedDay;
  const loadNotice = loadedDay
    ? '已加载的' + loadLabel + '：学校任务 ' + schoolCount + ' 项；已知行程：' + (itinerary.length ? itinerary.map(t => t.title).join('、') : '当前数据未提供') + '。'
    : '尚未加载当天任务与行程，请先核对当天负担。';
  const rows = group.portions.map(t => {
    const locked = ['done', 'pending_parent', 'archived'].includes(t.status);
    const date = inp({ type: 'date', value: t.planned_day || '', disabled: locked, 'aria-label': (t.portion_label || t.title) + '计划日期' });
    const notice = h('p.p-muted', {}, locked ? '已提交或完成，保留原安排' : '');
    const deadline = window.TaskPlanning.deadlineInfo(t);
    const warn = () => {
      if (locked) return;
      const notes = [];
      if (!date.value) notes.push('留空：待安排。');
      else if (date.value !== loadedDay) notes.push('未核对当天负担（' + date.value + '）。');
      if (deadline.date && date.value > deadline.date) notes.push('晚于老师截止 ' + deadline.label + '，需要协调。');
      if (deadline.conflict) notes.push('截止日期记录不一致，请核对老师原要求。');
      notice.textContent = notes.join(' ');
    };
    date.addEventListener('change', warn); warn();
    return { task: t, date, notice, locked, saved: false, el: h('section.p-schedule-row', {},
      h('strong', {}, t.portion_label || t.title), chip(t.status),
      t.progress_note ? h('p', {}, '已做到：' + t.progress_note) : null,
      deadline.label ? h('p.p-muted', {}, '老师截止：' + deadline.label) : null,
      field('计划日期', date), notice) };
  });
  let d, busy = false;
  const save = h('button.p-btn.primary', { type: 'button', 'data-testid': 'schedule-save', onclick: async () => {
    if (busy) return;
    busy = true; save.disabled = true; rows.forEach(r => { r.date.disabled = true; });
    let count = 0;
    for (const row of rows.filter(r => !r.locked && !r.saved && (r.date.value || null) !== r.task.planned_day)) {
      const pending = S.pendingFor('task:' + row.task.id);
      const matchesPlan = pending?.kind === 'update' && pending.body.planned_day === (row.date.value || null);
      const result = pending
        ? matchesPlan && pending.state === 'unknown' ? await S.retry(pending.key) : { result: 'rejected', code: 'unresolved_operation' }
        : await S.update(row.task, { planned_day: row.date.value || null });
      if (result.result !== 'saved') {
        row.notice.textContent = result.result === 'unknown' ? '还未确认保存，重试将沿用同一次调整。' : '状态已变化，本次没有覆盖。请关闭后重新打开。';
        rows.forEach(r => { r.date.disabled = r.locked || r.saved || r === row; });
        message.textContent = '已保存的安排会保留。' + (result.result === 'unknown' ? '请点“再确认一次”继续。' : '请先核对最新状态，再调整其余部分。');
        save.textContent = '再确认一次'; save.disabled = result.result !== 'unknown'; busy = false; return;
      }
      row.saved = true; row.notice.textContent = '已保存'; count++;
    }
    d.close(); toast(count ? '剩余部分的安排已保存' : '安排已核对'); render();
  } }, '保存安排');
  d = dialog({ title: '调整安排 · ' + group.title, cls: 'p-drawer', body: h('div.p-form', {},
    h('p', {}, '先看学校作业和课程；留出休息和睡前准备。'),
    h('p.p-muted', { 'data-testid': 'schedule-loaded-load' }, loadNotice),
    h('p', {}, '根据当天课业负担选日期。留空表示待安排；总量、已做进度和老师截止日都会保留。'),
    ...rows.map(r => r.el), message), actions: [h('button.p-btn', { type: 'button', onclick: () => d.close() }, '返回'), save] });
}

/* ================= 任务详情 ================= */
function detail(t0) {
  const t = S.find('parent', t0.child_id, t0.id) || t0, sp = t.support;
  const kv = (k, v) => v ? h('div.p-kv', {}, h('dt', {}, k), h('dd', {}, v)) : null;
  const rows = [h('p.p-detail-meta', {}, NAME(t.child_id), ' · ', (KIND[t.task_kind] || KIND.legacy).parent, ' · ', chip(t.status))];
  if (t.original_requirement) rows.push(h('section.p-teacher-requirement', { 'data-testid': 'original-requirement' }, h('h3', {}, '老师原要求'), h('p', {}, t.original_requirement)));
  rows.push(...window.TaskPlanning.details(t, true));
  if (t.help_note) rows.push(h('p', { 'data-testid': 'help-note', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: '12px', background: '#fff6db', borderRadius: '12px' } }, '孩子说：' + t.help_note));
  rows.push(h('dl.p-dl', {}, kv('第一步', t.first_step), kv('备注', t.parent_note), t.adult_required ? kv('陪同', '需要') : null));
  const mediaStops = [], stopMaterials = () => mediaStops.forEach(stop => stop());
  const attached = window.TaskPlanning.materials(t, { parent: true, beforeOpen: stopMaterials });
  mediaStops.push(attached.stop);
  rows.push(...attached.nodes);
  const legacy = attached.legacy;
  const legacyAudio = legacy.audio_url ? h('audio', { controls: true, preload: 'none', src: legacy.audio_url, 'aria-label': '音频' }) : null;
  if (legacyAudio) mediaStops.push(() => legacyAudio.pause());
  if (legacy.material_url || legacyAudio) rows.push(h('div.p-media', {},
    legacy.material_url ? h('button.p-btn', { type: 'button', onclick: () => { stopMaterials(); window.Media.openMaterial(legacy.material_url, t.title, { audience: 'parent', backLabel: '返回' }); } }, icon('book'), '材料') : null,
    legacyAudio));
  if (sp) rows.push(h('details.p-sub', {}, h('summary', {}, '成人支持'),
    h('dl.p-dl', {}, kv('示范', sp.adult_demo), kv('可接受', sp.acceptable_response), kv('简化', sp.simplify), kv('停止', sp.stop_rule), kv('给孩子', sp.child_demo), kv('来源', sp.source))));
  if (['mock', 'lan'].includes(C.TRANSPORT) && paperish(t)) rows.push(photoPost(t, { compact: true, onChanged: () => { d.close(); detail(S.find('parent', t.child_id, t.id) || t); } }));
  const canConfirm = !(requiresPhoto(t) && t.status === 'pending_parent' && !hasPhotos(t));
  const primary = t.status === 'pending_parent' ? (canConfirm ? ['done', '确认完成'] : null) : t.status === 'help' ? ['todo', '已回应，继续做'] : t.status === 'archived' ? ['todo', '恢复'] : needsKind(t) ? ['assign', '核对类型'] : null;
  if (t.status === 'help') rows.push(h('p.p-muted', { 'data-testid': 'help-response-note' }, '回应不等于已调整；日期以保存安排为准。'));
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
  if (!window.TaskPlanning.isWeekly(t) && t.status !== 'archived') more.push(['archived', '归档', true]);
  if (!window.TaskPlanning.isWeekly(t) && ['mock', 'lan'].includes(C.TRANSPORT)) more.push(['delete', '删除', true]);
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
  d = dialog({ title: t.title, body: h('div.p-detail', {}, ...rows), cls: 'p-drawer', onClose: stopMaterials, actions: [h('button.p-btn', { type: 'button', onclick: () => d.close() }, '关闭')] });
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
    form.querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = value || el.dataset.fixedDisabled === 'true'; });
    button.disabled = value;
    form.setAttribute('aria-busy', String(busy));
  };
  const rejectedMessage = r => {
    if (r.code === 'unresolved_operation') return '上一次操作还没有确认保存，请返回今天，先重试那一次操作。';
    if (r.code === 'task_replan_locked') return '这份已经提交或完成，请保留原安排；只调整还没做完的部分。';
    if (r.code === 'weekly_portion_required') return '这一份属于老师要求的总量，请保留内容，只调整安排。';
    if (r.code === 'reward_amount_locked') return '这一份已经发过经验，撤销后也保留原金额。请重新打开任务核对；其他内容仍可修改。';
    if (r.code === 'weekly_conversion_required') return '请保留已有任务类型；新建周作业时再划分固定的小份。';
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

function materialEditor(initial = []) {
  const list = h('div.p-material-editor');
  const rows = [];
  function add(m = {}) {
    const kind = sel('', Object.entries(window.TaskPlanning.materialKindLabels), m.kind || 'exercise');
    kind.setAttribute('aria-label', '材料用途');
    const title = inp({ value: m.title || '', maxlength: 100, placeholder: '材料名称', 'aria-label': '材料名称' });
    const url = inp({ value: m.url || '', maxlength: 2000, placeholder: 'assets/… 或 https://…', 'aria-label': '材料链接' });
    const from = inp({ type: 'number', min: 1, value: m.page_from || '', placeholder: '起始页', 'aria-label': 'PDF起始页' });
    const to = inp({ type: 'number', min: 1, value: m.page_to || '', placeholder: '结束页', 'aria-label': 'PDF结束页' });
    const row = { kind, title, url, from, to };
    row.el = h('div.p-material-row', {}, kind, title, url, h('div.p-page-range', {}, from, to),
      h('button.p-btn', { type: 'button', onclick: () => { rows.splice(rows.indexOf(row), 1); row.el.remove(); } }, '移除'));
    rows.push(row); list.append(row.el);
  }
  initial.forEach(add);
  const el = h('details.p-sub', { open: initial.length > 0 }, h('summary', {}, '对应材料 · 分清用途'),
    h('p.p-muted', {}, '按使用顺序添加；PDF可填写页码。答案会单独收起。'), list,
    h('button.p-btn', { type: 'button', onclick: () => add() }, icon('plus'), '添加材料'));
  return { el, read: () => rows.filter(r => r.url.value.trim()).map(r => ({
    kind: r.kind.value, title: r.title.value.trim() || r.kind.selectedOptions[0].textContent,
    url: r.url.value.trim(), ...(r.from.value ? { page_from: Number(r.from.value) } : {}),
    ...(r.to.value ? { page_to: Number(r.to.value) } : {})
  })) };
}
function planningControls(t = {}, { creating = false } = {}) {
  const material = materialEditor(t.materials || []);
  const kinds = [['school', '学校作业'], ['weekly', '周作业 / 一段时间完成的总量']];
  if (!creating) kinds.push(['habit', '已有习惯打卡'], ['itinerary', '已有行程']);
  const kind = sel('work_type', kinds, t.work_type || (t.plan ? 'weekly' : 'school'));
  if (!creating) { kind.disabled = true; kind.dataset.fixedDisabled = 'true'; }
  const plan = inp({ name: 'planned_day', type: 'date', value: t.planned_day === null ? '' : t.planned_day || t.day || today(), readonly: !creating && ['done', 'pending_parent'].includes(t.status) });
  const deadline = window.TaskPlanning.deadlineInfo(t);
  const due = inp({ name: 'due_day', type: 'date', value: deadline.date || '', readonly: deadline.exact });
  const photo = h('input', { type: 'checkbox', name: 'photo_required', checked: typeof t.photo_required === 'boolean' ? t.photo_required : creating ? false : requiresPhoto(t) });
  const xp = inp({ name: 'exp_award', type: 'number', min: 0, max: 50, value: Number.isInteger(t.exp_award) ? t.exp_award : 3, readonly: !!t.exp_award_locked });
  const requirement = h('textarea.p-input', { name: 'original_requirement', rows: 3, maxlength: 8000, placeholder: '保留老师原话；课堂要求与家庭要求分清' }, t.original_requirement || '');
  const planField = field('计划做的日期', plan);
  const dueField = field('老师真实截止日（没给就留空）', due);
  if (deadline.exact) dueField.append(h('p.p-muted', { 'data-testid': 'exact-deadline-locked' }, '原要求截止：' + deadline.label + '。这里只调整计划日期，真实截止时刻保持不变。'));
  if (deadline.conflict) dueField.append(h('p.p-warn', { 'data-testid': 'deadline-conflict' }, '当前截止日期与老师原时刻不一致，请核对原要求。保存后按原时刻的日期保留。'));
  const xpField = field('这一份的经验', xp);
  if (t.exp_award_locked) xpField.append(h('p.p-muted', { 'data-testid': 'reward-amount-locked' }, '这一份已发过经验，撤销后仍保留原金额；再次完成不会多领一份。'));
  const photoField = h('label.p-switch', {}, photo, h('span', {}, '这项纸笔作业需要拍照（哥哥）'));
  const el = h('section.p-planning-fields', {}, field('安排类型', kind), planField,
    dueField, field('老师原要求', requirement),
    photoField, xpField, material.el);
  const read = () => ({
    work_type: kind.value, planned_day: plan.value || null, due_day: deadline.exact ? deadline.date : due.value || null,
    original_requirement: requirement.value, photo_required: photo.checked,
    exp_award: Number(xp.value), materials: material.read()
  });
  function sync(child, taskKind, weeklyCreate = false) {
    const showPhoto = child === 'child_a' && ['paper', 'legacy'].includes(taskKind);
    photoField.hidden = !showPhoto;
    if (!showPhoto) photo.checked = false;
    planField.hidden = weeklyCreate; material.el.hidden = weeklyCreate; xpField.hidden = weeklyCreate;
    plan.required = kind.value !== 'weekly';
  }
  return { el, read, kind, plan, due, xp, photo, requirement, sync };
}
function portionEditor() {
  const amount = inp({ type: 'number', min: 1, max: 50, step: 1, value: 3, 'aria-label': '总份数' });
  const unit = sel('', [['份', '份'], ['关', '关'], ['天', '天'], ['篇', '篇']], '份');
  unit.setAttribute('aria-label', '份的单位');
  const list = h('div.p-portion-editor'), total = h('p.p-muted');
  const rows = [];
  const refreshTotal = () => { total.textContent = '共 ' + rows.length + ' 份，全部完成共 ' + rows.reduce((n, r) => n + (Number(r.xp.value) || 0), 0) + ' 经验。日期由你结合当天负担安排。'; };
  function resize(defaultXp = 3) {
    const n = Math.max(1, Math.min(50, Math.floor(Number(amount.value) || 1)));
    amount.value = n;
    while (rows.length > n) rows.pop().el.remove();
    while (rows.length < n) {
      const label = inp({ value: '第' + (rows.length + 1) + unit.value, maxlength: 50, required: true, 'aria-label': '这一份的内容' });
      const date = inp({ type: 'date', 'aria-label': '这一份计划日期' });
      const xp = inp({ type: 'number', min: 0, max: 50, value: defaultXp, 'aria-label': '这一份经验', oninput: refreshTotal });
      const row = { label, date, xp };
      row.el = h('div.p-portion-row', {}, field('内容', label), field('计划日期', date), field('经验', xp));
      rows.push(row); list.append(row.el);
    }
    refreshTotal();
  }
  const el = h('section.p-week-create', { hidden: true }, h('h3', {}, '分成固定的小份'),
    h('div.p-page-range', {}, field('总量', amount), field('单位', unit),
      h('button.p-btn', { type: 'button', onclick: () => resize() }, '设置份数')),
    h('p.p-muted', {}, '一份可以是一关、一篇或一次练习。未排日期的内容保留在周作业里；每份材料可在保存后分别添加。'),
    list, total);
  resize();
  amount.addEventListener('change', () => resize());
  unit.addEventListener('change', () => rows.forEach((r, i) => { if (/^第\d+[份关天篇]$/.test(r.label.value)) r.label.value = '第' + (i + 1) + unit.value; }));
  return { el, read: () => rows.map(r => ({ label: r.label.value.trim(), planned_day: r.date.value || null, exp_award: Number(r.xp.value), materials: [] })),
    reset: () => { rows.splice(0); list.replaceChildren(); amount.value = 3; unit.value = '份'; resize(); },
    restore: portions => { rows.splice(0); list.replaceChildren(); amount.value = portions.length; resize(); portions.forEach((p, i) => { rows[i].label.value = p.label; rows[i].date.value = p.planned_day || ''; rows[i].xp.value = p.exp_award; }); refreshTotal(); } };
}

function editDialog(t0) {
  const t = S.find('parent', t0.child_id, t0.id) || t0;
  const pending = S.pendingFor('task:' + t.id);
  const planning = C.TRANSPORT === 'lan' ? planningControls(pending?.kind === 'update' ? { ...t, ...pending.body } : t) : null;
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
    planning?.el,
    h('p.p-form-msg', { role: 'status', 'aria-live': 'polite' }));
  if (planning) { const sync = () => planning.sync(t.child_id, f.elements.kind.value); f.addEventListener('change', sync); sync(); }
  if (pending?.kind === 'update') {
    for (const key of ['title', 'first_step', 'parent_note', 'material_url', 'audio_url']) f.elements[key].value = pending.body[key] || '';
    f.querySelectorAll('[name=kind]').forEach(el => { el.checked = el.value === pending.body.task_kind; });
  }
  let save;
  const button = h('button.p-btn.primary', { type: 'button', 'data-testid': 'edit-submit', onclick: () => save() }, '保存');
  const d = dialog({ title: '修改任务', body: f, cls: 'p-drawer', actions: [
    h('button.p-btn', { type: 'button', onclick: () => d.close() }, '取消'), button
  ] });
  save = taskFormSave(f, button, v => S.update(t, { ...taskFields(v), ...(planning ? planning.read() : {}) }), () => {
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
        if (await setSent(t, v, p.photos)) { paint(photoInfo[t.id]); render(); toast(v ? '已标记' : '已取消标记', { undo: v ? async () => { await setSent(t, false, p.photos); render(); } : null }); }
      } }, icon('send'), p.teacher_sent ? '取消已发' : '已发老师'));
    }
    box.append(h('footer.p-post-foot', {}, ...foot));
  };
  if (pack || photoInfo[t.id]) paint(pack || photoInfo[t.id]);
  else { box.append(h('div.spinner.sm', { role: 'status', 'aria-label': '加载中' }));
    PhotoAdapter.list('parent', sel, t.id).then(r => { if (r.ok) { photoInfo[t.id] = r.data; paint(r.data); } else box.replaceChildren(h('p.p-warn', {}, '读取失败')); }); }
  return box;
}
async function setSent(t, value, scopePhotos) {
  const sel = { day: t.day, child_id: t.child_id };
  const cur = await PhotoAdapter.list('parent', sel, t.id);
  if (!cur.ok) { toast('读取失败'); return false; }
  const ids = (scopePhotos || cur.data.photos).map(p => p.id);
  const body = { day: t.day, child_id: t.child_id, task_id: t.id, value, expected_revision: cur.data.revision, operation_id: uuid(), ...(C.TRANSPORT === 'lan' ? { photo_ids: ids } : {}) };
  for (let i = 0; i < 2; i++) {          // 结果未知 → 同一 operation_id 重试一次
    const r = await PhotoAdapter.markSent(body);
    if (r.ok) { const b = await PhotoAdapter.list('parent', sel, t.id); if (b.ok && (C.TRANSPORT === 'lan' ? ids.every(id => b.data.photos.some(p => p.id === id && p.teacher_sent === value)) : b.data.teacher_sent === value)) { photoInfo[t.id] = b.data; log.unshift({ at: new Date(), what: `${NAME(t.child_id)} · ${short(t.title)} · ${value ? '已发老师' : '取消已发'}` }); return true; } }
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
  const pending = Object.values(S.pending).find(op => op.kind === 'create');
  const body = pending?.body || {};
  const planning = C.TRANSPORT === 'lan' ? planningControls(body, { creating: true }) : null;
  const portions = planning ? portionEditor() : null;
  const links = h('details.p-sub', {}, h('summary', {}, '链接'),
    field('材料（选填）', inp({ name: 'material_url', placeholder: 'assets/… 或 https://…' })),
    field('音频（选填）', inp({ name: 'audio_url', placeholder: 'assets/… 或 https://…' })));
  const f = h('form.p-form', { 'data-testid': 'create-form' },
    field('孩子', sel('child', KIDS.map(c => [c, NAME(c)]), who === 'all' ? KIDS[0] : who)),
    field('名称', inp({ name: 'title', required: true, maxlength: 100 })),
    field('第一步（选填）', inp({ name: 'first_step', placeholder: '作业已明确可留空' })),
    h('div.p-field', {}, h('span', {}, '完成方式'), h('div.p-seg', { role: 'radiogroup', 'aria-label': '完成方式' }, ...['paper', 'audio', 'reading'].map((k, i) => h('label.p-seg-opt', {}, h('input', { type: 'radio', name: 'kind', value: k, checked: i === 0 }), h('span', {}, KIND[k].parent))))),
    h('label.p-switch', {}, h('input', { type: 'checkbox', name: 'verified', checked: true }), h('span', {}, '已核对（孩子可见）')),
    field('备注（选填）', inp({ name: 'parent_note' })),
    links, planning?.el, portions?.el,
    h('p.p-form-msg', { role: 'status', 'aria-live': 'polite' }),
    h('button.p-btn.primary.wide', { type: 'submit', 'data-testid': 'create-submit' }, '保存'));
  if (pending) {
    for (const key of ['title', 'first_step', 'parent_note', 'material_url', 'audio_url']) f.elements[key].value = body[key] || '';
    f.elements.child.value = body.child_id;
    f.elements.verified.checked = body.assignment_state === 'verified';
    f.querySelectorAll('[name=kind]').forEach(el => { el.checked = el.value === body.task_kind; });
    if (body.portions && portions) portions.restore(body.portions);
  }
  const sync = () => {
    if (!planning) return;
    const weekly = planning.kind.value === 'weekly';
    planning.sync(f.elements.child.value, f.elements.kind.value, weekly);
    portions.el.hidden = !weekly;
    links.hidden = weekly;
    f.elements.title.maxLength = weekly ? 40 : 100;
  };
  f.addEventListener('change', sync); sync();
  const save = taskFormSave(f, f.querySelector('[data-testid=create-submit]'), v => {
    const fields = { ...taskFields(v), child_id: v.child, assignment_state: v.verified ? 'verified' : 'pending', ...(planning ? planning.read() : {}) };
    if (fields.work_type === 'weekly') {
      fields.portions = portions.read();
      fields.material_url = ''; fields.audio_url = ''; fields.materials = [];
    }
    return S.create(fields);
  }, r => {
    const next = createForm(); f.replaceWith(next);
    next.querySelector('.p-form-msg').textContent = r.op.body.portions ? '已保存固定的小份。回到今天的周作业，按份查看或添加对应材料。' : '已保存。可继续新增任务。';
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
