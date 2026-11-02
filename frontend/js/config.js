/* 小步 · Tidy Steps 前端配置（唯一需要按家庭/部署修改的地方）
   家里共享使用 ?transport=lan（默认）；本机回退使用 ?transport=mock。两种数据不自动迁移。 */
(function(){
const q = new URLSearchParams(location.search);
window.APP_CONFIG = {
  /* 2026-10-26 家长取消晚间关入口；不再按钟点关闭孩子页面。 */
  EVENING_BOUNDARY: null,
  TIMEZONE: 'Asia/Shanghai',

  /* lan = 同一 Mac 的文件库；mock = 原浏览器存档。共享不自动导入旧任务。 */
  TRANSPORT: q.get('transport') === 'mock' ? 'mock' : 'lan',
  HTTP_BASE: location.origin,
  API_PREFIX: q.get('transport') === 'mock' ? '/demo/family/' : '/lan/family/',
  // 旧云端适配关闭；家里共享只使用 lan-transport。
  HTTP_TASKS_VERIFIED: false,
  HTTP_TIMEOUT_MS: 8000,

  /* 种子示例日（仅 newState 初始任务用）。列表/新建的「今天」见 today()，跟本机 Asia/Shanghai 日历。 */
  DEMO_DAY: '2026-10-24',

  /* 孩子档案：API 里的 child_id 只是 child_a / child_b，显示名与模式在前端配置（不出现在孩子界面上的技术字段里） */
  // Quiet companions; Joey preference only, no Joey adventure in this release.
  BUDDY_DEFAULTS: { child_a: 'terapagos', child_b: 'charizard', muted: true },

  CHILDREN: {
    child_a: { name: 'Jared', mode: 'reader', avatar: 'J' },   /* 9 岁，会读：任务卡 + 原要求 + 完成/求助/今天到这里 */
    child_b: { name: 'Joey',  mode: 'voice',  avatar: 'Jo' }   /* 幼小衔接，不识字：声音优先 + 团团 + 家长陪同 */
  },

  /* 家长入口与返回按钮均单击进入。 */
  PARENT_GATE_HOLD_MS: 0,
  /* 兼容配置；当前导航直接使用 onclick */
  JOEY_DOOR_HOLD_MS: 0,

  /* ---- 仅测试用的覆盖（URL 参数），生产不应暴露 ---- */
  TEST: {
    now: q.get('transport') === 'mock' ? q.get('now') : null,                 /* 例如 ?now=21:45 模拟当前时刻 */
    scenario: q.get('scenario') || 'normal',  /* normal | long | done | empty | read-fail */
    failRead: Number(q.get('failRead')||0),
    failWrite: Number(q.get('failWrite')||0),
    noAudio: q.get('mute') === '1'
  }
};
/** 本机「今天」= Asia/Shanghai 日历日 YYYY-MM-DD（列表/新建用；不是 DEMO_DAY） */
window.APP_CONFIG.today = function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: window.APP_CONFIG.TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
};
})();
