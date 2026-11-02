/* 作业照片：草稿与已存照片均可删换；确认后锁定；提交前读回核对。 */
(function(){
const { h, icon } = window.UI;
const { PhotoAdapter, DraftStore, uuid } = window.API;
const hex = buf => Array.from(new Uint8Array(buf), x => x.toString(16).padStart(2, '0')).join('');

async function normalize(file) {
  if (file.size > 8 * 1024 * 1024) throw new Error('too_big');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const cv = document.createElement('canvas'); let out;
  for (const [edge, q] of [[1600, .84], [1400, .74], [1100, .7]]) {
    const s = Math.min(1, edge / Math.max(bmp.width, bmp.height));
    cv.width = Math.max(1, Math.round(bmp.width * s)); cv.height = Math.max(1, Math.round(bmp.height * s));
    const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.drawImage(bmp, 0, 0, cv.width, cv.height);
    out = await new Promise(r => cv.toBlob(r, 'image/jpeg', q));
    if (out && out.size <= 768 * 1024) break;
  }
  bmp.close && bmp.close();
  if (!out || out.size > 768 * 1024) throw new Error('too_big');
  const bytes = await out.arrayBuffer();
  return { id: uuid(), blob: out, url: URL.createObjectURL(out), size: out.size, sha256: await window.XBDigest.sha256(new Uint8Array(bytes)), removed: false };
}

function openPhotoSheet(task, { onClose, onSubmit, readOnly = false } = {}) {
  const sel = { day: task.day, child_id: task.child_id };
  const lan = window.APP_CONFIG.TRANSPORT === 'lan';
  let pack = null, busy = false, note = '', replacing = null, closed = false;
  const file = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, 'data-testid': 'photo-input' });
  const body = h('div.ps-body');
  const status = h('p.ps-status', { role: 'status', 'aria-live': 'polite', 'data-testid': 'photo-status' });
  const sendBtn = h('button.c-btn.primary.wide', { type: 'button', 'data-testid': 'photo-send' });
  const closeBtn = h('button.c-btn.ghost.wide', { type: 'button', 'data-testid': 'photo-close' }, '返回');
  const shoot = h('button.c-btn.camera', { type: 'button', 'data-testid': 'photo-shoot' }, icon('camera'), '拍照／再加一张');
  const album = h('button.c-btn.sun.wide', { type: 'button', 'data-testid': 'photo-album' }, icon('image'), '从相册选');
  const layer = h('div.ps', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ps-t', 'data-audience': 'child' },
    h('div.ps-card', {}, h('h2#ps-t.ps-title', {}, '作业照片'), shoot, album, file, body, status, h('div.ps-actions', {}, sendBtn, closeBtn)));
  const drafts = () => DraftStore.read(sel, task.id).filter(x => !x.removed);
  const locked = () => readOnly || pack?.editable === false || task.status === 'done';
  const message = r => r?.status === 409 ? '照片或任务已更新，请返回后重新打开核对。'
    : r?.error === 'photo_locked' ? '妈妈已经确认，照片不能再改了。' : '还没存上，请再试一次。';
  function accept(p) {
    pack = p;
    // Callers waiting on the photo gate must use the new version when submitting.
    if (Number.isInteger(p.task_version)) task.version = p.task_version;
    if (p.task_status) task.status = p.task_status;
  }
  function render() {
    const live = readOnly ? [] : drafts(), saved = pack?.photos || [];
    body.replaceChildren(...[
      live.length ? h('section.ps-sec', { 'data-testid': 'photo-drafts' }, h('h3', {}, '待提交'),
        h('div.ps-grid', {}, ...live.map(im => h('figure.ps-ph.draft', {}, h('img', { src: im.url, alt: im.replace ? '待替换照片' : '待提交照片' }),
          h('figcaption', {},
            h('button.c-mini', { type: 'button', disabled: busy || locked(), onclick: () => { replacing = { draft: im }; file.removeAttribute('capture'); file.click(); } }, '重拍／换一张'),
            h('button.c-mini', { type: 'button', disabled: busy || locked(), onclick: () => { DraftStore.drop(sel, task.id, im.id); URL.revokeObjectURL(im.url); render(); } }, '删除')))))) : null,
      saved.length ? h('section.ps-sec', { 'data-testid': 'photo-saved' }, h('h3', {}, readOnly ? '作业照片（回看）' : locked() ? '妈妈已确认' : '已存照片'),
        h('div.ps-grid', {}, ...saved.map(p => h('figure.ps-ph.saved', {}, h('img', { src: p.url, alt: '作业照片' }),
          lan && !locked() ? h('figcaption', {},
            h('button.c-mini', { type: 'button', disabled: busy || live.some(x => x.replace === p.id), onclick: () => { replacing = { saved: p }; file.removeAttribute('capture'); file.click(); } }, '重拍／换一张'),
            h('button.c-mini', { type: 'button', disabled: busy || live.some(x => x.replace === p.id), onclick: () => remove(p) }, '删除')) : null)))) : null,
      pack === null ? h('p', {}, '正在读取照片…') : !live.length && !saved.length ? h('p', {}, readOnly ? '这项作业没有存下的照片。' : '还没有照片，先拍一张。') : null].filter(Boolean));
    sendBtn.textContent = busy ? '正在保存…' : onSubmit ? '提交' : '保存照片';
    sendBtn.hidden = locked(); shoot.hidden = locked(); album.hidden = locked() || !needsHomeworkPhoto(task);
    sendBtn.disabled = busy || !pack || (!live.length && (!onSubmit || !saved.length));
    shoot.disabled = album.disabled = busy || !pack; closeBtn.disabled = busy;
    status.textContent = note || (readOnly ? '历史照片，只回看。' : locked() ? '妈妈已确认，照片已锁定。' : '可以删换照片，核对后点提交。');
  }
  async function refresh() {
    const r = await PhotoAdapter.list('child', sel, task.id);
    if (!r.ok) throw new Error('read_failed');
    accept(r.data); render();
  }
  async function syncTask() { if (lan) await window.Store.load('child', task.child_id); }
  async function remove(p) {
    if (busy || locked()) return;
    busy = true; note = '正在删除…'; render();
    try {
      const r = await PhotoAdapter.remove({ ...sel, task_id: task.id, photo_id: p.id, expected_revision: pack.revision });
      if (!r.ok) { note = message(r); return; }
      accept(r.data); await refresh();
      if (pack.photos.some(x => x.id === p.id)) throw new Error('readback_failed');
      await syncTask(); note = '已删除。修改后请重新提交。';
    } catch (_) { note = '还没确认删除成功，请返回后重新打开核对。'; }
    finally { busy = false; render(); }
  }
  file.onchange = async () => {
    const f = file.files[0], target = replacing; file.value = ''; replacing = null;
    if (!f || busy || locked()) return;
    busy = true; render();
    try {
      const im = await normalize(f);
      if (target?.saved) { im.replace = target.saved.id; im.expected_sha = target.saved.sha256; }
      if (target?.draft) {
        im.replace = target.draft.replace; im.expected_sha = target.draft.expected_sha;
        DraftStore.replace(sel, task.id, target.draft.id, im); URL.revokeObjectURL(target.draft.url);
      } else DraftStore.add(sel, task.id, im);
      note = '照片准备好了，点提交。';
    } catch (_) { note = '这张没读好，请再选一张。'; }
    finally { busy = false; render(); }
  };
  album.onclick = () => { if (busy || locked() || !pack) return; replacing = null; file.removeAttribute('capture'); file.click(); };
  shoot.onclick = () => { replacing = null; file.setAttribute('capture', 'environment'); file.click(); };
  sendBtn.onclick = async () => {
    if (busy || locked()) return;
    busy = true; note = '正在保存照片…'; render();
    try {
      const live = drafts();
      for (const im of live) {
        const edit = im.replace ? { replace: im.replace, expected_revision: pack.revision } : {};
        // A replacement is tied to the image actually previewed, never silently rebased.
        if (im.replace && !pack.photos.some(p => p.id === im.replace && p.sha256 === im.expected_sha) && !pack.photos.some(p => p.id === im.id && p.sha256 === im.sha256)) {
          note = '原照片已经更新，请返回后重新核对。'; return;
        }
        const r = await PhotoAdapter.upload(sel, task.id, im.id, im.blob, edit);
        if (!r.ok || r.data?.photo?.sha256 !== im.sha256) { note = message(r); return; }
        if (r.data.pack) accept(r.data.pack);
        await refresh();
        if (!pack.photos.some(p => p.id === im.id && p.sha256 === im.sha256)) throw new Error('readback_failed');
        DraftStore.drop(sel, task.id, im.id); URL.revokeObjectURL(im.url);
      }
      await refresh(); await syncTask();
      if (!pack.photos.length) { note = '请先拍一张作业照片。'; return; }
      if (locked()) { note = '妈妈已确认，照片已锁定。'; return; }
      if (onSubmit) {
        const r = await onSubmit(pack);
        if (r?.result !== 'saved') { note = '还没提交成功，请返回核对后再试。'; return; }
        busy = false; close();
      } else { note = '照片已保存，可以返回点完成。'; }
    } catch (_) { note = '还没确认存好，请再试一次。'; }
    finally { busy = false; if (!closed) render(); }
  };
  const prev = document.activeElement;
  const close = () => {
    if (busy || closed) return;
    closed = true; layer.remove(); document.removeEventListener('keydown', esc);
    prev?.focus?.(); onClose?.();
    window.Store.emit();
  };
  const esc = e => { if (e.key === 'Escape') close(); };
  closeBtn.onclick = close; document.addEventListener('keydown', esc);
  document.body.append(layer); render();
  refresh().catch(() => { note = '照片没读出来，请返回后再试。'; render(); });
  return close;
}
async function countUploaded(task) {
  const r = await PhotoAdapter.list('child', { day: task.day, child_id: task.child_id }, task.id);
  if (!r.ok || !r.data || !Array.isArray(r.data.photos)) return 0;
  return r.data.photos.length;
}
function needsHomeworkPhoto(task) {
  return task && task.child_id === 'child_a' && ['paper', 'legacy'].includes(task.task_kind);
}
/** 纸笔完成前：至少 1 张已上传照片。缺照片则引导去拍。返回是否可继续完成。 */
async function requireBeforeDone(task) {
  if (!needsHomeworkPhoto(task)) return true;
  if (await countUploaded(task) >= 1) return true;
  return new Promise(resolve => {
    let settled = false;
    const finish = ok => { if (settled) return; settled = true; resolve(!!ok); };
    let d;
    const go = h('button.c-btn.primary.wide', { type: 'button', 'data-testid': 'photo-need-shoot', style: { minHeight: '72px', fontSize: '24px' }, onclick: () => {
      d.close('shoot');
    } }, icon('camera'), '去拍照');
    const cancel = h('button.c-btn.ghost.wide', { type: 'button', 'data-testid': 'photo-need-cancel', style: { minHeight: '56px' }, onclick: () => d.close(false) }, '先不交');
    d = window.UI.dialog({
      title: '先拍一张给妈妈看',
      audience: 'child',
      cls: 'photo-need-dialog',
      body: h('div', {},
        h('p', { style: { fontSize: '20px', textAlign: 'center', margin: '8px 0 16px' } }, '纸笔作业要先拍照，妈妈才能检查。'),
        go, h('div', { style: { height: '10px' } }), cancel),
      actions: [],
      onClose: async v => {
        if (v !== 'shoot') return finish(false);
        openPhotoSheet(task, { onClose: async () => finish(await countUploaded(task) >= 1) });
      }
    });
    try { window.Voice && Voice.play('先拍一张给妈妈看。', null, { gesture: true, ignoreMuted: true }); } catch (_) {}
  });
}
window.Photos = { openPhotoSheet, normalize, needsHomeworkPhoto, countUploaded, requireBeforeDone };
})();
