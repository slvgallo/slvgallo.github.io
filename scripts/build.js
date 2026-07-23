const fs = require('fs-extra');
const path = require('path');
const {
  extractYouTubeId,
  optimizeCloudinaryUrl,
  optimizeCloudinaryIndexUrl,
  generateOGPImageUrl,
  generateYouTubeOGPImageUrl
} = require('./shared-utils');

class SiteBuilder {
  constructor() {
    this.config = {
      srcDir: path.join(__dirname, '..'),
      distDir: path.join(__dirname, '..', 'dist'),
      dataDir: path.join(__dirname, '..', 'data'),
      templatesDir: path.join(__dirname, '..', 'templates')
    };
    
    this.stats = {
      pages: 0,
      images: 0,
      errors: []
    };
  }

  /**
   * 日付生成
   */
  generateDateFromId(id) {
    if (id.length >= 4) {
      const year = id.substring(0, 2);
      const month = id.substring(2, 4);
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

  /**
   * サムネイル情報取得
   */
  getProcessedThumb(thumbUrl) {
    if (!thumbUrl) return { url: '', isYoutube: false };
    
    const isYoutube = typeof thumbUrl === "string" && 
      (thumbUrl.includes("youtube.com") || thumbUrl.includes("youtu.be"));
    
    if (isYoutube) {
      const videoId = extractYouTubeId(thumbUrl);
      return {
        url: videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : thumbUrl,
        isYoutube: true
      };
    }
    
    return {
      url: optimizeCloudinaryIndexUrl(thumbUrl),
      isYoutube: false
    };
  }

  /**
   * メディアHTML生成
   */
  generateMediaHTML(mediaItem, isPriority = false, workTitle = '') {
    const loading = isPriority ? '' : 'loading="lazy"';
    const priority = isPriority ? 'fetchpriority="high"' : '';
    const decoding = isPriority ? 'decoding="sync"' : 'decoding="async"';

    switch (mediaItem.type) {
      case 'image':
        const src = Array.isArray(mediaItem.src) ? mediaItem.src : [mediaItem.src];
        return src.map(s => 
          `<img src="${optimizeCloudinaryUrl(s)}" alt="Project image" ${loading} ${priority} ${decoding}>`
        ).join('');
      
      case 'image2column':
        if (Array.isArray(mediaItem.src)) {
          return `<div class="image2column-wrap">
            ${mediaItem.src.map(s => 
              `<img src="${optimizeCloudinaryUrl(s)}" alt="Project image" loading="lazy">`
            ).join('')}
          </div>`;
        }
        return '';
      
      case 'photo':
        const optimizedSrc = optimizeCloudinaryUrl(mediaItem.src);
        const altText = workTitle ? `${workTitle} - View on Flickr` : 'Photo';
        const img = `<img src="${optimizedSrc}" alt="${altText}" ${loading}>`;
        
        if (mediaItem.src.includes('flickr.com')) {
          const flickrMatch = mediaItem.src.match(/\/photos\/[^\/]+\/(\d+)/) || 
                            mediaItem.src.match(/\/(\d+)_[^_]+_b\.jpg$/);
          if (flickrMatch) {
            return `<a href="https://www.flickr.com/photos/slvgallo/${flickrMatch[1]}/" target="_blank" rel="noopener noreferrer" aria-label="${altText}">${img}</a>`;
          }
        }
        return img;
      
      case 'video':
        const videoId = extractYouTubeId(mediaItem.src);
        if (!videoId) return '';
        
        return `<div class="video-wrap" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden;">
          <iframe 
            src="https://www.youtube.com/embed/${videoId}" 
            style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"
            frameborder="0" 
            allowfullscreen 
            allow="autoplay; encrypted-media; picture-in-picture"
            ${loading}>
          </iframe>
        </div>`;

      case 'soundcloud':
        let scSrc = mediaItem.src;
        if (/^\d+$/.test(scSrc)) {
          scSrc = `https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/${scSrc}&color=%230b0b0b&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false&visual=true&sharing=false`;
        }
        return `<div style="position: relative; padding-bottom: 66.67%; height: 0; overflow: hidden;">
          <iframe src="${scSrc}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" width="100%" height="300" scrolling="no" frameborder="no" allow="autoplay; encrypted-media" loading="lazy"></iframe>
        </div>`;
      
      case 'processing':
        let prSrc = mediaItem.src;
        if (prSrc.includes('openprocessing.org/sketch/') && !prSrc.endsWith('/embed/')) {
          const skId = prSrc.split('/sketch/')[1].split('/')[0];
          prSrc = `https://openprocessing.org/sketch/${skId}/embed/`;
        }
        return `<div class="processing-wrap">
          <iframe src="${prSrc}" frameborder="0" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture; accelerometer; gyroscope; xr-spatial-tracking"></iframe>
        </div>`;

      case 'sketchfab':
        let sfSrc = mediaItem.src;
        if (sfSrc.includes('/embed')) {
          sfSrc += (sfSrc.includes('?') ? '&' : '?') + 'autospin=1&autostart=1&preload=1';
        }
        return `<div class="sketchfab-wrap">
          <iframe src="${sfSrc}" frameborder="0" allowfullscreen mozallowfullscreen="true" webkitallowfullscreen="true" allow="autoplay; encrypted-media; picture-in-picture; accelerometer; gyroscope; xr-spatial-tracking"></iframe>
        </div>`;

      case 'html':
        const hSrc = mediaItem.src.startsWith('/works/') 
          ? mediaItem.src.replace('/works/', '../works/') 
          : mediaItem.src;
        const ratioMatch = typeof mediaItem.aspectRatio === 'string'
          ? mediaItem.aspectRatio.match(/^(\d+(?:\.\d+)?)\s*[/:]\s*(\d+(?:\.\d+)?)$/)
          : null;
        const hasValidRatio = ratioMatch
          && Number(ratioMatch[1]) > 0
          && Number(ratioMatch[2]) > 0;
        const ratioClass = hasValidRatio ? ' html-wrap--fixed-ratio' : '';
        const ratioStyle = hasValidRatio
          ? ` style="--html-aspect-ratio: ${ratioMatch[1]} / ${ratioMatch[2]}"`
          : '';
        return `<div class="html-wrap${ratioClass}"${ratioStyle}>
          <iframe src="${hSrc}" frameborder="0" allow="autoplay" allowfullscreen></iframe>
        </div>`;
      
      default:
        console.warn(`Unknown media type: ${mediaItem.type}`);
        return '';
    }
  }

  /**
   * サムネイルコンテンツ生成
   */
  generateThumbContent(work, thumbInfo, isPriority) {
    const imgStyle = thumbInfo.isYoutube ? 'style="transform: scale(1.02);"' : '';
    const loading = isPriority ? '' : 'loading="lazy"';
    const priority = isPriority ? 'fetchpriority="high"' : '';
    const decoding = isPriority ? 'decoding="sync"' : 'decoding="async"';

    return `<img src="${thumbInfo.url}" ${imgStyle} alt="${work.title}" ${loading} ${priority} ${decoding}>`;
  }

  /**
   * テンプレート置換
   */
  replaceTemplate(template, work) {
    const tagsText = work.tags ? work.tags.map(tag => `#${tag}`).join(' ') : '';
    const tagsHtml = work.tags 
      ? work.tags.map(tag => `<a href="../index.html?filter=${tag}" class="project-tag">#${tag}</a>`).join(' ') 
      : '';

    const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
    const formatDescription = description => description || '';
    const stripHtml = html => String(html || '').replace(/<[^>]*>/g, ' ');

    const hasBilingualDescription = Boolean(work.desc_en && work.desc);
    const descriptionContent = hasBilingualDescription
      ? `<div class="project-desc-lang lang-en">${formatDescription(work.desc_en)}</div><div class="project-desc-lang lang-ja">${formatDescription(work.desc)}</div>`
      : formatDescription(work.desc);
    const languageButtons = hasBilingualDescription
      ? `<div class="lang-buttons" role="group" aria-label="Description language">
              <button id="lang-en" class="lang-btn active" type="button">EN</button>
              <button id="lang-ja" class="lang-btn" type="button">JP</button>
            </div>`
      : '';
    const metaDescription = escapeHtml(stripHtml(work.desc_en || work.desc).replace(/\s+/g, ' ').trim());
    
    const thumbInfo = this.getProcessedThumb(work.thumb);
    const optimizedThumb = optimizeCloudinaryUrl(thumbInfo.url || work.thumb || '');

    return template
      .replace(/\{\{ID\}\}/g, work.id)
      .replace(/\{\{TITLE\}\}/g, work.title)
      .replace(/\{\{META_DESC\}\}/g, metaDescription)
      .replace(/\{\{DESC_CONTENT\}\}/g, descriptionContent)
      .replace(/\{\{LANG_BUTTONS\}\}/g, languageButtons)
      .replace(/\{\{DATE\}\}/g, this.generateDateFromId(work.id))
      .replace(/\{\{THUMB\}\}/g, optimizedThumb)
      .replace(/\{\{TAGS_TEXT\}\}/g, tagsText)
      .replace(/\{\{TAGS_HTML\}\}/g, tagsHtml);
  }

  /**
   * 作品ページ生成
   */
  generateWorkPages(works) {
    console.log('📄 Generating work pages...');
    
    const workTemplate = fs.readFileSync(
      path.join(this.config.templatesDir, 'work.html'), 
      'utf8'
    );
    
    const worksDir = path.join(this.config.distDir, 'works');
    fs.ensureDirSync(worksDir);
    
    works.forEach(work => {
      try {
        let html = this.replaceTemplate(workTemplate, work);
        let fullMediaContent = '';
        let contentMediaContent = '';
        
        // OGP画像の生成
        let ogpImageUrl = null;
        
        if (work.thumb) {
          const generatedOgp = generateOGPImageUrl(work.thumb);
          if (generatedOgp) {
            ogpImageUrl = generatedOgp;
          }
        }
        
        if (!ogpImageUrl) {
          ogpImageUrl = 'https://res.cloudinary.com/ddwxt9vnm/image/upload/v1770820480/ogp_blank_ghjrxq.png';
        }
        
        if (work.media && Array.isArray(work.media)) {
          work.media.forEach((mediaItem, index) => {
            const mediaHTML = this.generateMediaHTML(mediaItem, index === 0, work.title);
            if (index === 0) {
              fullMediaContent = mediaHTML;
            } else {
              contentMediaContent += mediaHTML;
            }
          });
        }
        
        html = html.replace('{{FULL_MEDIA_CONTENT}}', fullMediaContent);
        html = html.replace('{{MEDIA_CONTENT}}', contentMediaContent);
        
        // OGPメタデータを置換
        html = html.replace('{{OGP_IMAGE_URL}}', ogpImageUrl);
        
        fs.writeFileSync(
          path.join(worksDir, `${work.id}.html`),
          html
        );
        
        this.stats.pages++;
      } catch (error) {
        console.error(`Error generating page for ${work.id}:`, error.message);
        this.stats.errors.push({ work: work.id, error: error.message });
      }
    });
    
    console.log(`   ✓ Generated ${this.stats.pages} work pages`);
  }

  /**
   * インデックスページ生成
   */
  generateIndexPage(works) {
    console.log('📄 Generating index page...');
    
    const indexTemplate = fs.readFileSync(
      path.join(this.config.templatesDir, 'index.html'), 
      'utf8'
    );
    
    // Process works data for embedding (minimal fields only)
    const processedWorks = works.map(work => {
      const processedWork = {
        id: work.id,
        title: work.title,
        thumb: work.thumb,
        tags: work.tags || []
      };
      
      // Apply same processing as client-side
      const videoId = extractYouTubeId(work.thumb);
      if (videoId) {
        processedWork.thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        processedWork.isYoutubeThumb = true;
      } else {
        processedWork.thumb = optimizeCloudinaryUrl(work.thumb);
        processedWork.isYoutubeThumb = false;
      }
      
      return processedWork;
    });
    
    // Create embedded data script
    const worksDataScript = `<script id="works-data" type="application/json">
${JSON.stringify(processedWorks, null, 2)}
</script>`;
    
    // OGP画像の生成
const ogpImageUrl = 'https://res.cloudinary.com/ddwxt9vnm/image/upload/c_fill,w_1200,h_630,b_white/l_slvgallo_txf9dz,w_600/fl_layer_apply,g_center/f_auto,q_auto/v1770820480/ogp_blank_ghjrxq.png';

    let worksGrid = '';
    works.forEach((work, index) => {
      const thumbInfo = this.getProcessedThumb(work.thumb);
      const isPriority = index < 4;

      worksGrid += `
      <article class="post index-post" data-tags="${work.tags ? work.tags.join(' ') : ''}">
        <div class="post-inner">
          <a href="works/${work.id}.html" class="post-content-anchor">
            <div class="post-photo-thumb">${this.generateThumbContent(work, thumbInfo, isPriority)}</div>
            <div class="post-content"><h2 class="post-title">${work.title}</h2></div>
          </a>
        </div>
      </article>`;
    });
    
    let html = indexTemplate.replace('{{WORKS_GRID}}', worksGrid);
    
    // OGPメタデータを置換
    html = html.replace('{{OGP_IMAGE_URL}}', ogpImageUrl);
    
    // 埋め込みデータを置換
    html = html.replace('{{WORKS_DATA}}', worksDataScript);
    
    fs.writeFileSync(
      path.join(this.config.distDir, 'index.html'),
      html
    );
    
    console.log('   ✓ Generated index.html');
  }

  /**
   * プロフィールページ生成
   */
  generateProfilePage() {
    console.log('📄 Generating profile page...');
    
    const profileTemplate = fs.readFileSync(
      path.join(this.config.templatesDir, 'profile.html'), 
      'utf8'
    );
    
    // OGP画像の生成
    const ogpImageUrl = 'https://res.cloudinary.com/ddwxt9vnm/image/upload/c_fill,w_1200,h_630,b_white/l_slvgallo_txf9dz,w_600/fl_layer_apply,g_center/f_auto,q_auto/v1770820480/ogp_blank_ghjrxq.png';
    
    let html = profileTemplate.replace('{{OGP_IMAGE_URL}}', ogpImageUrl);
    
    fs.writeFileSync(
      path.join(this.config.distDir, 'profile.html'),
      html
    );
    
    console.log('   ✓ Generated profile.html');
  }

  /**
   * アセットコピー
   */
  copyAssets() {
    console.log('📦 Copying assets...');
    
    const assets = ['css', 'js', 'img', 'data'];
    assets.forEach(asset => {
      const src = path.join(this.config.srcDir, asset);
      const dest = path.join(this.config.distDir, asset);
      
      if (fs.existsSync(src)) {
        fs.copySync(src, dest);
        console.log(`   ✓ Copied ${asset}/`);
      }
    });
    
    // Copy favicon.ico to root of dist directory
    const faviconSrc = path.join(this.config.srcDir, 'favicon.ico');
    const faviconDest = path.join(this.config.distDir, 'favicon.ico');
    if (fs.existsSync(faviconSrc)) {
      fs.copySync(faviconSrc, faviconDest);
      console.log('   ✓ Copied favicon.ico');
    }
    
    // worksディレクトリ内の静的ファイル（HTMLファイル以外）をコピー
    const worksSrc = path.join(this.config.srcDir, 'works');
    if (fs.existsSync(worksSrc)) {
      const files = fs.readdirSync(worksSrc);
      files.forEach(file => {
        if (!file.endsWith('.html')) {
          fs.copySync(
            path.join(worksSrc, file),
            path.join(this.config.distDir, 'works', file)
          );
        }
      });
    }
    
    // sitemap.xml is generated directly, don't copy from src
  }

  /**
   * サイトマップ生成
   */
  generateSitemap(works) {
    console.log('🗺️  Generating sitemap...');
    
    const now = new Date().toISOString();
    
    // XML escape function for safe XML generation
    function escapeXml(str) {
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    }
    
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://slvgallo.github.io/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  
  <url>
    <loc>https://slvgallo.github.io/profile.html</loc>
    <lastmod>${now}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  
`;
    
    works.forEach(work => {
      sitemap += `  <url>
    <loc>https://slvgallo.github.io/works/${escapeXml(work.id)}.html</loc>
    <lastmod>${now}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
`;
    });
    
    sitemap += `</urlset>`;
    
    fs.writeFileSync(
      path.join(this.config.distDir, 'sitemap.xml'),
      sitemap
    );
    
    console.log(`   ✓ Generated sitemap with ${2 + works.length} URLs`);
  }

  /**
   * ビルド統計表示
   */
  printStats(duration) {
    console.log('\n📊 Build Statistics:');
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Pages: ${this.stats.pages}`);
    
    if (this.stats.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      this.stats.errors.forEach(err => {
        console.log(`   - ${err.work}: ${err.error}`);
      });
    }
  }

  /**
   * ビルド実行
   */
  async build() {
    const startTime = Date.now();
    
    try {
      console.log('\n🚀 Starting build process...\n');
      
      // distディレクトリをクリア
      fs.emptyDirSync(this.config.distDir);
      
      // データ読み込み
      const works = JSON.parse(
        fs.readFileSync(path.join(this.config.dataDir, 'works.json'), 'utf8')
      );
      
      // 生成
      this.generateWorkPages(works);
      this.generateIndexPage(works);
      this.generateProfilePage();
      this.generateSitemap(works);
      this.copyAssets();
      
      const duration = Date.now() - startTime;
      this.printStats(duration);
      
      console.log('\n✅ Build completed successfully!\n');
      
    } catch (error) {
      console.error('\n❌ Build failed:', error);
      process.exit(1);
    }
  }
}

// CLI実行
if (require.main === module) {
  const builder = new SiteBuilder();
  builder.build();
}

module.exports = { SiteBuilder };
