import { state } from './state.js';
import { loadWorks } from './data.js';
import { applyFilter, setupInfiniteScroll, restoreScrollState, setupStateSaving } from './filter.js';
import { initNavigation } from './navigation.js';
import { initScroll } from './scroll.js';
import { initMenu } from './menu.js';
import { initFavicon } from './favicon-control.js';
const params = new URLSearchParams(window.location.search);
const initialFilter = params.get("filter");
document.addEventListener('DOMContentLoaded', async () => {
  state.data.allWorks = await loadWorks();

  setupInfiniteScroll();

  let initial = "all";
  if (initialFilter) {
    const hasTag = state.data.allWorks.some(work => 
      work.tags && work.tags.includes(initialFilter)
    );
    if (hasTag || initialFilter === "all") {
      initial = initialFilter;
    }
  }

  if (!restoreScrollState()) {
    applyFilter(initial, true);
  }

  initNavigation();
  initScroll();
  initMenu();
  initFavicon();
  setupStateSaving();
});
