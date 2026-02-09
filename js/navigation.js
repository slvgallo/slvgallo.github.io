import { state } from './state.js';
import { applyFilter } from './filter.js';

export function initNavigation() {
  if (state.init.navigationInitialized) return;
  state.init.navigationInitialized = true;

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  document.addEventListener("click", (e) => {
    const link = e.target.closest(".filter-link");
    if (!link) return;

    e.preventDefault();
    const filter = link.dataset.filter;

    if (currentPage !== 'index.html') {
      const pathSegments = window.location.pathname.split('/');
      if (pathSegments[pathSegments.length - 2] === 'works') {
        window.location.href = `../index.html?filter=${filter}`;
      } else {
        window.location.href = `index.html?filter=${filter}`;
      }
    } else {
      applyFilter(filter);
      window.scrollTo(0, 0);
    }
  });
}
