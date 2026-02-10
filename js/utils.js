// 共通ユーティリティ関数

/**
 * YouTube IDを抽出する関数
 */
export function extractYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    // 通常のYouTube動画
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /(?:youtube\.com\/vi\/)([^&\n?#]+)/,
    // YouTube Shorts
    /(?:youtube\.com\/shorts\/)([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
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

/**
 * インデックスページ用のCloudinary画像URLを最適化する
 */
export function getOptimizedIndexImageUrl(url, isYoutube) {
  if (!url || isYoutube) return url;
  
  if (url.includes('cloudinary.com')) {
    // すでに変換パラメータがある場合は二重に付けないようにチェック
    if (url.includes('/upload/') && !url.includes('f_webp')) {
      // w_600: 幅600pxに制限, c_limit: 元の比率を維持, f_webp: WebP形式, q_auto: 画質最適化
      const params = 'w_600,c_limit,f_webp,q_auto';
      return url.replace('/upload/', `/upload/${params}/`);
    }
  }
  
  return url;
}
