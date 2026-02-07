// ファビコンのダークモード対応（SVG単体で色制御）
class FaviconController {
  constructor() {
    this.svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg id="_レイヤー_1" data-name="レイヤー 1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 443.79 300">
  <defs>
    <style>
      .cls-1 {
        fill: currentColor;
      }
    </style>
  </defs>
  <path class="cls-1" d="M427.93,12.74c-35.58-20.54-80.32-15.91-110.94,11.48-36.1-32.29-90.7-32.29-126.79,0C151.05-10.8,90.93-7.45,55.92,31.7c-35.01,39.15-31.66,99.26,7.48,134.28,4.87,4.36,9.71,7.94,15.73,11.78,16.18,10.33,20.48,27.83,11.73,43-8.75,15.16-29.54,18.19-43.3,11.6-16.09-7.71-34.55-3.56-43.3,11.6-8.75,15.16-3.56,34.55,11.6,43.3,35.58,20.54,80.32,15.91,110.94-11.48,36.1,32.29,90.7,32.29,126.79,0,39.15,35.01,99.26,31.66,134.28-7.48,35.01-39.15,31.66-99.26-7.48-134.28-4.87-4.36-9.71-7.94-15.73-11.78-16.18-10.33-20.48-27.83-11.73-43,8.75-15.16,29.54-18.19,43.3-11.6,16.09,7.71,34.55,3.56,43.3-11.6,8.75-15.16,3.56-34.55-11.6-43.3ZM142.67,123.04c-7.6,5.12-10.49,7.96-15.88,12.9-5.39-4.93-8.27-7.78-15.88-12.9-10.31-6.94-15.82-16.18-15.82-27.95,0-17.51,14.19-31.7,31.7-31.7h0c17.51,0,31.7,14.19,31.7,31.7,0,11.77-5.52,21.01-15.82,27.95ZM190.2,236.61h0c-17.51,0-31.7-14.19-31.7-31.7,0-11.77,5.52-21.01,15.82-27.95,7.6-5.12,10.49-7.96,15.88-12.9,5.39,4.93,8.27,7.78,15.88,12.9,10.31,6.94,15.82,16.18,15.82,27.95,0,17.51-14.19,31.7-31.7,31.7ZM269.47,123.04c-7.6,5.12-10.49,7.96-15.88,12.9-5.39-4.93-8.27-7.78-15.88-12.9-10.31-6.94-15.82-16.18-15.82-27.95,0-17.51,14.19-31.7,31.7-31.7h0c17.51,0,31.7,14.19,31.7,31.7,0,11.77-5.52,21.01-15.82,27.95ZM348.69,204.91c0,17.51-14.19,31.7-31.7,31.7h0c-17.51,0-31.7-14.19-31.7-31.7,0-11.77,5.52-21.01,15.82-27.95,7.6-5.12,10.49-7.96,15.88-12.9,5.39,4.93,8.27,7.78,15.88,12.9,10.31,6.94,15.82,16.18,15.82,27.95Z"/>
</svg>`;
    this.init();
  }

  init() {
    // 初期設定
    this.updateFavicon();
    
    // ダークモードの変更を監視
    this.observeDarkMode();
    
    // システムテーマの変更を監視
    this.observeSystemTheme();
  }

  updateFavicon() {
    const isDarkMode = this.isDarkMode();
    const color = isDarkMode ? '#ffffff' : '#090000';
    
    // SVGのcurrentColorを置換
    const coloredSvg = this.svgContent.replace('fill: currentColor', `fill: ${color}`);
    
    // Data URIに変換
    const svgDataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(coloredSvg)));
    
    // 既存のファビコンを削除
    this.removeFaviconLinks();
    
    // 新しいファビコンを設定
    this.setFavicon(svgDataUri);
  }

  isDarkMode() {
    // CSSの prefers-color-scheme をチェック
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return true;
    }
    
    // 手動のダークモードクラスをチェック
    if (document.documentElement.classList.contains('dark-mode') ||
        document.body.classList.contains('dark-mode')) {
      return true;
    }
    
    return false;
  }

  setFavicon(url) {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = url;
    
    // IE用のicoファイルも設定（必要な場合）
    const icoLink = document.createElement('link');
    icoLink.rel = 'icon';
    icoLink.type = 'image/x-icon';
    icoLink.href = url;
    
    document.head.appendChild(link);
    document.head.appendChild(icoLink);
  }

  removeFaviconLinks() {
    const links = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]');
    links.forEach(link => link.remove());
  }

  observeDarkMode() {
    // MutationObserverでDOMの変更を監視
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && 
            (mutation.attributeName === 'class')) {
          this.updateFavicon();
        }
      });
    });

    // html要素とbody要素を監視
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });
    
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  observeSystemTheme() {
    // システムテーマの変更を監視
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      // 古いブラウザ対応
      if (mediaQuery.addListener) {
        mediaQuery.addListener(() => this.updateFavicon());
      } else {
        mediaQuery.addEventListener('change', () => this.updateFavicon());
      }
    }
  }
}

// 1回だけ初期化
function initFavicon() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      new FaviconController();
    }, { once: true });
  } else {
    new FaviconController();
  }
}
