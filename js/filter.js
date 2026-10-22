import { state } from './state.js';
import { createWorkItem } from './renderer.js';

export function applyFilter(filter, isInitialLoad = false) {
  state.data.currentFilter = filter;
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
    state.data.filteredWorks = [...state.data.allWorks];
  } else {
    state.data.filteredWorks = state.data.allWorks.filter(work => work.tags.includes(filter));
  }

  // 🔑 初期ロード時の最適化処理
  if (isInitialLoad && filter === "all") {
    const existingItems = grid.querySelectorAll('.index-post');
    
    if (existingItems.length > 0) {
      // ビルド時に生成された全作品がDOMに存在する場合
      // 最初の16個だけ表示、残りは非表示にする
      let hiddenCount = 0;
      existingItems.forEach((item, index) => {
        if (index >= 16) {
          item.style.cssText = 'display: none !important; visibility: hidden !important; position: absolute !important; left: -9999px !important; top: -9999px !important;';
          item.dataset.hidden = 'true';
          hiddenCount++;
        }
      });
      
      state.data.displayedCount = Math.min(16, existingItems.length);
      return;
    }
  }

  // フィルター変更時は通常通りクリア＆再構築
  grid.innerHTML = "";
  state.data.displayedCount = 0;

  // 最初のバッチをロード
  loadMoreItems();
}

export function loadMoreItems() {
  if (state.data.isLoading || state.data.displayedCount >= state.data.filteredWorks.length) return;

  state.data.isLoading = true;

  try {
    const grid = document.getElementById("works-grid");
    if (!grid) return;

    const startIndex = state.data.displayedCount;
    const endIndex = Math.min(startIndex + 16, state.data.filteredWorks.length);

    // 🔑 既存の非表示要素がある場合（初期ロードの続き）
    const existingHidden = grid.querySelectorAll('.index-post[data-hidden="true"]');
    
    if (existingHidden.length > 0 && state.data.currentFilter === 'all') {
      // 既存の非表示要素を順次表示
      const itemsToShow = Math.min(16, existingHidden.length);
      
      for (let i = 0; i < itemsToShow; i++) {
        existingHidden[i].style.cssText = '';
        existingHidden[i].removeAttribute('data-hidden');
      }
      
      state.data.displayedCount += itemsToShow;
    } else {
      // 通常の動的生成（フィルター適用時など）
      for (let i = startIndex; i < endIndex; i++) {
        const article = createWorkItem(state.data.filteredWorks[i], i);
        if (article) {
          grid.appendChild(article);
        }
      }
      
      state.data.displayedCount = endIndex;
    }
  } catch (error) {
    console.error('Error loading items:', error);
  } finally {
    state.data.isLoading = false;
    updateLoadingIndicator();
  }
}

export function setupInfiniteScroll() {
  if (state.init.infiniteObserver) return;

  const container = document.querySelector(".top-post-container");
  
  const sentinel = document.createElement("div");
  sentinel.id = "scroll-sentinel";
  sentinel.style.height = "1px";
  container.appendChild(sentinel);

  state.init.infiniteObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && !state.data.isLoading) {
        loadMoreItems();
      }
    });
  }, {
    rootMargin: "400px"
  });

  state.init.infiniteObserver.observe(sentinel);
}

export function updateLoadingIndicator() {
  let indicator = document.getElementById("loading-indicator");

  if (state.data.displayedCount >= state.data.filteredWorks.length) {
    if (indicator) indicator.remove();
  } else {
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

export function setupStateSaving() {
  if (state.init.stateSavingInitialized) return;
  state.init.stateSavingInitialized = true;

  const grid = document.getElementById("works-grid");
  grid.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (link && link.href && (link.href.includes("works.html") || link.href.includes("/works/"))) {
      const stateData = {
        scrollTop: window.scrollY,
        filter: state.data.currentFilter,
        displayedCount: state.data.displayedCount || document.querySelectorAll("#works-grid .post").length
      };
      sessionStorage.setItem("slvgallo_scroll_state", JSON.stringify(stateData));
    }
  });
}

export function restoreScrollState() {
  const navigationEntry = performance.getEntriesByType("navigation")[0];
  const isBackNavigation = navigationEntry && navigationEntry.type === "back_forward";

  if (!isBackNavigation) {
    sessionStorage.removeItem("slvgallo_scroll_state");
    return false;
  }

  const savedStateJson = sessionStorage.getItem("slvgallo_scroll_state");
  if (!savedStateJson) return false;

  try {
    const savedState = JSON.parse(savedStateJson);

    // フィルタを復元
    state.data.currentFilter = savedState.filter;
    const filterLinks = document.querySelectorAll(".filter-link");
    filterLinks.forEach((l) => l.classList.remove("active"));
    const activeLink = document.querySelector(`[data-filter="${state.data.currentFilter}"]`);
    if (activeLink) activeLink.classList.add("active");

    // リストをフィルタリング
    if (state.data.currentFilter === "all") {
      state.data.filteredWorks = [...state.data.allWorks];
    } else {
      state.data.filteredWorks = state.data.allWorks.filter(work => work.tags.includes(state.data.currentFilter));
    }

    const grid = document.getElementById("works-grid");
    const existingItems = grid.querySelectorAll('.index-post');
    
    if (existingItems.length > 0 && state.data.currentFilter === 'all') {
      // 既存のDOM要素を使って復元
      const countToShow = Math.min(savedState.displayedCount, existingItems.length);
      
      existingItems.forEach((item, index) => {
        if (index < countToShow) {
          item.style.display = '';
          item.removeAttribute('data-hidden');
        } else {
          item.style.display = 'none';
          item.dataset.hidden = 'true';
        }
      });
      
      state.data.displayedCount = countToShow;
    } else {
      // フィルター適用時は動的生成
      grid.innerHTML = "";
      const countToLoad = Math.min(savedState.displayedCount, state.data.filteredWorks.length);

      for (let i = 0; i < countToLoad; i++) {
        const article = createWorkItem(state.data.filteredWorks[i], i);
        grid.appendChild(article);
      }

      state.data.displayedCount = countToLoad;
    }

    updateLoadingIndicator();

    // スクロール位置を復元
    setTimeout(() => {
      window.scrollTo({
        top: savedState.scrollTop,
        behavior: 'instant'
      });
    }, 50);

    return true;
  } catch (e) {
    console.error('Failed to restore scroll state:', e);
    return false;
  }
}
