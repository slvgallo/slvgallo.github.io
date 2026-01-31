// ハンバーガーメニューの制御
(function () {
  const menuToggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".header-box-nav");
  const overlay = document.querySelector(".menu-overlay");

  if (menuToggle && nav && overlay) {
    menuToggle.addEventListener("click", function () {
      menuToggle.classList.toggle("active");
      nav.classList.toggle("active");
      overlay.classList.toggle("active");
    });

    overlay.addEventListener("click", function () {
      menuToggle.classList.remove("active");
      nav.classList.remove("active");
      overlay.classList.remove("active");
    });

    // メニュー内のリンクをクリックしたらメニューを閉じる
    const navLinks = nav.querySelectorAll("a");
    navLinks.forEach((link) => {
      link.addEventListener("click", function () {
        menuToggle.classList.remove("active");
        nav.classList.remove("active");
        overlay.classList.remove("active");
      });
    });
  }
})();
