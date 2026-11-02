/* 家长入口：单击直接进入；沿用原有家长会话时限。 */
(function(){
const { h, icon } = window.UI;
const KEY = 'xb.parentUntil';
const Gate = {
  open() { try { return Number(sessionStorage.getItem(KEY) || 0) > Date.now(); } catch (e) { return false; } },
  grant() { try { sessionStorage.setItem(KEY, String(Date.now() + 15 * 60 * 1000)); } catch (e) {} },
  revoke() { try { sessionStorage.removeItem(KEY); } catch (e) {} },
  /* 单击进入，保留原有会话时限。 */
  lockButton(onPass, cls = '') {
    return h('button.lock-btn ' + cls, { type: 'button', 'aria-label': '家长', 'data-testid': 'parent-lock', onclick: () => { Gate.grant(); onPass(); } }, icon('lock'), h('span', {}, '家长'));
  }

};
window.Gate = Gate;
})();
