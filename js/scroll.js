import { state } from './state.js';

export function initScroll() {
  if (state.init.scrollInitialized) return;
  state.init.scrollInitialized = true;

  const IMG_MAX_HEIGHT = 3.0;
  const IMG_MIN_HEIGHT = 2.0;
  const HEADER_MAX_PADDING = 5.0;
  const HEADER_MIN_PADDING = 1.0;
  const SCROLL_RANGE = 200;
  const HIDE_DELAY = 3000;

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                   (window.innerWidth <= 768);

  function checkMenuState() {
    const isHamburgerMenu = window.matchMedia('(max-width: 767px)').matches;
    // state.ui 階層へ保存
    state.ui.shouldAutoHide = !isMobile && !isHamburgerMenu;
    return state.ui.shouldAutoHide;
  }

  function updateHeader() {
    const header = document.querySelector('.header');
    const logoImg = document.querySelector('.header-blog-title img');
    if (!header) return;

    const scrollY = window.scrollY;
    checkMenuState();
    
    // スクロール方向と継続距離の判定（state.ui を使用）
    if (scrollY > state.ui.lastScrollY) {
      state.ui.scrollDirection = 'down';
      state.ui.continuousDownScroll++;
    } else if (scrollY < state.ui.lastScrollY) {
      state.ui.scrollDirection = 'up';
      state.ui.continuousDownScroll = 0;
    }
    
    // モバイル最適化
    if (isMobile) {
      header.style.transition = 'none';
      if (logoImg) logoImg.style.transition = 'none';
    }
    
    let progress = Math.max(0, Math.min(scrollY / SCROLL_RANGE, 1));
    
    const currentPadding = HEADER_MAX_PADDING - (progress * (HEADER_MAX_PADDING - HEADER_MIN_PADDING));
    header.style.paddingTop = `calc(${currentPadding}em + env(safe-area-inset-top, 0px))`;
    header.style.paddingBottom = `${currentPadding}em`;
    
    if (logoImg) {
      const currentHeight = IMG_MAX_HEIGHT - (progress * (IMG_MAX_HEIGHT - IMG_MIN_HEIGHT));
      logoImg.style.height = `${currentHeight}rem`;
    }
    
    if (scrollY > 100) {
      header.classList.add('scrolled');
      clearTimeout(state.ui.scrollTimer);
      
      if (!state.ui.isHeaderHovered && state.ui.shouldAutoHide && (state.ui.continuousDownScroll > 5)) {
        header.classList.add('hidden');
        state.ui.isHeaderHidden = true;
      } else if (!state.ui.isHeaderHovered && state.ui.shouldAutoHide) {
        state.ui.scrollTimer = setTimeout(() => {
          header.classList.add('hidden');
          state.ui.isHeaderHidden = true;
        }, HIDE_DELAY);
      }
      
      if (state.ui.isHeaderHidden && state.ui.scrollDirection === 'up') {
        header.classList.remove('hidden');
        header.classList.add('showing');
        state.ui.isHeaderHidden = false;
        
        setTimeout(() => {
          header.classList.remove('showing');
        }, 500);
      }
    } else {
      header.classList.remove('scrolled', 'hidden', 'showing');
      state.ui.isHeaderHidden = false;
      state.ui.continuousDownScroll = 0;
      clearTimeout(state.ui.scrollTimer);
    }
    
    if (isMobile) {
      requestAnimationFrame(() => {
        header.style.transition = '';
        if (logoImg) logoImg.style.transition = '';
      });
    }
    
    state.ui.lastScrollY = scrollY;
    state.ui.ticking = false;
  }

  function requestTick() {
    if (!state.ui.ticking) {
      window.requestAnimationFrame(updateHeader);
      state.ui.ticking = true;
    }
  }

  window.addEventListener('scroll', requestTick);

  // メディアクエリ監視
  window.matchMedia('(max-width: 767px)').addEventListener('change', () => {
    const oldAutoHide = state.ui.shouldAutoHide;
    checkMenuState();
    if (oldAutoHide !== state.ui.shouldAutoHide) {
      const header = document.querySelector('.header');
      if (header) header.classList.remove('hidden', 'showing');
      state.ui.isHeaderHidden = false;
      clearTimeout(state.ui.scrollTimer);
    }
  });

  // ヘッダーのマウスイベント
  const headerEl = document.querySelector('.header');
  if (headerEl) {
    headerEl.addEventListener('mouseenter', () => {
      state.ui.isHeaderHovered = true;
      clearTimeout(state.ui.scrollTimer);
      if (state.ui.isHeaderHidden) {
        headerEl.classList.remove('hidden');
        headerEl.classList.add('showing');
        state.ui.isHeaderHidden = false;
        setTimeout(() => headerEl.classList.remove('showing'), 300);
      }
    });

    headerEl.addEventListener('mouseleave', () => {
      state.ui.isHeaderHovered = false;
      if (state.ui.shouldAutoHide && window.scrollY > 100 && !state.ui.isHeaderHidden) {
        state.ui.scrollTimer = setTimeout(() => {
          const h = document.querySelector('.header');
          if (h) {
            h.classList.add('hidden');
            state.ui.isHeaderHidden = true;
          }
        }, HIDE_DELAY);
      }
    });
  }

  // 近接マウス移動による復帰
  document.addEventListener('mousemove', (e) => {
    if (state.ui.shouldAutoHide && state.ui.isHeaderHidden && e.clientY < 100 && !state.ui.isHeaderHovered && state.ui.scrollDirection === 'up') {
      const header = document.querySelector('.header');
      if (!header) return;
      header.classList.remove('hidden');
      header.classList.add('showing');
      state.ui.isHeaderHidden = false;
      
      setTimeout(() => header.classList.remove('showing'), 500);
      clearTimeout(state.ui.scrollTimer);
      state.ui.scrollTimer = setTimeout(() => {
        header.classList.add('hidden');
        state.ui.isHeaderHidden = true;
      }, HIDE_DELAY);
    }
  });

  // 初期実行
  checkMenuState();
  requestTick();

  // フッター監視
  const siteFooter = document.querySelector('.site-footer');
  const profileFloat = document.querySelector('.profile-float');
  if (profileFloat && siteFooter) {
    new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        profileFloat.classList.toggle('hidden', entry.isIntersecting);
      });
    }, { threshold: 0.1 }).observe(siteFooter);
  }
}