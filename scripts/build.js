const fs = require('fs-extra');
const path = require('path');

// ディレクトリ設定
const SRC_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(SRC_DIR, 'dist');
const DATA_DIR = path.join(SRC_DIR, 'data');
const TEMPLATES_DIR = path.join(SRC_DIR, 'templates');
const ASSETS_DIR = path.join(SRC_DIR, 'css', 'js', 'img');

// IDから日付を生成する関数
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
    
    const monthName = monthNames[month] || month;
    return `${monthName} ${fullYear}`;
  }
  return id;
}

// テンプレートを置換する関数
function replaceTemplate(template, work) {
  return template
    .replace(/\{\{ID\}\}/g, work.id)
    .replace(/\{\{TITLE\}\}/g, work.title)
    .replace(/\{\{DESC\}\}/g, (work.desc || '').replace(/\n/g, '<br>'))
    .replace(/\{\{DATE\}\}/g, generateDateFromId(work.id))
    .replace(/\{\{THUMB\}\}/g, work.thumb || '')
    .replace(/\{\{TAGS\}\}/g, work.tags ? work.tags.map(tag => `#${tag}`).join(' ') : '');
}

// 作品ページを生成する関数
function generateWorkPages(works) {
  const workTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'work.html'), 'utf8');
  const worksDir = path.join(DIST_DIR, 'works');
  
  fs.ensureDirSync(worksDir);
  
  works.forEach(work => {
    let html = replaceTemplate(workTemplate, work);
    
    // メディアコンテンツを生成（フルサイズとコンテンツエリアに分割）
    let fullMediaContent = '';
    let contentMediaContent = '';
    
    if (work.media && Array.isArray(work.media)) {
      work.media.forEach((mediaItem, index) => {
        const mediaHTML = generateMediaHTML(mediaItem);
        if (index === 0) {
          // 最初のメディアはフルサイズ
          fullMediaContent = mediaHTML;
        } else {
          // 残りはコンテンツエリア
          contentMediaContent += mediaHTML;
        }
      });
    }
    
    // メディアコンテンツをHTMLに挿入
    html = html.replace('{{FULL_MEDIA_CONTENT}}', fullMediaContent);
    html = html.replace('{{MEDIA_CONTENT}}', contentMediaContent);
    
    const filename = `${work.id}.html`;
    fs.writeFileSync(path.join(worksDir, filename), html);
    console.log(`Generated: works/${filename}`);
  });
}

// メディアHTMLを生成する関数
function generateMediaHTML(mediaItem) {
  switch (mediaItem.type) {
    case 'image':
      if (Array.isArray(mediaItem.src)) {
        return mediaItem.src.map(src => 
          `<img src="${src}" alt="Project image" loading="lazy">`
        ).join('');
      } else {
        return `<img src="${mediaItem.src}" alt="Project image" loading="lazy">`;
      }
      break;
    
    case 'image2column':
      if (Array.isArray(mediaItem.src)) {
        return `
          <div class="image2column-wrap" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            ${mediaItem.src.map(src => 
              `<img src="${src}" alt="Project image" loading="lazy" style="width: 100%; height: auto;">`
            ).join('')}
          </div>
        `;
      }
      break;
    
    case 'photo':
      // Flickr写真は基本的に画像として扱う
      const img = `<img src="${mediaItem.src}" alt="Flickr photo" loading="lazy">`;
      
      // Flickrの元ページへのリンクを自動的に追加
      if (mediaItem.src.includes('flickr.com')) {
        const flickrMatch = mediaItem.src.match(/\/photos\/[^\/]+\/(\d+)/);
        if (flickrMatch) {
          return `<a href="https://www.flickr.com/photos/slvgallo/${flickrMatch[1]}/" target="_blank" rel="noopener noreferrer">${img}</a>`;
        } else {
          // staticflickr.comの場合は別の方法でURLを生成
          const staticMatch = mediaItem.src.match(/\/(\d+)_[^_]+_b\.jpg$/);
          if (staticMatch) {
            return `<a href="https://www.flickr.com/photos/slvgallo/${staticMatch[1]}/" target="_blank" rel="noopener noreferrer">${img}</a>`;
          }
        }
      }
      return img;
      break;
    
    case 'video':
      const videoId = extractYouTubeId(mediaItem.src);
      if (videoId) {
        return `
          <div class="video-wrap" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden;">
            <iframe src="https://www.youtube.com/embed/${videoId}" 
                    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" 
                    frameborder="0" 
                    allowfullscreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture">
            </iframe>
          </div>
        `;
      }
      break;
    
    case 'soundcloud':
      // SoundCloudトラックIDから埋め込みURLを生成
      let soundcloudSrc = mediaItem.src;
      
      // 数字のみの場合は埋め込みURLを生成
      if (/^\d+$/.test(soundcloudSrc)) {
        soundcloudSrc = `https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/${soundcloudSrc}&color=%230b0b0b&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false&visual=true&sharing=false`;
      }
      
      return `
        <iframe width="100%" 
                height="166" 
                scrolling="no" 
                frameborder="no" 
                allow="autoplay" 
                src="${soundcloudSrc}">
        </iframe>
      `;
      break;
    
    case 'processing':
      // openprocessing.orgのURLを埋め込み用URLに変換
      let processingSrc = mediaItem.src;
      if (processingSrc.includes('openprocessing.org/sketch/')) {
        // https://openprocessing.org/sketch/123456 → https://openprocessing.org/sketch/123456/embed/
        if (!processingSrc.endsWith('/embed/')) {
          const sketchId = processingSrc.split('/sketch/')[1].split('/')[0];
          processingSrc = `https://openprocessing.org/sketch/${sketchId}/embed/`;
        }
      }
      
      return `
        <div class="processing-wrap">
          <iframe src="${processingSrc}" 
                  frameborder="0" 
                  allowfullscreen>
          </iframe>
        </div>
      `;
      break;
    
    case 'sketchfab':
      return `
        <div class="sketchfab-wrap">
          <iframe src="${mediaItem.src}" 
                  frameborder="0" 
                  allowfullscreen
                  allow="autoplay; fullscreen; vr">
          </iframe>
        </div>
      `;
      break;
    
    case 'html':
      // HTMLメディアのパスを修正
      let htmlSrc = mediaItem.src;
      if (htmlSrc.startsWith('/works/')) {
        // 絶対パスを相対パスに変換
        htmlSrc = htmlSrc.replace('/works/', '../works/');
      }
      return `
        <div class="html-wrap">
          <iframe src="${htmlSrc}" 
                  frameborder="0" 
                  allowfullscreen>
          </iframe>
        </div>
      `;
      break;
    
    default:
      return '';
  }
  
  return '';
}

// YouTube IDを抽出する関数
function extractYouTubeId(url) {
  // YouTube Shorts URLに対応
  const shortsMatch = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shortsMatch) {
    return shortsMatch[1];
  }
  
  // 通常のYouTube URL
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[7].length === 11) ? match[7] : null;
}

// トップページを生成する関数
function generateIndexPage(works) {
  const indexTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'index.html'), 'utf8');
  
  // 作品グリッドを生成
  let worksGrid = '';
  works.forEach(work => {
    const workItem = `
      <div class="post" data-tags="${work.tags ? work.tags.join(' ') : ''}">
        <div class="post-inner">
          <a href="works/${work.id}.html" class="post-content-anchor">
            <div class="post-thumb">
              <img src="${work.thumb || ''}" alt="${work.title}" loading="lazy">
            </div>
            <div class="post-content">
              <h2 class="post-title">${work.title}</h2>
            </div>
          </a>
        </div>
      </div>
    `;
    worksGrid += workItem;
  });
  
  const html = indexTemplate.replace('{{WORKS_GRID}}', worksGrid);
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), html);
  console.log('Generated: index.html');
}

// プロフィールページを生成する関数
function generateProfilePage() {
  const profileTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'profile.html'), 'utf8');
  fs.writeFileSync(path.join(DIST_DIR, 'profile.html'), profileTemplate);
  console.log('Generated: profile.html');
}

// アセットをコピーする関数
function copyAssets() {
  // CSS, JS, imgディレクトリをコピー
  const assetsToCopy = ['css', 'js', 'img'];
  
  assetsToCopy.forEach(asset => {
    const srcPath = path.join(SRC_DIR, asset);
    const destPath = path.join(DIST_DIR, asset);
    
    if (fs.existsSync(srcPath)) {
      fs.copySync(srcPath, destPath);
      console.log(`Copied: ${asset}/`);
    }
  });
  
  // worksディレクトリをコピー（HTMLメディア用）
  const worksSrcPath = path.join(SRC_DIR, 'works');
  const worksDestPath = path.join(DIST_DIR, 'works');
  
  if (fs.existsSync(worksSrcPath)) {
    fs.copySync(worksSrcPath, worksDestPath);
    console.log('Copied: works/');
  }
  
  // works.jsonもコピー（API用）
  fs.copySync(
    path.join(DATA_DIR, 'works.json'),
    path.join(DIST_DIR, 'data', 'works.json')
  );
  console.log('Copied: data/works.json');
}

// メインビルド関数
async function build() {
  try {
    console.log('🚀 Starting build process...');
    
    // 出力ディレクトリをクリーンアップ
    fs.emptyDirSync(DIST_DIR);
    console.log('📁 Cleaned dist directory');
    
    // works.jsonを読み込み
    const worksData = fs.readFileSync(path.join(DATA_DIR, 'works.json'), 'utf8');
    const works = JSON.parse(worksData);
    console.log(`📊 Loaded ${works.length} works from works.json`);
    
    // 各種ページを生成
    generateWorkPages(works);
    generateIndexPage(works);
    generateProfilePage();
    
    // アセットをコピー
    copyAssets();
    
    console.log('✅ Build completed successfully!');
    console.log(`📂 Output directory: ${DIST_DIR}`);
    
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

// スクリプト実行
if (require.main === module) {
  build();
}

module.exports = { build };
