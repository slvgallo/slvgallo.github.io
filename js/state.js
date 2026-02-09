export const state = {
  // From index.js
  allWorks: [],
  filteredWorks: [],
  displayedCount: 0,
  currentFilter: "all",
  isLoading: false,
  
  // From scroll-control.js
  lastScrollY: 0,
  ticking: false,
  scrollTimer: null,
  isHeaderHidden: false,
  isHeaderHovered: false,
  scrollDirection: 'up',
  continuousDownScroll: 0,
  shouldAutoHide: true,

  // From filter.js
  infiniteObserver: null,
  stateSavingInitialized: false,

  // From lang-toggle.js
  langInitialized: false,

  // From menu.js
  menuInitialized: false,

  // From navigation.js
  navigationInitialized: false
};
