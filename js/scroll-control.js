// フロートボタンスクロル制御
document.addEventListener('DOMContentLoaded', function() {
  const profileFloat = document.querySelector('.profile-float');
  const siteFooter = document.querySelector('.site-footer');
  
  if (!profileFloat || !siteFooter) return;
  
  // Intersection Observerを使用してフッターの表示を検知
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        // フッターが表示されたらフロートボタンを非表示
        profileFloat.classList.add('hidden');
      } else {
        // フッターが非表示になったらフロートボタンを表示
        profileFloat.classList.remove('hidden');
      }
    });
  }, {
    threshold: 0.1 // フッターの10%が表示されたら発火
  });
  
  // フッターを監視
  observer.observe(siteFooter);
});
