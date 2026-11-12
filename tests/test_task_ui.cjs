// Source-level UI behavior checks with synthetic nodes, not browser/layout acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Node {
  constructor(selector = 'div', attrs = {}, children = []) {
    this.tagName = (selector.match(/^[\w-]+/) || ['div'])[0].toUpperCase();
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.disabled = false;
    this.checked = false;
    this.readOnly = false;
    this.className = (selector.match(/\.[\w-]+/g) || []).map(s => s.slice(1)).join(' ');
    const id = selector.match(/#([\w-]+)/);
    if (id) this.attrs.id = id[1];
    this.classList = { add: (...names) => { this.className += ' ' + names.join(' '); }, contains: name => this.className.split(/\s+/).includes(name) };
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key.startsWith('on')) this[key] = value;
      else if (key === 'style') Object.assign(this.style, value);
      else if (value != null) this.setAttribute(key, value);
    }
    this.append(...children);
  }
  setAttribute(key, value) {
    this.attrs[key] = value;
    if (key === 'class') this.className += ' ' + value;
    else if (key === 'value') this._value = String(value);
    else if (key === 'readonly') this.readOnly = !!value;
    else if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    else if (['disabled', 'checked', 'selected', 'hidden', 'open'].includes(key)) this[key] = !!value;
    else this[key] = value;
  }
  getAttribute(key) { return this.attrs[key]; }
  removeAttribute(key) { delete this.attrs[key]; }
  append(...children) {
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      if (child instanceof Node) child.parentNode = this;
      this.children.push(child instanceof Node ? child : String(child));
    }
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); this.parentNode = null; }
  addEventListener(type, callback) { this['on' + type] = callback; }
  pause() { this.pauseCount = (this.pauseCount || 0) + 1; }
  focus() {}
  checkValidity() { return true; }
  get isConnected() { return !!this.parentNode; }
  get textContent() { return this.children.map(x => x instanceof Node ? x.textContent : x).join(''); }
  set textContent(value) { this.children = [String(value)]; }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === 'SELECT') return (this.children.find(x => x.selected) || this.children[0])?.value || '';
    return this.tagName === 'TEXTAREA' ? this.textContent : '';
  }
  set value(value) { this._value = String(value); }
  get selectedOptions() { return this.children.filter(x => x.value === this.value); }
  get elements() {
    return new Proxy({}, { get: (_, name) => {
      const nodes = this.querySelectorAll('[name=' + name + ']');
      return nodes.find(n => n.checked) || nodes[0];
    } });
  }
  matches(selector) {
    if (selector.includes(',')) return selector.split(',').some(s => this.matches(s.trim()));
    const parts = selector.trim().split(/\s+(?![^\[]*\])/);
    if (parts.length > 1) {
      if (!this.matches(parts.pop())) return false;
      for (let parent = this.parentNode; parent; parent = parent.parentNode) if (parent.matches(parts.join(' '))) return true;
      return false;
    }
    const negative = selector.match(/:not\(([^)]+)\)/);
    if (negative && this.matches(negative[1])) return false;
    selector = selector.replace(/:not\([^)]+\)/g, '');
    const attributes = [...selector.matchAll(/\[([^=\]]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g)];
    if (!attributes.every(([, name, a, b, c]) => {
      const expected = a ?? b ?? c;
      return expected === undefined ? this.attrs[name] !== undefined : String(this.attrs[name]) === expected;
    })) return false;
    const rest = selector.replace(/\[[^\]]+\]/g, '');
    const tag = rest.match(/^[\w-]+/);
    if (tag && this.tagName !== tag[0].toUpperCase()) return false;
    const id = rest.match(/#([\w-]+)/);
    if (id && this.attrs.id !== id[1]) return false;
    return (rest.match(/\.[\w-]+/g) || []).every(c => this.classList.contains(c.slice(1)));
  }
  querySelectorAll(selector) {
    const found = [];
    for (const child of this.children) if (child instanceof Node) {
      if (child.matches(selector)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  click() { return !this.disabled && this.onclick ? this.onclick({ currentTarget: this, target: this, preventDefault() {} }) : undefined; }
  chooseChecked(value) { if (!this.disabled) { this.checked = value; this.onchange?.({ target: this }); } }
}

const today = '2026-11-12';
const task = (extra = {}) => ({ id: 'synthetic-portion', child_id: 'child_a', day: today, planned_day: today, work_type: 'weekly', title: '合成练习', first_step: '', task_kind: 'reading', assignment_state: 'verified', status: 'todo', version: 1, materials: [], ...extra });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const byTestId = (root, id) => root.querySelector('[data-testid=' + id + ']');

function fixture(tasks = []) {
  const h = (selector, attrs, ...children) => new Node(selector, attrs, children);
  const document = new Node('document'), root = h('div');
  document.append(root);
  const dialogs = [], opened = [], players = [], retries = [], feedbacks = [], toasts = [];
  const pending = {};
  const state = child => ({ status: 'ok', tasks: tasks.filter(t => t.child_id === child), week: [], groups: [] });
  const Store = {
    pending,
    get: (_, child) => state(child),
    sel: child => ({ day: today, child_id: child }),
    find: (_, child, id) => tasks.find(t => t.child_id === child && t.id === id),
    load: async () => {}, on: () => true,
    pendingFor: key => pending[key],
    retry: async key => {
      const op = pending[key];
      assert.ok(op, 'retry must refer to an existing pending operation');
      retries.push({ key, operation_id: op.body.operation_id });
      Object.assign(tasks.find(t => t.id === op.body.task_id), { status: op.body.status });
      delete pending[key];
      return { result: 'saved' };
    },
    feedback: async (role, t, status, extra) => { feedbacks.push({ role, id: t.id, status, extra }); t.status = status; return { result: 'saved' }; }
  };
  const KIND = Object.fromEntries(['reading', 'audio', 'paper', 'legacy'].map(k => [k, { parent: k, child: k, hue: 'green', icon: 'book' }]));
  const window = {
    Store,
    APP_CONFIG: { TRANSPORT: 'lan', today: () => today, CHILDREN: { child_a: { name: 'Jared' }, child_b: { name: 'Joey' } }, TIMEZONE: 'Asia/Shanghai', TEST: {} },
    location: { hash: '', origin: 'http://synthetic.local' },
    scrollY: 0, scrollTo() {}, addEventListener() {},
    API: { PhotoAdapter: { list: async () => ({ ok: true, data: { photos: [] } }) }, uuid: () => 'synthetic-id' },
    UI: {
      h, icon: name => h('i', { 'data-icon': name }), KIND,
      kindOf: t => KIND[t.task_kind] || KIND.legacy,
      Prefs: { get: (_, fallback) => fallback, set() {} },
      pastBoundary: () => false, ChildScroll: { paint: draw => draw() },
      mascot: () => null, say() {}, toast: message => toasts.push(message),
      dialog: options => {
        const el = h('div.dlg', { 'data-audience': options.audience || 'parent' }, options.body, ...(options.actions || []));
        document.append(el);
        const d = { ...options, el, closed: false, close: value => { d.closed = true; el.remove(); options.onClose?.(value); } };
        dialogs.push(d); return d;
      }
    },
    Media: {
      isImageUrl: url => /\.(png|jpg)$/.test(url),
      AudioPlayer: url => { const p = { url, stops: 0, el: h('audio', { src: url }), stop() { this.stops++; } }; players.push(p); return p; },
      openMaterial: (url, title, opts) => opened.push({ url, title, opts })
    },
    Gate: { lockButton: () => null },
    Voice: { stop() {}, play() {} },
    Progress: { homeBuddy: () => null, receipt: () => null },
    Pledge: { entry: () => null },
    App: { go: hash => { window.location.hash = hash; }, multiChild: () => true }
  };
  window.window = window;
  const ctx = vm.createContext({ ...window, window, document, console, URLSearchParams, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame() {}, localStorage: { getItem: () => null, setItem() {} } });
  const load = name => { vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/ui/' + name + '.js'), 'utf8'), ctx, { filename: name + '.js' }); };
  load('task-planning');
  const route = (name, id) => {
    load(name);
    window.location.hash = '#/' + name.replace('child-', '') + (id ? '/task/' + id : '');
    if (name === 'parent') window.Parent.route(root);
    else window[name === 'child-jared' ? 'Jared' : 'Joey'].route(root, id ? ['task', id] : []);
  };
  return { window, document, root, dialogs, opened, players, Store, pending, retries, feedbacks, toasts, load, route };
}

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
  assert.match(summary.textContent,/01\/05–01\/10 · 周六 13:00 前交/);
  assert.match(summary.textContent,/已完成 1 项 · 还剩 1 项 · 待家长检查 1 项/);
  assert.equal(f.window.TaskPlanning.weekSummary(items,'2026-01-11'),null);
});

test('Joey weekly tasks never inherit stale carry labels', () => {
 const f=fixture([task({child_id:'child_b',carried_over:true})]);
 f.route('child-joey');
 assert.doesNotMatch(f.root.textContent,/顺延/);
});
