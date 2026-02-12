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
  
  // SoundCloudサムネイルの特殊処理（既存互換）
  if (work.thumb && work.thumb.includes('soundcloud.com')) {
    const img = document.createElement('img');
    // SoundCloud用の静的プレースホルダー（既存のOGP背景など）
    img.src = 'https://res.cloudinary.com/ddwxt9vnm/image/upload/v1770820480/ogp_blank_ghjrxq.png';
    img.alt = work.title;
    img.loading = "lazy";
    
    const scInfo = document.createElement('div');
    scInfo.className = "soundcloud-info";
    scInfo.style.cssText = "position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #000; z-index: 2; pointer-events: none; padding: 20px; text-align: center;";
    
    const playIcon = `
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-bottom: 10px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/>
        <path d="M10 8L16 12L10 16V8Z" fill="currentColor"/>
      </svg>
    `;
    
    scInfo.innerHTML = `
      ${playIcon}
      <div style="font-size: 0.9rem; font-weight: 500; letter-spacing: 0.05em; opacity: 0.8;">${work.title}</div>
    `;
    
    const overlay = document.createElement('div');
    overlay.className = "soundcloud-overlay";
    
    thumbContainer.appendChild(img);
    thumbContainer.appendChild(scInfo);
    thumbContainer.appendChild(overlay);
  } else {
    // 通常の画像サムネイル
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
  }

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