const assert = require('assert').strict;
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { readCustomContent } = require('./custom-content');
const { SiteBuilder } = require('./build');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-custom-content-'));
try {
  fs.ensureDirSync(path.join(fixture, 'works/2609-1'));
  const html = '<div id="test-work"><p>Literal $& and $1</p></div>';
  fs.writeFileSync(path.join(fixture, 'works/2609-1/content.html'), html);
  fs.writeFileSync(path.join(fixture, 'works/2609-1/style.css'), '#test-work { color: red; }');
  fs.writeFileSync(path.join(fixture, 'works/2609-1/script.js'), 'void 0;');
  const config = {
    src: 'works/2609-1/content.html',
    styles: ['works/2609-1/style.css'],
    scripts: ['works/2609-1/script.js']
  };
  const work = { id: '2609-1', title: 'Test', customContent: config };
  const read = override => readCustomContent({ ...work, customContent: { ...config, ...override } }, fixture);
  assert.equal(readCustomContent({ id: '2608-1' }, fixture), null);
  assert.equal(read({}).html, html);
  assert.equal(read({}).width, 'wide');
  assert.equal(read({ width: 'content' }).width, 'content');
  assert.deepEqual(read({}).styles, ['/works/2609-1/style.css']);
  assert.throws(() => read({ width: 'invalid' }));
  assert.throws(() => read({ src: '../outside.html' }));
  assert.throws(() => read({ src: 'works/2609-1/../outside.html' }));
  assert.throws(() => read({ src: 'works/2609-1/missing.html' }));
  assert.throws(() => read({ styles: 'works/2609-1/style.css' }));
  assert.throws(() => read({ scripts: ['https://example.com/script.js'] }));
  assert.throws(() => read({ scripts: ['works/2609-1/style.css'] }));
  fs.writeFileSync(path.join(fixture, 'works/2609-1/page.html'), '<html><body>Full document</body></html>');
  assert.throws(() => read({ src: 'works/2609-1/page.html' }));

  const builder = new SiteBuilder();
  builder.config.srcDir = fixture;
  builder.config.distDir = path.join(fixture, 'dist');
  builder.generateWorkPages([
    { ...work, media: [{ type: 'image', src: '/image.png' }] },
    { id: '2608-1', title: 'Existing', media: [{ type: 'image', src: '/image.png' }] }
  ]);
  const output = fs.readFileSync(path.join(fixture, 'dist/works/2609-1.html'), 'utf8');
  assert(output.includes(html), 'Fragment must preserve literal dollar signs');
  assert(output.indexOf('/image.png') < output.indexOf('id="project-custom-content"'));
  assert(output.indexOf('id="project-custom-content"') < output.indexOf('id="project-title"'));
  assert(output.indexOf('/works/2609-1/style.css') < output.indexOf('</head>'));
  assert(output.includes('<script defer src="/works/2609-1/script.js"></script>'));
  assert(!output.includes('{{CUSTOM_'));
  const existing = fs.readFileSync(path.join(fixture, 'dist/works/2608-1.html'), 'utf8');
  assert(!existing.includes('project-custom-content'));
  assert(!existing.includes('/works/2609-1/'));
  assert(!existing.includes('{{CUSTOM_'));
  assert.throws(() => builder.generateWorkPages([{ ...work, customContent: { src: 'missing.html' } }]));
  console.log('Custom content checks passed.');
} finally {
  fs.removeSync(fixture);
}
