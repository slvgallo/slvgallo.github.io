import { state } from './state.js';
import { createFocusTrap } from './focus-trap.js';

export function initMenu() {
  if (state.init.menuInitialized) return;
  state.init.menuInitialized = true;

  const menuToggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".header-box-nav");

  if (!menuToggle || !nav) return;

  const focusTrap = createFocusTrap(nav, {
    triggerElement: menuToggle,
    onEscape: () => closeMenu()
  });

  function closeMenu() {
    menuToggle.classList.remove("active");
    nav.classList.remove("active");
    document.body.classList.remove("menu-open");
    document.documentElement.classList.remove("menu-open");
    focusTrap.deactivate();
  }

  function openMenu() {
    menuToggle.classList.add("active");
    nav.classList.add("active");
    document.body.classList.add("menu-open");
    document.documentElement.classList.add("menu-open");
    focusTrap.activate();
  }

  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.classList.contains("active");
    
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  nav.addEventListener("click", (e) => {
    if (e.target.closest("a")) {
      closeMenu();
    }
  });
}
