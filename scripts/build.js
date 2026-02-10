const fs = require('fs-extra');
const path = require('path');
const {
  extractYouTubeId,
  optimizeCloudinaryUrl,
  optimizeCloudinaryIndexUrl
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
  generateMediaHTML(mediaItem, isPriority = false) {
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
          return `<div class="image2column-wrap" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            ${mediaItem.src.map(s => 
              `<img src="${optimizeCloudinaryUrl(s)}" alt="Project image" loading="lazy" style="width: 100%; height: auto;">`
            ).join('')}
          </div>`;
        }
        return '';
      
      case 'photo':
        const optimizedSrc = optimizeCloudinaryUrl(mediaItem.src);
        const img = `<img src="${optimizedSrc}" alt="Photo" ${loading}>`;
        
        if (mediaItem.src.includes('flickr.com')) {
          const flickrMatch = mediaItem.src.match(/\/photos\/[^\/]+\/(\d+)/) || 
                            mediaItem.src.match(/\/(\d+)_[^_]+_b\.jpg$/);
          if (flickrMatch) {
            return `<a href="https://www.flickr.com/photos/slvgallo/${flickrMatch[1]}/" target="_blank" rel="noopener noreferrer">${img}</a>`;
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
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            ${loading}>
          </iframe>
        </div>`;

      case 'soundcloud':
        let scSrc = mediaItem.src;
        if (/^\d+$/.test(scSrc)) {
          scSrc = `https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/${scSrc}&color=%230b0b0b&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false&visual=true&sharing=false`;
        }
        return `<div style="position: relative; padding-bottom: 66.67%; height: 0; overflow: hidden;">
          <iframe src="${scSrc}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" width="100%" height="300" scrolling="no" frameborder="no" allow="autoplay"></iframe>
        </div>`;
      
      case 'processing':
        let prSrc = mediaItem.src;
        if (prSrc.includes('openprocessing.org/sketch/') && !prSrc.endsWith('/embed/')) {
          const skId = prSrc.split('/sketch/')[1].split('/')[0];
          prSrc = `https://openprocessing.org/sketch/${skId}/embed/`;
        }
        return `<div class="processing-wrap">
          <iframe src="${prSrc}" frameborder="0" allowfullscreen></iframe>
        </div>`;

      case 'sketchfab':
        let sfSrc = mediaItem.src;
        if (sfSrc.includes('/embed')) {
          sfSrc += (sfSrc.includes('?') ? '&' : '?') + 'autospin=1&autostart=1&preload=1';
        }
        return `<div class="sketchfab-wrap">
          <iframe src="${sfSrc}" frameborder="0" allowfullscreen mozallowfullscreen="true" webkitallowfullscreen="true"></iframe>
        </div>`;

      case 'html':
        const hSrc = mediaItem.src.startsWith('/works/') 
          ? mediaItem.src.replace('/works/', '../works/') 
          : mediaItem.src;
        return `<div class="html-wrap">
          <iframe src="${hSrc}" frameborder="0" allowfullscreen></iframe>
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

    // SoundCloud特殊処理
    if (work.thumb && work.thumb.includes('soundcloud.com')) {
      const sc = work.media && work.media.find(m => m.type === 'soundcloud');
      if (sc) {
        return `<iframe 
          src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/${sc.src}&color=%23000000&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false&visual=true&sharing=false" 
          width="100%" 
          height="300" 
          frameborder="no" 
          scrolling="no" 
          allow="autoplay" 
          style="pointer-events: none;">
        </iframe>
        <div class="soundcloud-overlay"></div>`;
      }
    }
    
    return `<img src="${optimizeCloudinaryIndexUrl(thumbInfo.url)}" ${imgStyle} alt="${work.title}" ${loading} ${priority} ${decoding}>`;
  }

  /**
   * テンプレート置換
   */
  replaceTemplate(template, work) {
    const tagsText = work.tags ? work.tags.map(tag => `#${tag}`).join(' ') : '';
    const tagsHtml = work.tags 
      ? work.tags.map(tag => `<a href="../index.html?filter=${tag}" class="project-tag">#${tag}</a>`).join(' ') 
      : '';
    
    const thumbInfo = this.getProcessedThumb(work.thumb);
    const optimizedThumb = optimizeCloudinaryUrl(thumbInfo.url || work.thumb || '');

    return template
      .replace(/\{\{ID\}\}/g, work.id)
      .replace(/\{\{TITLE\}\}/g, work.title)
      .replace(/\{\{DESC\}\}/g, (work.desc || '').replace(/\n/g, '<br>'))
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
        
        if (work.media && Array.isArray(work.media)) {
          work.media.forEach((mediaItem, index) => {
            const mediaHTML = this.generateMediaHTML(mediaItem, index === 0);
            if (index === 0) {
              fullMediaContent = mediaHTML;
            } else {
              contentMediaContent += mediaHTML;
            }
          });
        }
        
        html = html.replace('{{FULL_MEDIA_CONTENT}}', fullMediaContent);
        html = html.replace('{{MEDIA_CONTENT}}', contentMediaContent);
        
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
    
    fs.writeFileSync(
      path.join(this.config.distDir, 'index.html'),
      indexTemplate.replace('{{WORKS_GRID}}', worksGrid)
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
    
    fs.writeFileSync(
      path.join(this.config.distDir, 'profile.html'),
      profileTemplate
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
    
    // sitemap.xml
    const sitemapSrc = path.join(this.config.srcDir, 'sitemap.xml');
    if (fs.existsSync(sitemapSrc)) {
      fs.copySync(sitemapSrc, path.join(this.config.distDir, 'sitemap.xml'));
      console.log('   ✓ Copied sitemap.xml');
    }
  }

  /**
   * サイトマップ生成
   */
  generateSitemap(works) {
    console.log('🗺️  Generating sitemap...');
    
    const now = new Date().toISOString();
    
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
    <loc>https://slvgallo.github.io/works/${work.id}.html</loc>
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
