/* 同源家里任务 API；不调用云端，不回退为浏览器保存成功。含纸笔作业照片。 */
(function () {
const TASK_PATH = /^\/lan\/family\/(parent|child)\/(tasks|task|create|update|delete|assign|feedback)$/;
const PHOTO_PATH = /^\/lan\/family\/(parent|child)\/(photos|photos\/zip|photos\/sent|photos\/delete|photo-library|photo)$/;

window.lanTransport = async (url, options = {}) => {
  const reply = (error, status) => new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });
  const target = new URL(url, location.href);
  if (target.origin !== location.origin) return reply('operation_not_available', 405);
  const isTask = TASK_PATH.test(target.pathname);
  const isPhoto = PHOTO_PATH.test(target.pathname);
  if (!isTask && !isPhoto) return reply('operation_not_available', 405);

  const method = (options.method || 'GET').toUpperCase();
  const controller = new AbortController();
  const timeout = isPhoto && method === 'POST' && options.body && !(typeof options.body === 'string')
    ? Math.max(window.APP_CONFIG.HTTP_TIMEOUT_MS || 8000, 30000)
    : (window.APP_CONFIG.HTTP_TIMEOUT_MS || 8000);
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(target.href, { ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
    const ctype = r.headers.get('Content-Type') || '';

    // Binary pass-through (zip). Photo file URLs are loaded via <img>, not this transport.
    if (isPhoto && target.pathname.endsWith('/photos/zip')) {
      if (r.status !== 200) {
        let err = 'invalid_backend_response';
        try { if (ctype.includes('application/json')) err = (await r.json()).error || err; } catch (_) {}
        return reply(err, r.status || 503);
      }
      return new Response(await r.blob(), { status: 200, headers: { 'Content-Type': ctype || 'application/zip' } });
    }

    if (!ctype.includes('application/json')) return reply('invalid_backend_response', 503);
    const data = await r.json();

    if (r.status === 200 && isTask) {
      const selected = method === 'GET'
        ? { day: target.searchParams.get('day'), child_id: target.searchParams.get('child') }
        : JSON.parse(options.body);
      if (data.dataset !== 'lan' || data.day !== selected.day || data.child_id !== selected.child_id || !Array.isArray(data.tasks)
        || data.tasks.some(t => t.day !== selected.day || t.child_id !== selected.child_id)) {
        return reply('backend_scope_mismatch', 502);
      }
    }

    if (r.status === 200 && isPhoto && target.pathname.endsWith('/photos') && method === 'GET') {
      const day = target.searchParams.get('day');
      const child = target.searchParams.get('child');
      const task = target.searchParams.get('task');
      if (data.day !== day || data.child_id !== child || data.task_id !== task || !Array.isArray(data.photos)) {
        return reply('backend_scope_mismatch', 502);
      }
    }

    return new Response(JSON.stringify(data), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  } catch (_) {
    return reply(method === 'POST' ? 'write_result_unknown' : 'connection_unavailable', 503);
  } finally {
    clearTimeout(timer);
  }
};
})();
