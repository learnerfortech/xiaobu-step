/* 家里共享、本机存档显式切换：不导入、不合并。 */
(function () {
window.SharedConnection = {
  modeURL(mode) { const u = new URL(location.href); u.searchParams.set('transport', mode === 'mock' ? 'mock' : 'lan'); return u.href; },
  blocked() { return false; }
};
})();
