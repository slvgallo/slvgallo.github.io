import { SCROLL, SCROLL_BEHAVIOR, MOBILE, TIMEOUTS } from './constants.js';

export class ScrollController {
  constructor() {
    this.profileFloat = document.querySelector('.profile-float');
    this.siteFooter = document.querySelector('.site-footer');
    this.header = document.querySelector('.header');
    this.logoImg = document.querySelector('.header-blog-title img');
    
    if (!this.header) return;
    
    // State variables (preserving original logic)
    this.lastScrollY = window.scrollY;
    this.ticking = false;
    this.scrollTimer = null;
    this.scrollDirection = 'up';
    this.continuousDownScroll = 0;
    
    // Constants from original file
    this.IMG_MAX_HEIGHT = SCROLL.IMG_MAX_HEIGHT;
    this.IMG_MIN_HEIGHT = SCROLL.IMG_MIN_HEIGHT;
    this.HEADER_MAX_PADDING = SCROLL.HEADER_MAX_PADDING;
    this.HEADER_MIN_PADDING = SCROLL.HEADER_MIN_PADDING;
    this.SCROLL_RANGE = SCROLL.SCROLL_RANGE;
    this.HIDE_DELAY = SCROLL.HIDE_DELAY;
    
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                     (window.innerWidth <= MOBILE.BREAKPOINT);
    this.shouldAutoHide = !this.isMobile;
    
    this.footerObserver = null;
  }

  init() {
    if (!this.header) return;
    
    this.initHeader();
    this.setupScrollListener();
    this.setupHeaderHover();
    this.setupMouseTracking();
    this.setupFooterObserver();
  }

  initHeader() {
    this.updateHeader();
  }

  // DOM-driven state methods
  isHeaderHidden() {
    return this.header.classList.contains('hidden');
  }

  isHeaderShowing() {
    return this.header.classList.contains('showing');
  }

  isHeaderScrolled() {
    return this.header.classList.contains('scrolled');
  }

  setHeaderHidden(hidden) {
    if (hidden) {
      this.header.classList.add('hidden');
      this.header.classList.remove('showing');
    } else {
      this.header.classList.remove('hidden');
    }
  }

  setHeaderShowing(showing) {
    if (showing) {
      this.header.classList.add('showing');
    } else {
      this.header.classList.remove('showing');
    }
  }

  setHeaderScrolled(scrolled) {
    if (scrolled) {
      this.header.classList.add('scrolled');
    } else {
      this.header.classList.remove('scrolled');
      this.header.classList.remove('hidden');
      this.header.classList.remove('showing');
      this.continuousDownScroll = 0;
      clearTimeout(this.scrollTimer);
    }
  }

  updateHeader() {
    const scrollY = window.scrollY;
    
    if (scrollY > this.lastScrollY) {
      this.scrollDirection = 'down';
      this.continuousDownScroll++;
    } else if (scrollY < this.lastScrollY) {
      this.scrollDirection = 'up';
      this.continuousDownScroll = 0;
    }
    
    // モバイルではパフォーマンスのためCSSトランジションを一時的に無効化
    if (this.isMobile) {
      this.header.style.transition = 'none';
      this.header.style.background = 'transparent';
      this.header.style.backdropFilter = 'none';
      this.header.style.webkitBackdropFilter = 'none';
      if (this.logoImg) this.logoImg.style.transition = 'none';
    }
    
    let progress = scrollY / this.SCROLL_RANGE;
    if (progress < 0) progress = 0;
    if (progress > 1) progress = 1;
    
    const currentPadding = this.HEADER_MAX_PADDING - (progress * (this.HEADER_MAX_PADDING - this.HEADER_MIN_PADDING));
    this.header.style.paddingTop = `calc(${currentPadding}em + env(safe-area-inset-top, 0px))`;
    this.header.style.paddingBottom = `${currentPadding}em`;
    
    if (this.logoImg) {
      const currentHeight = this.IMG_MAX_HEIGHT - (progress * (this.IMG_MAX_HEIGHT - this.IMG_MIN_HEIGHT));
      this.logoImg.style.height = `${currentHeight}rem`;
    }
    
    if (scrollY > SCROLL_BEHAVIOR.SCROLLED_THRESHOLD) {
      this.setHeaderScrolled(true);
      
      clearTimeout(this.scrollTimer);
      
      if (this.shouldAutoHide && (this.continuousDownScroll > SCROLL_BEHAVIOR.CONTINUOUS_DOWN_THRESHOLD)) {
        this.setHeaderHidden(true);
      } else if (this.shouldAutoHide) {
        this.scrollTimer = setTimeout(() => {
          this.setHeaderHidden(true);
        }, this.HIDE_DELAY);
      }
      
      if (this.isHeaderHidden() && this.scrollDirection === 'up') {
        this.setHeaderHidden(false);
        this.setHeaderShowing(true);
        
        setTimeout(() => {
          this.setHeaderShowing(false);
        }, TIMEOUTS.HEADER_SHOW_DELAY);
      }
    } else {
      this.setHeaderScrolled(false);
    }
    
    // モバイルではトランジションを再設定
    if (this.isMobile) {
      requestAnimationFrame(() => {
        this.header.style.transition = '';
        this.header.style.background = 'transparent';
        this.header.style.backdropFilter = 'none';
        this.header.style.webkitBackdropFilter = 'none';
        if (this.logoImg) this.logoImg.style.transition = '';
      });
    }
    
    this.lastScrollY = scrollY;
    this.ticking = false;
  }

  requestTick() {
    if (!this.ticking) {
      window.requestAnimationFrame(() => this.updateHeader());
      this.ticking = true;
    }
  }

  setupScrollListener() {
    window.addEventListener('scroll', () => this.requestTick());
  }

  setupHeaderHover() {
    this.header.addEventListener('mouseenter', () => {
      clearTimeout(this.scrollTimer);
      if (this.isHeaderHidden()) {
        this.setHeaderHidden(false);
        this.setHeaderShowing(true);
        
        setTimeout(() => {
          this.setHeaderShowing(false);
        }, TIMEOUTS.HEADER_SHOW_DELAY_HOVER);
      }
    });
    
    this.header.addEventListener('mouseleave', () => {
      if (this.shouldAutoHide && window.scrollY > SCROLL_BEHAVIOR.SCROLLED_THRESHOLD && !this.isHeaderHidden()) {
        this.scrollTimer = setTimeout(() => {
          this.setHeaderHidden(true);
        }, this.HIDE_DELAY);
      }
    });
  }

  setupMouseTracking() {
    document.addEventListener('mousemove', (e) => {
      if (this.shouldAutoHide && this.isHeaderHidden() && e.clientY < SCROLL_BEHAVIOR.MOUSE_EDGE_THRESHOLD && this.scrollDirection === 'up') {
        this.setHeaderHidden(false);
        this.setHeaderShowing(true);
        
        setTimeout(() => {
          this.setHeaderShowing(false);
        }, TIMEOUTS.HEADER_SHOW_DELAY);
        
        clearTimeout(this.scrollTimer);
        this.scrollTimer = setTimeout(() => {
          this.setHeaderHidden(true);
        }, this.HIDE_DELAY);
      }
    });
  }

  setupFooterObserver() {
    if (this.profileFloat && this.siteFooter) {
      this.footerObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            this.profileFloat.classList.add('hidden');
          } else {
            this.profileFloat.classList.remove('hidden');
          }
        });
      }, {
        threshold: 0.1
      });
      
      this.footerObserver.observe(this.siteFooter);
    }
  }

  // Cleanup method to prevent memory leaks
  destroy() {
    if (this.footerObserver) {
      this.footerObserver.disconnect();
    }
    clearTimeout(this.scrollTimer);
    window.removeEventListener('scroll', this.requestTick);
  }
}

// Initialize function for compatibility with existing structure
export function initScroll() {
  const scrollController = new ScrollController();
  scrollController.init();
  return scrollController;
}
