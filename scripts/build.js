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
    const html = replaceTemplate(workTemplate, work);
    const filename = `${work.id}.html`;
    fs.writeFileSync(path.join(worksDir, filename), html);
    console.log(`Generated: works/${filename}`);
  });
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
