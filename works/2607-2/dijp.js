'use strict';
const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d', {alpha: false});
const slider = document.getElementById('phase');
const phaseValue = document.getElementById('phaseValue');
const playPauseButton = document.getElementById('playPause');
const stateButtons = Array.from(document.querySelectorAll('[data-phase]'));
const ASSET_URL = './assets/dual_interpretation.jpg';
const A_TO_B_MILLISECONDS = 8000;
const MIDDLE_SNAP_THRESHOLD = 0.015;
ctx.imageSmoothingEnabled = false;
let parsed = null;
let decoded = null;
let lastRenderedPhase = null;
let errorLogged = false;
let playing = false;
let playbackDirection = 1;
let previousFrameTime = null;
function u16(bytes, index) { return (bytes[index] << 8) | bytes[index + 1]; }
function u32(bytes, index) { return ((bytes[index] * 0x1000000) + (bytes[index + 1] << 16) + (bytes[index + 2] << 8) + bytes[index + 3]) >>> 0; }
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function clamp(v, low = 0, high = 255) { return Math.max(low, Math.min(high, v)); }
function roundSymmetric(v) { return v >= 0 ? Math.floor(v + 0.5) : Math.ceil(v - 0.5); }
function extend(v, n) { if (n === 0) return 0; const vt = 1 << (n - 1); return v < vt ? v - ((1 << n) - 1) : v; }
function hash32(x) { x = (x >>> 0) ^ 0x9e3779b9; x = (x >>> 0) ^ (x >>> 16); x = Math.imul(x, 0x85ebca6b); x = (x >>> 0) ^ (x >>> 13); x = Math.imul(x, 0xc2b2ae3d); x = (x >>> 0) ^ (x >>> 16); return x >>> 0; }
const ZIGZAG = [0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63];
const DCT_BASIS = Array.from({length: 8}, (_, frequency) => Array.from({length: 8}, (_, sample) => (
  0.5 * (frequency === 0 ? 1 / Math.sqrt(2) : 1) * Math.cos((2 * sample + 1) * frequency * Math.PI / 16)
)));
function buildHuffman(counts, symbols) {
  const table = Array.from({length: 17}, () => new Map());
  let code = 0;
  let pos = 0;
  for (let len = 1; len <= 16; len += 1) {
    for (let i = 0; i < counts[len - 1]; i += 1) {
      table[len].set(code, symbols[pos++]);
      code += 1;
    }
    code <<= 1;
  }
  return table;
}
function parseJPEG(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('SOI not found');
  let p = 2;
  let meta = null;
  let qTables = {};
  let hTables = {};
  let entropy = null;
  let sof = null;
  let scanComponents = null;
  let legacyMetadata = null;
  let chunkDescriptor = null;
  const chunks = new Map();
  const app15PayloadSizes = [];
  while (p < bytes.length) {
    while (p < bytes.length && bytes[p] === 0xff) p += 1;
    if (p >= bytes.length) break;
    const marker = bytes[p++];
    if (marker === 0xd9) break;
    if (marker === 0xda) {
      const len = u16(bytes, p);
      const scanPayload = bytes.slice(p + 2, p + len);
      const scanCount = scanPayload[0];
      scanComponents = [];
      for (let i = 0; i < scanCount; i += 1) {
        const id = scanPayload[1 + i * 2];
        const selectors = scanPayload[2 + i * 2];
        scanComponents.push({id, dcTable: selectors >> 4, acTable: selectors & 15});
      }
      const payloadEnd = p + len;
      let e = payloadEnd;
      while (e + 1 < bytes.length) {
        if (bytes[e] === 0xff) {
          const next = bytes[e + 1];
          if (next === 0x00) { e += 2; continue; }
          if ((next >= 0xd0 && next <= 0xd7) || next === 0xd9) break;
        }
        e += 1;
      }
      const stuffed = bytes.slice(payloadEnd, e);
      const raw = [];
      for (let i = 0; i < stuffed.length; i += 1) {
        if (stuffed[i] === 0xff && stuffed[i + 1] === 0x00) { raw.push(0xff); i += 1; }
        else raw.push(stuffed[i]);
      }
      entropy = new Uint8Array(raw);
      p = e;
      continue;
    }
    const len = u16(bytes, p);
    const start = p + 2;
    const end = p + len;
    const payload = bytes.slice(start, end);
    p = end;
    if (marker === 0xef && payload.length > 5 && String.fromCharCode(...payload.slice(0, 4)) === 'DIJP') {
      app15PayloadSizes.push(payload.length);
      const chunked = payload.length >= 22 && String.fromCharCode(...payload.slice(5, 9)) === 'CHNK';
      if (chunked) {
        const version = payload[9];
        const chunkIndex = u16(payload, 10);
        const chunkCount = u16(payload, 12);
        const totalSize = u32(payload, 14);
        const checksum = u32(payload, 18);
        if (version !== 1 || chunkCount < 1 || chunkIndex >= chunkCount) throw new Error('invalid APP15 chunk header');
        const descriptor = `${chunkCount}:${totalSize}:${checksum}`;
        if (chunkDescriptor && chunkDescriptor.key !== descriptor) throw new Error('inconsistent APP15 chunks');
        if (chunks.has(chunkIndex)) throw new Error('duplicate APP15 chunk');
        chunkDescriptor = {key: descriptor, chunkCount, totalSize, checksum};
        chunks.set(chunkIndex, payload.slice(22));
      } else {
        if (legacyMetadata) throw new Error('duplicate APP15 metadata');
        legacyMetadata = payload.slice(5);
      }
    } else if (marker === 0xc0) {
      const componentCount = payload[5];
      const components = [];
      for (let i = 0; i < componentCount; i += 1) {
        const offset = 6 + i * 3;
        components.push({
          id: payload[offset],
          h: payload[offset + 1] >> 4,
          v: payload[offset + 1] & 15,
          qTable: payload[offset + 2],
        });
      }
      sof = {precision: payload[0], height: u16(payload, 1), width: u16(payload, 3), components};
    } else if (marker === 0xdb) {
      let k = 0;
      while (k < payload.length) {
        const info = payload[k++];
        const precision = info >> 4;
        const id = info & 15;
        if (precision !== 0) throw new Error('16-bit DQT unsupported');
        const serialized = Array.from(payload.slice(k, k + 64));
        const table = Array(64).fill(0);
        for (let i = 0; i < 64; i += 1) table[ZIGZAG[i]] = serialized[i];
        qTables[id] = table;
        k += 64;
      }
    } else if (marker === 0xc4) {
      let k = 0;
      while (k < payload.length) {
        const info = payload[k++];
        const kind = info >> 4;
        const id = info & 15;
        const counts = Array.from(payload.slice(k, k + 16));
        k += 16;
        const total = counts.reduce((a, b) => a + b, 0);
        const symbols = Array.from(payload.slice(k, k + total));
        k += total;
        hTables[`${kind}:${id}`] = buildHuffman(counts, symbols);
      }
    }
  }
  if (legacyMetadata && chunks.size) throw new Error('mixed APP15 metadata encodings');
  if (chunks.size) {
    if (!chunkDescriptor || chunks.size !== chunkDescriptor.chunkCount) throw new Error('missing APP15 chunk');
    const serialized = new Uint8Array(chunkDescriptor.totalSize);
    let offset = 0;
    for (let index = 0; index < chunkDescriptor.chunkCount; index += 1) {
      const chunk = chunks.get(index);
      if (!chunk) throw new Error('missing APP15 chunk');
      serialized.set(chunk, offset);
      offset += chunk.length;
    }
    if (offset !== serialized.length || crc32(serialized) !== chunkDescriptor.checksum) throw new Error('APP15 chunk checksum mismatch');
    meta = JSON.parse(new TextDecoder().decode(serialized));
  } else if (legacyMetadata) {
    meta = JSON.parse(new TextDecoder().decode(legacyMetadata));
  }
  if (!meta || !entropy || !sof || !scanComponents) throw new Error('DIJP metadata, SOF0, or scan missing');
  if (meta.format !== 'DIJP/0.7') throw new Error('DIJP version mismatch');
  if (meta.colorMode !== 'YCbCr444' || meta.componentCount !== 3) throw new Error('unsupported color mode');
  if (!Number.isInteger(meta.gridWidth) || !Number.isInteger(meta.gridHeight) || meta.gridWidth < 1 || meta.gridHeight < 1) {
    throw new Error('invalid APP15 grid');
  }
  if (sof.components.length !== 3 || sof.components.some(component => component.h !== 1 || component.v !== 1)) {
    throw new Error('Phase 3.0 supports YCbCr 4:4:4 only');
  }
  return {meta, qTables, hTables, entropy, sof, scanComponents, app15: {segmentCount: app15PayloadSizes.length, payloadSizes: app15PayloadSizes}};
}
class BitReader {
  constructor(bytes) { this.bytes = bytes; this.bit = 0; }
  readBit() { if (this.bit >= this.bytes.length * 8) throw new Error('entropy underrun'); const b = this.bytes[this.bit >> 3]; const value = (b >> (7 - (this.bit & 7))) & 1; this.bit += 1; return value; }
  read(n) { let value = 0; for (let i = 0; i < n; i += 1) value = (value << 1) | this.readBit(); return value; }
}
function decodeSymbol(br, table) { let code = 0; for (let len = 1; len <= 16; len += 1) { code = (code << 1) | br.readBit(); if (table[len].has(code)) return table[len].get(code); } throw new Error('invalid Huffman code'); }
function decodeBlocks(parsed) {
  const br = new BitReader(parsed.entropy);
  const count = parsed.meta.gridWidth * parsed.meta.gridHeight;
  const blocks = [];
  const predictors = new Map(parsed.scanComponents.map(component => [component.id, 0]));
  function decodeComponent(component) {
    const dcTable = parsed.hTables[`0:${component.dcTable}`];
    const acTable = parsed.hTables[`1:${component.acTable}`];
    if (!dcTable || !acTable) throw new Error(`Huffman table missing for component ${component.id}`);
    const coeffs = new Int16Array(64);
    const category = decodeSymbol(br, dcTable);
    const diff = extend(category ? br.read(category) : 0, category);
    const predictor = predictors.get(component.id) + diff;
    predictors.set(component.id, predictor);
    coeffs[0] = predictor;
    let k = 1;
    while (k < 64) {
      const rs = decodeSymbol(br, acTable);
      const run = rs >> 4;
      const size = rs & 15;
      if (rs === 0x00) break;
      if (rs === 0xf0) { k += 16; continue; }
      k += run;
      if (k >= 64) throw new Error('AC run exceeds block');
      if (size) coeffs[ZIGZAG[k]] = extend(br.read(size), size);
      k += 1;
    }
    return coeffs;
  }
  for (let n = 0; n < count; n += 1) {
    const components = new Map();
    for (const component of parsed.scanComponents) components.set(component.id, decodeComponent(component));
    blocks.push({sourceIndex: n, y: components.get(1), cb: components.get(2), cr: components.get(3)});
  }
  return {blocks, gridWidth: parsed.meta.gridWidth, gridHeight: parsed.meta.gridHeight};
}
function reconstructBlock(coefficients, qTable) {
  const pixels = new Uint8ClampedArray(64);
  const nonzero = [];
  for (let index = 0; index < 64; index += 1) {
    if (coefficients[index]) nonzero.push(index);
  }
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      let total = 0;
      for (const naturalIndex of nonzero) {
        const frequencyX = naturalIndex % 8;
        const frequencyY = Math.floor(naturalIndex / 8);
        total += coefficients[naturalIndex] * qTable[naturalIndex]
          * DCT_BASIS[frequencyX][x] * DCT_BASIS[frequencyY][y];
      }
      pixels[y * 8 + x] = clamp(Math.floor(total + 128.5));
    }
  }
  return pixels;
}
function createSpatiallyDistributedOrder(gridWidth, gridHeight, seed) {
  const tileSize = 4;
  const tiles = [];
  let tileId = 0;
  for (let tileY = 0; tileY < gridHeight; tileY += tileSize) {
    for (let tileX = 0; tileX < gridWidth; tileX += tileSize) {
      const cells = [];
      for (let y = tileY; y < Math.min(tileY + tileSize, gridHeight); y += 1) {
        for (let x = tileX; x < Math.min(tileX + tileSize, gridWidth); x += 1) cells.push(y * gridWidth + x);
      }
      cells.sort((left, right) => (hash32(left * 401 + seed + tileId * 409) - hash32(right * 401 + seed + tileId * 409)) || left - right);
      tiles.push({tileId, cells});
      tileId += 1;
    }
  }
  const order = [];
  const rounds = Math.max(...tiles.map(tile => tile.cells.length));
  for (let round = 0; round < rounds; round += 1) {
    const candidates = tiles
      .filter(tile => round < tile.cells.length)
      .map(tile => ({score: hash32(tile.tileId * 419 + seed + round * 421), tileId: tile.tileId, position: tile.cells[round]}));
    candidates.sort((left, right) => (left.score - right.score) || (left.tileId - right.tileId));
    for (const candidate of candidates) order.push(candidate.position);
  }
  if (order.length !== gridWidth * gridHeight || new Set(order).size !== order.length) throw new Error('invalid spatial transition order');
  return order;
}
function transitionMapping(mappingFrom, mappingTo, transitionOrder, progress) {
  const count = mappingFrom.length;
  if (mappingTo.length !== count || transitionOrder.length !== count) throw new Error('mapping length mismatch');
  const orderFrom = Array(count).fill(0);
  const target = Array(count).fill(0);
  for (let source = 0; source < count; source += 1) {
    orderFrom[mappingFrom[source]] = source;
    target[mappingTo[source]] = source;
  }
  const simulated = orderFrom.slice();
  const sourcePosition = Array(count).fill(0);
  for (let destination = 0; destination < count; destination += 1) sourcePosition[simulated[destination]] = destination;
  const swaps = [];
  for (const destination of transitionOrder) {
    const desiredSource = target[destination];
    const swapDestination = sourcePosition[desiredSource];
    if (swapDestination === destination) continue;
    const displacedSource = simulated[destination];
    simulated[destination] = desiredSource;
    simulated[swapDestination] = displacedSource;
    sourcePosition[desiredSource] = destination;
    sourcePosition[displacedSource] = swapDestination;
    swaps.push([destination, swapDestination]);
  }
  const processed = clamp(Math.round(clamp(progress, 0, 1) * swaps.length), 0, swaps.length);
  const current = orderFrom.slice();
  for (const [destination, swapDestination] of swaps.slice(0, processed)) {
    const displacedSource = current[destination];
    current[destination] = current[swapDestination];
    current[swapDestination] = displacedSource;
  }
  const mapping = Array(count).fill(0);
  for (let destination = 0; destination < count; destination += 1) mapping[current[destination]] = destination;
  return mapping;
}
function selectQuantTables(t, standardY, standardC, meta) {
  const tableA = meta.alternateDqtA;
  const tableB = meta.alternateDqtB;
  const firstSegment = t < 0.5;
  const phase = clamp(firstSegment ? t * 2 : (t - 0.5) * 2, 0, 1);
  const beforeY = firstSegment ? tableA.luminance : standardY;
  const beforeC = firstSegment ? tableA.chrominance : standardC;
  const afterY = firstSegment ? standardY : tableB.luminance;
  const afterC = firstSegment ? standardC : tableB.chrominance;
  const interpolate = (before, after) => before.map((value, index) => clamp(roundSymmetric(value + (after[index] - value) * phase), 1, 255));
  const selectedY = interpolate(beforeY, afterY);
  const selectedC = interpolate(beforeC, afterC);
  return [selectedY, selectedC, selectedC.slice()];
}
function renderImage(parsed, decoded, t) {
  const {meta} = parsed;
  const {blocks, gridWidth, gridHeight} = decoded;
  const mappingA = meta.mappingA || Array.from({length: blocks.length}, (_, i) => i);
  const mappingM = meta.mappingM || Array.from({length: blocks.length}, (_, i) => i);
  const mappingB = meta.mappingB || Array.from({length: blocks.length}, (_, i) => i);
  const activeLuma = meta.activeLumaZigzagCount || 16;
  const activeChroma = meta.activeChromaZigzagCount || 8;
  const componentDefs = new Map(parsed.sof.components.map(component => [component.id, component]));
  const qY = parsed.qTables[componentDefs.get(1).qTable];
  const qC = parsed.qTables[componentDefs.get(2).qTable];
  const seed = meta.transitionSeed || 12345;
  const firstSegment = t < 0.5;
  const localPhase = clamp(firstSegment ? t * 2 : (t - 0.5) * 2, 0, 1);
  const fromMapping = firstSegment ? mappingA : mappingM;
  const toMapping = firstSegment ? mappingM : mappingB;
  const transitionOrder = createSpatiallyDistributedOrder(gridWidth, gridHeight, seed);
  const mapping = transitionMapping(fromMapping, toMapping, transitionOrder, localPhase);
  const uniqueDestinations = new Set(mapping).size;
  const collisions = blocks.length - uniqueDestinations;
  const gaps = blocks.length - uniqueDestinations;
  if (collisions || gaps) throw new Error('transition mapping is not bijective');
  const moved = Math.round(localPhase * blocks.length);
  const unstable = 0;
  const resolvedBlocks = Array(blocks.length);
  for (let source = 0; source < blocks.length; source += 1) resolvedBlocks[mapping[source]] = blocks[source];
  const [selectedY, selectedCb, selectedCr] = selectQuantTables(t, qY, qC, meta);

  const off = document.createElement('canvas');
  const blockSize = meta.blockSize || 8;
  off.width = gridWidth * blockSize;
  off.height = gridHeight * blockSize;
  if (off.width < 1 || off.height < 1) throw new Error('invalid canvas size');
  const ox = off.getContext('2d', {alpha: false});
  const image = ox.createImageData(off.width, off.height);
  for (let d = 0; d < resolvedBlocks.length; d += 1) {
    const block = resolvedBlocks[d];
    const yPixels = reconstructBlock(block.y, selectedY);
    const cbPixels = reconstructBlock(block.cb, selectedCb);
    const crPixels = reconstructBlock(block.cr, selectedCr);
    const blockX = (d % gridWidth) * blockSize;
    const blockY = Math.floor(d / gridWidth) * blockSize;
    for (let y = 0; y < blockSize; y += 1) {
      for (let x = 0; x < blockSize; x += 1) {
        const pixel = y * blockSize + x;
        const yValue = yPixels[pixel];
        const cb = cbPixels[pixel] - 128;
        const cr = crPixels[pixel] - 128;
        const offset = ((blockY + y) * off.width + blockX + x) * 4;
        image.data[offset] = clamp(Math.floor(yValue + 1.402 * cr + 0.5));
        image.data[offset + 1] = clamp(Math.floor(yValue - 0.344136 * cb - 0.714136 * cr + 0.5));
        image.data[offset + 2] = clamp(Math.floor(yValue + 1.772 * cb + 0.5));
        image.data[offset + 3] = 255;
      }
    }
  }
  ox.putImageData(image, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  let currentSection = 'A';
  if (t >= 0.9999) currentSection = 'B';
  else if (Math.abs(t - 0.5) < 0.0001) currentSection = 'M';
  else if (t > 0.0001 && t < 0.5) currentSection = 'A→M';
  else if (t > 0.5) currentSection = 'M→B';
  canvas.dataset.section = currentSection;
  canvas.dataset.collisions = String(collisions);
  canvas.dataset.gaps = String(gaps);
  canvas.dataset.migrated = String(moved);
  canvas.dataset.unstable = String(unstable);
  canvas.dataset.activeLuma = String(activeLuma);
  canvas.dataset.activeChroma = String(activeChroma);
  canvas.dataset.format = meta.format || 'DIJP/0.7';
}
function showError(error) {
  const detail = error && error.message ? error.message : String(error);
  if (!errorLogged) { console.error('DIJP DECODE ERROR:', detail); errorLogged = true; }
}
function loadBytes(bytes) {
  try {
    const jp = parseJPEG(bytes);
    const decodedBlocks = decodeBlocks(jp);
    parsed = jp;
    decoded = decodedBlocks;
    canvas.width = jp.sof.width;
    canvas.height = jp.sof.height;
    lastRenderedPhase = null;
    requestRender(Number(slider.value));
  } catch (err) { showError(err); }
}

function updateStateButtonActivity(phase) {
  const threshold = playing ? MIDDLE_SNAP_THRESHOLD : 0;
  for (const button of stateButtons) {
    const distance = Math.abs(phase - Number(button.dataset.phase));
    button.setAttribute('aria-pressed', String(distance <= threshold));
  }
}

function requestRender(value) {
  const phase = clamp(Number.isFinite(value) ? value : 0, 0, 1);
  slider.value = String(phase);
  phaseValue.value = phase.toFixed(3);
  updateStateButtonActivity(phase);
  if (!parsed || !decoded) return;
  if (lastRenderedPhase === phase) return;
  lastRenderedPhase = phase;
  renderImage(parsed, decoded, phase);
}

function setPlaying(nextPlaying) {
  playing = nextPlaying;
  previousFrameTime = null;
  playPauseButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  playPauseButton.setAttribute('aria-pressed', String(playing));
  canvas.setAttribute('aria-label', `Dedicated DIJP decoder output. Click to ${playing ? 'pause' : 'play'}.`);
  updateStateButtonActivity(Number(slider.value));
  if (playing) requestAnimationFrame(animate);
}

function animate(timestamp) {
  if (!playing) return;
  if (previousFrameTime === null) previousFrameTime = timestamp;
  const elapsed = Math.min(timestamp - previousFrameTime, 100);
  previousFrameTime = timestamp;
  let phase = Number(slider.value) + playbackDirection * elapsed / A_TO_B_MILLISECONDS;
  if (phase >= 1) {
    phase = 2 - phase;
    playbackDirection = -1;
  } else if (phase <= 0) {
    phase = -phase;
    playbackDirection = 1;
  }
  requestRender(phase);
  requestAnimationFrame(animate);
}

async function loadAsset() {
  try {
    const response = await fetch(ASSET_URL);
    if (!response.ok) throw new Error(`JPEG request failed: ${response.status}`);
    loadBytes(new Uint8Array(await response.arrayBuffer()));
  } catch (error) {
    showError(error);
  }
}

slider.addEventListener('input', () => {
  setPlaying(false);
  const phase = Number(slider.value);
  requestRender(Math.abs(phase - 0.5) <= MIDDLE_SNAP_THRESHOLD ? 0.5 : phase);
});
stateButtons.forEach(button => button.addEventListener('click', () => {
  setPlaying(false);
  const phase = Number(button.dataset.phase);
  playbackDirection = phase >= 1 ? -1 : 1;
  requestRender(phase);
}));
playPauseButton.addEventListener('click', () => setPlaying(!playing));
canvas.addEventListener('click', () => setPlaying(!playing));
canvas.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  setPlaying(!playing);
});
window.addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  setPlaying(false);
  const delta = event.shiftKey ? 0.05 : 0.01;
  requestRender(Number(slider.value) + (event.key === 'ArrowRight' ? delta : -delta));
});
loadAsset();
