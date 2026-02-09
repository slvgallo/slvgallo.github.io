import { extractYouTubeId } from './utils.js';

export async function loadWorks() {
  const res = await fetch("data/works.json");
  if (!res.ok) {
    throw new Error(`HTTP error! status: ${res.status}`);
  }

  const works = await res.json();

  // YouTubeサムネイルの事前処理
  works.forEach((work) => {
    const videoId = extractYouTubeId(work.thumb);

    if (videoId) {
      work.thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      work.isYoutubeThumb = true;
    } else {
      work.isYoutubeThumb = false;
    }
  });

  return works;
}

/**
 * Cloudinary画像URLを自動最適化する
 *
 * @param {string} url - 元の画像URL
 * @param {boolean} isYoutube - YouTubeサムネイルかどうか
 * @returns {string}
 */
export function getOptimizedImageUrl(url, isYoutube = false) {
  if (!url) return "";

  // YouTubeサムネは何もしない
  if (isYoutube) {
    return url;
  }

  // Cloudinary画像のみ最適化
  if (url.includes('res.cloudinary.com') && url.includes('/upload/')) {

    // すでに transformation が入っている場合は触らない
    if (url.match(/\/upload\/[^/]+_/)) {
      return url;
    }

    // 自動最適化（推奨）
    const optimizationParams = 'f_auto,q_auto,c_limit,w_auto';

    return url.replace(
      '/upload/',
      `/upload/${optimizationParams}/`
    );
  }

  return url;
}
