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

      link.appendChild(thumb);
      postInner.appendChild(link);
      article.appendChild(postInner);
      grid.appendChild(article);
    });

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
