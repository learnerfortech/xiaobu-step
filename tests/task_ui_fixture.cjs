// Source-level UI behavior checks with synthetic nodes, not browser/layout acceptance.
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

// Only the successful text/select/check controls used by the production forms.
// This is a data fixture, not a browser implementation or layout assertion.
class FormDataFixture {
  constructor(form) {
    this.items = form.querySelectorAll('input[name],select[name],textarea[name]')
      .filter(node => !node.disabled && (!['radio', 'checkbox'].includes(node.type) || node.checked))
      .map(node => [node.name, node.value]);
  }
  entries() { return this.items[Symbol.iterator](); }
  [Symbol.iterator]() { return this.entries(); }
  get(name) { return this.items.find(item => item[0] === name)?.[1] ?? null; }
}

function fixture(tasks = []) {
  const h = (selector, attrs, ...children) => new Node(selector, attrs, children);
  const document = new Node('document'), root = h('div');
  document.append(root);
  const dialogs = [], opened = [], players = [], retries = [], feedbacks = [], toasts = [];
  const pending = {};
  const state = child => ({ status: 'ok', day: today, tasks: tasks.filter(t => t.child_id === child), week: [], groups: [] });
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
  const ctx = vm.createContext({ ...window, window, document, console, URLSearchParams, FormData: FormDataFixture, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame() {}, localStorage: { getItem: () => null, setItem() {} } });
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


module.exports = { fixture, task, byTestId, deferred, Node, today };
