/* Joey（child_b，幼小衔接，不识字，家长陪同）——受众：孩子。
   声音优先：每扇门、每个结果都由团团说（预录 mp3，缺录音才用系统语音）；屏幕上只留极短的门名和图标。
   打开即是门（今天的任务门 + 团团的游戏门），没有任何开始前设置；“玩什么”由 Joey 自己点。
   对标：首页 = HOMER 首页大色块瓷砖（docs/refs/homer-6.jpg）；做任务 = Duolingo ABC 课程页：左上 ✕、顶部进度条、
         中间一个大喇叭/内容、底部大按钮（duoabc-8.jpg / duoabc-3.jpg）；游戏 = v5 三扇门（同 HOMER 瓷砖）。 */
(function(){
const { h, icon, mascot, say, kindOf, Prefs, pastBoundary } = window.UI;
const { AudioPlayer, openMaterial } = window.Media;
const S = window.Store, CH = 'child_b', C = window.APP_CONFIG;
const DOOR = { reading: ['看一看', '和妈妈一起看一看！', 'story', 'book'], paper: ['画一画', '拿出纸和笔，和妈妈一起画一画！', 'count', 'pencil'],
  audio: ['听一听', '听一听，听到铃声就指一指！', 'pinyin', 'ear'], legacy: ['做一做', '和妈妈一起做一做！', 'sun', 'star'] };
const door = t => { if (/^joey-\d{8}-bag-open$/.test(t.id)) return ['打开书包','','bag-open','book']; if (/^joey-\d{8}-bag-pack$/.test(t.id)) return ['整理书包','','bag-pack','book']; const d = DOOR[t.task_kind] || DOOR.legacy; return t.child_label ? [t.child_label, d[1], d[2], d[3]] : d; };
const finished = t => ['done', 'pending_parent'].includes(t.status);
const flowRank = t => /^joey-\d{8}-bag-open$/.test(t.id) ? 0 : /^joey-\d{8}-bag-pack$/.test(t.id) ? 2 : 1;
const orderedTasks = tasks => (tasks || []).filter(t => t.child_id === CH).slice().sort((a, b) => flowRank(a) - flowRank(b));
const nextTask = (tasks, id) => {
  const list = orderedTasks(tasks), at = list.findIndex(t => t.id === id);
  return [...list.slice(at + 1), ...list.slice(0, Math.max(0, at))].find(t => !finished(t)) || null;
};
let buddy = null, stopMedia = () => {}, lastLine = null, spoken = null;
/* 同一画面只开口一次（数据刷新导致的重绘不重复说话） */
const once = (key, t) => { if (spoken === key) { lastLine = t; return; } spoken = key; line(t); };
const line = (t, b = buddy, cb) => { lastLine = t; say(t, b, cb, { preserveText: true }); };
const replayLine = () => {
  const id = location.hash.match(/^#\/joey\/task\/([^/?]+)/)?.[1];
  const t = id && S.find('child', CH, id);
  if (t && document.querySelector('[data-screen=joey-task]')) return readTask(t);
  stopMedia(); if (lastLine) line(lastLine);
};
// 只把拼音作业的朗读文案换成中文声母名；屏幕仍显示原字母。
const phonicsSpeech = (text, title) => {
  if (!/拼音|声母/.test(title)) return text;
  const names = { b:'玻', p:'坡', m:'摸', f:'佛', d:'得', t:'特', n:'讷', l:'勒' };
  return text.replace(/\bdtnl\b/gi, '得、特、讷、勒')
    .replace(/\bbpmf\b/gi, '玻、坡、摸、佛')
    .replace(/\b([bpmfdtnl])\b/gi, (_, letter) => names[letter.toLowerCase()]);
};
const taskSpeech = t => {
  const title = typeof t.title === 'string' ? t.title.trim() : '';
  const demo = typeof t.child_demo === 'string' ? t.child_demo.trim() : '';
  const step = typeof t.first_step === 'string' ? t.first_step.trim() : '';
  return phonicsSpeech([title, demo || step].filter(Boolean).join('。') || door(t)[1], title);
};

let handoff = null, readWatch = null;
let taskRead = { id: null, state: 'idle', attempt: 0 };
function paintReadTask() {
  const button = document.querySelector('[data-testid=listen-homework]');
  if (!button) return;
  const label = button.querySelector('[data-testid=listen-homework-label]');
  const failed = taskRead.state === 'failed';
  label.textContent = failed ? '点我听作业' : taskRead.state === 'playing' ? '再听一遍' : '听作业';
  button.style.background = failed ? '#a74400' : '';
  button.style.outline = failed ? '4px solid #ffd66b' : '';
  const msg = document.querySelector('[data-testid=listen-homework-status]');
  if (msg) msg.textContent = failed ? '还没播出来，点上面的大按钮再试一次。' : taskRead.state === 'playing' ? '正在读这份作业' : '点一下，听标题和怎么做。';
}
function readTask(t) {
  stopMedia(); clearTimeout(readWatch);
  const text = taskSpeech(t), attempt = taskRead.attempt + 1;
  taskRead = { id: t.id, state: 'pending', attempt }; lastLine = text;
  const active = () => taskRead.id === t.id && taskRead.attempt === attempt;
  const failed = () => { if (active()) { taskRead.state = 'failed'; paintReadTask(); } };
  Voice.unlock && Voice.unlock();
  readWatch = setTimeout(() => { if (active() && taskRead.state === 'pending') failed(); }, 15000);
  // Homework listening is explicit and remains available when mascot chatter is muted.
  Voice.play(text, () => { if (active() && taskRead.state !== 'failed') { taskRead.state = 'done'; clearTimeout(readWatch); paintReadTask(); } }, {
    preserveText: true, gesture: true, ignoreMuted: true, fallbackSpeech: true, startTimeoutMs: 15000,
    audioUrl: C.TRANSPORT === 'lan' ? '/lan/speech/task?'+new URLSearchParams({day:t.day,child:CH,id:t.id}) : null,
    onStart: () => { if (active()) { clearTimeout(readWatch); taskRead.state = 'playing'; paintReadTask(); } },
    onFailure: failed,
    onStop: () => { if (active()) { clearTimeout(readWatch); taskRead.state = 'idle'; paintReadTask(); } }
  });
  paintReadTask();
}

function stage(name, { onDoor, kids, guide = true, help = null, progress = null, close = false }) {
  const doorBtn = h('button.j-ib.nav-back', { type: 'button', 'aria-label': '返回', 'data-testid': 'joey-door', onclick: onDoor }, icon('back'), h('span', {}, '返回'));
  const g = guide ? h('button.j-guide', { type: 'button', 'aria-label': '团团，再说一遍', onclick: replayLine }, h('div.buddy.j')) : null;
  const el = h('main.c-screen.joey', { 'data-audience': 'child', 'data-screen': name, id: 'main' },
    h('header.j-top', {}, doorBtn, progress, h('div.j-top-r', {}, help, window.Gate.lockButton(() => App.go('#/parent'), 'small'))),
    h('div.j-stage', {}, ...kids), g);
  return el;
}
function mountGuide(root, state = 'idle') { const host = root.querySelector('.j-guide .buddy'); buddy = host ? mascot(host, state) : null; return buddy; }
function hear() { return h('button.j-hear', { type: 'button', 'aria-label': '再听一次', onclick: replayLine }, icon('sound')); }

const SUBJECTS = [
  { name:'文化传承', match:/文化传承/, hue:'culture', ic:'book' },
  { name:'思维城堡', match:/思维城堡/, hue:'thinking', ic:'star' },
  { name:'魔法王国', match:/魔法王国/, hue:'magic', ic:'pencil' },
  { name:'Big English', match:/Big English/i, hue:'english', ic:'ear' }
];
const subjectOf = t => SUBJECTS.find(s => s.match.test(t.title || ''));
const groupOf = t => flowRank(t)!==1 || t.home_group==='flow' ? 'flow' : t.itinerary || t.id.startsWith('itinerary-') || t.home_group==='itinerary' ? 'itinerary' : 'school';
const statusText = t => (t.carried_over ? '顺延 · ' : '') + (t.status === 'done' ? '已完成' : t.status === 'pending_parent' ? '等妈妈确认' : t.status === 'paused' ? '未完成' : '点开开始');
function enterTask(t) {
  handoff = { id:t.id, until:Date.now()+2000 }; readTask(t); App.go('#/joey/task/'+t.id);
}
function flowCard({title, subtitle, hue, ic, task, onclick, testid}) {
  return h('button.j-flow-card.'+hue, {type:'button','data-testid':testid || 'joey-task-door',
    'aria-label': title + (task && finished(task) ? '，'+statusText(task) : ''),
    onclick:onclick || (()=>enterTask(task)), disabled:!task && !onclick},
    h('span.j-flow-icon', {'aria-hidden':'true'}, icon(ic)),
    h('span.j-flow-copy', {}, h('strong',{},title),h('span',{},subtitle || (task ? statusText(task) : '今天没有这项任务'))),
    task && finished(task) ? h('span.j-badge.ok',{'aria-hidden':'true'},icon('check')) : h('span.j-flow-arrow',{'aria-hidden':'true'},'›'));
}
function home(root) {
  stopMedia(); Voice.stop();
  if (pastBoundary()) return night(root);
  const st=S.get('child',CH);
  if(st.status==='idle'||st.status==='loading') {
    root.replaceChildren(stage('joey-loading',{onDoor:()=>App.go('#/'),kids:[h('h1',{},'正在连接家里电脑…'),h('div.spinner',{role:'status','aria-label':'正在连接'}),h('button.c-btn',{type:'button',onclick:()=>App.go('#/')},'回选人')]}));
    if(st.status==='idle')S.load('child',CH);return;
  }
  if(st.status==='error') {
    root.replaceChildren(stage('joey-error',{onDoor:()=>App.go('#/'),kids:[h('h1',{style:{fontSize:'30px'},role:'alert'},'没连上家里电脑'),h('p',{},'看看电脑是否开着，平板是否连着家里 Wi-Fi。'),h('button.c-btn.primary',{type:'button','data-testid':'retry-load',onclick:()=>S.load('child',CH)},'再试一次'),h('button.c-btn',{type:'button',onclick:()=>App.go('#/')},'回选人')]}));return;
  }
  const tasks=orderedTasks(st.tasks),open=tasks.filter(t=>!finished(t));
  const bagOpen=tasks.find(t=>flowRank(t)===0),bagPack=tasks.find(t=>flowRank(t)===2);
  const schoolTasks=tasks.filter(t=>groupOf(t)==='school'),itineraries=tasks.filter(t=>groupOf(t)==='itinerary');
  const count=schoolTasks.filter(finished).length;
  let greet='Joey，先打开书包，再看看今天的作业。',name='joey-home';
  if(!tasks.length){greet='今天没有任务。';name='joey-empty';}
  else if(!open.length){greet='今天任务全部完成！乐乐真的太棒了！';name='joey-alldone';}
  const content=h('div.j-home-flow',{'data-testid':name==='joey-alldone'?'state-alldone':'joey-doors'},
    flowCard({title:'打开书包',hue:'bag-open',ic:'book',task:bagOpen}),
    flowCard({title:'今日作业',subtitle:`已完成 ${count}／${schoolTasks.length}`,hue:'school',ic:'pencil',testid:'joey-school-door',onclick:()=>{Voice.stop();App.go('#/joey/school');}}),
    flowCard({title:'整理书包',hue:'bag-pack',ic:'book',task:bagPack}),
    flowCard({title:'闯关小游戏',subtitle:'规则换换换 · 下一个是什么',hue:'games',ic:'star',testid:'joey-game-door',onclick:()=>{Voice.unlock?.();App.go('#/joey/games');}}),
    itineraries.length?h('section.j-itineraries',{'aria-label':'行程提醒'},h('h2',{},'行程提醒'),...itineraries.map(t=>h('button.j-itinerary',{type:'button','data-testid':'joey-itinerary',onclick:()=>enterTask(t)},icon('clock'),h('span',{},t.child_label||t.title),h('small',{},statusText(t))))):null);
  const el=stage(name,{onDoor:()=>App.go('#/'),kids:[Progress.homeBuddy(CH),content,name==='joey-alldone'?h('p.j-all-done',{role:'status'},'喷火龙：'+greet):null,hear()]});
  el.classList.add('joey-flow-home');root.replaceChildren(el);
  mountGuide(root,open.length||!tasks.length?'wave':'happy');
  if(name==='joey-alldone'){
    const key='xb.joey.allDoneSpoken.'+C.today();let already=false;
    try{already=localStorage.getItem(key)==='1';if(!already)localStorage.setItem(key,'1');}catch(_){already=spoken===name;}
    lastLine=greet;spoken=name;if(!already)say(greet,null,null,{preserveText:true});
  }else once(name,greet);
}
function school(root) {
  stopMedia();Voice.stop();
  const st=S.get('child',CH);if(st.status!=='ok')return home(root);
  const tasks=orderedTasks(st.tasks).filter(t=>groupOf(t)==='school');
  const cards=SUBJECTS.flatMap(s=>{
    const matches=tasks.filter(t=>subjectOf(t)===s);
    return matches.length?matches.map(t=>flowCard({title:s.name,subtitle:statusText(t)+(matches.length>1?' · '+(t.child_label||t.title):''),hue:s.hue,ic:s.ic,task:t}))
      :[flowCard({title:s.name,hue:s.hue,ic:s.ic})];
  });
  const extras=tasks.filter(t=>!subjectOf(t));
  root.replaceChildren(stage('joey-school',{onDoor:()=>App.go('#/joey'),kids:[
    h('section.j-school-list',{},h('h1',{},'今日作业'),h('p.j-school-count',{},`已完成 ${tasks.filter(finished).length}／${tasks.length}`),...cards,
      extras.length?h('section',{},h('h2',{},'其他作业'),...extras.map(t=>flowCard({title:t.child_label||t.title,hue:'school',ic:'book',task:t}))):null),hear()]}));
  mountGuide(root);once('school','点一科，听听今天要做什么。');
}

let last = { id: null, outcome: null }, actionEpoch = 0, doneDialog = null;
function leaveUnknown(t) {
  actionEpoch++; last = {};
  doneDialog?.close(false); doneDialog = null;
  S.abandon('task:' + t.id);
  App.go('#/joey'); S.load('child', CH);
}
function task(root, id) {
  stopMedia();
  if (taskRead.id !== id) { clearTimeout(readWatch); Voice.stop(); taskRead = { id, state: "idle", attempt: 0 }; }
  handoff = null;
  if (pastBoundary()) return night(root);
  const state = S.get('child', CH);
  if (state.status !== 'ok') return home(root);
  const t = S.find('child', CH, id);
  if (!t || t.child_id !== CH) return App.go('#/joey');
  if (last.id === id && last.outcome) return result(root, t, last.outcome);
  const [label, intro, hue, ic] = door(t);
  const op = S.pendingFor('task:' + t.id);
  let media;
  if (t.task_kind === 'audio' && t.audio_url) {
    const p = AudioPlayer(t.audio_url, { big: true, onPlay: () => Voice.stop() }); stopMedia = () => p.stop();
    media = h('div.j-media', {}, t.material_url ? h('img.j-sheet', { src: t.material_url, alt: '' }) : null, p.el);
  } else if (t.material_url && t.task_kind === 'reading') media = h('div.j-media.read', {}, h('iframe.j-read', { src: t.material_url, title: '故事', sandbox: '' }));
  else if (t.material_url) media = h('div.j-media', {}, t.adult_required ? h('button.c-btn.story', { type: 'button', 'data-testid': 'joey-open-material', 'aria-label': '打开材料大图', style: { width: '100%', height: 'auto', padding: '8px', display: 'flex', flexDirection: 'column' }, onclick: () => { Voice.stop(); stopMedia(); openMaterial(t.material_url, t.title, { backLabel: '返回任务' }); } }, h('img.j-sheet', { src: t.material_url, alt: t.title + '材料' }), h('span', {}, '点开看大图')) : h('img.j-sheet', { src: t.material_url, alt: '' }));
  else media = h('div.j-media.art.' + hue, { 'aria-hidden': 'true' }, icon(ic));
  const unknown = op && op.state === 'unknown', busy = op && op.state === 'saving';
  const helpBtn = h('button.j-ib', { type: 'button', 'aria-label': '请妈妈帮忙', 'data-testid': 'act-help', disabled: busy, onclick: () => requestHelp(t) }, icon('hand'));
  const paperish = ['paper', 'legacy'].includes(t.task_kind);
  // Full-width "完成" equal to 听作业 — including itinerary / adult_required (e.g. 乐高). Only done/pending_parent → 回到门前.
  const wide = { minHeight: '76px', width: '100%', fontSize: '28px' };
  const photoBtn = paperish && !['done'].includes(t.status)
    ? h('button.c-btn.camera', { type: 'button', 'data-testid': 'photo-open', style: Object.assign({}, wide, { minHeight: '64px', fontSize: '24px', marginBottom: '10px' }), disabled: busy, onclick: () => window.Photos.openPhotoSheet(t) }, icon('camera'), h('span', {}, '拍照留存（选填）'))
    : null;
  const doneBtn = busy ? h('button.c-btn.primary', { type:'button', disabled:true, style:wide, 'data-testid':'save-busy' }, '正在记下…') : unknown ? h('button.c-btn.sun', { type: 'button', 'aria-label': '再试一次', 'data-testid': 'save-retry', style: wide, onclick: () => act(t, op.body.status, true) }, icon('refresh'), h('span', {}, '再试一次'))
    : ['done', 'pending_parent'].includes(t.status) ? h('button.c-btn', { type: 'button', 'aria-label': '回到门前', 'data-testid': 'joey-back-doors', style: wide, onclick: () => App.go('#/joey') }, icon('home'), h('span', {}, '回到门前'))
    : h('button.c-btn.primary' + (busy ? '.busy' : ''), { type: 'button', 'aria-label': '完成', 'data-testid': 'act-done', disabled: busy, style: wide, onclick: async () => {
        if (!(await confirmDone(t))) return;
        if (paperish && !(await window.Photos.requireBeforeDone(t))) return;
        act(t, paperish ? 'pending_parent' : 'done');
      } }, icon('check'), h('span', {}, busy ? '…' : '完成'));
  const escape = unknown || busy ? h('button.c-btn.ghost', { type:'button', style:wide, 'data-testid':'save-leave', onclick:()=>leaveUnknown(t) }, '先返回／还没做完') : null;
  const all = orderedTasks(S.get('child', CH).tasks), idx = all.findIndex(x => x.id === t.id);
  const fin = all.filter(x => ['done', 'pending_parent'].includes(x.status)).length;
  const progress = h('div.j-progress', { role: 'progressbar', 'aria-label': '进度', 'aria-valuemin': 0, 'aria-valuemax': all.length, 'aria-valuenow': fin }, h('i', { style: { width: (all.length ? fin / all.length * 100 : 0) + '%' } }));
  root.replaceChildren(stage('joey-task', { onDoor: () => { if (unknown || busy) return leaveUnknown(t); last = {}; App.go(groupOf(t)==='school' ? '#/joey/school' : '#/joey'); }, help: helpBtn, progress, close: true,
    kids: [h('div.j-task', {}, (t.adult_required || flowRank(t) !== 1) ? h('section.j-media', { 'data-testid': 'joey-task-instructions', style: { textAlign: 'center' } }, h('h1', { style: { margin: '0', fontSize: '24px' } }, t.title), Number.isInteger(t.exp_award) ? h('p', { 'data-testid': 'task-exp', style: { margin: '0', fontSize: '18px' } }, '完成可得 +' + t.exp_award + ' 经验') : null, h('p', { style: { margin: '0', fontSize: '20px', lineHeight: '1.5' } }, t.first_step), t.adult_required ? h('span', { style: { fontSize: '16px' } }, '和妈妈一起做') : null) : null, h('button.c-btn.primary', { type: 'button', 'data-testid': 'listen-homework', style: wide, onclick: () => readTask(t) }, icon('sound'), h('span', { 'data-testid': 'listen-homework-label' }, '听作业')), h('p', { 'data-testid': 'listen-homework-status', role: 'status', 'aria-live': 'polite', style: { margin: '0', textAlign: 'center' } }), h('div.j-act.j-act-wide', { 'data-testid': unknown ? 'save-unknown' : 'joey-task-actions' }, photoBtn, doneBtn, escape), media), hear()] }));
  mountGuide(root, unknown ? 'think' : 'point');
  if (unknown) once('u' + id + op.body.operation_id, '还没记下来，再点一下试试。');
  else if (task._notice === id) { task._notice = null; spoken = null; line('我们再看一看。'); }
  else if (!busy) { lastLine = taskSpeech(t); paintReadTask(); }
}
async function confirmDone(t) {
  // 防误点：还没做就乱点「完成」时先问一句；「还没有」做大按钮默认出口。
  return new Promise(resolve => {
    const { h, dialog } = window.UI;
    doneDialog?.close(false);
    let d;
    const wide = { minHeight: '72px', width: '100%', fontSize: '26px' };
    const no = h('button.c-btn.primary', { type: 'button', 'data-testid': 'done-confirm-no', autofocus: true, style: wide, onclick: () => d.close(false) }, h('span', {}, '还没有'));
    const yes = h('button.c-btn', { type: 'button', 'data-testid': 'done-confirm-yes', style: Object.assign({}, wide, { background: '#edf1ee', color: '#203d32', boxShadow: 'none' }), onclick: () => d.close(true) }, h('span', {}, '做完了'));
    d = doneDialog = dialog({
      title: '真的做完了吗？',
      audience: 'child',
      cls: 'joey-done-confirm',
      body: h('div', {}, h('p', { style: { fontSize: '22px', textAlign: 'center', margin: '8px 0 16px' } }, '没做完就点「还没有」。'), no, h('div', { style: { height: '12px' } }), yes),
      actions: [],
      onClose: v => { d.el.remove(); if (doneDialog === d) doneDialog = null; resolve(v === true); }
    });
    try { window.Voice && Voice.play('真的做完了吗？没做完就点还没有。', null, { gesture: true, ignoreMuted: true }); } catch (_) {}
  });
}
async function requestHelp(t) {
  if (S.pendingFor('task:' + t.id)) return;
  stopMedia(); window.Voice && Voice.stop();
  const note = await window.UI.helpNoteDialog(t.help_note || '');
  if (note !== null) return act(t, 'help', false, { help_note: note });
}
async function act(t, status, retry, extra) {
  stopMedia(); Voice.stop();
  const epoch = ++actionEpoch;
  const r = retry ? await S.retry('task:' + t.id) : await S.feedback('child', t, status, extra);
  if (epoch !== actionEpoch || r.result === 'abandoned') return;
  if (r.result === 'saved') last = { id: t.id, outcome: status, reward: r.reward };
  if (r.result === 'rejected') task._notice = t.id;
  render();
}
function result(root, t, outcome) {
  const leave = to => { last = {}; App.go(to); };
  const v = { done: ['做好啦！真棒！', 'cheer'], pending_parent: ['做好啦！请妈妈检查，确认后才加经验！', 'happy'], help: ['我们请妈妈来帮忙！', 'wave'] }[outcome];
  const completed = ['done', 'pending_parent'].includes(outcome);
  const next = completed ? nextTask(S.get('child', CH).tasks, t.id) : null;
  const nextLabel = next ? next.title : '';
  const praise = v[0] + (next ? '下一项是「' + nextLabel + '」。' : '');
  root.replaceChildren(stage('joey-result-' + outcome, { onDoor: () => leave('#/joey'), kids: [
    h('div.j-result', { 'data-testid': 'result-' + outcome },
      outcome !== 'done' ? h('div.j-mama', { 'aria-hidden': 'true', html: window.MAMA_SVG }) : h('div.j-star', { 'aria-hidden': 'true' }, icon('star')),
      outcome === 'done' ? Progress.receipt(last.reward, CH)
      : outcome === 'pending_parent' ? h('section.reward-receipt', { 'data-testid': 'task-reward-wait', role: 'status' }, h('strong.reward-points', {}, '等妈妈检查'), h('p', {}, '妈妈确认后才会加经验。'))
      : null,
      next ? h('p.j-next', { 'data-testid': 'joey-next-label', role: 'status' }, '下一项是「' + nextLabel + '」') : null,
      h('div.j-act', {},
        outcome === 'help' ? h('button.j-big.primary', { type: 'button', 'aria-label': '接着做', onclick: () => leave('#/joey/task/' + t.id) }, icon('play')) : null,
        next ? h('button.j-big.white', { type: 'button', 'aria-label': '下一项', 'data-testid': 'result-next', onclick: () => leave('#/joey/task/' + next.id) }, icon('chevron'), h('span', {}, '下一项'))
             : h('button.j-big.white', { type: 'button', 'aria-label': '回到门前', 'data-testid': 'result-home', onclick: () => leave('#/joey') }, icon('home'), h('span', {}, '回到门前')))), hear()] }));
  const b = mountGuide(root, v[1] === 'cheer' ? 'happy' : v[1]);
  if (outcome === 'done') { b && setTimeout(() => b.play('cheer'), 100); window.Confetti && Confetti.burst({ count: 70 }); }
  once('r' + t.id + outcome, praise);
}
function bye(root) {
  stopMedia();
  root.replaceChildren(stage('joey-bye', { onDoor: () => App.go('#/joey'), kids: [h('div.j-result', { 'data-testid': 'state-bye' },
    h('div.j-act', {}, h('button.j-big.white', { type: 'button', 'aria-label': '回到门前', onclick: () => App.go('#/joey') }, icon('home')),
      App.multiChild() ? h('button.j-big.white', { type: 'button', 'aria-label': '回到开始', onclick: () => App.go('#/') }, icon('door')) : null)), hear()] }));
  mountGuide(root, 'wave'); once('bye', '今天先到这里，下次见！');
}
function night(root) {
  root.replaceChildren(stage('joey-night', { onDoor: () => App.go('#/joey'), kids: [h('div.j-result.night', { 'data-testid': 'state-night' }, h('div.moon', { 'aria-hidden': 'true' })), hear()] }));
  mountGuide(root, 'idle'); once('night', '该休息啦，明天见！');
}
/* 团团的游戏（v5 三扇门，嵌入模式：无家长设置页、无家长提示单） */
function games(root) {
  stopMedia(); Voice.stop();
  if (pastBoundary()) return night(root);
  const mute = Prefs.get('muteBuddy', false) || C.TEST.noAudio ? '&mute=1' : '';
  const f = h('iframe.j-games', { src: 'games/joey.html?embed=1' + mute, title: '闯关小游戏', allow: 'autoplay' });
  root.replaceChildren(h('main.c-screen.joey.games', { 'data-audience': 'child', 'data-screen': 'joey-games', id: 'main' }, f));
}
window.addEventListener('message', e => {
  if (e.origin !== location.origin || e.source !== document.querySelector('.j-games')?.contentWindow || !location.hash.startsWith('#/joey/games')) return;
  if (e.data?.type === 'xb-games-exit') App.go('#/joey');
  if (e.data?.type === 'xb-games-parent') { window.Gate.grant(); App.go('#/parent'); }
});

let current = null;
function render() {
  document.querySelectorAll('.dlg[data-audience=child]:not([data-active-dialog])').forEach(el=>el.remove());
  if (current) current();
}
window.Joey = {
  route(root, parts) {
    doneDialog?.close(false); doneDialog = null;
    spoken = null;
    const draw = () => parts[0] === 'task' ? task(root, parts[1]) : parts[0] === 'school' ? school(root) : parts[0] === 'games' ? games(root) : parts[0] === 'bye' ? bye(root) : home(root);
    current = () => UI.ChildScroll.paint(draw);
    if (!S._joeySub) S._joeySub = S.on(() => { if (location.hash.startsWith('#/joey') && !location.hash.startsWith('#/joey/games')) render(); });
    current();
  },
  stop(nextHash) {
    stopMedia();
    if (handoff && Date.now() <= handoff.until && nextHash === '#/joey/task/' + handoff.id) return;
    window.SoundFocus?.stopAll(); handoff = null; clearTimeout(readWatch); taskRead = { id: null, state: 'idle', attempt: 0 }; Voice.stop();
  }
};
})();
