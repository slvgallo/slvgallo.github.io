const fs = require('fs-extra');
const path = require('path');
const { thumbnailSources } = require('../js/thumbnails.mjs');
const { checkLinks } = require('./check-links');
const { generateMediaHTML } = require('./media');
const { readCustomContent } = require('./custom-content');
const { escapeHtml, serializeJson, urlAttribute, assertWorkId } = require('./html');
const {
  extractYouTubeId,
  optimizeCloudinaryUrl,
  optimizeCloudinaryIndexUrl,
  generateOGPImageUrl
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
  generateMediaHTML(...args) {
    return generateMediaHTML(...args);
  }

  /**
   * サムネイルコンテンツ生成
   */
  generateThumbContent(work, thumbInfo, isPriority) {
    const imgStyle = thumbInfo.isYoutube ? 'style="transform: scale(1.02);"' : '';
    const loading = isPriority ? '' : 'loading="lazy"';
    const priority = isPriority ? 'fetchpriority="high"' : '';
    const decoding = 'decoding="async"';
    const sources = thumbnailSources(thumbInfo.url);
    const responsive = sources.srcset ? `srcset="${escapeHtml(sources.srcset)}" sizes="${escapeHtml(sources.sizes)}"` : '';

    return `<img src="${urlAttribute(sources.src)}" ${responsive} ${imgStyle} alt="${escapeHtml(work.title)}" ${loading} ${priority} ${decoding}>`;
  }

  /**
   * テンプレート置換
   */
  replaceTemplate(template, work) {
    const tagsText = work.tags ? work.tags.map(tag => `#${tag}`).join(' ') : '';
    const tagsHtml = work.tags
      ? work.tags.map(tag => `<a href="../index.html?filter=${encodeURIComponent(tag)}" class="project-tag">#${escapeHtml(tag)}</a>`).join(' ')
      : '';
    const mainAspectRatio = work.media?.[0]?.aspectRatio;
    const mainRatioMatch = typeof mainAspectRatio === 'string'
      ? mainAspectRatio.match(/^(\d+(?:\.\d+)?)\s*[/:]\s*(\d+(?:\.\d+)?)$/)
      : null;
    const squarePageClass = work.layout === 'compact' || (
      mainRatioMatch
      && Number(mainRatioMatch[1]) > 0
      && Number(mainRatioMatch[1]) === Number(mainRatioMatch[2])
    )
      ? ' page-permalink--square'
      : '';

    const formatDescription = description => description || '';
    const stripHtml = html => String(html || '').replace(/<[^>]*>/g, ' ');
    const sourceName = work.source?.name ? escapeHtml(work.source.name) : '';
    const sourceUrl = work.source?.url ? urlAttribute(work.source.url) : '';
    const sourceMarkup = label => sourceName && sourceUrl
      ? `<p class="project-source">${label}: <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">${sourceName}</a></p>`
      : '';

    const hasBilingualDescription = Boolean(work.desc_en && work.desc);
    const descriptionContent = hasBilingualDescription
      ? `<div class="project-desc-lang lang-en">${formatDescription(work.desc_en)}${sourceMarkup('Source')}</div><div class="project-desc-lang lang-ja">${formatDescription(work.desc)}${sourceMarkup('出典')}</div>`
      : `${formatDescription(work.desc)}${sourceMarkup('出典')}`;
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
      .replace(/\{\{ID\}\}/g, () => work.id)
      .replace(/\{\{PAGE_MODIFIER_CLASS\}\}/g, () => squarePageClass)
      .replace(/\{\{TITLE\}\}/g, () => escapeHtml(work.title))
      .replace(/\{\{META_DESC\}\}/g, () => metaDescription)
      .replace(/\{\{DESC_CONTENT\}\}/g, () => descriptionContent)
      .replace(/\{\{LANG_BUTTONS\}\}/g, () => languageButtons)
      .replace(/\{\{DATE\}\}/g, this.generateDateFromId(work.id))
      .replace(/\{\{THUMB\}\}/g, () => urlAttribute(optimizedThumb))
      .replace(/\{\{TAGS_TEXT\}\}/g, () => escapeHtml(tagsText))
      .replace(/\{\{TAGS_HTML\}\}/g, () => tagsHtml);
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
        assertWorkId(work.id);
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
            if (index === 0 || mediaItem.placement === 'full') {
              fullMediaContent += mediaHTML;
            } else {
              contentMediaContent += mediaHTML;
            }
          });
        }

        html = html.replace('{{FULL_MEDIA_CONTENT}}', () => fullMediaContent);
        html = html.replace('{{MEDIA_CONTENT}}', () => contentMediaContent);

        const custom = readCustomContent(work, this.config.srcDir);
        html = html.replace('{{CUSTOM_STYLES}}', () => custom
          ? custom.styles.map(url => `<link rel="stylesheet" href="${url}">`).join('\n  ') : '');
        html = html.replace('{{CUSTOM_CONTENT}}', () => custom
          ? `<div id="project-custom-content" class="project-custom-content project-custom-content--${custom.width} ${custom.width === 'wide' ? 'l-container' : 'l-container-mini'}">${custom.html}</div>` : '');
        html = html.replace('{{CUSTOM_SCRIPTS}}', () => custom
          ? custom.scripts.map(url => `<script defer src="${url}"></script>`).join('\n') : '');

        // OGPメタデータを置換
        html = html.replaceAll('{{OGP_IMAGE_URL}}', () => urlAttribute(ogpImageUrl));

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
    if (this.stats.errors.length) throw new Error('Work page generation failed');
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
        tags: work.tags || [],
        isSoundCloud: work.media?.some(mediaItem => mediaItem.type === 'soundcloud') || false
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
${serializeJson(processedWorks)}
</script>`;

    // OGP画像の生成
const ogpImageUrl = 'https://res.cloudinary.com/ddwxt9vnm/image/upload/c_fill,w_1200,h_630,b_white/l_slvgallo_txf9dz,w_600/fl_layer_apply,g_center/f_auto,q_auto/v1770820480/ogp_blank_ghjrxq.png';

    let worksGrid = '';
    works.slice(0, 16).forEach((work, index) => {
      const thumbInfo = this.getProcessedThumb(work.thumb);
      const isPriority = index < 4;
      const isSoundCloud = work.media?.some(mediaItem => mediaItem.type === 'soundcloud');
      const soundCloudClass = isSoundCloud ? ' index-post--soundcloud' : '';

      worksGrid += `
      <article class="post index-post${soundCloudClass}" data-tags="${escapeHtml(work.tags ? work.tags.join(' ') : '')}">
        <div class="post-inner">
          <a href="works/${work.id}.html" class="post-content-anchor">
            <div class="post-photo-thumb">${this.generateThumbContent(work, thumbInfo, isPriority)}</div>
            <div class="post-content"><h2 class="post-title">${escapeHtml(work.title)}</h2></div>
          </a>
        </div>
      </article>`;
    });

    worksGrid += `<noscript><ul>${works.slice(16).map(work => `<li><a href="works/${work.id}.html">${escapeHtml(work.title)}</a></li>`).join('')}</ul></noscript>`;

    let html = indexTemplate.replace('{{WORKS_GRID}}', () => worksGrid);

    // OGPメタデータを置換
    html = html.replaceAll('{{OGP_IMAGE_URL}}', () => urlAttribute(ogpImageUrl));

    // 埋め込みデータを置換
    html = html.replace('{{WORKS_DATA}}', () => worksDataScript);

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

    let html = profileTemplate.replaceAll('{{OGP_IMAGE_URL}}', () => urlAttribute(ogpImageUrl));

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
    this.stats = { pages: 0, images: 0, errors: [] };

    const outputDir = this.config.distDir;
    fs.ensureDirSync(path.dirname(outputDir));
    const workspace = fs.mkdtempSync(outputDir + '.build-');
    const staging = path.join(workspace, 'next');
    const previous = path.join(workspace, 'previous');
    this.config.distDir = staging;

    try {
      console.log('\n🚀 Starting build process...\n');

      // Generate in a separate directory; keep the last successful output available.
      fs.emptyDirSync(this.config.distDir);

      // データ読み込み
      const works = JSON.parse(
        fs.readFileSync(path.join(this.config.dataDir, 'works.json'), 'utf8')
      );

      const ids = new Set();
      for (const work of works) {
        assertWorkId(work.id);
        if (ids.has(work.id)) throw new Error(`Duplicate work ID: ${work.id}`);
        ids.add(work.id);
      }

      // 生成
      this.generateWorkPages(works);
      this.generateIndexPage(works);
      this.generateProfilePage();
      this.generateSitemap(works);
      this.copyAssets();
      const checked = checkLinks(staging);
      console.log(`   ✓ Checked ${checked.references} local references in ${checked.pages} HTML files`);

      // Both renames stay on the same filesystem. Restore the previous output
      // if the replacement fails. Generation/validation failures never touch it.
      if (fs.existsSync(outputDir)) fs.renameSync(outputDir, previous);
      try {
        fs.renameSync(staging, outputDir);
      } catch (error) {
        if (fs.existsSync(previous)) fs.renameSync(previous, outputDir);
        throw error;
      }
      fs.removeSync(previous);

      const duration = Date.now() - startTime;
      this.printStats(duration);

      console.log('\n✅ Build completed successfully!\n');

    } catch (error) {
      console.error('\n❌ Build failed:', error);
      throw error;
    } finally {
      this.config.distDir = outputDir;
      // Preserve the backup for recovery if restoring it itself failed.
      if (!fs.existsSync(previous)) fs.removeSync(workspace);
    }
  }
}

// CLI実行
if (require.main === module) {
  const builder = new SiteBuilder();
  builder.build().catch(() => { process.exitCode = 1; });
}

module.exports = { SiteBuilder };
