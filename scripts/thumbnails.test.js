const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { SiteBuilder } = require('./build');
const { thumbnailSources } = require('../js/thumbnails.mjs');
const { checkLinks } = require('./check-links');

test('first batch has 16 cards, all works remain in data and no-script links', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-thumbs-'));
  try {
    const builder = new SiteBuilder(); builder.config.distDir = root;
    const works = Array.from({length: 20}, (_, i) => ({id: `2601-${i+1}`, title: `Work ${i}`, thumb: 'https://res.cloudinary.com/test/image/upload/v1/test.png', tags: []}));
    builder.generateIndexPage(works);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.equal((html.match(/<article /g) || []).length, 16);
    assert(html.includes('works/2601-20.html'));
    assert.equal(JSON.parse(html.match(/id="works-data" type="application\/json">([\s\S]*?)<\/script>/)[1]).length, 20);
    const sources = thumbnailSources(works[0].thumb);
    assert.equal(sources.srcset.split('w, ').length, 3);
    fs.writeFileSync(path.join(root, 'index.html'), `<img srcset="${sources.srcset}">`);
    assert.doesNotThrow(() => checkLinks(root));
    fs.writeFileSync(path.join(root, 'index.html'), '<img srcset="missing.png, other.png">');
    assert.throws(() => checkLinks(root), /missing.png/);
    assert.equal(thumbnailSources('/image.png').src, '/image.png');
  } finally { fs.removeSync(root); }
});
