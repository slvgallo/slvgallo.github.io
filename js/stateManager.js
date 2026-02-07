// State management for scroll position and filter state
// Extracted from index.js lines 87-161

export class StateManager {
  constructor() {
    this.storageKey = "slvgallo_scroll_state";
    this.currentFilter = "all";
    this.displayedCount = 0;
  }

  // スクロール状態を保存するセットアップ
  // Extracted from index.js lines 88-102
  setupStateSaving(currentFilter, displayedCount) {
    this.currentFilter = currentFilter;
    this.displayedCount = displayedCount;
    
    const grid = document.getElementById("works-grid");
    if (!grid) return;
    
    grid.addEventListener("click", (e) => {
      // リンクまたは画像の親リンクを探す
      const link = e.target.closest("a");
      if (link && link.href && (link.href.includes("works.html") || link.href.includes("/works/"))) {
        const state = {
          scrollTop: window.scrollY,
          filter: this.currentFilter,
          displayedCount: this.displayedCount || document.querySelectorAll("#works-grid .post").length
        };
        sessionStorage.setItem(this.storageKey, JSON.stringify(state));
      }
    });
  }

  // 状態を復元する関数
  // Extracted from index.js lines 105-161
  restoreScrollState(allWorks) {
    // ブラウザバックでの遷移かチェック
    const navigationEntry = performance.getEntriesByType("navigation")[0];
    const isBackNavigation = navigationEntry && navigationEntry.type === "back_forward";

    if (!isBackNavigation) {
      // 通常遷移の場合はストレージをクリア
      sessionStorage.removeItem(this.storageKey);
      return { restored: false, filter: "all" };
    }

    const savedStateJson = sessionStorage.getItem(this.storageKey);
    if (!savedStateJson) return { restored: false, filter: "all" };

    try {
      const state = JSON.parse(savedStateJson);
      
      // フィルタを復元
      this.currentFilter = state.filter;
      const filterLinks = document.querySelectorAll(".filter-link");
      filterLinks.forEach((l) => l.classList.remove("active"));
      const activeLink = document.querySelector(`[data-filter="${this.currentFilter}"]`);
      if (activeLink) activeLink.classList.add("active");

      // リストをフィルタリング
      let filteredWorks;
      if (this.currentFilter === "all") {
        filteredWorks = [...allWorks];
      } else {
        filteredWorks = allWorks.filter(work => work.tags.includes(this.currentFilter));
      }

      // 保存されていた数だけアイテムを表示
      const grid = document.getElementById("works-grid");
      if (grid) {
        grid.innerHTML = "";
      }
      
      // 表示数制限
      const countToLoad = Math.min(state.displayedCount, filteredWorks.length);
      
      this.displayedCount = countToLoad;

      // スクロール位置を復元（少し遅延させて描画完了を待つ）
      requestAnimationFrame(() => {
        window.scrollTo(0, state.scrollTop);
      });
      
      return { 
        restored: true, 
        filter: this.currentFilter, 
        filteredWorks: filteredWorks, 
        displayedCount: this.displayedCount 
      };
    } catch (e) {
      // 状態復元エラーは無視
      return { restored: false, filter: "all" };
    }
  }

  // Update current filter
  setCurrentFilter(filter) {
    this.currentFilter = filter;
  }

  // Update displayed count
  setDisplayedCount(count) {
    this.displayedCount = count;
  }

  // Get current state
  getCurrentState() {
    return {
      filter: this.currentFilter,
      displayedCount: this.displayedCount
    };
  }

  // Clear stored state
  clearState() {
    sessionStorage.removeItem(this.storageKey);
  }
}
