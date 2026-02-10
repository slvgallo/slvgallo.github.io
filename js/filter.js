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

  // 初期ロードで既にビルド済みのコンテンツ（{{WORKS_GRID}}）がある場合はクリアをスキップ
  if (isInitialLoad && filter === "all" && grid.children.length > 0) {
    state.data.displayedCount = grid.children.length;
    return;
  }

  // グリッドをクリアして最初からロード
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

    for (let i = startIndex; i < endIndex; i++) {
      // 🚀 修正ポイント: インデックス i を渡すことで最初の4枚をLCP最適化
      const article = createWorkItem(state.data.filteredWorks[i], i);
      if (article) {
        grid.appendChild(article);
      }
    }

    state.data.displayedCount = endIndex;
  } catch (error) {
    // エラー処理
  } finally {
    state.data.isLoading = false;
    updateLoadingIndicator();
  }
}

export function setupInfiniteScroll() {
  if (state.init.infiniteObserver) return;

  const sentinel = document.createElement("div");
  sentinel.id = "scroll-sentinel";
  sentinel.style.height = "1px";
  document.querySelector(".top-post-container").appendChild(sentinel);

  state.init.infiniteObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && !state.data.isLoading) {
        loadMoreItems();
      }
    });
  }, {
    rootMargin: "400px" // スムーズな体験のため少し長めに設定
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
    grid.innerHTML = "";

    const countToLoad = Math.min(savedState.displayedCount, state.data.filteredWorks.length);

    for (let i = 0; i < countToLoad; i++) {
      // 🚀 ここでもインデックス i を渡す
      const article = createWorkItem(state.data.filteredWorks[i], i);
      grid.appendChild(article);
    }

    state.data.displayedCount = countToLoad;
    updateLoadingIndicator();

    // 描画完了を待ってからスクロール位置を復元
    setTimeout(() => {
      window.scrollTo({
        top: savedState.scrollTop,
        behavior: 'instant' // 瞬時に移動させるのが最も安定する
      });
    }, 50);

    return true;
  } catch (e) {
    return false;
  }
}