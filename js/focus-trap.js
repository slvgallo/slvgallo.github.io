/**
 * 汎用フォーカストラップユーティリティ
 * menu.jsのロジックを再利用可能な関数に抽出
 */

export function createFocusTrap(container, options = {}) {
  const {
    onEscape = null,
    onActivate = null,
    onDeactivate = null,
    initialFocus = true,
    restoreFocus = true,
    triggerElement = null
  } = options;

  let focusableElements = [];
  let firstFocusableEl = null;
  let lastFocusableEl = null;
  let keydownHandler = null;
  let isActive = false;

  function getFocusableElements() {
    return Array.from(container.querySelectorAll(
      'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
  }

  function activate() {
    if (isActive) return;
    isActive = true;

    focusableElements = getFocusableElements();
    firstFocusableEl = focusableElements[0];
    lastFocusableEl = focusableElements[focusableElements.length - 1];

    keydownHandler = (e) => {
      if (e.key === 'Escape') {
        if (onEscape) {
          onEscape(e);
        } else {
          deactivate();
        }
        return;
      }

      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === firstFocusableEl) {
            e.preventDefault();
            lastFocusableEl.focus();
          }
        } else {
          if (document.activeElement === lastFocusableEl) {
            e.preventDefault();
            firstFocusableEl.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', keydownHandler);

    if (initialFocus && firstFocusableEl) {
      setTimeout(() => firstFocusableEl.focus(), 100);
    }

    if (onActivate) {
      onActivate();
    }
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;

    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }

    if (restoreFocus && triggerElement) {
      triggerElement.focus();
    }

    if (onDeactivate) {
      onDeactivate();
    }
  }

  function update() {
    if (isActive) {
      focusableElements = getFocusableElements();
      firstFocusableEl = focusableElements[0];
      lastFocusableEl = focusableElements[focusableElements.length - 1];
    }
  }

  return {
    activate,
    deactivate,
    update,
    isActive: () => isActive
  };
}
