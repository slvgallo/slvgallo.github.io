const params = new URLSearchParams(window.location.search);
const id = params.get('id');

// YouTube IDを抽出する関数
function extractYouTubeId(url) {
  const patterns = [
    // 通常のYouTube動画
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /(?:youtube\.com\/vi\/)([^&\n?#]+)/,
    // YouTube Shorts
    /(?:youtube\.com\/shorts\/)([^&\n?#]+)/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

// IDから日付を自動生成する関数
function generateDateFromId(id) {
  if (id.length >= 4) {
    const yearMonth = id.substring(0, 4);
    const year = yearMonth.substring(0, 2);
    const month = yearMonth.substring(2, 4);
    
    // 年を2000年代に変換
    const fullYear = `20${year}`;
    
    // 月を英語に変換
    const monthNames = {
      '01': 'JAN', '02': 'FEB', '03': 'MAR', '04': 'APR',
      '05': 'MAY', '06': 'JUNE', '07': 'JULY', '08': 'AUG',
      '09': 'SEPT', '10': 'OCT', '11': 'NOV', '12': 'DEC'
    };
    
    const monthName = monthNames[month] || month;
    return `${monthName} ${fullYear}`;
  }
  return id; // フォーマットが違う場合はそのまま返す
}

fetch('data/works.json')
  .then(res => res.json())
  .then(works => {
    const grid = document.getElementById('works-grid');

    works.forEach(work => {
      // YouTubeサムネイルを自動生成
      if (work.thumb && work.thumb.includes('youtube.com')) {
        const videoId = extractYouTubeId(work.thumb);
        if (videoId) {
          work.thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        }
      }

      const article = document.createElement('article');
      article.className = 'post index-post';
      article.dataset.tags = work.tags.join(' ');

      const postInner = document.createElement('div');
      postInner.className = 'post-inner';

      const link = document.createElement('a');
      link.href = `works.html?id=${work.id}`;
      link.className = 'post-content-anchor';

      const thumb = document.createElement('div');
      thumb.className = 'post-photo-thumb';
      thumb.style.backgroundImage = `url(${work.thumb})`;

      link.appendChild(thumb);
      postInner.appendChild(link);
      article.appendChild(postInner);
      grid.appendChild(article);
    });

    // フィルタ機能
    const filterLinks = document.querySelectorAll('.filter-link');
    let currentFilter = 'all';

    filterLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const filter = link.dataset.filter;
        currentFilter = filter;

        // アクティブ状態の更新
        filterLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');

        // フィルタリング
        const posts = grid.querySelectorAll('.index-post');
        posts.forEach((post, i) => {
          const tags = post.dataset.tags.split(' ');
          if (filter === 'all' || tags.includes(filter)) {
            post.style.display = '';
          } else {
            post.style.display = 'none';
          }
        });
      });
    });

    // 初期状態でAllをアクティブに
    const allLink = document.querySelector('[data-filter="all"]');
    if (allLink) {
      allLink.classList.add('active');
    }
  });

// ハンバーガーメニューの制御
(function() {
  const menuToggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.header-box-nav');
  const overlay = document.querySelector('.menu-overlay');
  
  if (menuToggle && nav && overlay) {
    menuToggle.addEventListener('click', function() {
      menuToggle.classList.toggle('active');
      nav.classList.toggle('active');
      overlay.classList.toggle('active');
    });
    
    overlay.addEventListener('click', function() {
      menuToggle.classList.remove('active');
      nav.classList.remove('active');
      overlay.classList.remove('active');
    });
    
    // メニュー内のリンクをクリックしたらメニューを閉じる
    const navLinks = nav.querySelectorAll('a');
    navLinks.forEach(link => {
      link.addEventListener('click', function() {
        menuToggle.classList.remove('active');
        nav.classList.remove('active');
        overlay.classList.remove('active');
      });
    });
  }
})();
