import { state } from './state.js';

const STORAGE_KEY = 'preferredLanguage';
const DEFAULT_LANGUAGE = 'en';
const LANGUAGE_TRANSITION = Object.freeze({
  enabled: true,
  media:
    '(min-width: 769px) and (prefers-reduced-motion: no-preference)'
});

function readPreferredLanguage() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'ja'
      ? 'ja'
      : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function savePreferredLanguage(language) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Language switching remains functional when storage is unavailable.
  }
}

function createTransitionLoader() {
  let componentPromise = null;

  return function loadTransitionComponent() {
    if (
      !LANGUAGE_TRANSITION.enabled ||
      !window.matchMedia(LANGUAGE_TRANSITION.media).matches
    ) {
      return Promise.resolve(null);
    }

    if (!componentPromise) {
      componentPromise = import('./language-transition.js')
        .then(({ createLanguageTransition }) => createLanguageTransition())
        .catch(error => {
          console.warn('Language transition disabled:', error);
          return null;
        });
    }

    return componentPromise;
  };
}

function languageFromTarget(target, container) {
  const button = target instanceof Element
    ? target.closest('#lang-en, #lang-ja')
    : null;
  if (!button || !container.contains(button)) return null;
  return button.id === 'lang-ja' ? 'ja' : 'en';
}

export function initLangToggle() {
  if (state.init.langInitialized) return;
  state.init.langInitialized = true;

  const langButtons = document.querySelector('.lang-buttons');
  const langEnBtn = document.getElementById('lang-en');
  const langJaBtn = document.getElementById('lang-ja');

  if (!langButtons || !langEnBtn || !langJaBtn) return;

  const titleRow = langButtons.closest('.work-title-row');
  const entryTitle = titleRow?.querySelector('.entry-title');
  const mobileTitleLayout = window.matchMedia('(max-width: 768px)');
  let titleLayoutFrame = 0;

  function updateTitleLayout() {
    titleLayoutFrame = 0;
    if (!titleRow || !entryTitle) return;

    titleRow.classList.remove('is-stacked');
    if (!mobileTitleLayout.matches) return;

    titleRow.classList.add('is-measuring');
    const rowStyle = window.getComputedStyle(titleRow);
    const gap = parseFloat(rowStyle.columnGap || rowStyle.gap) || 0;
    const requiredWidth = entryTitle.scrollWidth + langButtons.offsetWidth + gap;
    const availableWidth = titleRow.clientWidth;
    titleRow.classList.remove('is-measuring');
    titleRow.classList.toggle('is-stacked', requiredWidth > availableWidth + 0.5);
  }

  function scheduleTitleLayout() {
    if (titleLayoutFrame) cancelAnimationFrame(titleLayoutFrame);
    titleLayoutFrame = requestAnimationFrame(updateTitleLayout);
  }

  scheduleTitleLayout();
  window.addEventListener('resize', scheduleTitleLayout, {passive: true});
  if (mobileTitleLayout.addEventListener) {
    mobileTitleLayout.addEventListener('change', scheduleTitleLayout);
  }
  if (document.fonts?.ready) {
    document.fonts.ready.then(scheduleTitleLayout);
  }

  let currentLang = readPreferredLanguage();
  let transitioning = false;
  const loadTransitionComponent = createTransitionLoader();

  function setLanguage(lang) {
    currentLang = lang;
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.classList.toggle('lang-en-active', lang === 'en');
    document.documentElement.classList.toggle('lang-ja-active', lang === 'ja');

    // ボタンの状態更新
    langEnBtn.classList.toggle('active', lang === 'en');
    langJaBtn.classList.toggle('active', lang === 'ja');
    langEnBtn.setAttribute('aria-pressed', String(lang === 'en'));
    langJaBtn.setAttribute('aria-pressed', String(lang === 'ja'));
  }

  function commitLanguage(lang) {
    setLanguage(lang);
    savePreferredLanguage(lang);
  }

  function setTransitioning(isTransitioning) {
    transitioning = isTransitioning;
    langEnBtn.disabled = isTransitioning;
    langJaBtn.disabled = isTransitioning;
  }

  async function switchLanguage(lang) {
    if (transitioning || lang === currentLang) return;

    const sourceLanguage = currentLang;
    const commit = () => commitLanguage(lang);
    setTransitioning(true);

    try {
      const transitionComponent = await loadTransitionComponent();
      if (transitionComponent) {
        await transitionComponent.run(
          sourceLanguage,
          lang,
          commit
        );
      } else {
        commit();
      }
    } catch (error) {
      console.warn('Language transition failed:', error);
      if (currentLang !== lang) commit();
    } finally {
      setTransitioning(false);
    }
  }

  // 初期実行
  setLanguage(currentLang);

  // イベント委譲によるクリック制御
  document.addEventListener('click', (e) => {
    const language = languageFromTarget(e.target, langButtons);
    if (language) void switchLanguage(language);
  });

  // キーボード操作の改善
  langButtons.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const language = languageFromTarget(e.target, langButtons);
      if (!language) return;
      e.preventDefault();
      void switchLanguage(language);
    }
  });
}
