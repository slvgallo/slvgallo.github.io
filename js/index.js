// extractYouTubeId関数はutils.jsで定義

// グローバルエラーハンドラー
window.addEventListener('error', (e) => {
  // エラーを静かに処理
  console.error('Global error:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
  // Promiseの拒否を処理
  console.error('Unhandled promise rejection:', e.reason);
  e.preventDefault();
});

const params = new URLSearchParams(window.location.search);
const initialFilter = params.get("filter");

// 段階的読み込みの設定
const ITEMS_PER_LOAD = 16;
let allWorks = [];
let filteredWorks = [];
let displayedCount = 0;
let currentFilter = "all";
let isLoading = false;

fetch("data/works.json")
  .then((res) => {
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    return res.json();
  })
  .then((works) => {
    allWorks = works;
    
    // YouTubeサムネイルの事前処理
    allWorks.forEach((work) => {
      const isYoutubeThumb =
        typeof work.thumb === "string" &&
        (work.thumb.includes("youtube.com") || work.thumb.includes("youtu.be"));

      if (isYoutubeThumb) {
        const videoId = extractYouTubeId(work.thumb);
        if (videoId) {
          work.thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        }
        work.isYoutubeThumb = true;
      } else {
        work.isYoutubeThumb = false;
      }
    });

    // フィルタ機能の設定はnavigation.jsで行われるため、ここでは削除可能ですが、
    // navigation.jsが読み込まれる前にクリックされた場合の予備として残すか検討します。
    // 現状はnavigation.jsが一元管理するようにし、二重登録を防ぎます。
    // (navigation.js 内で applyFilter を呼び出すようになっています)

    // 初期状態: URLパラメータ filter があればそれを適用
    const initial = initialFilter && document.querySelector(`[data-filter="${initialFilter}"]`)
      ? initialFilter
      : "all";

    // 復元処理または初期化
    if (!restoreScrollState()) {
      applyFilter(initial);
    }

    // Intersection Observerの設定（スクロール検知用）
    setupInfiniteScroll();

    // クリックイベントの委譲（状態保存用）
    setupStateSaving();
  })
  .catch((error) => {
    // データ読み込みエラー処理
    const grid = document.getElementById("works-grid");
    if (grid) {
      grid.innerHTML = '<p class="error-message">error</p>';
    }
  });

// スクロール状態を保存するセットアップ
function setupStateSaving() {
  const grid = document.getElementById("works-grid");
  grid.addEventListener("click", (e) => {
    // リンクまたは画像の親リンクを探す
    const link = e.target.closest("a");
    if (link && link.href && link.href.includes("works.html")) {
      const state = {
        scrollTop: window.scrollY,
        filter: currentFilter,
        displayedCount: displayedCount
      };
      sessionStorage.setItem("slvgallo_scroll_state", JSON.stringify(state));
    }
  });
}

// 状態を復元する関数
function restoreScrollState() {
  // ブラウザバックでの遷移かチェック
  const navigationEntry = performance.getEntriesByType("navigation")[0];
  const isBackNavigation = navigationEntry && navigationEntry.type === "back_forward";

  if (!isBackNavigation) {
    // 通常遷移の場合はストレージをクリア
    sessionStorage.removeItem("slvgallo_scroll_state");
    return false;
  }

  const savedStateJson = sessionStorage.getItem("slvgallo_scroll_state");
  if (!savedStateJson) return false;

  try {
    const state = JSON.parse(savedStateJson);
    
    // フィルタを復元
    currentFilter = state.filter;
    const filterLinks = document.querySelectorAll(".filter-link");
    filterLinks.forEach((l) => l.classList.remove("active"));
    const activeLink = document.querySelector(`[data-filter="${currentFilter}"]`);
    if (activeLink) activeLink.classList.add("active");

    // リストをフィルタリング
    if (currentFilter === "all") {
      filteredWorks = [...allWorks];
    } else {
      filteredWorks = allWorks.filter(work => work.tags.includes(currentFilter));
    }

    // 保存されていた数だけアイテムを表示
    const grid = document.getElementById("works-grid");
    grid.innerHTML = "";
    
    // 表示数制限
    const countToLoad = Math.min(state.displayedCount, filteredWorks.length);
    
    for (let i = 0; i < countToLoad; i++) {
      const article = createWorkItem(filteredWorks[i]);
      grid.appendChild(article);
    }
    
    displayedCount = countToLoad;
    updateLoadingIndicator();

    // スクロール位置を復元（少し遅延させて描画完了を待つ）
    requestAnimationFrame(() => {
      window.scrollTo(0, state.scrollTop);
    });
    
    return true;
  } catch (e) {
    // 状態復元エラーは無視
    return false;
  }
}

// 作品アイテムを生成する関数
function createWorkItem(work) {
  const article = document.createElement("article");
  article.className = "post index-post";
  article.dataset.tags = work.tags.join(" ");

  const postInner = document.createElement("div");
  postInner.className = "post-inner";

  const link = document.createElement("a");
  link.href = `works/${work.id}.html`;
  link.className = "post-content-anchor";

  const thumb = document.createElement("div");
  thumb.className = "post-photo-thumb";
  
  // SoundCloudの場合はプレーヤーを表示
  if (work.thumb && work.thumb.includes('soundcloud.com')) {
    // SoundCloudトラックIDをmedia配列から取得
    const soundCloudMedia = work.media.find(m => m.type === 'soundcloud');
    if (soundCloudMedia && soundCloudMedia.src) {
      const trackId = soundCloudMedia.src;
      const iframe = document.createElement('iframe');
      // 公式埋め込みタグのURL形式に合わせる
      iframe.src = `https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/soundcloud%253Atracks%253A${trackId}&color=%23000000&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false&visual=true&sharing=false`;
      iframe.width = "100%";
      iframe.height = "300";
      iframe.frameBorder = "no";
      iframe.scrolling = "no";
      iframe.allow = "autoplay";
      iframe.style.pointerEvents = "none"; // iframeはクリックできないように
      
      thumb.appendChild(iframe);
      thumb.classList.add('soundcloud-thumb');
      
      // クリック用のオーバーレイを追加
      const clickOverlay = document.createElement('div');
      clickOverlay.className = 'soundcloud-overlay';
      thumb.appendChild(clickOverlay);
    } else {
      // フォールバック：通常のサムネイル
      const thumbUrl = getOptimizedImageUrl(work.thumb, work.isYoutubeThumb);
      
      const img = document.createElement('img');
      img.src = thumbUrl;
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = work.title;
      thumb.appendChild(img);
    }
  } else {
    // 通常の画像サムネイル
    const thumbUrl = getOptimizedImageUrl(work.thumb, work.isYoutubeThumb);
    
    const img = document.createElement('img');
    img.src = thumbUrl;
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = work.title;
    
    // YouTubeサムネイルのみtransformを適用
    img.style.transform = work.isYoutubeThumb ? "scale(1.02)" : "scale(1.0)";
    
    // Flickr写真の場合はworks.htmlに遷移（indexページ）
    if (work.thumb && work.thumb.includes('flickr.com')) {
      // 画像を直接追加（Flickrリンクは作成しない）
      thumb.appendChild(img);
    } else {
      thumb.appendChild(img);
    }
  }

  link.appendChild(thumb);
  postInner.appendChild(link);
  article.appendChild(postInner);
  
  return article;
}

// 次のバッチをロードする関数
function loadMoreItems() {
  if (isLoading || displayedCount >= filteredWorks.length) return;
  
  isLoading = true;
  try {
    const grid = document.getElementById("works-grid");
    if (!grid) return;
    
    const endIndex = Math.min(displayedCount + ITEMS_PER_LOAD, filteredWorks.length);
    
    for (let i = displayedCount; i < endIndex; i++) {
      const article = createWorkItem(filteredWorks[i]);
      if (article) {
        grid.appendChild(article);
      }
    }
    
    displayedCount = endIndex;
  } catch (error) {
    console.error("Error loading items:", error);
  } finally {
    isLoading = false;
    // ローディングインジケーターの更新
    updateLoadingIndicator();
  }
}

// フィルタを適用する関数
function applyFilter(filter) {
  currentFilter = filter;
  const grid = document.getElementById("works-grid");
  const filterLinks = document.querySelectorAll(".filter-link");
  
  // アクティブ状態の更新
  filterLinks.forEach((l) => l.classList.remove("active"));
  const activeLink = document.querySelector(`[data-filter="${filter}"]`);
  if (activeLink) {
    activeLink.classList.add("active");
  }

  // フィルタリングされた作品リストを作成
  if (filter === "all") {
    filteredWorks = [...allWorks];
  } else {
    filteredWorks = allWorks.filter(work => work.tags.includes(filter));
  }
  
  // グリッドをクリアして最初からロード
  grid.innerHTML = "";
  displayedCount = 0;
  
  // 最初のバッチをロード
  loadMoreItems();
}

// Infinite Scrollのセットアップ
function setupInfiniteScroll() {
  // センチネル要素を作成（監視対象）
  const sentinel = document.createElement("div");
  sentinel.id = "scroll-sentinel";
  sentinel.style.height = "1px";
  document.querySelector(".top-post-container").appendChild(sentinel);

  // Intersection Observerを設定
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && !isLoading) {
        loadMoreItems();
      }
    });
  }, {
    rootMargin: "200px" // 200px手前で発火
  });

  observer.observe(sentinel);
}

// ローディングインジケーターの更新
function updateLoadingIndicator() {
  let indicator = document.getElementById("loading-indicator");
  
  if (displayedCount >= filteredWorks.length) {
    // すべて表示済み - インジケーターを削除
    if (indicator) {
      indicator.remove();
    }
  } else {
    // まだ残りがある場合 - インジケーターを表示
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.id = "loading-indicator";
      indicator.className = "loading-indicator";
      indicator.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
      const sentinel = document.getElementById("scroll-sentinel");
      if (sentinel) {
        sentinel.parentNode.insertBefore(indicator, sentinel);
      }
    }
  }
}

/**
 * Cloudinaryの画像URLを最適化するヘルパー関数
 * @param {string} url - 元の画像URL
 * @param {boolean} isYoutube - YouTubeサムネイルかどうか
 * @returns {string} 最適化された画像URL
 */
function getOptimizedImageUrl(url, isYoutube) {
  if (!url) return "";
  
  // Cloudinaryの画像のみ最適化
  if (url.includes('cloudinary.com')) {
    // 既存の変換パラメータがない場合のみ追加
    if (url.includes('/upload/') && !url.includes('/upload/q_')) {
      // w_600: 幅600pxにリサイズ
      // h_338: 高さ338pxにリサイズ (16:9のアスペクト比維持)
      // c_fill: 指定サイズに切り抜き
      // q_auto: 画質自動最適化
      // f_auto: フォーマット自動選択 (WebP/AVIFなど)
      const optimizationParams = 'q_auto,f_auto,w_600,h_338,c_fill';
      return url.replace('/upload/', `/upload/${optimizationParams}/`);
    }
  }
  
  return url;
}
