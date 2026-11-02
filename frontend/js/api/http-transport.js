/* 共享任务适配：仅固定后台；不代管登录凭据，不回退为本机成功。
   现网GET可能执行schema初始化。确认生产版本/结构不变前，任务请求默认关闭。 */
(function () {
const REMOTE = 'https://family-synthetic-20261006.zhujing1227.workers.dev';
const toRemote = { child_a: 'family_a', child_b: 'family_b' };
const toLocal = { family_a: 'child_a', family_b: 'child_b' };
const reply = (error, status) => Response.json({ error }, { status });
const mapBack = value => Array.isArray(value) ? value.map(mapBack)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'child_id' ? (toLocal[v] || v) : mapBack(v)])) : value;
window.httpTransport = async (url, options = {}) => {
  const C = window.APP_CONFIG;
  let target;
  try {
    if (C.HTTP_BASE !== REMOTE) return reply('backend_not_configured', 503);
    target = new URL(String(url).replace(/^\/demo\/family\//, '/api/family/'), REMOTE);
    if (target.origin !== REMOTE || !target.pathname.startsWith('/api/family/')) return reply('endpoint_not_allowed', 405);
  } catch (_) { return reply('invalid_request', 400); }
  const method = (options.method || 'GET').toUpperCase();
  const operation = target.pathname.slice('/api/family/'.length);
  const allowed = method === 'GET' ? /^(parent|child)\/tasks$/.test(operation)
    : method === 'POST' && /^(parent\/create|parent\/assign|parent\/feedback|child\/feedback)$/.test(operation);
  // 照片、records、修改、删除均不发送请求；不拿归档或新增冒充删除/修改。
  if (!allowed) return reply('operation_not_available', 405);
  if (C.HTTP_TASKS_VERIFIED !== true) return reply('backend_verification_required', 503);
  if (method === 'POST' && window.location.origin !== REMOTE) return reply('same_origin_required', 409);
  let body, selectedDay, selectedChild;
  if (method === 'GET') {
    selectedDay = target.searchParams.get('day'); selectedChild = target.searchParams.get('child');
    const keys = [...target.searchParams.keys()];
    if (keys.some(k => !['day', 'child'].includes(k)) || new Set(keys).size !== keys.length) return reply('invalid_selection', 400);
    if (typeof selectedChild !== 'string' || !Object.hasOwn(toRemote, selectedChild) || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDay || '')) return reply('invalid_selection', 400);
    target.searchParams.set('child', toRemote[selectedChild]);
  } else {
    try { body = JSON.parse(options.body); } catch (_) { return reply('invalid_request', 400); }
    if (!body || Array.isArray(body) || typeof body !== 'object') return reply('invalid_request', 400);
    selectedChild = body.child_id; selectedDay = body.day;
    if (typeof selectedChild !== 'string' || !Object.hasOwn(toRemote, selectedChild) || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDay || '')) return reply('invalid_selection', 400);
    body.child_id = toRemote[selectedChild];
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), C.HTTP_TIMEOUT_MS || 8000);
  try {
    const response = await fetch(target.href, {
      method, credentials: 'include', cache: 'no-store', mode: 'cors', redirect: 'error', signal: controller.signal,
      ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    });
    if (!response.headers.get('Content-Type')?.includes('application/json')) return reply(method === 'POST' ? 'write_result_unknown' : 'authentication_required', method === 'POST' ? 503 : 401);
    let data; try { data = await response.json(); } catch (_) { return reply('invalid_backend_response', 502); }
    if (response.status === 200) {
      if (data?.authenticated !== true || data.dataset !== 'family' || data.day !== selectedDay || data.child_id !== toRemote[selectedChild] || !Array.isArray(data.tasks)
        || data.tasks.some(t => t.child_id !== toRemote[selectedChild] || t.day !== selectedDay)) return reply('backend_scope_mismatch', 502);
    }
    return Response.json(mapBack(data), { status: response.status });
  } catch (_) { return reply(method === 'POST' ? 'write_result_unknown' : 'connection_unavailable', 503); }
  finally { clearTimeout(timer); }
};
})();
