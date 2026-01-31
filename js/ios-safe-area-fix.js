// iOS Safari: safe-area-inset-topの動的監視と調整
(function() {
  'use strict';
  
  // iOSデバイス判定
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  
  if (!isIOS) return;
  
  // safe-area-inset-topの値を取得
  function getSafeAreaInsetTop() {
    const safeAreaTop = getComputedStyle(document.documentElement)
      .getPropertyValue('env(safe-area-inset-top)');
    
    // env()関数はCSSで解決されるため、JavaScriptから直接取得できない
    // 代わりに固定値を使用（ノッチなし: 0, ノッチあり: 約44px）
    const hasNotch = window.screen.height / window.screen.width > 2;
    return hasNotch ? 44 : 0;
  }
  
  // ヘッダーとコンテンツの調整
  function adjustLayout() {
    const safeAreaTop = getSafeAreaInsetTop();
    const header = document.querySelector('.header');
    const siteContent = document.querySelector('.site-content');
    
    if (header && safeAreaTop > 0) {
      // JavaScriptでの動的調整（CSSのcalc()が効かない場合の保険）
      header.style.paddingTop = `calc(5em + ${safeAreaTop}px)`;
      header.style.paddingBottom = `calc(5em + ${safeAreaTop}px)`;
    }
    
    if (siteContent && safeAreaTop > 0) {
      // コンテンツの上部余白調整
      const currentPadding = parseInt(getComputedStyle(siteContent).paddingTop) || 220;
      siteContent.style.paddingTop = `${currentPadding + safeAreaTop}px`;
    }
  }
  
  // 画面向き変更時に再調整
  function handleOrientationChange() {
    setTimeout(adjustLayout, 100);
  }
  
  // 初期化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', adjustLayout);
  } else {
    adjustLayout();
  }
  
  // イベントリスナー登録
  window.addEventListener('orientationchange', handleOrientationChange);
  window.addEventListener('resize', handleOrientationChange);
  
})();
