/**
 * サーバー/クライアント共通ユーティリティ
 */

/* =========================
 * YouTube
 * ========================= */

const { extractYouTubeId } = require('../js/youtube.mjs');

/* =========================
 * Cloudinary URL 最適化
 * ========================= */

function optimizeCloudinaryUrl(url) {
  if (!url || typeof url !== 'string') return url;

  if (url.includes('cloudinary.com') && url.includes('/upload/')) {
    if (!url.includes('f_auto')) {
      return url.replace('/upload/', '/upload/f_auto,q_auto/');
    }
  }
  return url;
}

function optimizeCloudinaryIndexUrl(url) {
  if (!url || typeof url !== 'string') return url;

  if (url.includes('cloudinary.com') && url.includes('/upload/')) {
    if (!url.includes('f_webp')) {
      return url.replace('/upload/', '/upload/w_600,c_limit,f_webp,q_auto/');
    }
  }

  if (url.includes('staticflickr.com')) {
    return url.replace(/_b\.jpg$/, '_z.jpg');
  }

  return url;
}

/* =========================
 * OGP 透かし生成
 * ========================= */

function isCloudinaryUrl(url) {
  return (
    typeof url === 'string' &&
    url.includes('res.cloudinary.com') &&
    url.includes('/upload/')
  );
}

function extractPublicIdFromCloudinaryUrl(url) {
  const afterUpload = url.split('/upload/')[1];
  const parts = afterUpload.split('/');
  const file = parts[parts.length - 1];
  return file.replace(/\.(jpg|jpeg|png|webp|gif|svg)$/i, '');
}

/**
 * すべての画像ソースに透かしOGPを適用
 * @param {string} imageSource
 */
function generateOGPImageUrl(imageSource) {
  if (!imageSource) return null;

  // Root-relative assets are served by this site and cannot be fetched by
  // Cloudinary until after deployment. Use the standard OGP fallback instead.
  if (imageSource.startsWith('/')) return null;

  const cloudName = "ddwxt9vnm";
  const logoId = "slv_pbcs35";

  const baseTrans = "c_fill,g_center,w_1200,h_630,e_colorize:5,co_black";
  const watermark = `l_${logoId},w_550,o_100/fl_layer_apply,g_center`;
  const optimize = "f_auto,q_auto";

  // ① Cloudinary Public ID
  if (!imageSource.startsWith('http')) {
    return `https://res.cloudinary.com/${cloudName}/image/upload/` +
      `${baseTrans}/${watermark}/${optimize}/${imageSource}.png`;
  }

  // ② Cloudinary URL
  if (isCloudinaryUrl(imageSource)) {
    const publicId = extractPublicIdFromCloudinaryUrl(imageSource);
    return `https://res.cloudinary.com/${cloudName}/image/upload/` +
      `${baseTrans}/${watermark}/${optimize}/${publicId}.png`;
  }

  // ③ 外部URL（Flickr / YouTube / 任意CDN）
  let imageUrl = imageSource;
  
  // YouTube URLの場合はサムネイルURLに変換
  if (imageSource.includes('youtube.com') || imageSource.includes('youtu.be')) {
    const videoId = extractYouTubeId(imageSource);
    if (videoId) {
      imageUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    }
  }
  
  return `https://res.cloudinary.com/${cloudName}/image/fetch/` +
    `${baseTrans}/${watermark}/${optimize}/` +
    imageUrl;
}

module.exports = {
  extractYouTubeId,
  optimizeCloudinaryUrl,
  optimizeCloudinaryIndexUrl,
  generateOGPImageUrl
};
