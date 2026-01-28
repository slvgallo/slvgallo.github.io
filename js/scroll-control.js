// フロートボタンとヘッダースクロル制御
document.addEventListener('DOMContentLoaded', function() {
  const profileFloat = document.querySelector('.profile-float');
  const siteFooter = document.querySelector('.site-footer');
  const header = document.querySelector('.header');
  
  if (!profileFloat || !siteFooter || !header) return;
  
  // ヘッダースクロル制御
  let lastScrollY = window.scrollY;
  let ticking = false;
  
  // パラメータ設定
  const IMG_MAX_HEIGHT = 3.0; // rem
  const IMG_MIN_HEIGHT = 2.0; // rem
  const HEADER_MAX_PADDING = 5.0; // em
  const HEADER_MIN_PADDING = 1.0; // em
  const SCROLL_RANGE = 200; // px
  
  // ロゴ画像の要素
  const logoImg = document.querySelector('.header-blog-title img');

  // 初期化関数
  function initHeader() {
    updateHeader();
  }

  function updateHeader() {
    const scrollY = window.scrollY;
    
    // スクロール量に基づく進捗（0.0〜1.0）
    let progress = scrollY / SCROLL_RANGE;
    if (progress < 0) progress = 0;
    if (progress > 1) progress = 1;
    
    // パディングの計算
    // progress 0 -> MAX, 1 -> MIN
    const currentPadding = HEADER_MAX_PADDING - (progress * (HEADER_MAX_PADDING - HEADER_MIN_PADDING));
    header.style.paddingTop = `${currentPadding}em`;
    header.style.paddingBottom = `${currentPadding}em`;
    
    // ロゴ画像サイズの計算
    if (logoImg) {
      const currentHeight = IMG_MAX_HEIGHT - (progress * (IMG_MAX_HEIGHT - IMG_MIN_HEIGHT));
      logoImg.style.height = `${currentHeight}rem`;
    }
    
    // 背景色などの切り替え（必要であればクラス付与だけ残す）
    if (scrollY > 100) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
    
    lastScrollY = scrollY;
    ticking = false;
  }

  function requestTick() {
    if (!ticking) {
      window.requestAnimationFrame(updateHeader);
      ticking = true;
    }
  }

  window.addEventListener('scroll', requestTick);
  
  // 初期化実行
  initHeader();
  
  // Intersection Observerを使用してフッターの表示を検知
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        // フッターが表示されたらフロートボタンを非表示
        profileFloat.classList.add('hidden');
      } else {
        // フッターが非表示になったらフロートボタンを表示
        profileFloat.classList.remove('hidden');
      }
    });
  }, {
    threshold: 0.1 // フッターの10%が表示されたら発火
  });
  
  // フッターを監視
  observer.observe(siteFooter);
});
