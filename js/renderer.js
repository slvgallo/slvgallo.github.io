import { getOptimizedImageUrl, getOptimizedIndexImageUrl } from './utils.js';

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