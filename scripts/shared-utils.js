/**
 * サーバー/クライアント共通のユーティリティ関数
 * ビルドスクリプトとフロントエンドで共有される関数群
 */

/**
 * YouTube ID抽出
 * @param {string} url - YouTube URL
 * @returns {string|null} - Video ID or null
 */
function extractYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /(?:youtube\.com\/vi\/)([^&\n?#]+)/,
    /(?:youtube\.com\/shorts\/)([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Cloudinary URL最適化（ビルド時用 - 詳細ページ）
 * @param {string} url - Original URL
 * @returns {string} - Optimized URL
 */
function optimizeCloudinaryUrl(url) {
  if (!url || typeof url !== 'string') return url;
  
  if (url.includes('cloudinary.com') && url.includes('/upload/')) {
    if (!url.includes('f_auto')) {
      return url.replace('/upload/', '/upload/f_auto,q_auto/');
    }
  }
  return url;
}

/**
 * インデックス用Cloudinary URL最適化（サムネイル用）
 * @param {string} url - Original URL
 * @returns {string} - Optimized URL
 */
function optimizeCloudinaryIndexUrl(url) {
  if (!url || typeof url !== 'string') return url;
  
  if (url.includes('cloudinary.com') && url.includes('/upload/')) {
    if (!url.includes('f_webp')) {
      return url.replace('/upload/', '/upload/w_600,c_limit,f_webp,q_auto/');
    }
  }
  
  // Flickr画像の最適化（インデックス用：_b.jpg → _z.jpg）
  if (url.includes('staticflickr.com')) {
    return url.replace(/_b\.jpg$/, '_z.jpg');
  }
  
  return url;
}

// CommonJS と ES Modules 両対応
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractYouTubeId,
    optimizeCloudinaryUrl,
    optimizeCloudinaryIndexUrl
  };
}

// ES Modules export
if (typeof exports !== 'undefined') {
  exports.extractYouTubeId = extractYouTubeId;
  exports.optimizeCloudinaryUrl = optimizeCloudinaryUrl;
  exports.optimizeCloudinaryIndexUrl = optimizeCloudinaryIndexUrl;
}
