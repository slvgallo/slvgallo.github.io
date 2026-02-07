// Single entry point for all JavaScript initialization
// This is the ONLY file that should listen to DOMContentLoaded

import { initFavicon } from './favicon-control.js';
import { initLang } from './lang-toggle.js';
import { initMenu } from './menu-control.js';
import { initNav } from './navigation.js';
import { initScroll } from './scroll-control.js';
import { initIndex } from './index.js';

// Single DOMContentLoaded listener for all modules
document.addEventListener('DOMContentLoaded', () => {
  // Initialize modules in order
  initFavicon();
  initLang();
  initMenu();
  initNav();
  initScroll();
  initIndex();
});
