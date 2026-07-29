(function (root) {
  'use strict';

  const ZIGZAG = [
    0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,
    27,20,13,6,7,14,21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,
    44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63,
  ];
  const POSITIONS = {
    A: [0, 1], B: [0.5, 0], C: [1, 1], M: [0.5, 2 / 3],
  };
  const REGIONS = [['M', 'A', 'B'], ['M', 'B', 'C'], ['M', 'C', 'A']];
  const DCT_BASIS = Array.from({length: 8}, (_, frequency) =>
    Array.from({length: 8}, (_, sample) =>
      0.5 * (frequency === 0 ? 1 / Math.sqrt(2) : 1)
      * Math.cos((2 * sample + 1) * frequency * Math.PI / 16)));

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function readU16(bytes, offset) {
    return (bytes[offset] << 8) | bytes[offset + 1];
  }

  function readU32(bytes, offset) {
    return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16)
      + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
  }

  function buildHuffman(counts, symbols) {
    const table = new Map();
    let code = 0;
    let position = 0;
    for (let length = 1; length <= 16; length += 1) {
      for (let index = 0; index < counts[length - 1]; index += 1) {
        table.set(`${length}:${code}`, symbols[position]);
        code += 1;
        position += 1;
      }
      code <<= 1;
    }
    return table;
  }

  function parseContainer(serialized) {
    if (new TextDecoder().decode(serialized.slice(0, 4)) !== 'D8B1' || serialized.length < 8) {
      throw new Error('invalid TIJP/0.8 binary container');
    }
    const headerSize = readU32(serialized, 4);
    const headerEnd = 8 + headerSize;
    if (headerEnd > serialized.length) throw new Error('truncated TIJP/0.8 header');
    const meta = JSON.parse(new TextDecoder().decode(serialized.slice(8, headerEnd)));
    if (meta.format !== 'DIJP' || !['0.8', '0.8.1'].includes(meta.version) || meta.anchorCount !== meta.anchors.length) {
      throw new Error('TIJP/0.8.x version or anchor count mismatch');
    }
    const blob = serialized.slice(headerEnd);
    meta.mappings = {};
    for (const anchor of meta.anchors) {
      if (anchor.mappingEncoding !== 'uint16be') throw new Error('unsupported mapping encoding');
      const mapping = [];
      for (let index = 0; index < anchor.mappingLength; index += 1) {
        const offset = anchor.mappingOffset + index * 2;
        if (offset + 2 > blob.length) throw new Error('truncated mapping');
        mapping.push(readU16(blob, offset));
      }
      meta.mappings[anchor.id] = mapping;
    }
    const expectedAnchors = new Set(['A', 'B', 'C', 'M']);
    if (meta.anchors.some(anchor => !expectedAnchors.has(anchor.id))
        || new Set(meta.anchors.map(anchor => anchor.id)).size !== expectedAnchors.size) {
      throw new Error('invalid TIJP anchor set');
    }
    for (const anchor of meta.anchors) {
      const position = anchor.position;
      if (!Array.isArray(position) || position.length !== 2 || position.some(value => !Number.isFinite(value))) {
        throw new Error('invalid TIJP anchor position');
      }
      const mapping = meta.mappings[anchor.id];
      if (mapping.length !== meta.blockCount || new Set(mapping).size !== meta.blockCount
          || mapping.some(value => value < 0 || value >= meta.blockCount)) {
        throw new Error('invalid TIJP mapping');
      }
    }
    return meta;
  }

  function parseJpeg(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('SOI missing');
    const parsed = {meta: null, entropy: null, dht: new Map(), dqt: new Map(), sof: null, scan: null, sofCount: 0, sosCount: 0};
    const chunks = new Map();
    let descriptor = null;
    let position = 2;
    while (position < bytes.length) {
      while (position < bytes.length && bytes[position] === 0xff) position += 1;
      if (position >= bytes.length) break;
      const marker = bytes[position];
      position += 1;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (position + 2 > bytes.length) throw new Error('truncated JPEG marker');
      const length = readU16(bytes, position);
      if (length < 2 || position + length > bytes.length) throw new Error('invalid JPEG marker length');
      const payload = bytes.slice(position + 2, position + length);
      const payloadEnd = position + length;
      if (marker === 0xda) {
        parsed.sosCount += 1;
        parsed.scan = [];
        for (let index = 0; index < payload[0]; index += 1) {
          parsed.scan.push([payload[1 + index * 2], payload[2 + index * 2] >> 4, payload[2 + index * 2] & 15]);
        }
        let entropyEnd = payloadEnd;
        while (entropyEnd + 1 < bytes.length) {
          if (bytes[entropyEnd] === 0xff) {
            const next = bytes[entropyEnd + 1];
            if (next === 0) { entropyEnd += 2; continue; }
            if ((next >= 0xd0 && next <= 0xd7) || next === 0xd9) break;
          }
          entropyEnd += 1;
        }
        const raw = [];
        for (let index = payloadEnd; index < entropyEnd; index += 1) {
          raw.push(bytes[index]);
          if (bytes[index] === 0xff && bytes[index + 1] === 0) index += 1;
        }
        parsed.entropy = Uint8Array.from(raw);
        position = entropyEnd;
        continue;
      }
      if (marker === 0xef && payload.length >= 22
          && new TextDecoder().decode(payload.slice(0, 9)) === 'DIJP\u0000CHNK') {
        const version = payload[9];
        const chunkIndex = readU16(payload, 10);
        const chunkCount = readU16(payload, 12);
        const totalSize = readU32(payload, 14);
        const checksum = readU32(payload, 18);
        if (version !== 2 || chunkCount < 1 || chunkIndex >= chunkCount) throw new Error('invalid APP15 chunk header');
        const nextDescriptor = `${chunkCount}:${totalSize}:${checksum}`;
        if (descriptor && descriptor.key !== nextDescriptor) throw new Error('inconsistent APP15 chunks');
        if (chunks.has(chunkIndex)) throw new Error('duplicate APP15 chunk');
        descriptor = {key: nextDescriptor, chunkCount, totalSize, checksum};
        chunks.set(chunkIndex, payload.slice(22));
      } else if (marker === 0xc0) {
        parsed.sofCount += 1;
        parsed.sof = {height: readU16(payload, 1), width: readU16(payload, 3)};
      } else if (marker === 0xdb) {
        let index = 0;
        while (index < payload.length) {
          const info = payload[index++];
          if (info >> 4) throw new Error('16-bit DQT unsupported');
          const table = Array(64).fill(0);
          for (let zigzag = 0; zigzag < 64; zigzag += 1) table[ZIGZAG[zigzag]] = payload[index + zigzag];
          parsed.dqt.set(info & 15, table);
          index += 64;
        }
      } else if (marker === 0xc4) {
        let index = 0;
        while (index < payload.length) {
          const info = payload[index++];
          const counts = Array.from(payload.slice(index, index + 16));
          index += 16;
          const count = counts.reduce((sum, value) => sum + value, 0);
          parsed.dht.set(`${info >> 4}:${info & 15}`, buildHuffman(counts, Array.from(payload.slice(index, index + count))));
          index += count;
        }
      }
      position = payloadEnd;
    }
    if (!descriptor || chunks.size !== descriptor.chunkCount) throw new Error('missing APP15 chunk');
    const serialized = new Uint8Array(descriptor.totalSize);
    let offset = 0;
    for (let index = 0; index < descriptor.chunkCount; index += 1) {
      const chunk = chunks.get(index);
      if (!chunk) throw new Error('missing APP15 chunk');
      serialized.set(chunk, offset);
      offset += chunk.length;
    }
    if (offset !== serialized.length || crc32(serialized) !== descriptor.checksum) throw new Error('APP15 chunk checksum mismatch');
    parsed.meta = parseContainer(serialized);
    parsed.app15 = {
      chunkCount: descriptor.chunkCount,
      totalSize: descriptor.totalSize,
      checksum: descriptor.checksum,
    };
    if (!parsed.entropy || !parsed.sof || !parsed.scan || parsed.sofCount !== 1 || parsed.sosCount !== 1) {
      throw new Error('required JPEG structure missing');
    }
    return parsed;
  }

  class BitReader {
    constructor(bytes) { this.bytes = bytes; this.position = 0; }
    read(count) {
      let value = 0;
      for (let index = 0; index < count; index += 1) {
        const byte = this.bytes[this.position >> 3];
        if (byte === undefined) throw new Error('entropy stream truncated');
        value = (value << 1) | ((byte >> (7 - (this.position & 7))) & 1);
        this.position += 1;
      }
      return value;
    }
  }

  function decodeSymbol(reader, table) {
    let code = 0;
    for (let length = 1; length <= 16; length += 1) {
      code = (code << 1) | reader.read(1);
      const symbol = table.get(`${length}:${code}`);
      if (symbol !== undefined) return symbol;
    }
    throw new Error('invalid Huffman code');
  }

  function extend(value, category) {
    if (!category) return 0;
    const threshold = 1 << (category - 1);
    return value >= threshold ? value : value - ((1 << category) - 1);
  }

  function decodeBlocks(parsed) {
    const reader = new BitReader(parsed.entropy);
    const predictors = new Map(parsed.scan.map(([id]) => [id, 0]));
    const output = [];
    for (let blockIndex = 0; blockIndex < parsed.meta.blockCount; blockIndex += 1) {
      const components = new Map();
      for (const [componentId, dcId, acId] of parsed.scan) {
        const coefficients = Array(64).fill(0);
        const category = decodeSymbol(reader, parsed.dht.get(`0:${dcId}`));
        const predictor = predictors.get(componentId) + extend(category ? reader.read(category) : 0, category);
        predictors.set(componentId, predictor);
        coefficients[0] = predictor;
        let zigzag = 1;
        while (zigzag < 64) {
          const symbol = decodeSymbol(reader, parsed.dht.get(`1:${acId}`));
          if (symbol === 0) break;
          if (symbol === 0xf0) { zigzag += 16; continue; }
          zigzag += symbol >> 4;
          const size = symbol & 15;
          if (zigzag >= 64) throw new Error('AC run exceeds block');
          coefficients[ZIGZAG[zigzag]] = extend(reader.read(size), size);
          zigzag += 1;
        }
        components.set(componentId, coefficients);
      }
      output.push([components.get(1), components.get(2), components.get(3)]);
    }
    return output;
  }

  function roundCommon(value) {
    return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function positionsFor(meta) {
    if (!meta || !Array.isArray(meta.anchors)) {
      return Object.fromEntries(Object.entries(POSITIONS).map(([id, position]) => [id, Array.from(position)]));
    }
    const positions = {};
    for (const anchor of meta.anchors) positions[anchor.id] = Array.from(anchor.position);
    return Object.keys(POSITIONS).every(id => positions[id]) ? positions : positionsFor(null);
  }

  function barycentric(point, ids, positions = POSITIONS) {
    const [x, y] = point;
    const [x1, y1] = positions[ids[0]], [x2, y2] = positions[ids[1]], [x3, y3] = positions[ids[2]];
    const denominator = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
    const raw = [
      ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / denominator,
      ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / denominator,
    ];
    raw.push(1 - raw[0] - raw[1]);
    if (Math.min(...raw) < -1e-10) return null;
    const normalized = raw.map(weight => Math.abs(weight) < 1e-12 ? 0 : Math.max(0, weight));
    const total = normalized.reduce((sum, value) => sum + value, 0);
    return Object.fromEntries(ids.map((id, index) => [id, normalized[index] / total]));
  }

  function clampToTriangle(u, v, positions = POSITIONS) {
    if (barycentric([u, v], ['A', 'B', 'C'], positions)) return [u, v];
    const edges = [['A', 'B'], ['B', 'C'], ['C', 'A']];
    return edges.map(([from, to]) => {
      const [x1, y1] = positions[from], [x2, y2] = positions[to];
      const dx = x2 - x1, dy = y2 - y1;
      const phase = clamp(((u - x1) * dx + (v - y1) * dy) / (dx * dx + dy * dy), 0, 1);
      return [x1 + phase * dx, y1 + phase * dy];
    }).sort((left, right) => {
      const dl = (left[0] - u) ** 2 + (left[1] - v) ** 2;
      const dr = (right[0] - u) ** 2 + (right[1] - v) ** 2;
      return dl - dr || left[0] - right[0] || left[1] - right[1];
    })[0];
  }

  function interpretationWeights(u, v, positions = POSITIONS) {
    const point = clampToTriangle(Number(u), Number(v), positions);
    for (const region of REGIONS) {
      const local = barycentric(point, region, positions);
      if (local) {
        const weights = {A: 0, B: 0, C: 0, M: 0, ...local};
        const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
        for (const id of Object.keys(weights)) weights[id] /= total;
        return {u: point[0], v: point[1], region: Array.from(region), weights};
      }
    }
    throw new Error('coordinate outside interpretation space');
  }

  function transitionMapping(mappingFrom, mappingTo, transitionOrder, progress) {
    const count = mappingFrom.length;
    const current = Array(count).fill(0);
    const target = Array(count).fill(0);
    for (let source = 0; source < count; source += 1) {
      current[mappingFrom[source]] = source;
      target[mappingTo[source]] = source;
    }
    const sourcePosition = Array(count).fill(0);
    current.forEach((source, destination) => { sourcePosition[source] = destination; });
    const swaps = [];
    for (const destination of transitionOrder) {
      const desired = target[destination];
      const swapDestination = sourcePosition[desired];
      if (swapDestination === destination) continue;
      const displaced = current[destination];
      [current[destination], current[swapDestination]] = [current[swapDestination], current[destination]];
      sourcePosition[desired] = destination;
      sourcePosition[displaced] = swapDestination;
      swaps.push([destination, swapDestination]);
    }
    const applied = clamp(roundCommon(clamp(progress, 0, 1) * swaps.length), 0, swaps.length);
    for (let index = swaps.length - 1; index >= applied; index -= 1) {
      const [destination, swapDestination] = swaps[index];
      [current[destination], current[swapDestination]] = [current[swapDestination], current[destination]];
    }
    const mapping = Array(count).fill(0);
    current.forEach((source, destination) => { mapping[source] = destination; });
    return mapping;
  }

  function mappingAt(meta, coordinate) {
    const active = Object.keys(coordinate.weights).filter(id => coordinate.weights[id] > 1e-12);
    if (active.length === 1) return Array.from(meta.mappings[active[0]]);
    const region = coordinate.region.filter(id => active.includes(id));
    let current = Array.from(meta.mappings[region[0]]);
    let consumed = coordinate.weights[region[0]];
    for (const id of region.slice(1)) {
      const denominator = consumed + coordinate.weights[id];
      const phase = denominator ? coordinate.weights[id] / denominator : 0;
      current = transitionMapping(current, meta.mappings[id], meta.transitionOrder, phase);
      consumed = denominator;
    }
    if (new Set(current).size !== current.length) throw new Error('mapping is not bijective');
    return current;
  }

  function interpolateQuantTables(meta, weights, mode = 'linear') {
    const active = Object.keys(weights).filter(id => weights[id] > 0);
    const component = name => Array.from({length: 64}, (_, index) => {
      let value;
      if (mode === 'logarithmic') {
        value = Math.exp(active.reduce((sum, id) => sum + weights[id] * Math.log(meta.quantTables[id][name][index]), 0));
      } else if (mode === 'stepped') {
        const selected = active.slice().sort((a, b) => weights[b] - weights[a] || a.localeCompare(b))[0];
        value = meta.quantTables[selected][name][index];
      } else {
        value = active.reduce((sum, id) => sum + weights[id] * meta.quantTables[id][name][index], 0);
      }
      return clamp(roundCommon(value), 1, 255);
    });
    return [component('luminance'), component('chrominance')];
  }

  function interpretationAt(meta, u, v, mode = 'linear') {
    const coordinate = interpretationWeights(u, v, positionsFor(meta));
    const [quantLuminance, quantChrominance] = interpolateQuantTables(meta, coordinate.weights, mode);
    return {...coordinate, mapping: mappingAt(meta, coordinate), quantLuminance, quantChrominance};
  }

  function reconstruct(coefficients, qtable) {
    const nonzero = coefficients.map((value, index) => value ? index : -1).filter(index => index >= 0);
    return Array.from({length: 64}, (_, pixel) => {
      const x = pixel % 8, y = Math.floor(pixel / 8);
      let total = 0;
      for (const index of nonzero) {
        total += coefficients[index] * qtable[index] * DCT_BASIS[index % 8][x] * DCT_BASIS[Math.floor(index / 8)][y];
      }
      return clamp(Math.floor(total + 128.5), 0, 255);
    });
  }

  function renderRgba(parsed, u, v, mode = 'linear') {
    const blocks = parsed.blocks || (parsed.blocks = decodeBlocks(parsed));
    const state = interpretationAt(parsed.meta, u, v, mode);
    const width = parsed.meta.imageWidth, height = parsed.meta.imageHeight;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let source = 0; source < blocks.length; source += 1) {
      const destination = state.mapping[source];
      const blockX = (destination % parsed.meta.gridWidth) * 8;
      const blockY = Math.floor(destination / parsed.meta.gridWidth) * 8;
      const yPixels = reconstruct(blocks[source][0], state.quantLuminance);
      const cbPixels = reconstruct(blocks[source][1], state.quantChrominance);
      const crPixels = reconstruct(blocks[source][2], state.quantChrominance);
      for (let pixel = 0; pixel < 64; pixel += 1) {
        const y = yPixels[pixel], cb = cbPixels[pixel] - 128, cr = crPixels[pixel] - 128;
        const offset = ((blockY + Math.floor(pixel / 8)) * width + blockX + (pixel % 8)) * 4;
        rgba[offset] = clamp(Math.floor(y + 1.402 * cr + 0.5), 0, 255);
        rgba[offset + 1] = clamp(Math.floor(y - 0.344136 * cb - 0.714136 * cr + 0.5), 0, 255);
        rgba[offset + 2] = clamp(Math.floor(y + 1.772 * cb + 0.5), 0, 255);
        rgba[offset + 3] = 255;
      }
    }
    return {rgba, width, height, state};
  }

  function decodeAnchor(parsed, anchorId) {
    const position = positionsFor(parsed.meta)[anchorId];
    if (!position) throw new Error(`unknown anchor ${anchorId}`);
    return renderRgba(parsed, position[0], position[1]);
  }

  root.DIJPThree = {
    POSITIONS, REGIONS, crc32, parseJpeg, decodeBlocks, positionsFor, clampToTriangle,
    interpretationWeights,
    interpretationAt, transitionMapping, interpolateQuantTables, renderRgba, decodeAnchor,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
(function (root) {
  'use strict';

  const VIEWBOX = Object.freeze({width: 300, height: 260, left: 24, top: 20, innerWidth: 252, innerHeight: 216});

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function displayRect(viewWidth, viewHeight, imageWidth, imageHeight, fit = 'cover', focusX = 0.5, focusY = 0.5) {
    if (![viewWidth, viewHeight, imageWidth, imageHeight].every(value => Number.isFinite(value) && value > 0)) {
      return {x: 0, y: 0, width: 0, height: 0, scale: 0};
    }
    let scale;
    if (fit === 'contain') {
      scale = Math.min(viewWidth / imageWidth, viewHeight / imageHeight);
    } else if (fit === 'pixel') {
      scale = Math.max(1, Math.floor(Math.min(viewWidth / imageWidth, viewHeight / imageHeight)));
    } else {
      scale = Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
    }
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    const boundedFocusX = clamp(Number(focusX), 0, 1);
    const boundedFocusY = clamp(Number(focusY), 0, 1);
    const x = width > viewWidth ? -(width - viewWidth) * boundedFocusX : (viewWidth - width) / 2;
    const y = height > viewHeight ? -(height - viewHeight) * boundedFocusY : (viewHeight - height) / 2;
    return {x, y, width, height, scale};
  }

  function spaceToSvg(position) {
    return [
      VIEWBOX.left + position[0] * VIEWBOX.innerWidth,
      VIEWBOX.top + position[1] * VIEWBOX.innerHeight,
    ];
  }

  function svgToSpace(point) {
    return [
      (point[0] - VIEWBOX.left) / VIEWBOX.innerWidth,
      (point[1] - VIEWBOX.top) / VIEWBOX.innerHeight,
    ];
  }

  function pointDistanceCss(left, right, cssWidth, cssHeight) {
    const dx = (left[0] - right[0]) * VIEWBOX.innerWidth * cssWidth / VIEWBOX.width;
    const dy = (left[1] - right[1]) * VIEWBOX.innerHeight * cssHeight / VIEWBOX.height;
    return Math.hypot(dx, dy);
  }

  function snapPoint(raw, positions, cssWidth, cssHeight, project) {
    const projected = project(raw[0], raw[1]);
    const thresholds = {A: 12, B: 12, C: 12, M: 10};
    const candidates = Object.entries(positions)
      .filter(([id]) => thresholds[id])
      .map(([id, position]) => ({
        id,
        position,
        distance: pointDistanceCss(projected, position, cssWidth, cssHeight),
      }))
      .filter(candidate => candidate.distance <= thresholds[candidate.id])
      .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id));
    const selected = candidates[0];
    return {
      u: selected ? selected.position[0] : projected[0],
      v: selected ? selected.position[1] : projected[1],
      anchor: selected ? selected.id : null,
    };
  }

  function createRequestGate() {
    let latest = 0;
    return {
      next() {
        latest += 1;
        return latest;
      },
      current(id) {
        return id === latest;
      },
      value() {
        return latest;
      },
    };
  }

  function hasDijpMetadata(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
    let position = 2;
    while (position + 3 < bytes.length) {
      while (bytes[position] === 0xff) position += 1;
      const marker = bytes[position++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
      if (position + 2 > bytes.length) return false;
      const length = (bytes[position] << 8) | bytes[position + 1];
      if (length < 2 || position + length > bytes.length) return false;
      if (marker === 0xef && length >= 6
          && bytes[position + 2] === 0x44
          && bytes[position + 3] === 0x49
          && bytes[position + 4] === 0x4a
          && bytes[position + 5] === 0x50) {
        return true;
      }
      position += length;
    }
    return false;
  }

  root.DIJPPublicViewer = {
    VIEWBOX,
    clamp,
    displayRect,
    spaceToSvg,
    svgToSpace,
    snapPoint,
    createRequestGate,
    hasDijpMetadata,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
(function () {
  'use strict';

  const PUBLIC_ASSET_URL = './assets/triple_interpretation.jpg';
  const AUTOPLAY_SEGMENT_MILLISECONDS = 1800;
  const AUTOPLAY_ANCHOR_HOLD_MILLISECONDS = 140;
  const AUTOPLAY_DECODE_INTERVAL_MILLISECONDS = 80;
  const Core = window.DIJPPublicViewer;
  const Three = window.DIJPThree;
  if (!Core || !Three) throw new Error('TIJP viewer dependencies are unavailable');

  const elements = {
    viewer: document.getElementById('viewer'),
    canvas: document.getElementById('decoded-canvas'),
    imageUiFrame: document.getElementById('image-ui-frame'),
    controlOverlay: document.getElementById('control-overlay'),
    playPause: document.getElementById('play-pause'),
    ratioA: document.getElementById('ratio-a'),
    ratioB: document.getElementById('ratio-b'),
    ratioC: document.getElementById('ratio-c'),
    ratioM: document.getElementById('ratio-m'),
    ratioButtons: Array.from(document.querySelectorAll('[data-ratio-anchor]')),
    triangle: document.getElementById('triangle-controller'),
    standardMarker: document.getElementById('standard-marker'),
    currentMarker: document.getElementById('current-marker'),
    announcement: document.getElementById('controller-announcement'),
    loading: document.getElementById('loading-overlay'),
    error: document.getElementById('error-overlay'),
    errorTitle: document.getElementById('error-title'),
    errorDetail: document.getElementById('error-detail'),
  };

  const context = elements.canvas.getContext('2d', {alpha: false});
  const decodedCanvas = document.createElement('canvas');
  const decodedContext = decodedCanvas.getContext('2d', {alpha: false});
  const requestGate = Core.createRequestGate();
  const defaultPositions = Three.positionsFor(null);
  const state = {
    adapter: null,
    parsed: null,
    positions: defaultPositions,
    position: {u: defaultPositions.M[0], v: defaultPositions.M[1]},
    pending: null,
    pendingCommit: false,
    pendingAnnouncement: false,
    decodeFrame: 0,
    loadId: 0,
    dragging: false,
    pointerId: null,
    snappedAnchor: 'M',
    display: {fit: 'contain', focusX: 0.5, focusY: 0.5},
    viewport: {width: 1, height: 1, dpr: 1},
    rendered: null,
    playing: false,
    playbackFrame: 0,
    playbackRoute: null,
    playbackElapsed: 0,
    playbackLastTime: 0,
    playbackLastDecodeTime: 0,
  };

  function createAdapter(parsed) {
    const positions = Three.positionsFor(parsed.meta);
    return {
      positions,
      normalize(point) {
        const projected = Three.clampToTriangle(point.u, point.v, positions);
        return {u: projected[0], v: projected[1]};
      },
      render(point) {
        return Three.renderRgba(parsed, point.u, point.v);
      },
    };
  }

  function parseTijp(bytes) {
    if (!Core.hasDijpMetadata(bytes)) throw new Error('DIJP metadata missing');
    const parsed = Three.parseJpeg(bytes);
    return {parsed, adapter: createAdapter(parsed)};
  }

  function showLoading(message) {
    elements.loading.textContent = message;
    elements.loading.hidden = false;
    elements.viewer.setAttribute('aria-busy', 'true');
  }

  function clearMessages() {
    elements.loading.hidden = true;
    elements.error.hidden = true;
    elements.viewer.setAttribute('aria-busy', 'false');
  }

  function classifyError(error, bytes) {
    const detail = String(error && error.message || error);
    const publicDetail = detail
      .replace(/DIJP\/0\.8(?:\.1|\.x)?/g, match => match.replace('DIJP', 'TIJP'))
      .replace(/\bDIJP (metadata|mapping|anchor|version)\b/gi, 'TIJP $1');
    const jpeg = bytes && bytes[0] === 0xff && bytes[1] === 0xd8;
    if (jpeg && /missing APP15|metadata.*missing/i.test(detail)) {
      return ['VALID JPEG · TIJP METADATA NOT FOUND', 'LOAD A TIJP JPEG'];
    }
    if (/checksum|CRC/i.test(detail)) return ['APP15 CRC MISMATCH', 'THE TIJP METADATA IS DAMAGED'];
    if (/version/i.test(detail)) return ['UNSUPPORTED TIJP VERSION', publicDetail];
    if (/mapping|bijection/i.test(detail)) return ['INVALID MAPPING', publicDetail];
    if (/APP15|metadata|chunk/i.test(detail)) return ['INVALID APP15', publicDetail];
    if (/SOI|JPEG|Huffman|entropy|DQT|scan|SOF/i.test(detail)) return ['JPEG DECODE FAILED', publicDetail];
    return ['TIJP DECODE ERROR', publicDetail];
  }

  function showError(error, bytes) {
    setPlayback(false, {reset: true});
    const [title, detail] = classifyError(error, bytes);
    elements.loading.hidden = true;
    elements.errorTitle.textContent = title;
    elements.errorDetail.textContent = detail;
    elements.error.hidden = false;
    elements.viewer.setAttribute('aria-busy', 'false');
  }

  function viewportSize() {
    const visual = window.visualViewport;
    return {
      width: Math.max(1, Math.round(visual ? visual.width : window.innerWidth)),
      height: Math.max(1, Math.round(visual ? visual.height : window.innerHeight)),
      left: visual ? visual.offsetLeft : 0,
      top: visual ? visual.offsetTop : 0,
      dpr: Math.max(1, window.devicePixelRatio || 1),
    };
  }

  function resizeViewport() {
    const viewport = viewportSize();
    state.viewport = viewport;
    elements.viewer.style.left = `${viewport.left}px`;
    elements.viewer.style.top = `${viewport.top}px`;
    elements.viewer.style.width = `${viewport.width}px`;
    elements.viewer.style.height = `${viewport.height}px`;
    elements.canvas.style.width = `${viewport.width}px`;
    elements.canvas.style.height = `${viewport.height}px`;
    const width = Math.round(viewport.width * viewport.dpr);
    const height = Math.round(viewport.height * viewport.dpr);
    if (elements.canvas.width !== width || elements.canvas.height !== height) {
      elements.canvas.width = width;
      elements.canvas.height = height;
    }
    drawViewport();
  }

  function drawViewport() {
    const {width, height, dpr} = state.viewport;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = '#050606';
    context.fillRect(0, 0, width, height);
    if (!decodedCanvas.width || !decodedCanvas.height) {
      updateImageUiFrame({x: 0, y: 0, width, height});
      return;
    }
    const rect = Core.displayRect(
      width,
      height,
      decodedCanvas.width,
      decodedCanvas.height,
      state.display.fit,
      state.display.focusX,
      state.display.focusY,
    );
    context.imageSmoothingEnabled = state.display.fit !== 'pixel';
    context.drawImage(decodedCanvas, rect.x, rect.y, rect.width, rect.height);
    updateImageUiFrame(rect);
  }

  function updateImageUiFrame(rect) {
    const left = Math.max(0, rect.x);
    const top = Math.max(0, rect.y);
    const right = Math.min(state.viewport.width, rect.x + rect.width);
    const bottom = Math.min(state.viewport.height, rect.y + rect.height);
    elements.imageUiFrame.style.left = `${left}px`;
    elements.imageUiFrame.style.top = `${top}px`;
    elements.imageUiFrame.style.width = `${Math.max(1, right - left)}px`;
    elements.imageUiFrame.style.height = `${Math.max(1, bottom - top)}px`;
  }

  function updateTriangleGeometry() {
    for (const id of ['A', 'B', 'C']) {
      const group = elements.triangle.querySelector(`[data-anchor="${id}"]`);
      const [x, y] = Core.spaceToSvg(state.positions[id]);
      group.setAttribute('transform', `translate(${x} ${y})`);
    }
    const [mx, my] = Core.spaceToSvg(state.positions.M);
    elements.standardMarker.setAttribute('transform', `translate(${mx} ${my})`);
    const endpoints = {ma: 'A', mb: 'B', mc: 'C'};
    for (const [lineId, anchorId] of Object.entries(endpoints)) {
      const line = document.getElementById(`line-${lineId}`);
      const [x, y] = Core.spaceToSvg(state.positions[anchorId]);
      line.setAttribute('x1', String(mx));
      line.setAttribute('y1', String(my));
      line.setAttribute('x2', String(x));
      line.setAttribute('y2', String(y));
    }
    updateCurrentMarker();
  }

  function updateCurrentMarker() {
    const [x, y] = Core.spaceToSvg([state.position.u, state.position.v]);
    elements.currentMarker.setAttribute('transform', `translate(${x} ${y})`);
    elements.currentMarker.classList.toggle('is-snapped', Boolean(state.snappedAnchor));
  }

  function interpretationRatios(point = state.position) {
    const {weights} = Three.interpretationWeights(
      point.u,
      point.v,
      state.positions,
    );
    return ['A', 'B', 'C', 'M'].map(id => weights[id] || 0);
  }

  function percentageTenths(ratios) {
    const exact = ratios.map(value => value * 1000);
    const units = exact.map(Math.floor);
    let remainder = 1000 - units.reduce((sum, value) => sum + value, 0);
    const tiePriority = [3, 1, 0, 2];
    const order = ratios.map((_, index) => index).sort((left, right) =>
      exact[right] - units[right] - (exact[left] - units[left])
      || tiePriority.indexOf(left) - tiePriority.indexOf(right));
    for (let index = 0; index < remainder; index += 1) {
      units[order[index % order.length]] += 1;
    }
    return units;
  }

  function updateRatios() {
    const units = percentageTenths(interpretationRatios());
    const outputs = [elements.ratioA, elements.ratioB, elements.ratioC, elements.ratioM];
    outputs.forEach((output, index) => {
      output.textContent = `${(units[index] / 10).toFixed(1)}%`;
    });
    elements.ratioButtons.forEach((button, index) => {
      button.setAttribute('aria-pressed', String(units[index] === 1000));
    });
    return units;
  }

  async function decodePending(requestId, point, commit, announce) {
    let result;
    try {
      result = await Promise.resolve().then(() => state.adapter.render(point));
    } catch (error) {
      if (requestGate.current(requestId)) showError(error);
      return;
    }
    if (!requestGate.current(requestId)) return;
    state.position = {u: point.u, v: point.v};
    state.rendered = result;
    decodedCanvas.width = result.width;
    decodedCanvas.height = result.height;
    decodedContext.putImageData(new ImageData(result.rgba, result.width, result.height), 0, 0);
    drawViewport();
    updateCurrentMarker();
    updateRatios();
    clearMessages();
    if (commit) updateUrl();
    if (announce) announcePosition();
  }

  function flushDecode() {
    state.decodeFrame = 0;
    if (!state.adapter || !state.parsed || !state.pending) return;
    const point = state.pending;
    const commit = state.pendingCommit;
    const announce = state.pendingAnnouncement;
    state.pending = null;
    state.pendingCommit = false;
    state.pendingAnnouncement = false;
    const requestId = requestGate.value();
    decodePending(requestId, point, commit, announce);
  }

  function scheduleDecode(point, options = {}) {
    if (!state.adapter) return;
    const normalized = state.adapter.normalize(point);
    state.pending = {u: normalized.u, v: normalized.v};
    state.position = state.pending;
    state.pendingCommit ||= Boolean(options.commit);
    state.pendingAnnouncement ||= Boolean(options.announce);
    requestGate.next();
    updateCurrentMarker();
    updateRatios();
    if (!state.decodeFrame) state.decodeFrame = requestAnimationFrame(flushDecode);
  }

  function announcePosition() {
    const units = updateRatios();
    elements.announcement.textContent =
      `A ${(units[0] / 10).toFixed(1)} percent, `
      + `B ${(units[1] / 10).toFixed(1)} percent, `
      + `C ${(units[2] / 10).toFixed(1)} percent, `
      + `Standard ${(units[3] / 10).toFixed(1)} percent`;
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('sample');
    url.searchParams.set('u', state.position.u.toFixed(4));
    url.searchParams.set('v', state.position.v.toFixed(4));
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function initialPosition() {
    const parameters = new URLSearchParams(window.location.search);
    const u = Number(parameters.get('u'));
    const v = Number(parameters.get('v'));
    if (parameters.has('u') && parameters.has('v') && Number.isFinite(u) && Number.isFinite(v)) {
      return state.adapter.normalize({u, v});
    }
    return {u: state.positions.M[0], v: state.positions.M[1]};
  }

  async function loadBytes(input, options = {}) {
    setPlayback(false, {reset: true});
    elements.playPause.disabled = true;
    const loadId = ++state.loadId;
    requestGate.next();
    showLoading('PARSING APP15');
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    try {
      await Promise.resolve();
      const {parsed, adapter} = parseTijp(bytes);
      if (loadId !== state.loadId) return false;
      state.parsed = parsed;
      state.adapter = adapter;
      state.positions = adapter.positions;
      elements.playPause.disabled = false;
      updateTriangleGeometry();
      showLoading('DECODING STANDARD');
      const position = options.restoreUrl ? initialPosition() : options.position || {
        u: state.positions.M[0],
        v: state.positions.M[1],
      };
      state.snappedAnchor = nearestAnchor(position, 0.00001);
      scheduleDecode(position, {commit: Boolean(options.commit), announce: true});
      return true;
    } catch (error) {
      if (loadId === state.loadId) showError(error, bytes);
      return false;
    }
  }

  async function loadPublicAsset() {
    const loadId = ++state.loadId;
    requestGate.next();
    showLoading('LOADING TIJP');
    try {
      const response = await fetch(PUBLIC_ASSET_URL, {cache: 'no-cache'});
      if (!response.ok) throw new Error(`asset request failed: ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (loadId !== state.loadId) return;
      await loadBytes(bytes, {
        restoreUrl: true,
        commit: true,
      });
    } catch (error) {
      if (loadId === state.loadId) showError(new Error(`ASSET LOAD FAILED · ${error.message}`));
    }
  }

  function nearestAnchor(point, tolerance = 0.000001) {
    return Object.entries(state.positions).find(([, position]) =>
      Math.hypot(position[0] - point.u, position[1] - point.v) <= tolerance)?.[0] || null;
  }

  function positionFor(id) {
    const [u, v] = state.positions[id];
    return {u, v};
  }

  function createPlaybackLoop() {
    return [
      positionFor('M'),
      positionFor('A'),
      positionFor('M'),
      positionFor('B'),
      positionFor('M'),
      positionFor('C'),
      positionFor('B'),
      positionFor('A'),
      positionFor('C'),
      positionFor('M'),
    ];
  }

  function createPlaybackRoute(start = state.position) {
    const loop = createPlaybackLoop();
    return nearestAnchor(start, 0.00001) === 'M'
      ? loop
      : [{u: start.u, v: start.v}, ...loop];
  }

  function updatePlaybackUi() {
    elements.playPause.setAttribute('aria-pressed', String(state.playing));
    elements.canvas.setAttribute('aria-pressed', String(state.playing));
    elements.playPause.setAttribute(
      'aria-label',
      state.playing ? 'Pause automatic interpretation' : 'Play automatic interpretation',
    );
    elements.canvas.setAttribute(
      'aria-label',
      state.playing
        ? 'Decoded TIJP image. Click to pause automatic interpretation.'
        : 'Decoded TIJP image. Click to play automatic interpretation.',
    );
    updateControlBackground();
  }

  function updateControlBackground() {
    elements.controlOverlay.classList.toggle(
      'is-background-transparent',
      state.dragging || state.playing,
    );
  }

  function setPlayback(playing, options = {}) {
    const next = Boolean(playing && state.adapter);
    if (!next) {
      if (state.playbackFrame) cancelAnimationFrame(state.playbackFrame);
      state.playbackFrame = 0;
      state.playing = false;
      state.playbackLastTime = 0;
      state.playbackLastDecodeTime = 0;
      if (options.reset) {
        state.playbackRoute = null;
        state.playbackElapsed = 0;
      }
      if (options.commit && state.adapter) updateUrl();
      updatePlaybackUi();
      return;
    }

    if (!state.playbackRoute) {
      state.playbackRoute = createPlaybackRoute();
      state.playbackElapsed = 0;
    }
    state.playing = true;
    state.playbackLastTime = 0;
    state.playbackLastDecodeTime = 0;
    updatePlaybackUi();
    state.playbackFrame = requestAnimationFrame(advancePlayback);
  }

  function advancePlayback(timestamp) {
    if (!state.playing || !state.playbackRoute) return;
    if (state.playbackLastTime) {
      state.playbackElapsed += Math.min(timestamp - state.playbackLastTime, 100);
    }
    state.playbackLastTime = timestamp;

    let duration = (state.playbackRoute.length - 1) * AUTOPLAY_SEGMENT_MILLISECONDS;
    if (state.playbackElapsed >= duration) {
      state.playbackElapsed %= duration;
      state.playbackRoute = createPlaybackLoop();
      duration = (state.playbackRoute.length - 1) * AUTOPLAY_SEGMENT_MILLISECONDS;
    }

    if (!state.playbackLastDecodeTime
        || timestamp - state.playbackLastDecodeTime >= AUTOPLAY_DECODE_INTERVAL_MILLISECONDS) {
      const segmentProgress = state.playbackElapsed / AUTOPLAY_SEGMENT_MILLISECONDS;
      const segmentIndex = Math.min(
        state.playbackRoute.length - 2,
        Math.floor(segmentProgress),
      );
      const segmentElapsed = state.playbackElapsed
        - segmentIndex * AUTOPLAY_SEGMENT_MILLISECONDS;
      const travelDuration = AUTOPLAY_SEGMENT_MILLISECONDS
        - AUTOPLAY_ANCHOR_HOLD_MILLISECONDS;
      const travelProgress = Math.min(1, segmentElapsed / travelDuration);
      const eased = travelProgress * travelProgress * (3 - 2 * travelProgress);
      const from = state.playbackRoute[segmentIndex];
      const to = state.playbackRoute[segmentIndex + 1];
      const point = {
        u: from.u + (to.u - from.u) * eased,
        v: from.v + (to.v - from.v) * eased,
      };
      state.snappedAnchor = nearestAnchor(point, 0.00001);
      scheduleDecode(point);
      state.playbackLastDecodeTime = timestamp;
    }

    state.playbackFrame = requestAnimationFrame(advancePlayback);
  }

  function pointFromPointer(event) {
    const rect = elements.triangle.getBoundingClientRect();
    const svgPoint = [
      (event.clientX - rect.left) * Core.VIEWBOX.width / rect.width,
      (event.clientY - rect.top) * Core.VIEWBOX.height / rect.height,
    ];
    const raw = Core.svgToSpace(svgPoint);
    const snap = Core.snapPoint(
      raw,
      state.positions,
      rect.width,
      rect.height,
      (u, v) => Three.clampToTriangle(u, v, state.positions),
    );
    const normalized = state.adapter.normalize({u: snap.u, v: snap.v});
    const retainedAnchor = snap.anchor
      && Math.hypot(normalized.u - state.positions[snap.anchor][0], normalized.v - state.positions[snap.anchor][1]) < 1e-8
      ? snap.anchor
      : null;
    return {u: normalized.u, v: normalized.v, anchor: retainedAnchor};
  }

  function selectAnchor(id, options = {}) {
    if (!state.adapter || !state.positions[id]) return;
    setPlayback(false, {reset: true});
    let point = {u: state.positions[id][0], v: state.positions[id][1]};
    point = state.adapter.normalize(point);
    state.snappedAnchor = nearestAnchor(point, 1e-8);
    scheduleDecode(point, {commit: true, announce: options.announce !== false});
  }

  function moveByKeyboard(key, shiftKey) {
    const step = shiftKey ? 0.05 : 0.01;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[key];
    if (!delta) return false;
    setPlayback(false, {reset: true});
    const normalized = state.adapter.normalize({
      u: state.position.u + delta[0],
      v: state.position.v + delta[1],
    });
    state.snappedAnchor = nearestAnchor(normalized, 0.012);
    const point = state.snappedAnchor
      ? {u: state.positions[state.snappedAnchor][0], v: state.positions[state.snappedAnchor][1]}
      : normalized;
    scheduleDecode(point, {commit: true, announce: true});
    return true;
  }

  elements.triangle.addEventListener('pointerdown', event => {
    if (!state.adapter) return;
    event.preventDefault();
    setPlayback(false, {reset: true});
    state.dragging = true;
    updateControlBackground();
    state.pointerId = event.pointerId;
    elements.triangle.setPointerCapture(event.pointerId);
    const point = pointFromPointer(event);
    state.snappedAnchor = point.anchor;
    scheduleDecode(point);
  });

  elements.triangle.addEventListener('pointermove', event => {
    if (!state.dragging || event.pointerId !== state.pointerId) return;
    event.preventDefault();
    const point = pointFromPointer(event);
    state.snappedAnchor = point.anchor;
    scheduleDecode(point);
  });

  function endPointer(event) {
    if (!state.dragging || event.pointerId !== state.pointerId) return;
    state.dragging = false;
    updateControlBackground();
    if (elements.triangle.hasPointerCapture(event.pointerId)) elements.triangle.releasePointerCapture(event.pointerId);
    state.pointerId = null;
    scheduleDecode(state.position, {commit: true, announce: true});
  }

  elements.triangle.addEventListener('pointerup', endPointer);
  elements.triangle.addEventListener('pointercancel', endPointer);

  function togglePlayback() {
    if (state.playing) setPlayback(false, {commit: true});
    else setPlayback(true);
  }

  function isDisplayedImagePoint(event) {
    const rect = elements.imageUiFrame.getBoundingClientRect();
    return event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom;
  }

  elements.playPause.addEventListener('click', togglePlayback);
  elements.canvas.addEventListener('click', event => {
    if (isDisplayedImagePoint(event)) togglePlayback();
  });
  elements.canvas.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    togglePlayback();
  });
  for (const button of elements.ratioButtons) {
    button.addEventListener('click', () => selectAnchor(button.dataset.ratioAnchor));
  }

  window.addEventListener('keydown', event => {
    if (!state.adapter || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (moveByKeyboard(event.key, event.shiftKey)) {
      event.preventDefault();
      return;
    }
    const key = event.key.toUpperCase();
    if (['A', 'B', 'C', 'M'].includes(key)) {
      event.preventDefault();
      selectAnchor(key);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectAnchor('M');
    } else if (event.key === 'Escape') {
      setPlayback(false, {commit: true});
    } else {
      return;
    }
  });

  window.addEventListener('resize', resizeViewport);
  window.addEventListener('orientationchange', resizeViewport);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.playing) setPlayback(false, {commit: true});
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resizeViewport);
    window.visualViewport.addEventListener('scroll', resizeViewport);
  }

  async function initialize() {
    resizeViewport();
    updateTriangleGeometry();
    updateRatios();
    await loadPublicAsset();
  }

  initialize();
})();
