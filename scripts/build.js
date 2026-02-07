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
    
    // メディアコンテンツを生成
    let mediaContent = '';
    if (work.media && Array.isArray(work.media)) {
      work.media.forEach(mediaItem => {
        mediaContent += generateMediaHTML(mediaItem);
      });
    }
    
    // メディアコンテンツをHTMLに挿入
    html = html.replace('{{MEDIA_CONTENT}}', mediaContent);
    
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
        return mediaItem.src.map((src, index) => {
          let html = `<img src="${src}" alt="Project image" loading="lazy">`;
          if (mediaItem.link) {
            let link = mediaItem.link;
            if (Array.isArray(link)) {
               link = link[index] || link[0];
            }
            return `<a href="${link}" target="_blank" rel="noopener noreferrer">${html}</a>`;
          }
          return html;
        }).join('');
      } else {
        let html = `<img src="${mediaItem.src}" alt="Project image" loading="lazy">`;
        if (mediaItem.link) {
           return `<a href="${mediaItem.link}" target="_blank" rel="noopener noreferrer">${html}</a>`;
        }
        return html;
      }
      break;

    case 'photo':
      // Flickr logic port
      const imgHtml = `<img src="${mediaItem.src}" alt="Flickr photo" loading="lazy">`;
      if (mediaItem.src.includes('flickr.com')) {
         let flickrLink = mediaItem.src;
         const flickrMatch = mediaItem.src.match(/\/photos\/[^\/]+\/(\d+)/);
         if (flickrMatch) {
            flickrLink = `https://www.flickr.com/photos/slvgallo/${flickrMatch[1]}/`;
         } else {
            const staticMatch = mediaItem.src.match(/\/(\d+)_[^_]+_b\.jpg$/);
            if (staticMatch) {
               flickrLink = `https://www.flickr.com/photos/slvgallo/${staticMatch[1]}/`;
            }
         }
         return `<a href="${flickrLink}" target="_blank" rel="noopener noreferrer">${imgHtml}</a>`;
      }
      return imgHtml;
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
      } else {
        return `
          <div class="video-wrap" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden;">
            <iframe src="${mediaItem.src}" 
                    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" 
                    frameborder="0" 
                    allowfullscreen>
            </iframe>
          </div>
        `;
      }
      break;
    
    case 'soundcloud':
      let scSrc = mediaItem.src;
      if (/^\d+$/.test(scSrc)) {
         scSrc = `https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/${scSrc}&color=%230b0b0b&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false&visual=true&sharing=false`;
      }
      // Add credit
      const credit = `<div style="font-size: 10px; color: #cccccc;line-break: anywhere;word-break: normal;overflow: hidden;white-space: nowrap;text-overflow: ellipsis; font-family: Interstate,Lucida Grande,Lucida Sans Unicode,Lucida Sans,Garuda,Verdana,Tahoma,sans-serif;font-weight: 100;"><a href="https://soundcloud.com/slvgallo" title="slvgallo" target="_blank" style="color: #cccccc; text-decoration: none;">slvgallo</a> · <a href="https://soundcloud.com/slvgallo/otp" title="OTP" target="_blank" style="color: #cccccc; text-decoration: none;">OTP</a></div>`;
      
      return `
        <div class="soundcloud-wrap">
          <iframe width="100%" 
                  height="300" 
                  scrolling="no" 
                  frameborder="no" 
                  allow="autoplay" 
                  src="${scSrc}">
          </iframe>
          ${credit}
        </div>
      `;
      break;

    case 'processing':
      let embedUrl = mediaItem.src;
      if (embedUrl.includes('openprocessing.org/sketch/')) {
        // Ensure embed URL format
        if (!embedUrl.endsWith('/embed/')) {
           // check if already has /embed/ in middle? No, standard is /sketch/ID/embed/
           const sketchIdMatch = embedUrl.match(/\/sketch\/(\d+)/);
           if (sketchIdMatch) {
             embedUrl = `https://openprocessing.org/sketch/${sketchIdMatch[1]}/embed/`;
           }
        }
      }
      return `
        <div class="processing-wrap">
          <iframe src="${embedUrl}" 
                  style="width: 100%; height: 600px; border: 0;" 
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
                  style="width: 100%; height: 600px; border: 0;" 
                  frameborder="0" 
                  allowfullscreen 
                  allow="autoplay; fullscreen; vr">
          </iframe>
        </div>
      `;
      break;

    case 'html':
      return `
        <div class="html-wrap">
          <iframe src="${mediaItem.src}" 
                  style="width: 100%; height: 600px; border: 0;" 
                  frameborder="0" 
                  allowfullscreen>
          </iframe>
        </div>
      `;
      break;

    case 'image2column':
      if (Array.isArray(mediaItem.src)) {
        const imagesHtml = mediaItem.src.map((src, index) => {
          let imgHtml = `<img src="${src}" alt="Project image" loading="lazy" style="width: 100%; height: auto;">`;
          if (mediaItem.link) {
            let link = mediaItem.link;
            if (Array.isArray(link)) {
               link = link[index] || link[0];
            }
            return `<a href="${link}" target="_blank" rel="noopener noreferrer">${imgHtml}</a>`;
          }
          return imgHtml;
        }).join('');
        return `<div class="image2column-wrap" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">${imagesHtml}</div>`;
      }
      return '';
      break;

    default:
      return '';
  }
}

// YouTube IDを抽出する関数（utils.jsからコピー）
function extractYouTubeId(url) {
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
