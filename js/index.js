// extractYouTubeId関数はutils.jsで定義

import { preprocessWorkThumbnails } from './renderWorks.js';
import { InfiniteScrollController } from './infiniteScroll.js';
import { StateManager } from './stateManager.js';

// Development-only error handlers
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  window.addEventListener('error', (e) => {
    // エラーを静かに処理
    console.error('Global error:', e.error);
  });

  window.addEventListener('unhandledrejection', (e) => {
    // Promiseの拒否を処理
    console.error('Unhandled promise rejection:', e.reason);
    e.preventDefault();
  });
}

const params = new URLSearchParams(window.location.search);
const initialFilter = params.get("filter");

// Global variables for orchestrator
let allWorks = [];
let filteredWorks = [];
let currentFilter = "all";
let infiniteScrollController = null;
let stateManager = null;

// フィルタを適用する関数
function applyFilter(filter) {
  currentFilter = filter;
  const grid = document.getElementById("works-grid");
  const filterLinks = document.querySelectorAll(".filter-link");
  
  // アクティブ状態の更新
  filterLinks.forEach((l) => l.classList.remove("active"));
  const activeLink = document.querySelector(`[data-filter="${filter}"]`);
  if (activeLink) {
    activeLink.classList.add("active");
  }

  // フィルタリングされた作品リストを作成
  if (filter === "all") {
    filteredWorks = [...allWorks];
  } else {
    filteredWorks = allWorks.filter(work => work.tags.includes(filter));
  }
  
  // Update infinite scroll controller
  if (infiniteScrollController) {
    infiniteScrollController.updateFilteredWorks(filteredWorks);
  }
  
  // Update state manager
  if (stateManager) {
    stateManager.setCurrentFilter(filter);
  }
}

// Make applyFilter globally available for navigation.js
window.applyFilter = applyFilter;

// Get initial filter from URL parameters
function getInitialFilter() {
  let initial = "all";
  if (initialFilter) {
    // フィルタが有効なタグかチェック（DOM要素の有無ではなく、データ内の存在で判定）
    const hasTag = allWorks.some(work => work.tags && work.tags.includes(initialFilter));
    if (hasTag || initialFilter === "all") {
      initial = initialFilter;
    }
  }
  return initial;
}

// Main initialization function
export function initIndex() {
  stateManager = new StateManager();
  infiniteScrollController = new InfiniteScrollController();

  fetch("data/works.json")
    .then((res) => {
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      return res.json();
    })
    .then((works) => {
      allWorks = preprocessWorkThumbnails(works);
      
      // 復元処理または初期化
      const restoreResult = stateManager.restoreScrollState(allWorks);
      if (!restoreResult.restored) {
        const initial = getInitialFilter();
        applyFilter(initial);
      } else {
        // Restore filtered works and display count
        filteredWorks = restoreResult.filteredWorks;
        currentFilter = restoreResult.filter;
        stateManager.setCurrentFilter(currentFilter);
        
        // Initialize infinite scroll with restored state
        infiniteScrollController.init(filteredWorks, restoreResult.displayedCount);
      }

      // Setup state saving after restoration
      stateManager.setupStateSaving(currentFilter, infiniteScrollController.displayedCount);
    })
    .catch((error) => {
      // データ読み込みエラー処理
      const grid = document.getElementById("works-grid");
      if (grid) {
        grid.innerHTML = '<p class="error-message">error</p>';
      }
    });
}
