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
      // YouTubeサムネイルもCloudinary等のプロキシを通さない場合はそのまま
      work.thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      work.isYoutubeThumb = true;
    } else {
      // Cloudinaryなどの画像URLをここで事前に最適化しておくことも可能
      work.thumb = getOptimizedImageUrl(work.thumb, false);
      work.isYoutubeThumb = false;
    }
  });
  
  return works;
}

/**
 * Cloudinaryの画像URLを最適化するヘルパー関数
 */
export function getOptimizedImageUrl(url, isYoutube) {
  if (!url) return "";
  
  // YouTubeの画像はCloudinaryではないのでスキップ
  if (isYoutube) return url;

  // Cloudinaryの画像のみ最適化
  if (url.includes('cloudinary.com')) {
    // すでにパラメータが含まれているかチェック
    if (url.includes('/upload/') && !url.includes('f_auto')) {
      /**
       * 🚀 最適化のポイント:
       * f_auto: ブラウザが対応していれば自動で WebP や AVIF に変換
       * q_auto: 見た目を維持しつつ限界までファイルサイズを削減
       * w_800: 表示領域に合わせてリサイズ（600だとRetinaディスプレイで少しボケるため800位が推奨）
       */
      const optimizationParams = 'f_auto,q_auto,w_800,c_fill,ar_16:9';
      return url.replace('/upload/', `/upload/${optimizationParams}/`);
    }
  }
  
  return url;
}