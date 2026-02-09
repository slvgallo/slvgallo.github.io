const fs = require('fs-extra');
const path = require('path');

// ディレクトリ設定
const DIST_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(__dirname, '..', 'data');

// サイトマップ生成関数
function generateSitemap() {
  try {
    // works.jsonを読み込み
    const worksData = fs.readFileSync(path.join(DATA_DIR, 'works.json'), 'utf8');
    const works = JSON.parse(worksData);
    
    // 現在の日時を取得（W3C datetime format）
    const now = new Date().toISOString();
    
    // サイトマップXMLの開始
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <!-- トップページ -->
  <url>
    <loc>https://slvgallo.github.io/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  
  <!-- プロフィールページ -->
  <url>
    <loc>https://slvgallo.github.io/profile.html</loc>
    <lastmod>${now}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  
  <!-- 作品ページ -->
`;
    
    // 各作品ページを追加
    works.forEach(work => {
      // IDから日付を生成
      const date = generateDateFromId(work.id);
      
      sitemap += `  <url>
    <loc>https://slvgallo.github.io/works/${work.id}.html</loc>
    <lastmod>${now}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
`;
    });
    
    // サイトマップXMLの終了
    sitemap += `</urlset>`;
    
    // サイトマップをdistディレクトリに保存
    const sitemapPath = path.join(DIST_DIR, 'sitemap.xml');
    fs.writeFileSync(sitemapPath, sitemap);
    
    console.log('✅ Sitemap generated successfully!');
    console.log(`📍 Location: ${sitemapPath}`);
    console.log(`📊 Total URLs: ${2 + works.length} (2 static + ${works.length} works)`);
    
  } catch (error) {
    console.error('❌ Failed to generate sitemap:', error);
    process.exit(1);
  }
}

// IDから日付を生成する関数（build.jsと共通）
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

// スクリプト実行
if (require.main === module) {
  generateSitemap();
}

module.exports = { generateSitemap };
