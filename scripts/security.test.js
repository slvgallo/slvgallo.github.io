const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SiteBuilder } = require('./build');
const { serializeJson, urlAttribute } = require('./html');
const { createServer } = require('./server');

test('generated pages preserve text without allowing script or attribute breakout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-security-'));
  try {
    const builder = new SiteBuilder();
    builder.config.distDir = root;
    const title = '</script><script>alert(1)</script> " $&';
    const works = [{ id: '2610-1', title, thumb: '/test.png?x=" onerror="alert(1)', tags: ['code'], desc: '<p>Literal $&</p>' }];
    builder.generateIndexPage(works);
    builder.generateWorkPages(works);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const embedded = html.match(/<script id="works-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
    assert.equal(JSON.parse(embedded)[0].title, title);
    assert(!html.includes('<script>alert(1)</script>'));
    assert(!html.includes(' onerror="alert(1)'));
    const detail = fs.readFileSync(path.join(root, 'works/2610-1.html'), 'utf8');
    assert(detail.includes('<p>Literal $&</p>'));
    assert(!detail.includes('{{'));
    assert.throws(() => builder.generateWorkPages([{ ...works[0], id: '../../outside' }]));
    assert.throws(() => builder.generateMediaHTML({ type: 'link-card', src: 'javascript:alert(1)' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('JSON and URL helpers reject executable input and preserve ordinary data', () => {
  const value = { text: '</script> & $&' };
  assert.deepEqual(JSON.parse(serializeJson(value)), value);
  assert(!serializeJson(value).includes('<'));
  for (const url of ['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,test']) {
    assert.throws(() => urlAttribute(url));
  }
  assert.equal(urlAttribute('https://example.com/?a=1&b=2'), 'https://example.com/?a=1&amp;b=2');
});

test('preview serves existing files and returns 404 for missing files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-server-'));
  fs.writeFileSync(path.join(root, 'index.html'), 'preview');
  const server = createServer(root).listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await (await fetch(origin)).text(), 'preview');
    assert.equal((await fetch(`${origin}/missing.js`)).status, 404);
    assert.equal((await fetch(`${origin}/.env`)).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('development rebuild recovers after a build failure', async () => {
  const { DevServer } = require('./dev');
  const server = new DevServer();
  let attempts = 0;
  server.builder.build = async () => {
    if (++attempts === 1) throw new Error('Expected fixture failure');
  };
  await server.rebuild('invalid fixture');
  assert.equal(server.isBuilding, false);
  await server.rebuild('repaired fixture');
  assert.equal(attempts, 2);
  assert.equal(server.isBuilding, false);
});

test('updated file watcher detects edits', async () => {
  const chokidar = require('chokidar');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-watcher-'));
  const file = path.join(root, 'fixture.css');
  fs.writeFileSync(file, 'body {}');
  const watcher = chokidar.watch(root, { ignoreInitial: true });
  try {
    await new Promise((resolve, reject) => { watcher.once('ready', resolve); watcher.once('error', reject); });
    const changed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Watcher timed out')), 5000);
      watcher.once('change', name => { clearTimeout(timer); resolve(name); });
    });
    fs.appendFileSync(file, '\n/* changed */');
    assert.equal(await changed, file);
  } finally {
    await watcher.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
