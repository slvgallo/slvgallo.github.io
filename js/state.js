/**
 * Global Application State
 * * [data] - アプリケーションの核となるデータ（作品、フィルタリング、読込状況）
 * [ui]   - 画面表示上の制御状態（スクロール、ヘッダーの表示非表示など）
 * [init] - 冪等性を確保するための初期化管理フラグ
 */
export const state = {
  data: {
    allWorks: [],
    filteredWorks: [],
    displayedCount: 0,
    currentFilter: "all",
    isLoading: false,
  },

  ui: {
    lastScrollY: 0,
    ticking: false,
    scrollTimer: null,
    isHeaderHidden: false,
    isHeaderHovered: false,
    scrollDirection: 'up',
    continuousDownScroll: 0,
    shouldAutoHide: true
  },

  init: {
    infiniteObserver: null,
    stateSavingInitialized: false,
    scrollInitialized: false,
    faviconInitialized: false,
    langInitialized: false,
    menuInitialized: false,
    navigationInitialized: false
  }
};