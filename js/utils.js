// クライアントサイド用ユーティリティ
// ビルド時に画像は最適化済みなので、追加処理は不要

/**
 * YouTube ID抽出
 */
export function extractYouTubeId(url) {
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
 * Cloudinary画像URLを最適化する
 * ビルド時に最適化済みなのでそのまま返す
 */
export function getOptimizedImageUrl(url, isYoutube) {
  return url;
}

/**
 * インデックスページ用のCloudinary画像URLを最適化する
 * ビルド時に最適化済みなのでそのまま返す
 */
export function getOptimizedIndexImageUrl(url, isYoutube) {
  return url;
}
