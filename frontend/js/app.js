/* 路由（hash，file:// 可用）。每个画面根元素都带 data-audience="child|parent" 与 data-screen，供受众审查脚本使用。
   #/            孩子选择（对标 Duolingo ABC「Who's Learning?」）；始终并排显示 Jared 与 Joey，不因设备设置跳转
   #/jared...    Jared 孩子端      #/joey...  Joey 孩子端      #/parent  家长区（必须先过家长门） */
(function(){
const { h } = window.UI;
const C = window.APP_CONFIG;
const root = document.getElementById('app');
const blockZoom = e => { if (e.cancelable) e.preventDefault(); };
['gesturestart', 'gesturechange'].forEach(type => document.addEventListener(type, blockZoom, { passive: false }));
document.addEventListener('touchmove', e => { if (e.touches.length > 1) blockZoom(e); }, { passive: false });

const modeNotice = h('div', { 'data-testid': 'storage-mode', role: 'note', style: { padding: '8px 12px', textAlign: 'center', background: C.TRANSPORT === 'lan' ? '#e5f1e9' : '#fff2d7', color: '#243c32', fontSize: '13px' } },
  C.TRANSPORT === 'lan' ? '家里共享 · 任务保存在 Mac' : '本机模式 · 仅此浏览器，不与其他设备同步');
root.before(modeNotice);
const routeOf = id => (C.CHILDREN[id].mode === 'voice' ? '#/joey' : '#/jared');
let lastArea = null;
const App = window.App = {
  go(hash) { UI.ChildScroll.remember(); if (location.hash === hash) route(); else location.hash = hash; },
  multiChild: () => true,
};
function launcher() {
  root.replaceChildren(h('main.c-screen.launch', { 'data-audience': 'child', 'data-screen': 'launcher', id: 'main' },
    h('header.c-top', {}, h('span'), h('div.c-top-r', {}, window.Gate.lockButton(() => App.go('#/parent')))),
    h('h1.launch-h', {}, '谁来？'),
    h('div.launch-grid', {}, ...Object.entries(C.CHILDREN).map(([id, c]) => h('button.launch-card.' + id, { type: 'button', 'data-testid': 'pick-' + id, onclick: () => { window.Voice && Voice.unlock(); App.go(routeOf(id)); } },
      h('span.launch-face', { 'aria-hidden': 'true' }, c.avatar), h('span.launch-name', {}, c.name))))));
}
function route() {
  if (window.SharedConnection && SharedConnection.blocked()) return SharedConnection.render(root);
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const area = parts[0] || 'launch';
  if ('scrollRestoration' in history) history.scrollRestoration = ['jared','joey'].includes(area) ? 'manual' : 'auto';
  window.Jared && Jared.stop(); window.Joey && Joey.stop(hash);
  document.querySelectorAll('.dlg,.mat,.ps').forEach(x => x.remove());
  if (area !== 'parent' && lastArea === 'parent') { for (const k of Object.keys(window.Store.tasks)) if (k.startsWith('child:')) window.Store.tasks[k] = { status: 'idle', tasks: [] }; }
  lastArea = area;
  document.body.dataset.area = area;
  if (area === 'parent') {
    if (!window.Gate.open()) { location.replace('#/'); return; }
    return window.Parent.route(root);
  }
  if (area === 'jared') return Jared.route(root, parts.slice(1));
  if (area === 'joey') return Joey.route(root, parts.slice(1));
  return launcher();
}
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (document.hidden) { window.Voice && Voice.stop(); window.Jared && Jared.stop(); window.Joey && Joey.stop(); } });
route();
})();
