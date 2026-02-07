// ハンバーガーメニューの制御
export function initMenu() {
  const menuToggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".header-box-nav");
  const overlay = document.querySelector(".menu-overlay");

  if (menuToggle && nav && overlay) {
    menuToggle.addEventListener("click", function () {
      menuToggle.classList.toggle("active");
      nav.classList.toggle("active");
      overlay.classList.toggle("active");
      document.body.classList.toggle("menu-open");
      document.documentElement.classList.toggle("menu-open");
    });

    overlay.addEventListener("click", function () {
      menuToggle.classList.remove("active");
      nav.classList.remove("active");
      overlay.classList.remove("active");
      document.body.classList.remove("menu-open");
      document.documentElement.classList.remove("menu-open");
    });

    // メニュー内のリンクをクリックしたらメニューを閉じる
    const navLinks = nav.querySelectorAll("a");
    navLinks.forEach((link) => {
      link.addEventListener("click", function () {
        menuToggle.classList.remove("active");
        nav.classList.remove("active");
        overlay.classList.remove("active");
        document.body.classList.remove("menu-open");
        document.documentElement.classList.remove("menu-open");
      });
    });
  }
}
