import { initNavigation } from './navigation.js';
import { initScroll } from './scroll.js';
import { initMenu } from './menu.js';
import { initFavicon } from './favicon-control.js';
import { initLangToggle } from './lang-toggle.js';

document.addEventListener('DOMContentLoaded', () => {
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  // 全ページ共通
  initNavigation();
  initMenu();
  initFavicon();
  initLangToggle();

  // ヘッダースクロールは header があるページのみ
  if (document.querySelector('.header')) {
    initScroll();
  }
});
