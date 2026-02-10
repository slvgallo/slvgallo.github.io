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
      // 🚀 CloudinaryのURLをここでWebP/最適化済みに書き換える
      work.thumb = getOptimizedImageUrl(work.thumb, false);
      work.isYoutubeThumb = false;
    }
  });
  
  return works;
}

/**
 * Cloudinaryの画像URLを最適化する
 */
export function getOptimizedImageUrl(url, isYoutube) {
  if (!url || isYoutube) return url;
  
  if (url.includes('cloudinary.com')) {
    // すでに変換パラメータがある場合は二重に付けないようにチェック
    if (url.includes('/upload/') && !url.includes('f_auto')) {
      // f_auto: WebP化, q_auto: 画質最適化, w_800: 幅リサイズ, c_fill: 指定サイズで埋める
      // 16:9比率を保ちたい場合は ar_16:9,c_fill を追加
      const params = 'f_auto,q_auto,w_800,c_fill,ar_16:9';
      return url.replace('/upload/', `/upload/${params}/`);
    }
  }
  
  return url;
}