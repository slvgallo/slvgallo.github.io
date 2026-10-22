const { extractYouTubeId, optimizeCloudinaryUrl } = require('./shared-utils');
const { escapeHtml, urlAttribute } = require('./html');

function generateMediaHTML(mediaItem, isPriority = false, workTitle = '') {
    const loading = isPriority ? '' : 'loading="lazy"';
    const priority = isPriority ? 'fetchpriority="high"' : '';
    const decoding = isPriority ? 'decoding="sync"' : 'decoding="async"';

    switch (mediaItem.type) {
      case 'image':
        const src = Array.isArray(mediaItem.src) ? mediaItem.src : [mediaItem.src];
        return src.map(s =>
          `<img src="${urlAttribute(optimizeCloudinaryUrl(s))}" alt="Project image" ${loading} ${priority} ${decoding}>`
        ).join('');

      case 'image2column':
        if (Array.isArray(mediaItem.src)) {
          return `<div class="image2column-wrap">
            ${mediaItem.src.map(s =>
              `<img src="${urlAttribute(optimizeCloudinaryUrl(s))}" alt="Project image" loading="lazy">`
            ).join('')}
          </div>`;
        }
        return '';

      case 'photo':
        const optimizedSrc = optimizeCloudinaryUrl(mediaItem.src);
        const altText = workTitle ? `${workTitle} - View on Flickr` : 'Photo';
        const img = `<img src="${urlAttribute(optimizedSrc)}" alt="${escapeHtml(altText)}" ${loading}>`;

        if (mediaItem.src.includes('flickr.com')) {
          const flickrMatch = mediaItem.src.match(/\/photos\/[^\/]+\/(\d+)/) ||
                            mediaItem.src.match(/\/(\d+)_[^_]+_b\.jpg$/);
          if (flickrMatch) {
            return `<a href="https://www.flickr.com/photos/slvgallo/${flickrMatch[1]}/" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(altText)}">${img}</a>`;
          }
        }
        return img;

      case 'video':
        const videoId = extractYouTubeId(mediaItem.src);
        if (!videoId) return '';

        return `<div class="video-wrap" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden;">
          <iframe
            src="https://www.youtube.com/embed/${encodeURIComponent(videoId)}"
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
          <iframe src="${urlAttribute(scSrc)}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" width="100%" height="300" scrolling="no" frameborder="no" allow="autoplay; encrypted-media" loading="lazy"></iframe>
        </div>`;

      case 'processing':
        let prSrc = mediaItem.src;
        if (prSrc.includes('openprocessing.org/sketch/') && !prSrc.endsWith('/embed/')) {
          const skId = prSrc.split('/sketch/')[1].split('/')[0];
          prSrc = `https://openprocessing.org/sketch/${skId}/embed/`;
        }
        return `<div class="processing-wrap">
          <iframe src="${urlAttribute(prSrc)}" frameborder="0" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture; accelerometer; gyroscope; xr-spatial-tracking"></iframe>
        </div>`;

      case 'sketchfab':
        let sfSrc = mediaItem.src;
        if (sfSrc.includes('/embed')) {
          sfSrc += (sfSrc.includes('?') ? '&' : '?') + 'autospin=1&autostart=1&preload=1';
        }
        return `<div class="sketchfab-wrap">
          <iframe src="${urlAttribute(sfSrc)}" frameborder="0" allowfullscreen mozallowfullscreen="true" webkitallowfullscreen="true" allow="autoplay; encrypted-media; picture-in-picture; accelerometer; gyroscope; xr-spatial-tracking"></iframe>
        </div>`;

      case 'html':
        const hSrc = mediaItem.src.startsWith('/works/')
          ? mediaItem.src.replace('/works/', '../works/')
          : mediaItem.src;
        const parseRatio = value => {
          const match = typeof value === 'string'
            ? value.match(/^(\d+(?:\.\d+)?)\s*[/:]\s*(\d+(?:\.\d+)?)$/)
            : null;
          return match && Number(match[1]) > 0 && Number(match[2]) > 0 ? match : null;
        };
        const ratioMatch = parseRatio(mediaItem.aspectRatio);
        // 狭い画面では埋め込みが横長すぎて操作パネルに埋まる作品があるため、
        // aspectRatioMobile で768px以下だけ別の比率を渡せるようにしている
        const mobileRatioMatch = parseRatio(mediaItem.aspectRatioMobile);
        const hasValidRatio = Boolean(ratioMatch);
        const isSquareRatio = hasValidRatio
          && Number(ratioMatch[1]) === Number(ratioMatch[2]);
        const ratioClass = hasValidRatio
          ? ` html-wrap--fixed-ratio${isSquareRatio ? ' html-wrap--square' : ''}`
          : '';
        const ratioVars = hasValidRatio
          ? [`--html-aspect-ratio: ${ratioMatch[1]} / ${ratioMatch[2]}`].concat(
              mobileRatioMatch
                ? [`--html-aspect-ratio-mobile: ${mobileRatioMatch[1]} / ${mobileRatioMatch[2]}`]
                : []
            )
          : [];
        const ratioStyle = ratioVars.length
          ? ` style="${ratioVars.join('; ')}"`
          : '';
        return `<div class="html-wrap${ratioClass}"${ratioStyle}>
          <iframe src="${urlAttribute(hSrc)}" frameborder="0" allow="autoplay" allowfullscreen></iframe>
        </div>`;

      case 'link-card':
        const linkHref = mediaItem.src.startsWith('/works/')
          ? mediaItem.src.replace('/works/', '../works/')
          : mediaItem.src;
        const linkTitle = escapeHtml(mediaItem.title || workTitle);
        const linkLabel = escapeHtml(mediaItem.label || 'Open');
        return `<a class="project-link-card" href="${urlAttribute(linkHref)}" target="_blank" rel="noopener noreferrer">
          <strong class="project-link-card__title">${linkTitle}</strong>
          <span class="project-link-card__action">${linkLabel}</span>
        </a>`;

      default:
        console.warn(`Unknown media type: ${mediaItem.type}`);
        return '';
    }
  }

module.exports = { generateMediaHTML };
