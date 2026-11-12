/* Jared（child_a，会读）——受众：孩子。只有标签，没有说明文字。
   对标：首页 = Brili「Upcoming Routines」列表卡（docs/refs/brili-3.jpg）；
         做任务 = Brili「Finish Your Tasks」单任务卡 + 底部进度点 + 顶部 ✕/⏸（brili-5.jpg）；
         完成 = Brili「You made it happen!」弹窗 + 一个确定按钮（brili-7.jpg）；
         排顺序 = Brili 任务列表的排序柄（brili-6.jpg），改成 ↑↓ 按钮以满足“不只靠拖动”。 */
(function(){
const { h, icon, mascot, kindOf, Prefs, pastBoundary } = window.UI;
const { AudioPlayer, openMaterial, isImageUrl } = window.Media;
const S = window.Store, CH = 'child_a', Planning = window.TaskPlanning;
const CTA = { todo: '开始', doing: '继续', paused: '✕ 未完成', help: '继续', pending_parent: '已提交，等妈妈检查', done: '已完成' };
const readingChoice = t => t.task_kind === 'reading' && t.title === '自己选一本书读一会儿';
const displayTitle = t => (t.carried_over && !Planning.isWeekly(t) ? ((Date.parse(t.day) - Date.parse(t.planned_day)) === 86400000 ? '昨天顺延 · ' : '顺延 · ') : '') + t.title;
const HISTORY_STATUS = { todo: '未完成', doing: '进行中', paused: '✕ 未完成', help: '需要帮助', pending_parent: '已提交，等妈妈检查', done: '已完成' };
const taskTitle = Planning.taskTitle;
// 家长定三类后台键：学校作业／英语作业／高途。卡面：School Work／KET冲鸭／脑王思维。顺延按内容归回三类。
const GROUPS = ['学校作业', '英语作业', '高途'];
// 展示名定稿；内部键不变（home_group / 路由）。
const GROUP_LABEL = { '学校作业': 'School Work', '英语作业': 'KET冲鸭', '高途': '脑王思维' };
// APP阅读打卡 → 英语；自己选一本书不进三张卡。脑王* / home_group=高途 → 高途。
const looksEnglish = t => /英语|KET|乐翼|精听|Big English|朗读|听写|Phonics|PU\s*\d|APP\s*阅读|阅读打卡/i.test((t.title || '') + ' ' + (t.child_label || ''));
const looksGaotu = t => /高途|脑王/.test((t.title || '') + ' ' + (t.child_label || '')) || t.home_group === '高途';
const groupOf = t => {
  if (t.work_type === 'itinerary' || t.itinerary || (t.id && t.id.startsWith('itinerary-'))) return '';
  // 自由阅读：不是 School Work，也不进 KET／脑王；返回空，不新开第四张卡
  if (readingChoice(t) || t.title === '自己选一本书读一会儿') return '';
  const g = t.home_group || '';
  // 明确分类优先：学校英语留在 School Work，不被标题关键字挪走。
  if (GROUPS.includes(g)) return g;
  if (g === '英语作业' || looksEnglish(t)) return '英语作业';
  if (g === '高途' || looksGaotu(t)) return '高途';
  if (g === '学校作业' || g === '阅读' || g === '顺延') {
    if (looksEnglish(t)) return '英语作业';
    if (looksGaotu(t)) return '高途';
    return '学校作业';
  }
  if (g === '不分类' || !g) {
    if (t.itinerary) return '';
    if (looksEnglish(t)) return '英语作业';
    if (looksGaotu(t)) return '高途';
    // 不分类且非行程的普通作业 → 学校作业；真行程靠 itinerary 字段
    if (t.task_kind && t.task_kind !== 'itinerary') return '学校作业';
    return '';
  }
  if (t.task_kind === 'reading') return '学校作业';
  if (GROUPS.includes(g)) return g;
  return '学校作业';
};
const groupRoute = t => groupOf(t) ? '#/jared/group/' + encodeURIComponent(groupOf(t)) : '#/jared';
let selectedGroup = null;
const groupRank = t => groupOf(t) ? GROUPS.indexOf(groupOf(t)) : GROUPS.length;
const ACTIVE = ['todo', 'doing', 'paused', 'help'];
// Jared entrance is child_a only — never mix Joey tasks into this stream.
const ownTasks = tasks => (tasks || []).filter(t => t.child_id === CH);
let stopMedia = () => {};

function ordered(tasks) {
  const key = 'order.' + CH + '.' + (tasks[0] && tasks[0].day), saved = Prefs.get(key, []);
  const pos = id => { const i = saved.indexOf(id); return i < 0 ? 999 : i; };
  return { key, list: tasks.slice().sort((a, b) => groupRank(a) - groupRank(b) || Number(!ACTIVE.includes(a.status)) - Number(!ACTIVE.includes(b.status)) || pos(a.id) - pos(b.id) || tasks.indexOf(a) - tasks.indexOf(b)) };
}
const lock = () => window.Gate.lockButton(() => App.go('#/parent'));
const screen = (name, ...kids) => h('main.c-screen.jared', { 'data-audience': 'child', 'data-screen': name, id: 'main' }, ...kids);
const selectedDay = () => S.sel(CH, 'child').day;
const viewingHistory = () => window.APP_CONFIG.TRANSPORT === 'lan' && selectedDay() < window.APP_CONFIG.today();
function chooseDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > window.APP_CONFIG.today()) return;
  S.jaredDay = day === window.APP_CONFIG.today() ? null : day;
  last = {}; home._ordering = false;
  S.load('child', CH); App.go('#/jared'); render();
}
function dateNav() {
  if (window.APP_CONFIG.TRANSPORT !== 'lan') return null;
  const today = window.APP_CONFIG.today(), selected = selectedDay();
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - i); return d.toISOString().slice(0, 10); });
  return h('section.jared-dates', { 'data-testid': 'jared-dates', 'aria-label': '作业日期' },
    h('nav.date-buttons', {}, ...days.map((day, i) => h('button.c-mini', { type: 'button', 'aria-pressed': String(selected === day), 'data-day': day, onclick: () => chooseDay(day) }, i === 0 ? '今天' : i === 1 ? '昨天' : day.slice(5).replace('-', '/')))),
    h('label', {}, '查看日期 ', h('input', { type: 'date', value: selected, max: today, 'aria-label': '哥哥作业日期', onchange: e => chooseDay(e.target.value) })),
    viewingHistory() ? h('p', { role: 'status' }, selected + ' 的作业 · 回看目前状态') : null);
}
const stopBtn = () => h('button.c-icon-btn.labeled', { type: 'button', 'data-testid': 'stop-today', onclick: () => App.go('#/jared/bye') }, icon('door'), h('span', {}, '今天到这里'));
const homeTop = (extra) => h('header.c-top', {}, h('h1.c-hello', {}, 'Jared'), h('div.c-top-r', {}, extra, stopBtn(), lock()));
const statusMark = t => t.status === 'pending_parent' ? h('span.st-mark.mama', { 'aria-hidden': 'true', html: window.MAMA_SVG })
  : t.status === 'help' ? h('span.st-mark.help', { 'aria-hidden': 'true' }, icon('hand')) : null;

function adjustedNotes(st) {
  if (viewingHistory() || !st.adjusted?.length) return null;
  return h('section.adjusted-notes', { 'aria-label': '今天已调整的安排', 'data-testid': 'adjusted-today' },
    ...st.adjusted.map(t => h('p', {}, t.title + ' · 已调整，今天不用做')));
}
function weekPanel(st) {
  if (window.APP_CONFIG.TRANSPORT !== 'lan' || !st.week?.length) return null;
  const items = ownTasks(st.week), required = items.filter(t => !t.plan?.optional);
  const done = required.filter(t => t.status === 'done').length, pending = required.filter(t => t.status === 'pending_parent').length;
  const groups = (st.groups || []).map(g => ({ ...g, portions: items.filter(t => t.assignment_id === g.id) }));
  const legacy = items.filter(t => !t.assignment_id);
  if (legacy.length) groups.push({ id: 'legacy', title: '已有周作业', portions: legacy });
  return h('details.week-overview', { 'data-testid': 'week-overview' },
    h('summary', {}, '周作业 · 已做 ' + (done + pending) + '/' + required.length + (pending ? ' · ' + pending + '份等妈妈检查' : '') + ' · 查看总进度'),
    ...groups.map(g => h('section.week-assignment', { 'data-assignment-id': g.id },
      h('h3', {}, g.title),
      g.total != null ? h('p', {}, '已完成 ' + g.done + ' · 待检查 ' + g.pending + ' · 还剩 ' + g.remaining + '份') : null,
      g.due_day ? h('p', {}, '老师截止：' + g.due_day) : null,
      g.deadline_conflict ? h('p.planning-note', {}, '每一份的截止日期请看对应任务。') : null,
      ...g.portions.map(t => h('div.week-portion', {},
        h('strong', {}, taskTitle(t, t.portion_label || t.title)),
        h('p', {}, (t.plan?.optional ? '选做 · ' : '') + '计划：' + Planning.shortDay(t.planned_day) + ' · ' + (HISTORY_STATUS[t.status] || '未完成')),
        t.progress_note ? h('p.planning-progress', {}, '已做到：' + t.progress_note) : null,
        h('button.c-mini', { type: 'button', onclick: () => { last = {}; App.go('#/jared/task/' + t.id); } }, '查看这一份'))),
      !viewingHistory() && g.portions.some(t => !Planning.paper(t) && ACTIVE.includes(t.status))
        ? h('button.c-mini', { type: 'button', 'data-testid': 'record-portions', onclick: () => Planning.recordGroup(g, g.portions, render) }, '记录已完成的小份 / 关卡') : null)));
}

function home(root, group = null) {
  selectedGroup = group;
  stopMedia();
  if (pastBoundary()) return night(root);
  const st = S.get('child', CH);
  if (st.status === 'idle' || st.status === 'loading') {
    root.replaceChildren(screen('jared-loading', homeTop(), dateNav(), h('div.c-center', {}, h('div.spinner', { role: 'status', 'aria-label': '加载中' }))));
    if (st.status === 'idle') S.load('child', CH); return;
  }
  if (st.status === 'error') {
    const host = h('div.buddy.md');
    root.replaceChildren(screen('jared-error', homeTop(), dateNav(), h('section.c-state', { 'data-testid': 'state-error' }, host, h('h2', {}, '没连上'),
      h('button.c-btn.primary', { type: 'button', 'data-testid': 'retry-load', onclick: () => S.load('child', CH) }, icon('refresh'), '再试一次'))));
    mascot(host, 'think'); return;
  }
  const { key, list } = ordered(ownTasks(st.tasks));
  if (group && !GROUPS.includes(group)) return App.go('#/jared');
  const pend = Object.values(S.pending).filter(p => p.body.child_id === CH && p.state === 'unknown');
  const banner = pend.length ? h('div.c-banner.warn', { role: 'status', 'data-testid': 'pending-banner' }, h('span', {}, '还没存上'),
    h('button.c-mini', { type: 'button', onclick: async () => { for (const p of pend) await S.retry(p.key); } }, icon('refresh'), '再试一次')) : null;
  if (!list.length) {
    const host = h('div.buddy.md');
    root.replaceChildren(screen('jared-empty', homeTop(), dateNav(), h('section.c-state', { 'data-testid': 'state-empty' }, host, h('h2', {}, viewingHistory() ? '这一天没有作业记录' : '今天没有任务')), Progress.homeBuddy('child_a'), Pledge.entry(), adjustedNotes(st), Planning.weekSummary(st.week, st.day), weekPanel(st)));
    mascot(host, 'happy'); return;
  }
  const active = list.filter(t => ACTIVE.includes(t.status));
  const ordering = !viewingHistory() && !!home._ordering;
  const firstActive = active[0] && active[0].id;
  const renderCard = t => {
    const i = list.indexOf(t);
    const k = kindOf(t);
    return h('li.rcard' + (t.id === firstActive ? '.now' : '') + (ACTIVE.includes(t.status) ? '' : '.quiet'), {},
      h('button.rcard-main', { type: 'button', 'data-testid': t.id === firstActive ? 'next-go' : null, onclick: () => App.go('#/jared/task/' + t.id) },
        h('span.rcard-ic.' + k.hue, { 'aria-hidden': 'true' }, icon(k.icon)),
        h('span.rcard-txt', {}, h('span.rcard-title', {}, taskTitle(t, displayTitle(t))), h('span.rcard-meta', {}, k.child + (Number.isInteger(t.exp_award) ? ' · +' + t.exp_award + ' 经验' : '') + (t.planned_day && t.planned_day < st.day ? (Planning.isWeekly(t) ? ' · 原计划 ' : ' · 从 ') + t.planned_day.slice(5) + (Planning.isWeekly(t) ? '' : ' 顺延') : ''))),
        h('span.rcard-cta.' + t.status, {}, statusMark(t), (viewingHistory() ? HISTORY_STATUS[t.status] : CTA[t.status]) || '')),
      !viewingHistory() && ACTIVE.includes(t.status) ? h('button.c-mini', { type:'button', 'data-testid':'mark-unfinished', disabled:!!S.pendingFor('task:'+t.id)||t.status==='paused', onclick:async()=>{ await S.feedback('child',t,'paused'); render(); } }, t.status==='paused'?'✕ 未完成':'✕ 标为未完成') : null,
      ordering ? h('span.rcard-order', {},
        h('button.c-mini.sq', { type: 'button', 'aria-label': '上移：' + t.title, disabled: i === 0 || groupOf(list[i - 1]) !== groupOf(t), onclick: () => move(key, list, i, -1, root) }, icon('up')),
        h('button.c-mini.sq', { type: 'button', 'aria-label': '下移：' + t.title, disabled: i === list.length - 1 || groupOf(list[i + 1]) !== groupOf(t), onclick: () => move(key, list, i, 1, root) }, icon('down'))) : null);
  };
  // 首页三张分类卡；点开才见该列表。自己选一本书不进卡（loose）。
  const orderBtn = h('button.c-mini', { type: 'button', 'aria-pressed': String(ordering), 'data-testid': 'order-toggle', onclick: () => { home._ordering = !ordering; home(root, selectedGroup); } }, icon(ordering ? 'check' : 'up'), ordering ? null : icon('down'), ordering ? '好了' : '排顺序');
  let doneBox = null;
  if (!active.length && !viewingHistory()) { const host = h('div.buddy.sm'); doneBox = h('section.c-alldone', { 'data-testid': 'state-alldone' }, host, h('h2', {}, '今天都做完啦')); setTimeout(() => mascot(host, 'happy'), 0); }

  let cards;
  if (group) {
    const visible = list.filter(t => groupOf(t) === group);
    cards = h('div', { 'data-testid': 'task-list' },
      h('header.c-top', {}, h('button.c-mini', { type: 'button', onclick: () => App.go('#/jared') }, '返回分类'), h('h1', {}, GROUP_LABEL[group] || group)),
      viewingHistory() ? null : h('div.c-list-tools', {}, orderBtn),
      h('ol.rlist', {}, ...visible.map(renderCard)),
      visible.length ? null : h('p', {}, '这类今天没有作业。'));
  } else {
    const doors = h('nav.jared-group-cards.j-home-flow', { 'aria-label': '作业分类', 'data-testid': 'jared-groups' },
      ...GROUPS.map(name => {
        const items = list.filter(t => groupOf(t) === name);
        const remaining = items.filter(t => !['done', 'pending_parent'].includes(t.status)).length;
        const hue = name === '学校作业' ? 'school' : name === '英语作业' ? 'english' : 'thinking';
        const ic = name === '英语作业' ? 'star' : name === '高途' ? 'book' : 'pencil';
        const sub = items.length ? ('剩 ' + remaining + '／' + items.length + ' 项') : '今天没有';
        return h('button.j-flow-card.' + hue, { type: 'button', 'data-testid': 'jared-group-card', 'data-group': name, onclick: () => App.go('#/jared/group/' + encodeURIComponent(name)) },
          h('span.j-flow-icon', { 'aria-hidden': 'true' }, icon(ic)),
          h('span.j-flow-copy', {}, h('strong', {}, GROUP_LABEL[name] || name), h('span', {}, sub)),
          h('span.j-flow-arrow', { 'aria-hidden': 'true' }, '›'));
      }));
    const loose = list.filter(t => !groupOf(t));
    cards = h('div', { 'data-testid': 'task-list' }, doors,
      loose.length ? h('section.j-itineraries', { 'aria-label': '今天行程' }, h('h2', {}, '今天行程'), h('ol.rlist', {}, ...loose.map(renderCard))) : null);
  }

  // 伙伴在上；三张分类卡紧跟，作业不再整页摊开一大串。
  root.replaceChildren(screen(active.length ? 'jared-home' : 'jared-alldone', homeTop(), dateNav(), banner, doneBox, group ? null : Progress.homeBuddy('child_a'), group ? null : Pledge.entry(), cards, adjustedNotes(st), (!group || group==='英语作业') ? Planning.weekSummary(st.week, st.day) : null, group ? null : weekPanel(st)));
}

function move(key, list, i, d, root) { if (!list[i + d] || groupOf(list[i]) !== groupOf(list[i + d])) return; const ids = list.map(t => t.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; Prefs.set(key, ids); home(root, selectedGroup); }

let last = { id: null, outcome: null };
function task(root, id) {
  stopMedia();
  if (pastBoundary()) return night(root);
  const st = S.get('child', CH);
  if (st.status !== 'ok') { if (st.status === 'idle') S.load('child', CH); return home(root); }
  const t = S.find('child', CH, id);
  if (!t || t.child_id !== CH) return App.go('#/jared');
  if (!viewingHistory() && last.id === id && last.outcome) return result(root, t, last.outcome);
  const k = kindOf(t), op = S.pendingFor('task:' + t.id);
  const { list } = ordered(ownTasks(st.tasks));
  const card = [h('span.tcard-ic.' + k.hue, { 'aria-hidden': 'true' }, icon(k.icon)), h('h1.tcard-title', { 'data-testid': 'task-title' }, taskTitle(t, displayTitle(t)))];
  if (t.original_requirement) card.push(h('section.task-requirement', { 'data-testid': 'original-requirement' },
    h('h2', {}, '老师的原话'), h('p.req-text', {}, t.original_requirement)));
  card.push(...Planning.details(t));
  if (Number.isInteger(t.exp_award)) card.push(h('p.tcard-exp', { 'data-testid': 'task-exp' }, '做好了可得 +' + t.exp_award + ' 经验'));
  if (t.first_step && t.first_step !== t.original_requirement) card.push(h('p.tcard-step', {}, t.first_step));
  const attached = Planning.materials(t, { beforeOpen: () => stopMedia() });
  const stops = [attached.stop], legacy = attached.legacy;
  card.push(...attached.nodes);
  if (legacy.material_url) card.push(isImageUrl(legacy.material_url)
    ? h('button.mat-thumb', { type: 'button', 'data-testid': 'open-material', 'aria-label': '看图', onclick: () => { stopMedia(); openMaterial(legacy.material_url, t.title, { backLabel: '返回' }); } }, h('img', { src: legacy.material_url, alt: '' }))
    : h('button.c-btn.story', { type: 'button', 'data-testid': 'open-material', onclick: () => { stopMedia(); openMaterial(legacy.material_url, t.title, { backLabel: '返回' }); } }, icon('book'), t.task_kind === 'reading' ? '故事' : '材料'));
  if (legacy.audio_url) { const p = AudioPlayer(legacy.audio_url); stops.push(() => p.stop()); card.push(p.el); }
  stopMedia = () => stops.forEach(stop => stop());
  const paperish = Planning.paper(t);
  if (paperish && viewingHistory()) card.push(h('button.c-btn.camera', { type: 'button', 'data-testid': 'history-photos', onclick: () => window.Photos.openPhotoSheet({ ...t, day: t.completed_day || t.day }, { readOnly: true }) }, icon('camera'), '查看作业照片'));
  if (paperish && !viewingHistory() && t.status !== 'done')
    card.push(h('button.c-btn.camera', { type: 'button', 'data-testid': 'photo-open', onclick: () => editPhotos(t) }, icon('camera'), Planning.needsPhoto(t) ? '拍照／查看照片' : '拍照留存（选填）'));
  const box = h('div.save-box', { role: 'status', 'aria-live': 'polite', 'data-testid': 'save-box' });
  if (op && op.state === 'unknown') box.append(h('div.c-banner.warn', { 'data-testid': 'save-unknown' }, h('span', {}, '还没存上'),
    h('button.c-mini', { type: 'button', 'data-testid': 'save-retry', onclick: () => act(t, op.body.status, true) }, icon('refresh'), '再试一次')));
  if (task._notice === id) box.append(h('div.c-banner.info', { 'data-testid': 'conflict-note' }, icon('refresh'), '已更新'));
  const busy = op && op.state === 'saving';
  const finished = ['done', 'pending_parent'].includes(t.status);
  const actions = viewingHistory() ? h('nav.t-actions', {}, h('p', {}, '历史回看 · ' + (HISTORY_STATUS[t.status] || '未完成')), h('button.c-btn.primary', { type: 'button', onclick: () => chooseDay(window.APP_CONFIG.today()) }, '回到今天')) : finished ? h('nav.t-actions', { 'aria-label': '操作' }, h('div.t-status', {}, statusMark(t), CTA[t.status]), Planning.undoButton(t, () => { last = {}; render(); }))
    : h('nav.t-actions', { 'aria-label': '操作' },
      h('button.c-btn.primary.big', { type: 'button', 'data-testid': 'act-done', disabled: busy, onclick: async () => {
        if (paperish) return Planning.needsPhoto(t) ? editPhotos(t) : act(t, 'pending_parent');
        if (readingChoice(t)) return finishReading(t);
        act(t, 'done');
      } }, icon('check'), busy ? '…' : paperish ? '提交' : '完成'),
      window.APP_CONFIG.TRANSPORT === 'lan' ? h('button.c-mini', { type: 'button', 'data-testid': 'record-progress', disabled: !!op, onclick: () => Planning.progress(t, () => { last = {}; render(); }) }, '记下做到哪里') : null,
      h('button.c-btn.sun', { type: 'button', 'data-testid': 'act-help', disabled: busy, onclick: () => requestHelp(t) }, icon('hand'), '需要帮助'));
  const dots = h('ol.t-dots', { 'aria-label': `第 ${list.findIndex(x => x.id === t.id) + 1} 个，共 ${list.length} 个` },
    ...list.map(x => h('li.' + (x.id === t.id ? 'cur' : ['done', 'pending_parent'].includes(x.status) ? 'done' : 'todo'), { 'aria-hidden': 'true' })));
  root.replaceChildren(screen('jared-task',
    h('header.c-top.task', {}, h('button.c-icon-btn', { type: 'button', 'data-testid': 'back', 'aria-label': '返回', onclick: () => App.go(groupRoute(t)) }, icon('back'), '返回'),
      h('span.c-top-title', {}, k.child),
      h('div.c-top-r', {}, paperish || viewingHistory() ? null : h('button.c-icon-btn.labeled', { type: 'button', 'data-testid': 'act-stop', onclick: () => stopHere(t) }, icon('pause'), h('span', {}, '今天到这里')), lock())),
    h('section.tcard', {}, ...card), box, actions, dots));
}
function editPhotos(t) {
  window.Photos.openPhotoSheet(t, {
    onSubmit: async photoPack => {
      await S.load('child', CH);
      const fresh = S.find('child', CH, t.id);
      if (!fresh || fresh.status === 'done' || (photoPack.task_version != null && fresh.version !== photoPack.task_version)) return { result: 'rejected' };
      const r = await act(fresh, 'pending_parent');
      if (r.result === 'saved') Object.assign(t, S.find('child', CH, t.id));
      return r;
    },
    onClose: () => { if (t.status !== 'pending_parent') last = {}; render(); }
  });
}
function finishReading(t) {
  const input = h('input', { type: 'number', min: '1', max: '1440', step: '1', inputmode: 'numeric', placeholder: '可以不填', 'aria-label': '大约读了几分钟' });
  const hint = h('p', { role: 'status' });
  let d;
  const submit = h('button.c-btn.primary', { type: 'button', onclick: async () => {
    const value = input.value.trim(), minutes = value ? Number(value) : null;
    if (value && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) { hint.textContent = '填大约的分钟数，或者留空。'; return; }
    submit.disabled = true;
    const r = await act(t, 'done', false, { reading_minutes: minutes });
    if (r.result === 'saved') d.close(true);
    else { hint.textContent = '还没存好，请返回核对后再试。'; submit.disabled = false; }
  } }, '完成');
  d = window.UI.dialog({ title: '读完啦', audience: 'child', body: h('div', {}, h('label', {}, '大约读了几分钟（选填）', input), hint), actions: [h('button.c-btn.ghost', { type: 'button', onclick: () => d.close(false) }, '先不交'), submit], onClose: () => render() });
}
async function requestHelp(t) {
  if (S.pendingFor('task:' + t.id)) return;
  stopMedia(); window.Voice && Voice.stop();
  const note = await window.UI.helpNoteDialog(t.help_note || '');
  if (note !== null) return act(t, 'help', false, { help_note: note });
}
async function act(t, status, retry, extra) {
  stopMedia(); task._notice = null;
  const r = retry ? await S.retry('task:' + t.id) : await S.feedback('child', t, status, extra);
  if (r.result === 'saved') last = ['done', 'pending_parent', 'help'].includes(status) ? { id: t.id, outcome: status, reward: r.reward } : {};
  if (r.result === 'rejected') task._notice = t.id;
  render();
  return r;
}
function stopHere(t) {
  stopMedia(); window.Voice && Voice.stop();
  if (['todo', 'doing'].includes(t.status) && !S.pendingFor('task:' + t.id)) S.feedback('child', t, 'paused');
  App.go('#/jared/bye');
}
function result(root, t, outcome) {
  const host = h('div.buddy.lg');
  const head = { done: '完成啦！', pending_parent: '请妈妈检查', help: '找妈妈' }[outcome] || '';
  const photo = outcome === 'pending_parent' && Planning.paper(t);
  const ok = () => { last = {}; App.go('#/jared'); };
  root.replaceChildren(screen('jared-result-' + outcome, h('header.c-top', {}, h('span'), h('div.c-top-r', {}, lock())),
    h('section.modal-card', { 'data-testid': 'result-' + outcome, role: 'dialog', 'aria-labelledby': 'res-h' },
      h('div.result-art', {}, outcome === 'done' ? host : h('div.mama-big', { 'aria-hidden': 'true', html: window.MAMA_SVG }), outcome === 'done' ? null : host),
      h('h2#res-h', {}, head),
      outcome === 'done' ? Progress.receipt(last.reward, CH)
      : outcome === 'pending_parent' ? h('section.reward-receipt', { 'data-testid': 'task-reward-wait', role: 'status' }, h('strong.reward-points', {}, '等妈妈检查'), h('p', {}, '妈妈确认后才会加经验。'))
      : null,
      photo ? h('button.c-btn.camera', { type: 'button', 'data-testid': 'photo-open', onclick: () => editPhotos(t) }, icon('camera'), '拍照') : null,
      Planning.undoButton(t, () => { last = {}; render(); }),
      h('button.c-btn.primary.big', { type: 'button', 'data-testid': 'result-home', onclick: ok }, '好'))));
  const b = mascot(host, outcome === 'done' ? 'idle' : outcome === 'help' ? 'wave' : 'happy');
  if (b && outcome === 'done') { setTimeout(() => b.play('cheer'), 120); window.Confetti && Confetti.burst({ count: 60 }); }
  setTimeout(() => { const f = root.querySelector('[data-testid=result-home]'); f && f.focus(); }, 30);
}
function bye(root) {
  stopMedia();
  const host = h('div.buddy.lg');
  const pend = Object.values(S.pending).filter(p => p.body.child_id === CH && p.state === 'unknown');
  root.replaceChildren(screen('jared-bye', h('header.c-top', {}, h('span'), h('div.c-top-r', {}, lock())),
    h('section.c-state', { 'data-testid': 'state-bye' }, host, h('h2', {}, '明天见'),
      pend.length ? h('div.c-banner.warn', { 'data-testid': 'pending-banner' }, h('span', {}, '还没存上'),
        h('button.c-mini', { type: 'button', onclick: async () => { for (const p of pend) await S.retry(p.key); bye(root); } }, icon('refresh'), '再试一次')) : null,
      h('div.result-actions', {},
        pastBoundary() ? null : h('button.c-btn.ghost', { type: 'button', 'aria-label': '回到今天', onclick: () => App.go('#/jared') }, icon('back'), '回去'),
        App.multiChild() ? h('button.c-btn.ghost', { type: 'button', 'aria-label': '选人', onclick: () => App.go('#/') }, icon('home')) : null))));
  mascot(host, 'wave');
}
function night(root) {
  const host = h('div.buddy.lg');
  root.replaceChildren(screen('jared-night', h('header.c-top', {}, h('span'), h('div.c-top-r', {}, lock())),
    h('section.c-state.night', { 'data-testid': 'state-night' }, h('div.moon', { 'aria-hidden': 'true' }), host, h('h2', {}, '明天见'))));
  mascot(host, 'idle');
}
let current = null;
function render() { if (current) current(); }
window.Jared = {
  route(root, parts) {
    task._notice = null;
    const draw = () => parts[0] === 'pledge' ? Pledge.render(root) : parts[0] === 'task' ? task(root, parts[1]) : parts[0] === 'bye' ? bye(root) : parts[0] === 'group' ? home(root, (()=>{try{return decodeURIComponent(parts[1]||'');}catch(_){return '';}})()) : home(root);
    current = () => UI.ChildScroll.paint(draw);
    if (!S._jaredSub) S._jaredSub = S.on(() => { if (location.hash.startsWith('#/jared') && !location.hash.startsWith('#/jared/pledge') && !document.querySelector('.ps,.mat,.dlg')) render(); });
    current();
  },
  stop() { stopMedia(); }
};
})();
