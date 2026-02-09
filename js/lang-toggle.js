import { state } from './state.js';

export function initLangToggle() {
  if (state.init.langInitialized) return;
  state.init.langInitialized = true;

  // 初期言語の決定（localStorage または デフォルト 'en'）
  let currentLang = localStorage.getItem('preferredLanguage') || 'en';

  /**
   * 言語を切り替える関数
   * 💡 各要素をループで回すのではなく、ルート(html要素)のクラスを切り替える
   * これにより、後から追加されたDOM（フィルタ後の作品など）にも自動でスタイルが適用されます
   */
  function setLanguage(lang) {
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.classList.toggle('lang-en-active', lang === 'en');
    document.documentElement.classList.toggle('lang-ja-active', lang === 'ja');

    // ボタンの状態更新
    const langEnBtn = document.getElementById('lang-en');
    const langJaBtn = document.getElementById('lang-ja');
    if (langEnBtn) langEnBtn.classList.toggle('active', lang === 'en');
    if (langJaBtn) langJaBtn.classList.toggle('active', lang === 'ja');
  }

  // 初期実行
  setLanguage(currentLang);

  // イベント委譲によるクリック制御
  document.addEventListener('click', (e) => {
    const btnEn = e.target.closest('#lang-en');
    const btnJa = e.target.closest('#lang-ja');

    if (btnEn) {
      setLanguage('en');
      localStorage.setItem('preferredLanguage', 'en');
    } else if (btnJa) {
      setLanguage('ja');
      localStorage.setItem('preferredLanguage', 'ja');
    }
  });
}
