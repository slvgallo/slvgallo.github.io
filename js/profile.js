// プロフィールページのインタラクティブ機能

document.addEventListener("DOMContentLoaded", function () {
  // スムーズスクロール
  const links = document.querySelectorAll('a[href^="#"]');
  links.forEach((link) => {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute("href"));
      if (target) {
        target.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    });
  });

  // スキルアイテムのアニメーション
  const skillItems = document.querySelectorAll(".skill-item");
  const observerOptions = {
    threshold: 0.1,
    rootMargin: "0px 0px -50px 0px",
  };

  const observer = new IntersectionObserver(function (entries) {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = "1";
        entry.target.style.transform = "translateY(0)";
      }
    });
  }, observerOptions);

  skillItems.forEach((item) => {
    item.style.opacity = "0";
    item.style.transform = "translateY(20px)";
    item.style.transition = "opacity 0.6s ease, transform 0.6s ease";
    observer.observe(item);
  });

  // 注目作品のホバーエフェクト強化
  const featuredWorks = document.querySelectorAll(".featured-work");
  featuredWorks.forEach((work) => {
    work.addEventListener("mouseenter", function () {
      this.style.transform = "translateY(-8px) scale(1.02)";
    });

    work.addEventListener("mouseleave", function () {
      this.style.transform = "translateY(-4px) scale(1)";
    });
  });

  // コンタクトリンクのクリックトラッキング（任意）
  const contactLinks = document.querySelectorAll(".contact-link");
  contactLinks.forEach((link) => {
    link.addEventListener("click", function () {
      const platform = this.querySelector(".contact-platform").textContent;
      console.log(`Contact link clicked: ${platform}`);
    });
  });
});
