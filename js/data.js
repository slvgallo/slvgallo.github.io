import { extractYouTubeId } from './utils.js';

export async function loadWorks() {
  const res = await fetch("data/works.json");
  if (!res.ok) {
    throw new Error(`HTTP error! status: ${res.status}`);
  }
  const works = await res.json();
  
  // YouTubeサムネイルの事前処理
  works.forEach((work) => {
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
  
  return works;
}

/**
 * Cloudinaryの画像URLを最適化するヘルパー関数
 * @param {string} url - 元の画像URL
 * @param {boolean} isYoutube - YouTubeサムネイルかどうか
 * @returns {string} 最適化された画像URL
 */
export function getOptimizedImageUrl(url, isYoutube) {
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
