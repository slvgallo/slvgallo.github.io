import { extractYouTubeId, getOptimizedImageUrl } from './utils.js';

export async function loadWorks() {
  const res = await fetch("data/works.json");
  if (!res.ok) {
    throw new Error(`HTTP error! status: ${res.status}`);
  }
  const works = await res.json();
  
  // 各作品のデータを事前処理
  works.forEach((work) => {
    const videoId = extractYouTubeId(work.thumb);

    if (videoId) {
      work.thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      work.isYoutubeThumb = true;
    } else {
      work.thumb = getOptimizedImageUrl(work.thumb, false);
      work.isYoutubeThumb = false;
    }
  });
  
  return works;
}

export { getOptimizedImageUrl };