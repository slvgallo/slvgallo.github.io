// Bundle of utility modules for performance optimization
// Combined from utils.js and renderer.js

/**
 * YouTube ID抽出
 * Note: Identical to scripts/shared-utils.js for consistency
 */
export function extractYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /(?:youtube\.com\/vi\/)([^&\n?#]+)/,
    /(?:youtube\.com\/shorts\/)([^&\n?#]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * Cloudinary画像URLを最適化する
 * ビルド時に最適化済みなのでそのまま返す
 */
export function getOptimizedImageUrl(url, isYoutube) {
  return url;
}

/**
 * インデックスページ用のCloudinary画像URLを最適化する
 * ビルド時に最適化済みなのでそのまま返す
 */
export function getOptimizedIndexImageUrl(url, isYoutube) {
  return url;
}

/**
 * 作品アイテム（記事）のHTML要素を作成する
 * @param {Object} work - 作品データ
 * @param {number} index - インデックス（LCP最適化のため）
 */
export function createWorkItem(work, index = 100) { 
  const article = document.createElement("article");
  article.className = "post index-post";
  article.dataset.tags = work.tags ? work.tags.join(" ") : "";

  const postInner = document.createElement("div");
  postInner.className = "post-inner";

  const link = document.createElement("a");
  // 静的サイト構成のため /works/ フォルダへのリンク
  link.href = `works/${work.id}.html`;
  link.className = "post-content-anchor";

  const thumbContainer = document.createElement("div");
  thumbContainer.className = "post-photo-thumb";
  
  // 通常の画像サムネイル（Cloudinary画像を含む）
  const thumbUrl = getOptimizedIndexImageUrl(work.thumb, work.isYoutubeThumb);
  
  const img = document.createElement('img');
  img.src = thumbUrl;
  img.alt = work.title;
  
  // LCP最適化
  if (index < 4) {
    img.loading = "eager";
    img.fetchPriority = "high";
    img.decoding = "sync";
  } else {
    img.loading = "lazy";
    img.decoding = "async";
  }
  
  if (work.isYoutubeThumb) {
    img.style.transform = "scale(1.02)";
  }
  
  thumbContainer.appendChild(img);

  const contentContainer = document.createElement("div");
  contentContainer.className = "post-content";
  
  const title = document.createElement("h2");
  title.className = "post-title";
  title.textContent = work.title;
  
  contentContainer.appendChild(title);
  
  link.appendChild(thumbContainer);
  link.appendChild(contentContainer);
  postInner.appendChild(link);
  article.appendChild(postInner);
  
  return article;
}
