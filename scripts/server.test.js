const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { createServer, listenLocal } = require('./server');
const { DevServer } = require('./dev');

test('Express 5 serves browser assets with usable MIME types and blocks hidden directories', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'express-assets-'));
  const files = { 'script.js': 'text/javascript', 'module.mjs': 'text/javascript', 'style.css': 'text/css', 'data.json': 'application/json' };
  for (const file of Object.keys(files)) fs.outputFileSync(path.join(root, file), 'fixture');
  fs.outputFileSync(path.join(root, '.private/secret.txt'), 'secret');
  const server = await listenLocal(createServer(root), 0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [file, mime] of Object.entries(files)) {
      const response = await fetch(`${base}/${file}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type').split(';')[0], mime);
      assert.equal(await response.text(), 'fixture');
    }
    const hidden = await fetch(`${base}/.private/secret.txt`);
    assert.equal(hidden.status, 404);
    await hidden.text();
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.removeSync(root);
  }
});

test('busy port rejects startup and does not start the development watcher', async () => {
  const occupied = await listenLocal(createServer(), 0);
  try {
    const port = occupied.address().port;
    await assert.rejects(listenLocal(createServer(), port), { code: 'EADDRINUSE' });
    const dev = new DevServer(port);
    dev.builder.build = async () => {};
    let watching = false;
    dev.setupWatcher = () => { watching = true; };
    await assert.rejects(dev.start(), { code: 'EADDRINUSE' });
    assert.equal(watching, false);
  } finally {
    await new Promise(resolve => occupied.close(resolve));
  }
});
