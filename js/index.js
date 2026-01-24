// extractYouTubeId関数はutils.jsで定義

const params = new URLSearchParams(window.location.search);
const initialFilter = params.get("filter");

fetch("data/works.json")
  .then((res) => res.json())
  .then((works) => {
    const grid = document.getElementById("works-grid");

    works.forEach((work) => {
      const isYoutubeThumb =
        typeof work.thumb === "string" &&
        (work.thumb.includes("youtube.com") || work.thumb.includes("youtu.be"));

      // YouTubeサムネイルを自動生成
      if (isYoutubeThumb) {
        const videoId = extractYouTubeId(work.thumb);
        if (videoId) {
          work.thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        }
      }

      const article = document.createElement("article");
      article.className = "post index-post";
      article.dataset.tags = work.tags.join(" ");

      const postInner = document.createElement("div");
      postInner.className = "post-inner";

      const link = document.createElement("a");
      link.href = `works.html?id=${work.id}`;
      link.className = "post-content-anchor";

      const thumb = document.createElement("div");
      thumb.className = "post-photo-thumb";
      
      // Cloudinary URLの最適化
      let thumbUrl = work.thumb;
      if (thumbUrl.includes('cloudinary.com')) {
        // Cloudinaryの最適化パラメータを追加
        const optimizationParams = 'q_auto,f_auto,w_800,h_450,c_fill';
        thumbUrl = thumbUrl.replace('/upload/', `/upload/${optimizationParams}/`);
      }
      thumb.style.backgroundImage = `url(${thumbUrl})`;
      
      // YouTubeサムネイルのみtransformを適用
      thumb.style.transform = isYoutubeThumb ? "scale(1.02)" : "scale(1.0)";

      // タイトル要素を追加
      const title = document.createElement("div");
      title.className = "post-title";
      title.textContent = work.title;

      // 日付とタグ要素を追加
      const tags = document.createElement("div");
      tags.className = "post-tags";
      
      // 日付を生成
      let dateText = "";
      if (work.id.length >= 4) {
        const yearMonth = work.id.substring(0, 4);
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
        dateText = `${monthName} ${fullYear} | `;
      }
      
      // 日付とタグを結合
      const tagTexts = work.tags.map(tag => `#${tag}`).join(' ');
      tags.textContent = dateText + tagTexts;

      link.appendChild(thumb);
      link.appendChild(title);
      link.appendChild(tags);
      postInner.appendChild(link);
      article.appendChild(postInner);
      grid.appendChild(article);
    });

    // モバイル用スクロールイベントリスナー
    if (window.innerWidth <= 768) {
      let scrollTimeout;
      
      document.addEventListener('scroll', function(e) {
        // すべてのタイトルとタグを表示
        document.querySelectorAll('.post-title').forEach(title => {
          title.classList.add('show');
        });
        document.querySelectorAll('.post-tags').forEach(tags => {
          tags.classList.add('show');
        });
        
        // スクロール停止を検知して非表示
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          document.querySelectorAll('.post-title').forEach(title => {
            title.classList.remove('show');
          });
          document.querySelectorAll('.post-tags').forEach(tags => {
            tags.classList.remove('show');
          });
        }, 1000); // 1秒後に非表示
      });
    }

    // フィルタ機能
    const filterLinks = document.querySelectorAll(".filter-link");

    function applyFilter(filter) {
      // アクティブ状態の更新
      filterLinks.forEach((l) => l.classList.remove("active"));
      const activeLink = document.querySelector(`[data-filter="${filter}"]`);
      if (activeLink) {
        activeLink.classList.add("active");
      }

      // フィルタリング
      const posts = grid.querySelectorAll(".index-post");
      posts.forEach((post) => {
        const tags = post.dataset.tags.split(" ");
        if (filter === "all" || tags.includes(filter)) {
          post.style.display = "";
        } else {
          post.style.display = "none";
        }
      });
    }

    filterLinks.forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const filter = link.dataset.filter;
        applyFilter(filter);
      });
    });

    // 初期状態: URLパラメータ filter があればそれを適用
    const initial = initialFilter && document.querySelector(`[data-filter="${initialFilter}"]`)
      ? initialFilter
      : "all";
    applyFilter(initial);
  });

// ウィンドウリサイズ時の処理
window.addEventListener('resize', function() {
  const isMobile = window.innerWidth <= 768;
  const allTitles = document.querySelectorAll('.post-title');
  const allTags = document.querySelectorAll('.post-tags');
  
  if (isMobile) {
    // モバイル表示：すべて非表示
    allTitles.forEach(title => title.classList.remove('show'));
    allTags.forEach(tags => tags.classList.remove('show'));
  } else {
    // デスクトップ表示：すべてリセット
    allTitles.forEach(title => title.classList.remove('show'));
    allTags.forEach(tags => tags.classList.remove('show'));
  }
});

// ハンバーガーメニューの制御
(function () {
  const menuToggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".header-box-nav");
  const overlay = document.querySelector(".menu-overlay");

  if (menuToggle && nav && overlay) {
    menuToggle.addEventListener("click", function () {
      menuToggle.classList.toggle("active");
      nav.classList.toggle("active");
      overlay.classList.toggle("active");
    });

    overlay.addEventListener("click", function () {
      menuToggle.classList.remove("active");
      nav.classList.remove("active");
      overlay.classList.remove("active");
    });

    // メニュー内のリンクをクリックしたらメニューを閉じる
    const navLinks = nav.querySelectorAll("a");
    navLinks.forEach((link) => {
      link.addEventListener("click", function () {
        menuToggle.classList.remove("active");
        nav.classList.remove("active");
        overlay.classList.remove("active");
      });
    });
  }
})();
