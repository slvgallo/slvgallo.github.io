// Single entry point for all JavaScript initialization
// This is the ONLY file that should listen to DOMContentLoaded

document.addEventListener('DOMContentLoaded', () => {
  // Initialize modules in order
  initFavicon();
  initLang();
  initMenu();
  initNav();
  initScroll();
  initIndex();
});
