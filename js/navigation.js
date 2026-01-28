// グローバルなフィルター機能
document.addEventListener('DOMContentLoaded', function() {
  // 現在のページを判定
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  
  // フィルターリンクのイベントを全ページで設定
  const filterLinks = document.querySelectorAll(".filter-link");
  
  filterLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const filter = link.dataset.filter;
      
      // index.html以外のページならindex.htmlにリダイレクト
      if (currentPage !== 'index.html') {
        window.location.href = `index.html?filter=${filter}`;
      } else {
        // index.htmlの場合は既存のフィルター機能を呼び出し
        if (typeof applyFilter === 'function') {
          applyFilter(filter);
        }
      }
    });
  });
});
