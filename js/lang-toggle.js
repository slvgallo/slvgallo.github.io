// 言語切り替え機能
document.addEventListener('DOMContentLoaded', function() {
  const langEnBtn = document.getElementById('lang-en');
  const langJaBtn = document.getElementById('lang-ja');
  const langEnElements = document.querySelectorAll('.lang-en');
  const langJaElements = document.querySelectorAll('.lang-ja');
  
  let currentLang = localStorage.getItem('preferredLanguage') || 'en';
  
  // 初期言語設定
  setLanguage(currentLang);
  
  // ENボタンクリックイベント
  langEnBtn.addEventListener('click', function() {
    setLanguage('en');
    localStorage.setItem('preferredLanguage', 'en');
  });
  
  // JPボタンクリックイベント
  langJaBtn.addEventListener('click', function() {
    setLanguage('ja');
    localStorage.setItem('preferredLanguage', 'ja');
  });
  
  function setLanguage(lang) {
    if (lang === 'en') {
      langEnElements.forEach(el => el.style.display = 'inline');
      langJaElements.forEach(el => el.style.display = 'none');
      langEnBtn.classList.add('active');
      langJaBtn.classList.remove('active');
    } else {
      langEnElements.forEach(el => el.style.display = 'none');
      langJaElements.forEach(el => el.style.display = 'inline');
      langEnBtn.classList.remove('active');
      langJaBtn.classList.add('active');
    }
  }
});
