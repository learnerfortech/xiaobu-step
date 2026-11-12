/* Shared task details. Planning stays with the parent; progress belongs to the same task. */
(function () {
const { h, icon, dialog, toast } = window.UI;
const S = window.Store;
const isWeekly = t => ['school', 'habit', 'weekly', 'itinerary'].includes(t.work_type) ? t.work_type === 'weekly' : !!t.plan;
const paper = t => ['paper', 'legacy'].includes(t.task_kind);
const needsPhoto = t => t.child_id === 'child_a' && paper(t) && t.photo_required !== false;
const shortDay = d => d ? d.slice(5).replace('-', '/') : '待安排';
const materialKindLabels = { explanation: '讲解', exercise: '练习', prompt: '题图', model: '范文', answer: '答案', audio: '音频', link: '外部网站' };

function taskTitle(t, title) {
  const complete = ['done', 'pending_parent'].includes(t.status);
  return h('span.task-title-content' + (complete ? '.is-complete' : ''), {},
    complete ? h('span.task-title-check', { role: 'img', 'aria-label': t.status === 'done' ? '已完成' : '已提交' }, icon('check')) : null,
    h('span.task-title-copy', {}, title));
}

function details(t, parent = false) {
  const nodes = [];
  if (parent) nodes.push(h('p.planning-meta', {}, '录入：' + (t.created_day || '旧记录未注明')));
  if (t.planned_day || isWeekly(t)) nodes.push(h('p.planning-meta', {}, '计划：' + shortDay(t.planned_day)));
  if (t.due_day) nodes.push(h('p.planning-meta', { 'data-testid': 'teacher-deadline' }, '老师截止：' + t.due_day));
  if (t.deadline_passed && !['done', 'pending_parent'].includes(t.status)) nodes.push(h('p.planning-note', { 'data-testid': 'deadline-support' }, parent
    ? '老师的截止日期已到，还有内容没完成。请一起选出现在能做的一小步，并与老师协调。'
    : '老师的截止日期已到。可以先做一小步，也可以请妈妈帮忙安排。'));
  if (parent && t.planning_warning) nodes.push(h('p.planning-note', { 'data-testid': 'planning-warning' }, t.planning_warning === 'planned_after_due'
    ? '这次安排在老师截止日之后，需要协调；老师的截止日期没有改变。'
    : '截止前还有内容没安排，请结合当天负担安排，或先与老师协调。'));
  if (t.progress_note) nodes.push(h('p.planning-progress', { 'data-testid': 'partial-progress' }, '已做到：' + t.progress_note));
  return nodes;
}

function materials(t, { parent = false, beforeOpen = () => {} } = {}) {
  const players = [];
  // A page range is not a replacement for the original whole file. Legacy links
  // keep their unspecified purpose unless the exact resource is fully represented.
  const covers = (url, audio) => (t.materials || []).some(m => m.url === url && !m.page_from && !m.page_to
    && (audio ? m.kind === 'audio' : m.kind !== 'audio'));
  const legacy = {
    material_url: t.material_url && !covers(t.material_url, false) ? t.material_url : '',
    audio_url: t.audio_url && !covers(t.audio_url, true) ? t.audio_url : ''
  };
  const entries = (t.materials || []).map(m => {
    const pages = m.page_from ? (' · 第' + m.page_from + (m.page_to && m.page_to !== m.page_from ? '—' + m.page_to : '') + '页') : '';
    const label = (materialKindLabels[m.kind] || '材料') + ' · ' + m.title + pages;
    let item;
    if (m.kind === 'audio') {
      const player = window.Media.AudioPlayer(m.url);
      players.push(player);
      item = h('section.task-material', {}, h('h3', {}, label), player.el);
    } else {
      const url = m.page_from && /\.pdf(?:[?#]|$)/i.test(m.url) ? m.url.split('#')[0] + '#page=' + m.page_from : m.url;
      item = h('button.' + (parent ? 'p-btn' : 'c-btn.story'), { type: 'button', 'data-testid': 'task-material', 'data-kind': m.kind, onclick: () => {
        beforeOpen(); window.Voice?.stop();
        window.Media.openMaterial(url, label, { audience: parent ? 'parent' : 'child', backLabel: '返回任务' });
      } }, icon(m.kind === 'link' ? 'chevron' : 'book'), label);
    }
    return m.kind === 'answer' && !parent
      ? h('details.task-answers', {}, h('summary', {}, '做完练习，再看答案'), item)
      : item;
  });
  if ((t.materials || []).some(m => m.kind === 'link')) entries.push(h('p.planning-meta', {}, '在原网站完成后，回来记录进度；网站还没有自动同步。'));
  return { nodes: entries.length ? [h('section.task-materials', { 'aria-label': '本任务材料' }, ...entries)] : [], legacy, stop: () => players.forEach(p => p.stop()) };
}

function progress(t, onSaved = () => {}) {
  const input = h('textarea.p-input', { rows: 3, maxlength: 500, 'aria-label': '已经做到哪里', 'data-testid': 'progress-note-input', placeholder: '例如：第1页完成，还剩第2页' });
  input.value = t.progress_note || '';
  const message = h('p', { role: 'status' });
  let d, busy = false, pending = null;
  const save = h('button.c-btn.primary', { type: 'button', 'data-testid': 'save-progress', onclick: async () => {
    if (busy) return;
    busy = true; save.disabled = true; input.disabled = true;
    const current = S.find('child', t.child_id, t.id) || t;
    const r = pending ? await S.retry(pending.key) : await S.feedback('child', current, 'doing', { progress_note: input.value.trim() || '已做一部分' });
    if (r.result === 'saved') { d.close(true); toast('进度已记下'); onSaved(); return; }
    pending = r.result === 'unknown' ? r.op : null;
    input.disabled = !!pending;
    message.textContent = pending ? '还没确认存好，点“再确认一次”重试。' : '没有覆盖原进度，请返回查看最新任务后再记。';
    save.textContent = pending ? '再确认一次' : '记下';
    save.disabled = r.result === 'rejected'; busy = false;
  } }, '记下');
  d = dialog({ title: '记下做到哪里', audience: 'child', body: h('div', {}, input, h('p.planning-meta', {}, '已经做过的会保留，这一份完成后再打勾。'), message), actions: [h('button.c-btn.ghost', { type: 'button', onclick: () => d.close() }, '返回'), save] });
}

const canUndo = t => t.status === 'pending_parent' || (t.status === 'done' && !paper(t) && t.completed_by === 'child');
function undoButton(t, onSaved = () => {}) {
  if (!canUndo(t)) return null;
  let busy = false;
  return h('button.c-mini', { type: 'button', 'data-testid': 'undo-completion', onclick: async e => {
    if (busy) return;
    const button = e.currentTarget;
    busy = true; button.disabled = true;
    const current = S.find('child', t.child_id, t.id) || t;
    const previous = S.pendingFor('task:' + t.id);
    if (previous && (previous.kind !== 'feedback' || previous.body.status !== 'todo')) { toast('请先确认上一次保存，再撤销'); busy = false; button.disabled = false; return; }
    const r = previous?.state === 'unknown' ? await S.retry(previous.key) : await S.feedback('child', current, 'todo');
    if (r.result === 'saved') { toast('已撤销，原来的进度和照片还在'); onSaved(); }
    else { toast(r.result === 'unknown' ? '还没确认存好，请再点一次' : '状态已变化，请返回核对'); busy = false; button.disabled = false; }
  } }, icon('undo'), '刚才点错了，撤销');
}

function recordGroup(group, portions, onSaved = () => {}) {
  // Record actual work only. This never edits parent-chosen dates or trusts the external website.
  const eligible = portions.filter(t => !paper(t));
  const message = h('p', { role: 'status' });
  const rows = eligible.map(t => {
    const complete = ['done', 'pending_parent'].includes(t.status);
    const input = h('input', { type: 'checkbox', checked: complete, disabled: complete, value: t.id });
    return { task: t, input, saved: complete, pendingKey: null, el: h('label.portion-check', {}, input, h('span', {}, t.portion_label || t.title), complete ? h('span', {}, '已记下') : null) };
  });
  let d, busy = false, batch = null;
  const button = h('button.c-btn.primary', { type: 'button', 'data-testid': 'save-completed-portions', onclick: async () => {
    if (busy) return;
    if (!batch) batch = rows.filter(row => row.input.checked && !row.saved);
    busy = true; button.disabled = true;
    rows.forEach(row => { row.input.disabled = true; });
    let saved = 0, failure = null;
    for (const row of batch.filter(row => !row.saved)) {
      const current = S.find('child', row.task.child_id, row.task.id) || row.task;
      const pending = S.pendingFor('task:' + current.id);
      if (pending && (pending.kind !== 'feedback' || pending.body.status !== 'done' || pending.state !== 'unknown')) {
        failure = { result: 'rejected' }; break;
      }
      const retryKey = row.pendingKey || pending?.key;
      const r = retryKey ? await S.retry(retryKey) : await S.feedback('child', current, 'done');
      if (r.result !== 'saved') {
        if (r.result === 'unknown') row.pendingKey = r.op?.key || retryKey || 'task:' + current.id;
        failure = r; break;
      }
      row.saved = true; row.pendingKey = null; row.input.checked = true; saved++;
    }
    if (!failure) { d.close(true); toast(saved ? '完成的份数已记下' : '没有新增完成项'); onSaved(); return; }
    const unknown = failure.result === 'unknown';
    message.textContent = unknown
      ? '已经存好的会保留，勾选也已保留。请点“再确认一次”继续，不会重复发经验。'
      : '已经存好的会保留。任务状态有变化，请返回查看最新任务，再记录其余部分。';
    button.textContent = unknown ? '再确认一次' : '请返回核对';
    button.disabled = !unknown; busy = false;
  } }, '记下完成');
  d = dialog({ title: group.title, audience: 'child', body: h('div', {}, h('p', {}, '勾选这次实际做完的部分。由你记录，网站没有自动同步。'), ...rows.map(x => x.el), message), actions: [h('button.c-btn.ghost', { type: 'button', onclick: () => d.close() }, '返回'), button] });
}

function weekSummary(tasks, viewDay = APP_CONFIG.today()) {
  const sets = new Map();
  for (const t of tasks || []) {
    if (!isWeekly(t) || t.home_group !== '英语作业' || !t.plan?.start || !t.plan?.end || viewDay < t.plan.start || viewDay > t.plan.end) continue;
    const key=t.plan.id || t.plan.start+':'+t.plan.end;
    if (!sets.has(key)) sets.set(key, []);
    if (!sets.get(key).some(x=>x.id===t.id)) sets.get(key).push(t);
  }
  if (!sets.size) return null;
  return h('section.week-summary', {'data-testid':'weekly-english-summary'}, ...[...sets.values()].map(items=>{
    const plan=items[0].plan, done=items.filter(t=>t.status==='done').length, pending=items.filter(t=>t.status==='pending_parent').length;
    const deadline=plan.deadline, date=deadline?.slice(0,10), time=deadline?.slice(11,16);
    const weekday=date ? ['周日','周一','周二','周三','周四','周五','周六'][new Date(date+'T12:00:00Z').getUTCDay()] : '';
    return h('div',{},h('h2',{},'本周英语'),h('p',{},shortDay(plan.start)+'–'+shortDay(plan.end)+(deadline?' · '+weekday+' '+time+' 前交':'')),
      h('p',{},'已完成 '+done+' 项 · 还剩 '+(items.length-done-pending)+' 项'+(pending?' · 待家长检查 '+pending+' 项':'')),
      h('p.planning-meta',{},'以下是本周总量，建议日期可由家长调整；不表示今天都要做完。'));
  }));
}

window.TaskPlanning = { weekSummary, taskTitle, materialKindLabels, isWeekly, paper, needsPhoto, shortDay, details, materials, progress, undoButton, recordGroup };
})();
