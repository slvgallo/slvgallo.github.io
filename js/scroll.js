import { state } from './state.js';
import { supportsScrollDrivenAnimations } from './utils.js';

const MOBILE_MEDIA_QUERY = '(max-width: 767px)';
const IMG_MAX_HEIGHT = 3;
const IMG_MIN_HEIGHT = 2;
const HEADER_MAX_PADDING = 5;
const HEADER_MIN_PADDING = 1;
const SCROLL_RANGE = 200;
const AUTO_HIDE_THRESHOLD = 100;
const HIDE_DELAY = 3000;

export function initScroll() {
  if (state.init.scrollInitialized) return;
  state.init.scrollInitialized = true;

  const header = document.querySelector('.header');
  if (!header) return;

  const logoImg = header.querySelector('.header-title img');
  const mobileMediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
  const supportsNativeScrollAnimation = supportsScrollDrivenAnimations();
  let scrollListenerAttached = false;

  function isMobileLayout() {
    return mobileMediaQuery.matches;
  }

  function checkMenuState() {
    state.ui.shouldAutoHide = !isMobileLayout();
  }

  function applyFallbackHeaderMotion(scrollY) {
    if (supportsNativeScrollAnimation) return;

    const progress = Math.max(0, Math.min(scrollY / SCROLL_RANGE, 1));

    if (isMobileLayout()) {
      const offset =
        -progress * (HEADER_MAX_PADDING - HEADER_MIN_PADDING);
      const minScale = IMG_MIN_HEIGHT / IMG_MAX_HEIGHT;
      const scale = minScale + (1 - progress) * (1 - minScale);

      header.style.setProperty('--header-fallback-offset', `${offset}rem`);
      header.style.setProperty(
        '--header-fallback-logo-scale',
        String(scale)
      );
      return;
    }

    const currentPadding =
      HEADER_MAX_PADDING -
      progress * (HEADER_MAX_PADDING - HEADER_MIN_PADDING);
    header.style.paddingTop =
      `calc(${currentPadding}em + env(safe-area-inset-top, 0px))`;
    header.style.paddingBottom = `${currentPadding}em`;

    if (logoImg) {
      const currentHeight =
        IMG_MAX_HEIGHT - progress * (IMG_MAX_HEIGHT - IMG_MIN_HEIGHT);
      logoImg.style.height = `${currentHeight}rem`;
    }
  }

  function updateScrollDirection(scrollY) {
    if (scrollY > state.ui.lastScrollY) {
      state.ui.scrollDirection = 'down';
      state.ui.continuousDownScroll++;
    } else if (scrollY < state.ui.lastScrollY) {
      state.ui.scrollDirection = 'up';
      state.ui.continuousDownScroll = 0;
    }
  }

  function updateHeaderVisibility(scrollY) {
    if (scrollY <= AUTO_HIDE_THRESHOLD) {
      header.classList.remove('scrolled', 'hidden', 'showing');
      state.ui.isHeaderHidden = false;
      state.ui.continuousDownScroll = 0;
      clearTimeout(state.ui.scrollTimer);
      return;
    }

    header.classList.add('scrolled');
    clearTimeout(state.ui.scrollTimer);

    if (
      !state.ui.isHeaderHovered &&
      state.ui.shouldAutoHide &&
      state.ui.continuousDownScroll > 5
    ) {
      header.classList.add('hidden');
      state.ui.isHeaderHidden = true;
    } else if (!state.ui.isHeaderHovered && state.ui.shouldAutoHide) {
      state.ui.scrollTimer = setTimeout(() => {
        header.classList.add('hidden');
        state.ui.isHeaderHidden = true;
      }, HIDE_DELAY);
    }

    if (
      state.ui.isHeaderHidden &&
      state.ui.scrollDirection === 'up'
    ) {
      header.classList.remove('hidden');
      header.classList.add('showing');
      state.ui.isHeaderHidden = false;

      setTimeout(() => {
        header.classList.remove('showing');
      }, 500);
    }
  }

  function updateHeader() {
    const scrollY = window.scrollY;

    checkMenuState();
    updateScrollDirection(scrollY);
    applyFallbackHeaderMotion(scrollY);
    updateHeaderVisibility(scrollY);

    state.ui.lastScrollY = scrollY;
    state.ui.ticking = false;
  }

  function requestTick() {
    if (state.ui.ticking) return;

    window.requestAnimationFrame(updateHeader);
    state.ui.ticking = true;
  }

  function shouldTrackScroll() {
    return !supportsNativeScrollAnimation || !isMobileLayout();
  }

  function syncScrollListener() {
    const shouldAttach = shouldTrackScroll();

    if (shouldAttach && !scrollListenerAttached) {
      window.addEventListener('scroll', requestTick);
      scrollListenerAttached = true;
      requestTick();
    } else if (!shouldAttach && scrollListenerAttached) {
      window.removeEventListener('scroll', requestTick);
      scrollListenerAttached = false;
    }
  }

  function resetFallbackInlineStyles() {
    header.style.removeProperty('padding-top');
    header.style.removeProperty('padding-bottom');
    if (logoImg) logoImg.style.removeProperty('height');
  }

  function handleLayoutChange() {
    resetFallbackInlineStyles();
    checkMenuState();
    header.classList.remove('hidden', 'showing');
    state.ui.isHeaderHidden = false;
    state.ui.lastScrollY = window.scrollY;
    clearTimeout(state.ui.scrollTimer);
    syncScrollListener();
  }

  if (typeof mobileMediaQuery.addEventListener === 'function') {
    mobileMediaQuery.addEventListener('change', handleLayoutChange);
  } else {
    mobileMediaQuery.addListener(handleLayoutChange);
  }

  header.addEventListener('mouseenter', () => {
    state.ui.isHeaderHovered = true;
    clearTimeout(state.ui.scrollTimer);

    if (state.ui.isHeaderHidden) {
      header.classList.remove('hidden');
      header.classList.add('showing');
      state.ui.isHeaderHidden = false;
      setTimeout(() => header.classList.remove('showing'), 300);
    }
  });

  header.addEventListener('mouseleave', () => {
    state.ui.isHeaderHovered = false;

    if (
      state.ui.shouldAutoHide &&
      window.scrollY > AUTO_HIDE_THRESHOLD &&
      !state.ui.isHeaderHidden
    ) {
      state.ui.scrollTimer = setTimeout(() => {
        header.classList.add('hidden');
        state.ui.isHeaderHidden = true;
      }, HIDE_DELAY);
    }
  });

  document.addEventListener('mousemove', (event) => {
    if (
      !state.ui.shouldAutoHide ||
      !state.ui.isHeaderHidden ||
      event.clientY >= AUTO_HIDE_THRESHOLD ||
      state.ui.isHeaderHovered ||
      state.ui.scrollDirection !== 'up'
    ) {
      return;
    }

    header.classList.remove('hidden');
    header.classList.add('showing');
    state.ui.isHeaderHidden = false;

    setTimeout(() => header.classList.remove('showing'), 500);

    clearTimeout(state.ui.scrollTimer);
    state.ui.scrollTimer = setTimeout(() => {
      header.classList.add('hidden');
      state.ui.isHeaderHidden = true;
    }, HIDE_DELAY);
  });

  checkMenuState();
  syncScrollListener();

  const siteFooter = document.querySelector('.site-footer');
  const profileFloat = document.querySelector('.profile-float');

  if (profileFloat && siteFooter) {
    new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          profileFloat.classList.toggle('hidden', entry.isIntersecting);
        });
      },
      { threshold: 0.1 }
    ).observe(siteFooter);
  }
}
