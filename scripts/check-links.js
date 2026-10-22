const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('parse5');

const SITE = 'https://slvgallo.github.io';

// Check published HTML references without requesting external services.
function checkLinks(root) {
  root = path.resolve(root);
  const errors = new Set();
  let pages = 0;
  let references = 0;
  function check(value, base, source) {
    if (!value || value.startsWith('#')) return;
    let url;
    try { url = new URL(value, base); } catch {
      errors.add(`${source}: invalid URL ${value}`);
      return;
    }
    if (url.origin !== SITE) return;
    references++;
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch {
      errors.add(`${source}: invalid URL encoding ${value}`);
      return;
    }
    let target = path.resolve(root, '.' + pathname);
    if (target !== root && !target.startsWith(root + path.sep)) {
      errors.add(`${source}: path outside output ${value}`);
      return;
    }
    try {
      if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
      if (!fs.statSync(target).isFile()) throw new Error('Not a file');
    } catch {
      errors.add(`${source}: missing ${value}`);
    }
  }
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { scan(file); continue; }
      if (!entry.isFile() || !file.endsWith('.html')) continue;
      pages++;
      const source = path.relative(root, file).split(path.sep).join('/');
      const document = parse(fs.readFileSync(file, 'utf8'));
      const nodes = [];
      function walk(node) {
        nodes.push(node);
        for (const child of node.childNodes || []) walk(child);
        if (node.content) walk(node.content);
      }
      walk(document);
      const pageUrl = new URL(source, SITE + '/');
      const baseNode = nodes.find(node => node.tagName === 'base' && node.attrs.some(a => a.name === 'href'));
      let base = pageUrl;
      if (baseNode) {
        try { base = new URL(baseNode.attrs.find(a => a.name === 'href').value, pageUrl); }
        catch { errors.add(`${source}: invalid base URL`); }
      }
      for (const node of nodes) {
        if (node.tagName === 'base') continue;
        for (const attr of node.attrs || []) {
          if (['href', 'src', 'poster'].includes(attr.name)) check(attr.value, base, source);
          // Responsive candidates without data URLs; data URLs are embedded assets.
          if (attr.name === 'srcset' && !attr.value.includes('data:')) {
            for (const candidate of attr.value.split(',')) check(candidate.trim().split(/\s+/)[0], base, source);
          }
        }
      }
    }
  }
  scan(root);
  if (errors.size) throw new Error(`Broken local references:\n${[...errors].join('\n')}`);
  return { pages, references };
}

if (require.main === module) {
  try { console.log(checkLinks(path.join(__dirname, '..', 'dist'))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { checkLinks };
