/* 孩子端媒体：稳定的播放控件 + 材料阅读层 */
(function(){
const { h, icon } = window.UI;
const fmt = s => !isFinite(s) ? '--:--' : Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

/* 播放控件：位置固定；播放/暂停/继续同一个按钮，“从头”单独一个；进度跟随媒体时间；连点不叠播（单一 audio 元素）。
   没有 url → 不渲染空播放器，由调用方显示“声音还没准备好”。 */
function AudioPlayer(url, { big = false, onPlay } = {}) {
  const a = new Audio(); a.preload = 'metadata'; a.src = url;
  const soundOwner = window.SoundFocus?.trackMedia(a);
  const play = () => { window.SoundFocus?.claim(soundOwner); a.play().catch(() => { err.hidden = false; }); };
  const lbl = h('span.ap-label');
  const main = h('button.ap-main' + (big ? '.big' : ''), { type: 'button', 'data-testid': 'ap-main' });
  const again = h('button.ap-again', { type: 'button', 'data-testid': 'ap-again', 'aria-label': '从头再听' }, icon('replay'), big ? null : h('span', {}, '从头'));
  const bar = h('div.ap-bar', { role: 'progressbar', 'aria-label': '听到哪里了', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, h('i'));
  const time = h('span.ap-time', { 'aria-hidden': 'true' }, '0:00 / --:--');
  const err = h('p.ap-err', { hidden: true }, '声音打不开。可以点“需要帮助”。');
  let started = false;
  const paint = () => {
    const playing = !a.paused && !a.ended;
    main.replaceChildren(icon(playing ? 'pause' : 'play'), big ? '' : h('span', {}, playing ? '暂停' : (started && !a.ended ? '继续' : '播放')));
    main.setAttribute('aria-label', playing ? '暂停' : (started && !a.ended ? '继续播放' : '播放'));
    main.classList.toggle('on', playing);
    const p = a.duration ? a.currentTime / a.duration * 100 : 0;
    bar.firstChild.style.width = p + '%'; bar.setAttribute('aria-valuenow', Math.round(p));
    time.textContent = fmt(a.currentTime) + ' / ' + fmt(a.duration);
  };
  main.onclick = () => { if (a.paused || a.ended) { if (a.ended) a.currentTime = 0; window.Voice && Voice.stop(); onPlay && onPlay(); play(); started = true; } else a.pause(); };
  again.onclick = () => { window.Voice && Voice.stop(); a.currentTime = 0; started = true; play(); };
  ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata'].forEach(k => a.addEventListener(k, paint));
  a.addEventListener('error', () => { err.hidden = false; main.disabled = again.disabled = true; });
  paint();
  const el = h('div.ap' + (big ? '.ap-big' : ''), { 'data-testid': 'audio-player' }, h('div.ap-row', {}, main, again), h('div.ap-track', {}, bar, time), err);
  return { el, stop() { a.pause(); }, audio: a };
}

/* 材料层：全屏，顶部固定“回到任务”；html 用无脚本沙箱 iframe，图片可放大 */
function openMaterial(url, title, { audience = 'child', backLabel = '回到任务' } = {}) {
  const prev = document.activeElement, returnY = window.scrollY;
  const returnHash = location.hash;
  const isImg = isImageUrl(url);
  // 外部作业网站需要自身脚本和提交能力，使用独立标签，不嵌入禁用脚本的材料框。
  let external = false, joywing = false;
  try { const target = new URL(url, location.href); external = /^https?:$/.test(target.protocol) && target.origin !== location.origin; joywing = target.origin === location.origin && /^\/assets\/pu4-jessica\/reading\/test[1-4]\.html$/.test(target.pathname); } catch (_) {}
  const view = external && !isImg ? h('section', { style: { padding: '24px', textAlign: 'center' } },
    h('p', {}, '请在原网站完成作业与提交，完成后回到小步。'),
    h('a.c-btn.primary', { href: url, target: '_blank', rel: 'noopener noreferrer', 'data-testid': 'external-material' }, '打开作业网站'))
    : isImg ? h('div.mat-img', {}, h('img', { src: url, alt: title || '学习材料' }))
                     : h('iframe.mat-frame', { src: url, title: title || '学习材料', sandbox: 'allow-popups allow-popups-to-escape-sandbox' });
  const back = h('button.mat-back', { type: 'button', 'data-testid': 'material-back' }, icon('back'), backLabel);
  // This link belongs to the top document, outside the sandboxed material iframe.
  const homeworkLink = joywing ? h('a.c-btn.primary', {
    href: 'https://www.joywingenglish.cn/index.html', target: '_blank', rel: 'noopener noreferrer',
    'data-testid': 'joywing-homework-link', style: { minHeight: '48px', padding: '12px 16px', fontSize: '18px', textDecoration: 'none' }
  }, '去乐翼网站做题') : null;
  const top = h('div.mat-top', joywing ? { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } } : {}, back, homeworkLink);
  const layer = h('div.mat', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '学习材料', 'data-audience': audience }, top, view);
  const close = () => { layer.remove(); document.removeEventListener('keydown', esc); prev && prev.focus && prev.focus({ preventScroll: true }); if (location.hash === returnHash) { window.scrollTo(0, returnY); requestAnimationFrame(() => { if(location.hash === returnHash) window.scrollTo(0, returnY); }); } };
  const esc = e => { if (e.key === 'Escape') close(); };
  back.onclick = close; document.addEventListener('keydown', esc);
  document.body.append(layer); back.focus({ preventScroll: true });
  return close;
}
const isImageUrl = u => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u) || /^data:image/.test(u);
window.Media = { AudioPlayer, openMaterial, isImageUrl };
})();
