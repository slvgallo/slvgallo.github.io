console.log('🚀 page-common.js loaded');

// SoundCloudウィジェットのエラーを完全にブロック
(function() {
  // 元のエラーハンドラーを保存
  const originalOnError = window.onerror;
  const originalUnhandledRejection = window.onunhandledrejection;
  
  // エラーハンドラーを完全に置き換え
  window.onerror = function(message, source, lineno, colno, error) {
    const messageStr = String(message);
    const sourceStr = String(source || '');
    
    // SoundCloud関連のエラーを完全に無視
    if (sourceStr.includes('widget-') || 
        sourceStr.includes('soundcloud') ||
        messageStr.includes('widget-') ||
        messageStr.includes('SoundCloud') ||
        messageStr.includes('Permissions policy violation') ||
        messageStr.includes('Encrypted Media access has been blocked') ||
        messageStr.includes('Unrecognized origin') ||
        messageStr.includes('getImageData') && messageStr.includes('width is 0')) {
      return true; // エラーを完全に無視
    }
    
    // その他のエラーは元のハンドラーに渡す
    if (originalOnError) {
      return originalOnError.call(this, message, source, lineno, colno, error);
    }
    return false;
  };
  
  window.onunhandledrejection = function(event) {
    const reasonStr = String(event.reason || '');
    
    if (reasonStr.includes('soundcloud') || reasonStr.includes('widget-')) {
      event.preventDefault();
      return true;
    }
    
    if (originalUnhandledRejection) {
      return originalUnhandledRejection.call(this, event);
    }
    return false;
  };
  
  // イベントリスナーでもブロック
  window.addEventListener('error', (e) => {
    e.preventDefault();
    e.stopPropagation();
    return true;
  }, true);
  
  window.addEventListener('unhandledrejection', (e) => {
    e.preventDefault();
    return true;
  });
})();

// consoleメソッドを完全にオーバーライド
(function() {
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  
  console.error = function(...args) {
    const message = args.join(' ');
    if (message.includes('soundcloud') || message.includes('widget-') || 
        message.includes('Permissions policy violation') ||
        message.includes('Encrypted Media access has been blocked') ||
        message.includes('Unrecognized origin') ||
        message.includes('getImageData') && message.includes('width is 0')) {
      return;
    }
    return originalConsoleError.apply(console, args);
  };
  
  console.warn = function(...args) {
    const message = args.join(' ');
    if (message.includes('soundcloud') || message.includes('widget-') ||
        message.includes('Permissions policy violation') ||
        message.includes('Unrecognized origin')) {
      return;
    }
    return originalConsoleWarn.apply(console, args);
  };
  
  // console.logもSoundCloud関連をフィルタリング
  const originalConsoleLog = console.log;
  console.log = function(...args) {
    const message = args.join(' ');
    if (message.includes('SoundCloud Embed Player')) {
      return;
    }
    return originalConsoleLog.apply(console, args);
  };
})();

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
