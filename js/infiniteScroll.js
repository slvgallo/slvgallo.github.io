// Infinite Scroll controller class
// Extracted from index.js lines 247-347
class InfiniteScrollController {
  constructor() {
    this.sentinel = null;
    this.observer = null;
    this.isLoading = false;
    this.displayedCount = 0;
    this.filteredWorks = [];
  }

  init(filteredWorks, displayedCount = 0) {
    this.filteredWorks = filteredWorks;
    this.displayedCount = displayedCount;
    this.isLoading = false;
    
    // センチネル要素を作成（監視対象）
    this.createSentinel();
    
    // Intersection Observerを設定
    this.setupObserver();
    
    // ローディングインジケーターの初期状態を更新
    this.updateLoadingIndicator();
  }

  createSentinel() {
    this.sentinel = document.createElement("div");
    this.sentinel.id = "scroll-sentinel";
    this.sentinel.style.height = "1px";
    const container = document.querySelector(".top-post-container");
    if (container) {
      container.appendChild(this.sentinel);
    }
  }

  setupObserver() {
    if (!this.sentinel) return;
    
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !this.isLoading) {
          this.loadMoreItems();
        }
      });
    }, {
      rootMargin: INFINITE_SCROLL.ROOT_MARGIN // 200px手前で発火
    });

    this.observer.observe(this.sentinel);
  }

  // 次のバッチをロードする関数
  // Extracted from index.js lines 248-273
  loadMoreItems() {
    if (this.isLoading || this.displayedCount >= this.filteredWorks.length) return;
    
    this.isLoading = true;
    try {
      const grid = document.getElementById("works-grid");
      if (!grid) return;
      
      const endIndex = Math.min(this.displayedCount + INFINITE_SCROLL.ITEMS_PER_LOAD, this.filteredWorks.length);
      
      for (let i = this.displayedCount; i < endIndex; i++) {
        const article = createWorkItem(this.filteredWorks[i]);
        if (article) {
          grid.appendChild(article);
        }
      }
      
      this.displayedCount = endIndex;
    } catch (error) {
      console.error("Error loading items:", error);
    } finally {
      this.isLoading = false;
      // ローディングインジケーターの更新
      this.updateLoadingIndicator();
    }
  }

  // ローディングインジケーターの更新
  // Extracted from index.js lines 326-347
  updateLoadingIndicator() {
    let indicator = document.getElementById("loading-indicator");
    
    if (this.displayedCount >= this.filteredWorks.length) {
      // すべて表示済み - インジケーターを削除
      if (indicator) {
        indicator.remove();
      }
    } else {
      // まだ残りがある場合 - インジケーターを表示
      if (!indicator) {
        indicator = document.createElement("div");
        indicator.id = "loading-indicator";
        indicator.className = "loading-indicator";
        indicator.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
        const sentinel = document.getElementById("scroll-sentinel");
        if (sentinel) {
          sentinel.parentNode.insertBefore(indicator, sentinel);
        }
      }
    }
  }

  // Cleanup method to prevent memory leaks
  destroy() {
    if (this.observer && this.sentinel) {
      this.observer.unobserve(this.sentinel);
      this.observer.disconnect();
    }
    if (this.sentinel && this.sentinel.parentNode) {
      this.sentinel.parentNode.removeChild(this.sentinel);
    }
    const indicator = document.getElementById("loading-indicator");
    if (indicator && indicator.parentNode) {
      indicator.parentNode.removeChild(indicator);
    }
  }

  // Update filtered works and reset display
  updateFilteredWorks(newFilteredWorks) {
    this.filteredWorks = newFilteredWorks;
    this.displayedCount = 0;
    this.isLoading = false;
    
    // Clear grid
    const grid = document.getElementById("works-grid");
    if (grid) {
      grid.innerHTML = "";
    }
    
    // Load first batch
    this.loadMoreItems();
  }
}
