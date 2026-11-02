/* 通用 UI 工具：DOM 构造、图标、对话框、提示条（含撤销）、按住按钮、时间、团团、声音 */
(function(){
const C = window.APP_CONFIG;
function h(tag, attrs, ...kids) {
  const [t0, ...cls] = tag.split('.');
  const [t, id] = t0.split('#');
  const e = document.createElement(t || 'div');
  if (id) e.id = id;
  if (cls.length) e.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className += (e.className ? ' ' : '') + v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const P = d => `<path d="${d}"/>`;
const ICONS = {
  back: P('M15 5l-7 7 7 7'), play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  replay: P('M4 12a8 8 0 1 0 2.5-5.8')+P('M4 4v5h5'), check: P('M5 12.5l4.5 4.5L19 7.5'),
  hand: P('M8 13V6.5a1.5 1.5 0 0 1 3 0V12')+P('M11 11V4.5a1.5 1.5 0 0 1 3 0V11')+P('M14 11V5.5a1.5 1.5 0 0 1 3 0V13')+P('M8 13l-1.6-1.8a1.6 1.6 0 0 0-2.4 2.1L8 19c1.2 1.4 2.6 2 4.6 2H13a5 5 0 0 0 5-5v-4.5a1.5 1.5 0 0 0-1-1.4'),
  door: P('M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21')+P('M3 21h18')+'<circle cx="14.5" cy="12.5" r="1.2" fill="currentColor"/>',
  camera: P('M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2L9.3 5h5.4l1.6 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z')+'<circle cx="12" cy="12.8" r="3.4"/>',
  book: P('M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z')+P('M12 6v13.5'),
  ear: P('M4 14v-2a8 8 0 0 1 16 0v2')+'<rect x="3" y="13" width="4.5" height="7" rx="2"/><rect x="16.5" y="13" width="4.5" height="7" rx="2"/>',
  pencil: P('M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z')+P('M13.5 7l3 3'),
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/>'+P('M8 10.5V8a4 4 0 0 1 8 0v2.5'),
  up: P('M6 14l6-6 6 6'), down: P('M6 10l6 6 6-6'), more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor"/>',
  close: P('M6 6l12 12M18 6L6 18'), refresh: P('M20 12a8 8 0 1 1-2.4-5.7')+P('M20 4v5h-5'),
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/>'+P('M3.5 16l5-5 4 4 3-3 5 5')+'<circle cx="15.5" cy="9.5" r="1.5"/>',
  download: P('M12 4v11')+P('M7 10.5l5 5 5-5')+P('M5 20h14'), send: P('M4 12l16-7-6.5 16-2.5-6.5z'),
  undo: P('M9 7L4.5 11.5 9 16')+P('M5 11.5h9a5 5 0 0 1 0 10h-2'), gear: '<circle cx="12" cy="12" r="3"/>'+P('M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1'),
  clock: '<circle cx="12" cy="12" r="8.5"/>'+P('M12 7.5V12l3 2'), heart: P('M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z'),
  plus: P('M12 5v14M5 12h14'), star: P('M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z'),
  home: P('M4 11l8-7 8 7')+P('M6.5 9.5V20h11V9.5'), chevron: P('M9 6l6 6-6 6'), sound: P('M5 9.5h3.5L13 6v12l-4.5-3.5H5z')+P('M16 9a4 4 0 0 1 0 6')+P('M18.5 6.5a7.5 7.5 0 0 1 0 11')
};
const icon = (n, cls = '') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ic ' + cls); s.setAttribute('aria-hidden', 'true');
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2.2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.innerHTML = ICONS[n] || ''; return s; };

/* 按住按钮：ms 毫秒后触发；松开太早 → onShort（例如提示“按住”） */
function holdable(btn, ms, onDone, onShort) {
  let t = null, start = 0, raf = 0, fired = false;
  const ring = btn.querySelector('.hold-ring');
  const set = p => { btn.style.setProperty('--hold', p); };
  const tick = () => { const p = Math.min(1, (performance.now() - start) / ms); set(p); if (p < 1 && t) raf = requestAnimationFrame(tick); };
  const down = e => { if (e.button > 0) return; e.preventDefault(); fired = false; start = performance.now(); btn.classList.add('holding');
    t = setTimeout(() => { fired = true; t = null; btn.classList.remove('holding'); set(0); onDone(); }, ms); raf = requestAnimationFrame(tick); };
  const up = () => { if (!t) return; clearTimeout(t); t = null; cancelAnimationFrame(raf); btn.classList.remove('holding'); set(0); if (!fired && onShort) onShort(); };
  btn.addEventListener('pointerdown', down); ['pointerup', 'pointerleave', 'pointercancel'].forEach(k => btn.addEventListener(k, up));
  btn.addEventListener('contextmenu', e => e.preventDefault());
  /* 键盘可达：按住空格/回车同样计时 */
  btn.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !t && !e.repeat) { e.preventDefault(); down({ button: 0, preventDefault() {} }); } });
  btn.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') up(); });
  btn.addEventListener('click', e => e.preventDefault());
}

/* 对话框（模态，焦点进入，Esc 关闭） */
function dialog({ title, body, actions = [], audience = 'parent', cls = '', onClose, labelledBy }) {
  const prev = document.activeElement;
  const id = 'dlg' + Math.random().toString(36).slice(2, 7);
  const box = h('div.dlg-card', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id + 't' },
    title ? h('h2.dlg-title', { id: id + 't' }, title) : null, body,
    actions.length ? h('div.dlg-actions', {}, actions) : null);
  const wrap = h('div.dlg ' + cls, { 'data-audience': audience }, box);
  wrap.dataset.activeDialog = 'true';
  let closed = false;
  const close = (v) => { if (closed) return; closed = true; delete wrap.dataset.activeDialog; wrap.remove(); document.removeEventListener('keydown', esc); prev && prev.focus && prev.focus({ preventScroll: true }); onClose && onClose(v); };
  const esc = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  document.body.append(wrap);
  setTimeout(() => { const f = box.querySelector('[autofocus],button,input,select,textarea'); f && f.focus(); }, 30);
  return { close, el: wrap, box };
}
function confirmDialog({ title, text, ok = '确定', cancel = '取消', danger = false }) {
  return new Promise(res => {
    let d;
    const okB = h('button.p-btn' + (danger ? '.danger' : '.primary'), { onclick: () => { d.close(true); } }, ok);
    const noB = h('button.p-btn', { onclick: () => d.close(false) }, cancel);
    d = dialog({ title, body: h('p.dlg-text', {}, text), actions: [noB, okB], onClose: v => res(!!v) });
  });
}

/* The dialog only collects text. A send result triggers the existing versioned feedback flow. */
let helpNoteOpen = false;
function helpNoteDialog(previous = '') {
  if (helpNoteOpen) return Promise.resolve(null);
  helpNoteOpen = true;
  return new Promise(resolve => {
    let d, recognition = null, listening = false, closed = false, prefix = '';
    const limit = value => Array.from(value).slice(0, 500).join('');
    const input = h('textarea.p-input', { rows: 4, maxLength: 500, 'aria-label': '需要什么帮助', 'data-testid': 'help-note-input', placeholder: '哪里卡住了？可以打字，也可以直接找妈妈。', style: { width: '100%', fontSize: '20px', lineHeight: '1.5' } });
    input.value = limit(previous);
    const message = h('p', { role: 'status', 'aria-live': 'polite', 'data-testid': 'help-voice-status' });
    const count = h('p', { style: { textAlign: 'right', margin: '6px 0', fontSize: '16px' } });
    const updateCount = () => { count.textContent = Array.from(input.value).length + '/500'; };
    input.oninput = updateCount; updateCount();
    const voice = h('button.c-btn.sun', { type: 'button', 'data-testid': 'help-speak', style: { minHeight: '48px' } }, '说话');
    const stop = () => {
      listening = false; input.readOnly = false;
      if (recognition) { const r = recognition; recognition = null; r.onstart = r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch (_) {} }
    };
    const finish = value => d.close(value);
    const routeClose = () => finish(null);
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    voice.hidden = !Recognition;
    voice.onclick = () => {
      if (listening) { try { recognition.stop(); } catch (_) { stop(); } return; }
      window.Voice && Voice.stop();
      prefix = input.value.trim();
      const fallback = () => { stop(); voice.hidden = true; message.textContent = '这次不能识别语音，可以打字，或直接找妈妈。'; };
      try {
        recognition = new Recognition(); recognition.lang = 'zh-CN'; recognition.continuous = false; recognition.interimResults = true;
        listening = true; input.readOnly = true; voice.textContent = '说完了'; message.textContent = '正在准备，请允许使用麦克风。';
        recognition.onstart = () => { if (!closed) message.textContent = '我在听，说完后点“说完了”。'; };
        recognition.onresult = event => {
          if (closed) return;
          let words = ''; for (let i = 0; i < event.results.length; i++) words += event.results[i][0].transcript;
          input.value = limit((prefix ? prefix + ' ' : '') + words); updateCount();
        };
        recognition.onerror = event => {
          if (closed) return;
          if (event.error === 'no-speech') { message.textContent = '没听清，可以再说一次或打字。'; }
          else fallback();
        };
        recognition.onend = () => { if (!closed) { listening = false; input.readOnly = false; voice.textContent = '说话'; if (input.value.trim()) message.textContent = '请看看文字，确认后发给妈妈。'; } };
        recognition.start();
      } catch (_) { fallback(); }
    };
    const send = h('button.c-btn.primary', { type: 'button', 'data-testid': 'help-send', onclick: () => finish(limit(input.value.trim())) }, '发给妈妈');
    const direct = h('button.c-btn.sun', { type: 'button', 'data-testid': 'help-direct', onclick: () => finish('') }, '不说了，直接找妈妈');
    const cancel = h('button.c-btn', { type: 'button', 'data-testid': 'help-cancel', style: { background: '#edf1ee', color: '#203d32', boxShadow: 'none' }, onclick: () => finish(null) }, '取消');
    d = dialog({ title: '需要什么帮助？', audience: 'child', cls: 'help-note-dialog', body: h('div', {}, input, count, voice, message), actions: [cancel, direct, send], onClose: value => {
      if (closed) return; closed = true; stop(); helpNoteOpen = false; window.removeEventListener('hashchange', routeClose); resolve(typeof value === 'string' ? value : null);
    } });
    d.el.dataset.testid = 'help-note-dialog';
    d.box.style.maxHeight = '90dvh'; d.box.style.overflowY = 'auto';
    window.addEventListener('hashchange', routeClose);
  });
}

/* 提示条：家长端用（撤销按钮）。孩子端不靠 toast 传递重要信息。 */
let toastEl = null, toastT = 0;
function toast(text, { undo, ms = 6000 } = {}) {
  toastEl && toastEl.remove(); clearTimeout(toastT);
  toastEl = h('div.toast', { role: 'status', 'aria-live': 'polite', 'data-audience': 'parent' }, h('span', {}, text),
    undo ? h('button.toast-undo', { onclick: () => { toastEl.remove(); undo(); } }, icon('undo'), '撤销') : null);
  document.body.append(toastEl);
  toastT = setTimeout(() => toastEl && toastEl.remove(), ms);
}

/* 时间：Asia/Shanghai 的 HH:MM；测试可 ?now=HH:MM */
function nowHM() {
  if (C.TEST.now) return C.TEST.now;
  return new Intl.DateTimeFormat('en-GB', { timeZone: C.TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}
const pastBoundary = () => !!C.EVENING_BOUNDARY && nowHM() >= C.EVENING_BOUNDARY;

/* 家长偏好（本设备；不是服务器数据） */
const Prefs = {
  get(k, d) { try { const v = localStorage.getItem('xb.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('xb.' + k, JSON.stringify(v)); } catch (e) {} }
};

/* 团团：可隐藏（家长设置） */
function mascot(host, state = 'idle') {
  if (Prefs.get('hideBuddy', false)) { host.classList.add('buddy-hidden'); return null; }
  try { const t = new Tuan(host, { state }); t.setLevelSource && t.setLevelSource(() => Voice.level()); return t; } catch (e) { return null; }
}
/* 说话：遵守“静音”设置与 ?mute=1；不在媒体播放中插话（调用方负责） */
function say(text, buddy, onend, options) {
  if (Prefs.get('muteBuddy', false) || C.TEST.noAudio) { onend && setTimeout(onend, 50); return; }
  buddy && buddy.talk && buddy.talk(true);
  Voice.play(text, () => { buddy && buddy.talk && buddy.talk(false); onend && onend(); }, options);
}

const KIND = {
  paper: { child: '写一写', parent: '纸笔', icon: 'pencil', hue: 'count' },
  audio: { child: '听一听', parent: '听力', icon: 'ear', hue: 'pinyin' },
  reading: { child: '读一读', parent: '阅读', icon: 'book', hue: 'story' },
  legacy: { child: '做一做', parent: '旧任务（类型待核对）', icon: 'star', hue: 'sun' }
};
const kindOf = t => KIND[t.task_kind] || KIND.legacy;

window.UI = { h, icon, holdable, dialog, confirmDialog, helpNoteDialog, toast, nowHM, pastBoundary, Prefs, mascot, say, KIND, kindOf };
})();

/* Child routes keep independent positions by child, selected date and route.
   Parent rendering keeps its own existing keepY implementation. */
(function(){
 const saved = new Map(); let active = null, restoring = false, revision = 0;
 const key = () => {
  const hash = location.hash || '#/', child = /^#\/jared(?:\/|$)/.test(hash) ? 'child_a' : /^#\/joey(?:\/|$)/.test(hash) ? 'child_b' : null;
  return child ? hash + '|' + window.Store.sel(child, 'child').day : null;
 };
 const snapshot = () => ({ y:window.scrollY, details:[...document.querySelectorAll('#app details')].map(el=>el.open) });
 const waiting = () => !!document.querySelector('#app [data-screen$="-loading"],#app [data-screen$="-error"]');
 const remember = () => { if(active && active===key() && !restoring && !waiting()) saved.set(active,snapshot()); };
 function restore(value, token) {
  if(token!==revision || active!==key())return;
  [...document.querySelectorAll('#app details')].forEach((el,i)=>{if(i<value.details.length)el.open=value.details[i];});
  window.scrollTo({top:value.y,left:0,behavior:'instant'});
 }
 function paint(draw) {
  const next=key();if(!next)return draw();
  if(active===next)remember();
  active=next;
  const value=saved.get(next)||{y:0,details:[]};saved.set(next,value);
  restoring=true;const token=++revision;
  try {draw();} finally {
   restore(value,token);
   requestAnimationFrame(()=>{restore(value,token);requestAnimationFrame(()=>{restore(value,token);if(token===revision)restoring=false;});});
  }
 }
 window.addEventListener('scroll',remember,{passive:true});
 // Media/portrait loads may resize a restored list after its first paint.
 document.addEventListener('load',e=>{if(active===key()&&e.target.closest?.('#app')&&saved.has(active))restore(saved.get(active),revision);},true);
 window.UI.ChildScroll={remember,paint};
})();
