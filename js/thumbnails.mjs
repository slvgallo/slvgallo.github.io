export const thumbnailSizes = '(min-width: 1440px) calc((100vw - 50px) / 4), (min-width: 1024px) calc((100vw - 40px) / 3), (min-width: 768px) calc((100vw - 30px) / 2), calc(100vw - 20px)';
export function thumbnailSources(url) {
  if (typeof url !== 'string' || !url.startsWith('https://res.cloudinary.com/') || !url.includes('/upload/')) return { src: url };
  const original = url.replace('/upload/w_600,c_limit,f_webp,q_auto/', '/upload/').replace('/upload/f_auto,q_auto/', '/upload/');
  const atWidth = width => original.replace('/upload/', `/upload/w_${width},c_limit,f_webp,q_auto:eco/`);
  return { src: atWidth(600), srcset: [320, 400, 600].map(width => `${atWidth(width)} ${width}w`).join(', '), sizes: thumbnailSizes };
}
