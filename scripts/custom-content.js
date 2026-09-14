const fs = require('fs');
const path = require('path');

// Paths are repository-relative and limited to the work's published directory.
function readCustomContent(work, sourceRoot) {
  if (work.customContent === undefined) return null;
  const config = work.customContent;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('customContent must be an object');
  }
  const width = config.width === undefined ? 'wide' : config.width;
  if (!['wide', 'content'].includes(width)) {
    throw new Error('customContent.width must be wide or content');
  }
  const prefix = `works/${work.id}/`;
  const workDirectory = fs.realpathSync(path.join(sourceRoot, prefix));
  function asset(value, extension) {
    if (typeof value !== 'string' || !value.startsWith(prefix)
      || !/^[a-zA-Z0-9_./-]+$/.test(value)
      || value.split('/').some(part => !part || part === '.' || part === '..')
      || path.extname(value) !== extension) {
      throw new Error(`customContent requires a ${extension} file under ${prefix}`);
    }
    const absolutePath = fs.realpathSync(path.join(sourceRoot, value));
    if (!absolutePath.startsWith(workDirectory + path.sep) || !fs.statSync(absolutePath).isFile()) {
      throw new Error(`Invalid customContent file: ${value}`);
    }
    return { absolutePath, url: `/${value}` };
  }
  function assets(field, extension) {
    if (config[field] === undefined) return [];
    if (!Array.isArray(config[field])) throw new Error(`customContent.${field} must be an array`);
    return [...new Set(config[field])].map(value => asset(value, extension).url);
  }
  const source = asset(config.src, '.html');
  const html = fs.readFileSync(source.absolutePath, 'utf8');
  // Authored HTML is trusted site code, not sanitized user input.
  if (/<(?:!doctype|\/?(?:html|head|body|main|script|style|link|base))\b/i.test(html)) {
    throw new Error('customContent.src must be a fragment; declare CSS and JS separately');
  }
  return { html, width, styles: assets('styles', '.css'), scripts: assets('scripts', '.js') };
}

module.exports = { readCustomContent };
