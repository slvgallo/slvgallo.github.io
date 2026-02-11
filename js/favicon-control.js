/**
 * FaviconController
 * サイトのファビコンをダークモード/ライトモードに合わせて動的に切り替える
 */
class FaviconController {
  constructor() {
    this.svgContent = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 443.79 300"><path fill="currentColor" d="M427.93,12.74c-35.58-20.54-80.32-15.91-110.94,11.48-36.1-32.29-90.7-32.29-126.79,0C151.05-10.8,90.93-7.45,55.92,31.7c-35.01,39.15-31.66,99.26,7.48,134.28,4.87,4.36,9.71,7.94,15.73,11.78,16.18,10.33,20.48,27.83,11.73,43-8.75,15.16-29.54,18.19-43.3,11.6-16.09-7.71-34.55-3.56-43.3,11.6-8.75,15.16-3.56,34.55,11.6,43.3,35.58,20.54,80.32,15.91,110.94-11.48,36.1,32.29,90.7,32.29,126.79,0,39.15,35.01,99.26,31.66,134.28-7.48,35.01-39.15,31.66-99.26-7.48-134.28-4.87-4.36-9.71-7.94-15.73-11.78-16.18-10.33-20.48-27.83-11.73-43,8.75-15.16,29.54-18.19,43.3-11.6,16.09,7.71,34.55,3.56,43.3-11.6,8.75-15.16,3.56-34.55-11.6-43.3ZM142.67,123.04c-7.6,5.12-10.49,7.96-15.88,12.9-5.39-4.93-8.27-7.78-15.88-12.9-10.31-6.94-15.82-16.18-15.82-27.95,0-17.51,14.19-31.7,31.7-31.7h0c17.51,0,31.7,14.19,31.7,31.7,0,11.77-5.52,21.01-15.82,27.95ZM190.2,236.61h0c-17.51,0-31.7-14.19-31.7-31.7,0-11.77,5.52-21.01,15.82-27.95,7.6-5.12,10.49-7.96,15.88-12.9,5.39,4.93,8.27,7.78,15.88,12.9,10.31,6.94,15.82,16.18,15.82,27.95,0,17.51-14.19,31.7-31.7,31.7ZM269.47,123.04c-7.6,5.12-10.49,7.96-15.88,12.9-5.39-4.93-8.27-7.78-15.88-12.9-10.31-6.94-15.82-16.18-15.82-27.95,0-17.51,14.19-31.7,31.7-31.7h0c17.51,0,31.7,14.19,31.7,31.7,0,11.77-5.52,21.01-15.82,27.95ZM348.69,204.91c0,17.51-14.19,31.7-31.7,31.7h0c-17.51,0-31.7-14.19-31.7-31.7,0-11.77,5.52-21.01,15.82-27.95,7.6-5.12,10.49-7.96,15.88-12.9,5.39,4.93,8.27,7.78,15.88,12.9,10.31,6.94,15.82,16.18,15.82,27.95Z"/></svg>';
  }

  /**
   * 明示的な起動メソッド
   */
  init() {
    this.updateFavicon();
    this.observeDarkMode();
    this.observeSystemTheme();
  }

  updateFavicon() {
    const isDarkMode = this.checkDarkMode();
    // 色の定義を整理
    const color = isDarkMode ? '#ffffff' : '#090000';
    
    // SVG内の currentColor を置換
    const coloredSvg = this.svgContent.replace('currentColor', color);
    
    // 軽量な encodeURIComponent 方式を採用（Base64より高速）
    const svgDataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(coloredSvg)}`;
    
    this.removeFaviconLinks();
    this.setFavicon(svgDataUri);
  }

  checkDarkMode() {
    // 1. OS設定
    const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    // 2. クラス名（プロジェクトの実装に合わせて .dark と .dark-mode 両方を念のためチェック）
    const classDark = document.documentElement.classList.contains('dark') || 
                      document.body.classList.contains('dark') ||
                      document.documentElement.classList.contains('dark-mode') || 
                      document.body.classList.contains('dark-mode');
    
    return systemDark || classDark;
  }

  setFavicon(url) {
    // 標準的なfavicon
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = url;
    
    // Appleデバイスや一部のブラウザ向けのショートカットアイコン
    const shortcutLink = document.createElement('link');
    shortcutLink.rel = 'shortcut icon';
    shortcutLink.href = url;
    
    document.head.appendChild(link);
    document.head.appendChild(shortcutLink);
  }

  removeFaviconLinks() {
    const links = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]');
    links.forEach(link => link.remove());
  }

  observeDarkMode() {
    const observer = new MutationObserver(() => this.updateFavicon());
    
    // クラスの変更を監視
    const config = { attributes: true, attributeFilter: ['class'] };
    observer.observe(document.documentElement, config);
    observer.observe(document.body, config);
  }

  observeSystemTheme() {
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => this.updateFavicon();
      
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handler);
      } else {
        mediaQuery.addListener(handler);
      }
    }
  }
}

/**
 * 外部公開用の初期化関数
 */
export function initFavicon() {
  const controller = new FaviconController();
  controller.init();
}