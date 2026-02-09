import { state } from './state.js';
import { initNavigation } from './navigation.js';
import { initScroll } from './scroll.js';
import { initMenu } from './menu.js';
import { initFavicon } from './favicon-control.js';
import { initLangToggle } from './lang-toggle.js';

document.addEventListener('DOMContentLoaded', () => {


  // 1. 基本的なUIコンポーネントの初期化
  initNavigation();
  initMenu();
  initFavicon();
  initLangToggle();

  // 2. ヘッダーが存在する場合のみスクロール制御を起動
  // (initScroll 内部でも二重起動ガードが走ります)
  if (document.querySelector('.header')) {
    initScroll();
  }
});