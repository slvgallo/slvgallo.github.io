// グローバルなフィルター機能
export function initNav() {
  // 現在のページを判定
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  
  // フィルターーリンクのイベントを全ページで設定
  const filterLinks = document.querySelectorAll(".filter-link");
  
  filterLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const filter = link.dataset.filter;
      
      // index.html以外のページならindex.htmlにリダイレクト
      if (currentPage !== 'index.html') {
        // worksページからの相対パスを考慮
        const pathSegments = window.location.pathname.split('/');
        if (pathSegments[pathSegments.length - 2] === 'works') {
          // worksページの場合
          window.location.href = `../index.html?filter=${filter}`;
        } else {
          // その他のページの場合
          window.location.href = `index.html?filter=${filter}`;
        }
      } else {
        // index.htmlの場合は既存のフィルター機能を呼び出し
        if (typeof applyFilter === 'function') {
          applyFilter(filter);
          // フィルター変更時はスクロール位置をリセット
          window.scrollTo(0, 0);
        } else {
          // index.jsの初期化待ちなどのケースに対応
          window.location.href = `index.html?filter=${filter}`;
        }
      }
    });
  });
}
