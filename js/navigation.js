import { state } from './state.js';
import { applyFilter } from './filter.js';

export function initNavigation() {
  
  if (state.init.navigationInitialized) return;
  state.init.navigationInitialized = true;

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  // 効率的なイベント委譲: documentに対して一度だけ貼る
  document.addEventListener("click", (e) => {
    const link = e.target.closest(".filter-link");
    if (!link) return;

    e.preventDefault();
    const filter = link.dataset.filter;

    // index.html 以外にいる場合は、URLパラメータ付きでリダイレクト
    if (currentPage !== 'index.html' && currentPage !== '') {
      const pathSegments = window.location.pathname.split('/');
      
      // works/ フォルダ内の個別ページにいる場合
      if (pathSegments.includes('works')) {
        window.location.href = `../index.html?filter=${filter}`;
      } else {
        window.location.href = `index.html?filter=${filter}`;
      }
    } else {
      // index.html の場合は、ページ遷移せずにフィルタを適用
      applyFilter(filter);
      window.scrollTo({
        top: 0,
        behavior: 'smooth' // スムーズなスクロール
      });
    }
  });
}