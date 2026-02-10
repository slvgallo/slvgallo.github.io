import { state } from './state.js';
import { loadWorks } from './data.js';
import { applyFilter, restoreScrollState, setupInfiniteScroll, setupStateSaving } from './filter.js';
import { initNavigation } from './navigation.js';
import { initScroll } from './scroll.js';
import { initMenu } from './menu.js';
import { initFavicon } from './favicon-control.js';
import { initLangToggle } from './lang-toggle.js';

document.addEventListener('DOMContentLoaded', async () => {
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  // 全ページ共通の初期化
  initNavigation();
  initMenu();
  initFavicon();
  initLangToggle();

  const isIndexPage = currentPage === 'index.html' || currentPage === '';

  // インデックスページ固有の処理
  if (isIndexPage && document.getElementById('works-grid')) {
    try {
      // データのロード
      state.data.allWorks = await loadWorks();
      
      // 無限スクロールと状態保存のセットアップ
      setupInfiniteScroll();
      setupStateSaving();

      // スクロール状態の復元（戻るボタンなど）
      const restored = restoreScrollState();

      if (!restored) {
        // 戻る操作でない場合は、URLパラメータを確認
        const urlParams = new URLSearchParams(window.location.search);
        const filterParam = urlParams.get('filter') || 'all';
        applyFilter(filterParam, true);
      }
    } catch (error) {
      console.error('Failed to load works:', error);
    }
  }

  // ヘッダースクロールは header があるページのみ
  if (document.querySelector('.header')) {
    initScroll();
  }
});
