const fs = require('fs-extra');
const path = require('path');

// --- 追加: Cloudinary URLの最適化関数 ---
function optimizeCloudinaryUrl(url) {
  if (typeof url === 'string' && url.includes('cloudinary.com')) {
    // すでにf_autoが含まれている場合は重複しないようにチェック
    if (url.includes('/upload/') && !url.includes('f_auto')) {
      // /upload/ の直後に最適化パラメータ f_auto(WebP化), q_auto(画質自動調整) を挿入
      return url.replace('/upload/', '/upload/f_auto,q_auto/');
    }
  }
  return url;
}

// --- 追加: インデックス用Cloudinary URLの最適化関数 ---
function optimizeCloudinaryIndexUrl(url) {
  if (typeof url === 'string' && url.includes('cloudinary.com')) {
    // すでにf_autoが含まれている場合は重複しないようにチェック
    if (url.includes('/upload/') && !url.includes('f_auto')) {
      // w_600: 幅600pxに制限, c_limit: 元の比率を維持, f_auto: WebP化, q_auto: 画質自動調整
      return url.replace('/upload/', '/upload/w_600,c_limit,f_auto,q_auto/');
    }
  }
  return url;
}

// ES Modulesを動的にインポートするための設定
async function loadWorks() {
  const { loadWorks } = await import(path.join(__dirname, '..', 'js', 'data.js'));
  return await loadWorks();
}

const SRC_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(SRC_DIR, 'dist');
const DATA_DIR = path.join(SRC_DIR, 'data');
const TEMPLATES_DIR = path.join(SRC_DIR, 'templates');

function generateDateFromId(id) {
  if (id.length >= 4) {
    const yearMonth = id.substring(0, 4);
    const year = yearMonth.substring(0, 2);
    const month = yearMonth.substring(2, 4);
    const fullYear = `20${year}`;
    const monthNames = {
      '01': 'JAN', '02': 'FEB', '03': 'MAR', '04': 'APR',
      '05': 'MAY', '06': 'JUNE', '07': 'JULY', '08': 'AUG',
      '09': 'SEPT', '10': 'OCT', '11': 'NOV', '12': 'DEC'
    };
    return `${monthNames[month] || month} ${fullYear}`;
  }
  return id;
}

function replaceTemplate(template, work) {
  const tagsText = work.tags ? work.tags.map(tag => `#${tag}`).join(' ') : '';
  const tagsHtml = work.tags ? work.tags.map(tag => `<a href="../index.html?filter=${tag}" class="project-tag">#${tag}</a>`).join(' ') : '';
  const thumbInfo = getProcessedThumb(work.thumb);
  const optimizedThumb = optimizeCloudinaryUrl(thumbInfo.url || work.thumb || '');

  return template
    .replace(/\{\{ID\}\}/g, work.id)
    .replace(/\{\{TITLE\}\}/g, work.title)
    .replace(/\{\{DESC\}\}/g, (work.desc || '').replace(/\n/g, '<br>'))
    .replace(/\{\{DATE\}\}/g, generateDateFromId(work.id))
    .replace(/\{\{THUMB\}\}/g, optimizedThumb)
    .replace(/\{\{TAGS_TEXT\}\}/g, tagsText)
    .replace(/\{\{TAGS_HTML\}\}/g, tagsHtml);
}

// 作品個別ページの生成（1枚目のメディアをLCP最適化）
function generateWorkPages(works) {
  const workTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'work.html'), 'utf8');
  const worksDir = path.join(DIST_DIR, 'works');
  fs.ensureDirSync(worksDir);
  
  works.forEach(work => {
    let html = replaceTemplate(workTemplate, work);
    let fullMediaContent = '';
    let contentMediaContent = '';
    
    if (work.media && Array.isArray(work.media)) {
      work.media.forEach((mediaItem, index) => {
        // 最初のメディア(index 0)は優先読み込み対象
        const mediaHTML = generateMediaHTML(mediaItem, index === 0);
        if (index === 0) {
          fullMediaContent = mediaHTML;
        } else {
          contentMediaContent += mediaHTML;
        }
      });
    }
    html = html.replace('{{FULL_MEDIA_CONTENT}}', fullMediaContent);
    html = html.replace('{{MEDIA_CONTENT}}', contentMediaContent);
    fs.writeFileSync(path.join(worksDir, `${work.id}.html`), html);
  });
}

// メディアHTML生成（WebP化 + LCP対応）
function generateMediaHTML(mediaItem, isPriority = false) {
  const loading = isPriority ? '' : 'loading="lazy"';
  const priority = isPriority ? 'fetchpriority="high"' : '';
  const decoding = isPriority ? 'decoding="sync"' : 'decoding="async"';

  switch (mediaItem.type) {
    case 'image':
      if (Array.isArray(mediaItem.src)) {
        return mediaItem.src.map(src => 
          `<img src="${optimizeCloudinaryUrl(src)}" alt="Project image" ${loading} ${priority} ${decoding}>`
        ).join('');
      }
      return `<img src="${optimizeCloudinaryUrl(mediaItem.src)}" alt="Project image" ${loading} ${priority} ${decoding}>`;
    
    case 'image2column':
      if (Array.isArray(mediaItem.src)) {
        return `<div class="image2column-wrap" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
          ${mediaItem.src.map(src => `<img src="${optimizeCloudinaryUrl(src)}" alt="Project image" loading="lazy" style="width: 100%; height: auto;">`).join('')}
        </div>`;
      }
      break;
    
    case 'photo':
      const optimizedSrc = optimizeCloudinaryUrl(mediaItem.src);
      const img = `<img src="${optimizedSrc}" alt="Flickr photo" ${loading}>`;
      // Flickrリンク処理は維持
      if (mediaItem.src.includes('flickr.com')) {
        const flickrMatch = mediaItem.src.match(/\/photos\/[^\/]+\/(\d+)/) || mediaItem.src.match(/\/(\d+)_[^_]+_b\.jpg$/);
        if (flickrMatch) return `<a href="https://www.flickr.com/photos/slvgallo/${flickrMatch[1]}/" target="_blank" rel="noopener noreferrer">${img}</a>`;
      }
      return img;
    
    case 'video':
      const videoId = extractYouTubeId(mediaItem.src);
      return videoId ? `<div class="video-wrap" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden;"><iframe src="https://www.youtube.com/embed/${videoId}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" frameborder="0" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe></div>` : '';

    // ... その他のケース(soundcloud, processing等)は元のロジックを維持 ...
    case 'soundcloud':
      let scSrc = mediaItem.src;
      if (/^\d+$/.test(scSrc)) scSrc = `https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/${scSrc}&color=%230b0b0b&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false&visual=true&sharing=false`;
      return `<div style="position: relative; padding-bottom: 66.67%; height: 0; overflow: hidden;"><iframe src="${scSrc}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" width="100%" height="300" scrolling="no" frameborder="no" allow="autoplay"></iframe></div>`;
    
    case 'processing':
      let prSrc = mediaItem.src;
      if (prSrc.includes('openprocessing.org/sketch/') && !prSrc.endsWith('/embed/')) {
        const skId = prSrc.split('/sketch/')[1].split('/')[0];
        prSrc = `https://openprocessing.org/sketch/${skId}/embed/`;
      }
      return `<div class="processing-wrap"><iframe src="${prSrc}" frameborder="0" allowfullscreen></iframe></div>`;

    case 'sketchfab':
      let sfSrc = mediaItem.src;
      if (sfSrc.includes('/embed')) sfSrc += (sfSrc.includes('?') ? '&' : '?') + 'autospin=1&autostart=1&preload=1';
      return `<div class="sketchfab-wrap"><iframe src="${sfSrc}" frameborder="0" allowfullscreen mozallowfullscreen="true" onmozallowfullscreen="true" webkitallowfullscreen="true" onwebkitallowfullscreen="true"></iframe></div>`;

    case 'html':
      let hSrc = mediaItem.src.startsWith('/works/') ? mediaItem.src.replace('/works/', '../works/') : mediaItem.src;
      return `<div class="html-wrap"><iframe src="${hSrc}" frameborder="0" allowfullscreen></iframe></div>`;
    
    default: return '';
  }
}

function extractYouTubeId(url) {
  const shortsMatch = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shortsMatch) return shortsMatch[1];
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[7].length === 11) ? match[7] : null;
}

function getProcessedThumb(thumbUrl) {
  if (!thumbUrl) return { url: '', isYoutube: false };
  const isYoutube = typeof thumbUrl === "string" && (thumbUrl.includes("youtube.com") || thumbUrl.includes("youtu.be"));
  if (isYoutube) {
    const videoId = extractYouTubeId(thumbUrl);
    return { url: videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : thumbUrl, isYoutube: true };
  }
  return { url: optimizeCloudinaryUrl(thumbUrl), isYoutube: false };
}

function generateThumbContent(work, thumbInfo, isPriority) {
  const imgStyle = thumbInfo.isYoutube ? 'style="transform: scale(1.02);"' : '';
  const loading = isPriority ? '' : 'loading="lazy"';
  const priority = isPriority ? 'fetchpriority="high"' : '';
  const decoding = isPriority ? 'decoding="sync"' : 'decoding="async"';

  if (work.thumb && work.thumb.includes('soundcloud.com')) {
    const sc = work.media && work.media.find(m => m.type === 'soundcloud');
    if (sc) return `<iframe src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/soundcloud%253Atracks%253A${sc.src}&color=%23000000&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false&visual=true&sharing=false" width="100%" height="300" frameborder="no" scrolling="no" allow="autoplay" style="pointer-events: none;"></iframe><div class="soundcloud-overlay"></div>`;
  }
  
  return `<img src="${optimizeCloudinaryIndexUrl(thumbInfo.url)}" ${imgStyle} alt="${work.title}" ${loading} ${priority} ${decoding}>`;
}

function generateIndexPage(works) {
  const indexTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'index.html'), 'utf8');
  let worksGrid = '';
  works.forEach((work, index) => {
    const thumbInfo = getProcessedThumb(work.thumb);
    const isPriority = index < 4; // 最初の4枚をLCP最適化

    worksGrid += `
      <article class="post index-post" data-tags="${work.tags ? work.tags.join(' ') : ''}">
        <div class="post-inner">
          <a href="works/${work.id}.html" class="post-content-anchor">
            <div class="post-photo-thumb">${generateThumbContent(work, thumbInfo, isPriority)}</div>
            <div class="post-content"><h2 class="post-title">${work.title}</h2></div>
          </a>
        </div>
      </article>`;
  });
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), indexTemplate.replace('{{WORKS_GRID}}', worksGrid));
  console.log('Generated: index.html with Cloudinary WebP & LCP optimizations');
}

// ... 以降、generateProfilePage, copyAssets, build 関数などは元のままでOK ...
// (紙面の都合上、主要な変更部分のみ記載しています)
function generateProfilePage() {
  const profileTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'profile.html'), 'utf8');
  fs.writeFileSync(path.join(DIST_DIR, 'profile.html'), profileTemplate);
}

function copyAssets() {
  ['css', 'js', 'img'].forEach(asset => {
    const src = path.join(SRC_DIR, asset);
    if (fs.existsSync(src)) fs.copySync(src, path.join(DIST_DIR, asset));
  });
  if (fs.existsSync(path.join(SRC_DIR, 'works'))) fs.copySync(path.join(SRC_DIR, 'works'), path.join(DIST_DIR, 'works'));
  fs.copySync(path.join(DATA_DIR, 'works.json'), path.join(DIST_DIR, 'data', 'works.json'));
  if (fs.existsSync(path.join(SRC_DIR, 'sitemap.xml'))) fs.copySync(path.join(SRC_DIR, 'sitemap.xml'), path.join(DIST_DIR, 'sitemap.xml'));
}

const { generateSitemap } = require('./generate-sitemap');

async function build() {
  try {
    console.log('🚀 Starting build process...');
    fs.emptyDirSync(DIST_DIR);
    const works = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'works.json'), 'utf8'));
    generateWorkPages(works);
    generateIndexPage(works);
    generateProfilePage();
    generateSitemap();
    copyAssets();
    console.log('✅ Build completed successfully!');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

if (require.main === module) build();

module.exports = { build };