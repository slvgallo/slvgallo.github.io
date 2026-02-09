import { state } from './state.js';
import { loadWorks } from './data.js';
import {
  applyFilter,
  setupInfiniteScroll,
  restoreScrollState,
  setupStateSaving
} from './filter.js';
import { initNavigation } from './navigation.js';
import { initScroll } from './scroll.js';
import { initMenu } from './menu.js';
import { initFavicon } from './favicon-control.js';
import { initLangToggle } from './lang-toggle.js'; // 共通パーツ用

const params = new URLSearchParams(window.location.search);
const initialFilter = params.get("filter");

document.addEventListener('DOMContentLoaded', async () => {
  // 1. データのロード（state.data へ格納）
  state.data.allWorks = await loadWorks();

  // 2. 無限スクロールの準備
  // （内部で state.init.infiniteObserver をチェックするので安全）
  setupInfiniteScroll();

  // 3. 初期フィルタの決定
  let initial = "all";
  if (initialFilter) {
    // state.data.allWorks を参照
    const hasTag = state.data.allWorks.some(work => work.tags && work.tags.includes(initialFilter));
    if (hasTag || initialFilter === "all") {
      initial = initialFilter;
    }
  }

  // 4. 状態復元または初期フィルタ適用
  // restoreScrollState内でも state.data / state.init を参照するように修正済み
  if (!restoreScrollState()) {
    applyFilter(initial);
  }

  // 5. 各種モジュールの初期化
  // それぞれの内部で state.init.xxxInitialized をチェックするように実装
  initNavigation();
  initScroll();
  initMenu();
  initFavicon();
  initLangToggle();
  setupStateSaving();
});