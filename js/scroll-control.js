document.addEventListener('DOMContentLoaded', function() {
  const profileFloat = document.querySelector('.profile-float');
  const siteFooter = document.querySelector('.site-footer');
  const header = document.querySelector('.header');
  
  if (!header) return;
  
  let lastScrollY = window.scrollY;
  let ticking = false;
  let scrollTimer = null;
  let isHeaderHidden = false;
  let isHeaderHovered = false;
  let scrollDirection = 'up';
  let continuousDownScroll = 0;
  
  const IMG_MAX_HEIGHT = 3.0;
  const IMG_MIN_HEIGHT = 2.0;
  const HEADER_MAX_PADDING = 5.0;
  const HEADER_MIN_PADDING = 1.0;
  const SCROLL_RANGE = 200;
  const HIDE_DELAY = 3000;
  
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                   (window.innerWidth <= 768);
  const shouldAutoHide = !isMobile;
  
  const logoImg = document.querySelector('.header-blog-title img');

  function initHeader() {
    updateHeader();
  }

  function updateHeader() {
    const scrollY = window.scrollY;
    
    if (scrollY > lastScrollY) {
      scrollDirection = 'down';
      continuousDownScroll++;
    } else if (scrollY < lastScrollY) {
      scrollDirection = 'up';
      continuousDownScroll = 0;
    }
    
    // モバイルではパフォーマンスのためCSSトランジションを一時的に無効化
    if (isMobile) {
      header.style.transition = 'none';
      header.style.background = 'transparent';
      header.style.backdropFilter = 'none';
      header.style.webkitBackdropFilter = 'none';
      if (logoImg) logoImg.style.transition = 'none';
    }
    
    let progress = scrollY / SCROLL_RANGE;
    if (progress < 0) progress = 0;
    if (progress > 1) progress = 1;
    
    const currentPadding = HEADER_MAX_PADDING - (progress * (HEADER_MAX_PADDING - HEADER_MIN_PADDING));
    header.style.paddingTop = `calc(${currentPadding}em + env(safe-area-inset-top, 0px))`;
    header.style.paddingBottom = `${currentPadding}em`;
    
    if (logoImg) {
      const currentHeight = IMG_MAX_HEIGHT - (progress * (IMG_MAX_HEIGHT - IMG_MIN_HEIGHT));
      logoImg.style.height = `${currentHeight}rem`;
    }
    
    if (scrollY > 100) {
      header.classList.add('scrolled');
      
      clearTimeout(scrollTimer);
      
      if (!isHeaderHovered && shouldAutoHide && (continuousDownScroll > 5 )) {
        header.classList.add('hidden');
        isHeaderHidden = true;
      } else if (!isHeaderHovered && shouldAutoHide) {
        scrollTimer = setTimeout(() => {
          header.classList.add('hidden');
          isHeaderHidden = true;
        }, HIDE_DELAY);
      }
      
      if (isHeaderHidden && scrollDirection === 'up') {
        header.classList.remove('hidden');
        header.classList.add('showing');
        isHeaderHidden = false;
        
        setTimeout(() => {
          header.classList.remove('showing');
        }, 500);
      }
    } else {
      header.classList.remove('scrolled');
      header.classList.remove('hidden');
      header.classList.remove('showing');
      isHeaderHidden = false;
      continuousDownScroll = 0;
      clearTimeout(scrollTimer);
    }
    
    // モバイルではトランジションを再設定
    if (isMobile) {
      requestAnimationFrame(() => {
        header.style.transition = '';
        header.style.background = 'transparent';
        header.style.backdropFilter = 'none';
        header.style.webkitBackdropFilter = 'none';
        if (logoImg) logoImg.style.transition = '';
      });
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
  
  header.addEventListener('mouseenter', () => {
    isHeaderHovered = true;
    clearTimeout(scrollTimer);
    if (isHeaderHidden) {
      header.classList.remove('hidden');
      header.classList.add('showing');
      isHeaderHidden = false;
      
      setTimeout(() => {
        header.classList.remove('showing');
      }, 300);
    }
  });
  
  header.addEventListener('mouseleave', () => {
    isHeaderHovered = false;
    if (shouldAutoHide && window.scrollY > 100 && !isHeaderHidden) {
      scrollTimer = setTimeout(() => {
        header.classList.add('hidden');
        isHeaderHidden = true;
      }, HIDE_DELAY);
    }
  });
  
  document.addEventListener('mousemove', (e) => {
    if (shouldAutoHide && isHeaderHidden && e.clientY < 100 && !isHeaderHovered && scrollDirection === 'up') {
      header.classList.remove('hidden');
      header.classList.add('showing');
      isHeaderHidden = false;
      
      setTimeout(() => {
        header.classList.remove('showing');
      }, 500);
      
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        header.classList.add('hidden');
        isHeaderHidden = true;
      }, HIDE_DELAY);
    }
  });
  
  initHeader();
  
  if (profileFloat && siteFooter) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          profileFloat.classList.add('hidden');
        } else {
          profileFloat.classList.remove('hidden');
        }
      });
    }, {
      threshold: 0.1
    });
    
    observer.observe(siteFooter);
  }
});
