/**
 * フィルターリンクのフォーカス管理
 * フィルターコンテナにフォーカストラップを適用
 */

import { createFocusTrap } from './focus-trap.js';

export function initFilterFocus() {
  const filterNav = document.querySelector('.header-box-nav .nav');
  
  if (!filterNav) return;

  const focusTrap = createFocusTrap(filterNav, {
    initialFocus: false,
    restoreFocus: false
  });

  // フィルターリンクのキーボード操作改善
  filterNav.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const target = e.target.closest('.filter-link');
      if (target) {
        target.click();
      }
    }
  });

  return focusTrap;
}
