import { state } from './state.js';

export function initMenu() {
  
  if (state.init.menuInitialized) return;
  state.init.menuInitialized = true;

  // メニューを閉じる共通処理
  function closeMenu() {
    const menuToggle = document.querySelector(".menu-toggle");
    const nav = document.querySelector(".header-box-nav");
    const overlay = document.querySelector(".menu-overlay");

    if (menuToggle) menuToggle.classList.remove("active");
    if (nav) nav.classList.remove("active");
    if (overlay) overlay.classList.remove("active");
    
    document.body.classList.remove("menu-open");
    document.documentElement.classList.remove("menu-open");
  }

  // イベント委譲と実行時検索を組み合わせた堅牢なリスナー
  document.addEventListener("click", (e) => {
    const menuToggle = e.target.closest(".menu-toggle");
    const overlay = e.target.closest(".menu-overlay");
    const navLink = e.target.closest(".header-box-nav a");

    // 1. トグルボタンのクリック
    if (menuToggle) {
      const nav = document.querySelector(".header-box-nav");
      const ol = document.querySelector(".menu-overlay");
      
      menuToggle.classList.toggle("active");
      if (nav) nav.classList.toggle("active");
      if (ol) ol.classList.toggle("active");
      
      const isOpen = menuToggle.classList.contains("active");
      document.body.classList.toggle("menu-open", isOpen);
      document.documentElement.classList.toggle("menu-open", isOpen);
      return;
    }

    // 2. オーバーレイまたはナビリンクのクリック（メニューを閉じる）
    if (overlay || navLink) {
      closeMenu();
    }
  });
}