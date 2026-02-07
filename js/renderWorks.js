// extractYouTubeId関数はutils.jsで定義

import { generateWorkLink } from './env.js';

// 作品アイテムを生成する関数
// Extracted from index.js lines 164-245
export function createWorkItem(work) {
  const article = document.createElement("article");
  article.className = "post index-post";
  article.dataset.tags = work.tags.join(" ");

  const postInner = document.createElement("div");
  postInner.className = "post-inner";

  const link = document.createElement("a");
  // 静的環境（dist）なら works/ID.html、開発環境なら works.html?id=ID
  link.href = generateWorkLink(work.id);
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

/**
 * Cloudinaryの画像URLを最適化するヘルパー関数
 * Extracted from index.js lines 355-373
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

// YouTubeサムネイルの事前処理
// Extracted from index.js lines 36-51
export function preprocessWorkThumbnails(works) {
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
