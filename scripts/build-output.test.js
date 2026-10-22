const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { SiteBuilder } = require('./build');
const { checkLinks } = require('./check-links');

function fixture() { return fs.mkdtempSync(path.join(os.tmpdir(), 'site-output-')); }

test('failed generation or validation preserves output; successful retry replaces it', async () => {
  const root = fixture();
  try {
    const output = path.join(root, 'dist');
    fs.outputFileSync(path.join(output, 'index.html'), 'previous');
    fs.outputFileSync(path.join(output, 'obsolete.html'), 'old');
    fs.outputJsonSync(path.join(root, 'data/works.json'), []);
    const builder = new SiteBuilder();
    builder.config.distDir = output;
    builder.config.dataDir = path.join(root, 'data');
    builder.generateWorkPages = () => {};
    builder.generateProfilePage = () => {};
    builder.generateSitemap = () => {};
    builder.copyAssets = () => {};
    builder.generateIndexPage = () => {
      fs.outputFileSync(path.join(builder.config.distDir, 'index.html'), 'partial');
      throw new Error('Fixture generation failure');
    };
    await assert.rejects(builder.build(), /Fixture generation failure/);
    assert.equal(fs.readFileSync(path.join(output, 'index.html'), 'utf8'), 'previous');
    assert.equal(builder.config.distDir, output);
    builder.generateIndexPage = () => fs.outputFileSync(path.join(builder.config.distDir, 'index.html'), '<img src="missing.png">');
    await assert.rejects(builder.build(), /missing.png/);
    assert.equal(fs.readFileSync(path.join(output, 'index.html'), 'utf8'), 'previous');
    builder.generateIndexPage = () => fs.outputFileSync(path.join(builder.config.distDir, 'index.html'), 'new');
    await builder.build();
    assert.equal(fs.readFileSync(path.join(output, 'index.html'), 'utf8'), 'new');
    assert(!fs.existsSync(path.join(output, 'obsolete.html')));
    assert(!fs.readdirSync(root).some(name => name.startsWith('dist.build-')));
  } finally { fs.removeSync(root); }
});

test('HTML checker resolves relative/root/same-site URLs and ignores external URLs', () => {
  const root = fixture();
  try {
    fs.outputFileSync(path.join(root, 'asset name.png'), 'image');
    fs.outputFileSync(path.join(root, 'folder/index.html'), '<p id="section">Detail</p>');
    fs.outputFileSync(path.join(root, 'index.html'), `
      <a href="/folder/?a=1&amp;b=2#section">Folder</a>
      <img src="asset%20name.png">
      <iframe src="https://slvgallo.github.io/folder/"></iframe>
      <img src="https://example.com/not-requested.png">
      <img src="data:image/png;base64,AAAA">
      <a href="mailto:example@example.com">Email</a>
      <a href="#dynamic">Fragment</a>
      <script>const markup = '<img src="not-a-real-reference.png">';</script>
    `);
    assert.equal(checkLinks(root).pages, 2);
    for (const markup of [
      '<a href="missing.html">Broken</a>', '<iframe src="missing.html"></iframe>',
      '<img srcset="missing.png 1x, /asset%20name.png 2x">',
      '<video poster="missing.png"></video>', '<script src="missing.js"></script>',
      '<link href="missing.css" rel="stylesheet">', '<img src="/%zz">'
    ]) {
      fs.outputFileSync(path.join(root, 'index.html'), markup);
      assert.throws(() => checkLinks(root), /Broken local references/);
    }
    fs.outputFileSync(path.join(root, 'index.html'), '<base href="/folder/"><a href="index.html">OK</a>');
    assert.equal(checkLinks(root).pages, 2);
  } finally { fs.removeSync(root); }
});
