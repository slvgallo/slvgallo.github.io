import { getOptimizedImageUrl } from './data.js';

export function createWorkItem(work) {
  const article = document.createElement("article");
  article.className = "post index-post";
  article.dataset.tags = work.tags.join(" ");

  const postInner = document.createElement("div");
  postInner.className = "post-inner";

  const link = document.createElement("a");
  // 静的環境（dist）なら works/ID.html、開発環境なら works.html?id=ID
  if (window.slvEnv === 'static') {
    link.href = `works/${work.id}.html`;
  } else {
    link.href = `works.html?id=${work.id}`;
  }
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
