import { getOptimizedImageUrl } from './data.js';

// --- 変更点: インデックス（何番目の要素か）を引数に追加 ---
export function createWorkItem(work, index = 100) { 
  const article = document.createElement("article");
  article.className = "post index-post";
  article.dataset.tags = work.tags.join(" ");

  const postInner = document.createElement("div");
  postInner.className = "post-inner";

  const link = document.createElement("a");
  if (window.slvEnv === 'static') {
    link.href = `works/${work.id}.html`;
  } else {
    link.href = `works.html?id=${work.id}`;
  }
  link.className = "post-content-anchor";

  const thumb = document.createElement("div");
  thumb.className = "post-photo-thumb";
  
  // SoundCloudの場合...
  if (work.thumb && work.thumb.includes('soundcloud.com')) {
    // ...（中略）...
  } else {
    // 通常の画像サムネイル
    const thumbUrl = getOptimizedImageUrl(work.thumb, work.isYoutubeThumb);
    
    const img = document.createElement('img');
    img.src = thumbUrl;
    img.alt = work.title;
    
    // --- 🚀 修正ポイント: LCP最適化 ---
    // 最初の4枚（index 0,1,2,3）は lazy を外して fetchpriority="high" を設定
    if (index < 4) {
      img.loading = "eager"; // 明示的に即時読み込み
      img.fetchPriority = "high"; // ダウンロード優先度を最高に
      img.decoding = "sync"; // デコードを同期的に（画像表示を優先）
    } else {
      img.loading = "lazy"; // それ以外は遅延読み込み
      img.decoding = "async";
    }
    // ---------------------------------
    
    // YouTubeサムネイルのみtransformを適用
    img.style.transform = work.isYoutubeThumb ? "scale(1.02)" : "scale(1.0)";
    
    thumb.appendChild(img);
  }

  link.appendChild(thumb);
  postInner.appendChild(link);
  article.appendChild(postInner);
  
  return article;
}