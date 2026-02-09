import { state } from './state.js';
import { createWorkItem } from './renderer.js';

export function applyFilter(filter) {
  state.data.currentFilter = filter; // data階層へ
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
  
  // グリッドをクリアして最初からロード
  if (grid) grid.innerHTML = "";
  state.data.displayedCount = 0;
  
  loadMoreItems();
}

export function loadMoreItems() {
  // data階層を参照
  if (state.data.isLoading || state.data.displayedCount >= state.data.filteredWorks.length) return;
  
  state.data.isLoading = true;
  try {
    const grid = document.getElementById("works-grid");
    if (!grid) return;
    
    const endIndex = Math.min(state.data.displayedCount + 16, state.data.filteredWorks.length);
    
    for (let i = state.data.displayedCount; i < endIndex; i++) {
      const article = createWorkItem(state.data.filteredWorks[i]);
      if (article) {
        grid.appendChild(article);
      }
    }
    
    state.data.displayedCount = endIndex;
  } catch (error) {
    console.error("Error loading items:", error);
  } finally {
    state.data.isLoading = false;
    updateLoadingIndicator();
  }
}

export function setupInfiniteScroll() {
  // init階層のObserverフラグとDOM両方でガード
  if (state.init.infiniteObserver || document.getElementById("scroll-sentinel")) return;
  
  const container = document.querySelector(".top-post-container");
  if (!container) return;

  const sentinel = document.createElement("div");
  sentinel.id = "scroll-sentinel";
  sentinel.style.height = "1px";
  container.appendChild(sentinel);

  // Observerを生成し、状態管理に入れる（再初期化防止の核心）
  state.init.infiniteObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && !state.data.isLoading) {
        loadMoreItems();
      }
    });
  }, {
    rootMargin: "200px"
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
  if (!grid) return;

  grid.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (link && link.href && (link.href.includes("works.html") || link.href.includes("/works/"))) {
      const stateData = {
        scrollTop: window.scrollY,
        filter: state.data.currentFilter,
        displayedCount: state.data.displayedCount
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
    
    state.data.currentFilter = savedState.filter;
    
    // UIの復元（アクティブリンク）
    const filterLinks = document.querySelectorAll(".filter-link");
    filterLinks.forEach((l) => l.classList.remove("active"));
    const activeLink = document.querySelector(`[data-filter="${state.data.currentFilter}"]`);
    if (activeLink) activeLink.classList.add("active");

    // リストのフィルタリング
    if (state.data.currentFilter === "all") {
      state.data.filteredWorks = [...state.data.allWorks];
    } else {
      state.data.filteredWorks = state.data.allWorks.filter(work => 
        work.tags.includes(state.data.currentFilter)
      );
    }

    const grid = document.getElementById("works-grid");
    if (grid) {
      grid.innerHTML = "";
      const countToLoad = Math.min(savedState.displayedCount, state.data.filteredWorks.length);
      
      for (let i = 0; i < countToLoad; i++) {
        const article = createWorkItem(state.data.filteredWorks[i]);
        grid.appendChild(article);
      }
      
      state.data.displayedCount = countToLoad;
      updateLoadingIndicator();

      requestAnimationFrame(() => {
        window.scrollTo(0, savedState.scrollTop);
      });
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}