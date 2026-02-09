import { state } from './state.js';

export function initMenu() {
  if (state.init.menuInitialized) return;
  state.init.menuInitialized = true;

  const menuToggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".header-box-nav");
  const overlay = document.querySelector(".menu-overlay");

  if (!menuToggle || !nav || !overlay) return;

  function closeMenu() {
    menuToggle.classList.remove("active");
    nav.classList.remove("active");
    overlay.classList.remove("active");
    document.body.classList.remove("menu-open");
    document.documentElement.classList.remove("menu-open");
  }

  menuToggle.addEventListener("click", () => {
    menuToggle.classList.toggle("active");
    nav.classList.toggle("active");
    overlay.classList.toggle("active");
    document.body.classList.toggle("menu-open");
    document.documentElement.classList.toggle("menu-open");
  });

  overlay.addEventListener("click", closeMenu);

  nav.addEventListener("click", (e) => {
    if (e.target.closest("a")) {
      closeMenu();
    }
  });
}
