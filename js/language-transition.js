const TRANSITION_DURATION = 600;
const TRANSITION_FPS = 30;
const VIEWPORT_PADDING = 80;
const EXCLUDED_TEXT_SELECTOR = '.project-source';

const segmenter = 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

function splitGraphemes(text) {
  if (segmenter) {
    return [...segmenter.segment(text)].map(item => item.segment);
  }
  return Array.from(text);
}

function createTextRecord(node) {
  return {
    node,
    text: node.nodeValue,
    characters: splitGraphemes(node.nodeValue)
  };
}

function collectTextRecords(container) {
  const records = [];
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest(EXCLUDED_TEXT_SELECTOR)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  while (walker.nextNode()) {
    records.push(createTextRecord(walker.currentNode));
  }
  return records;
}

function findLanguageContainer(parent, language) {
  return [...parent.children].find(child =>
    child.classList.contains(`lang-${language}`)
  );
}

function createLanguagePair(parent) {
  const enContainer = findLanguageContainer(parent, 'en');
  const jaContainer = findLanguageContainer(parent, 'ja');
  if (!enContainer || !jaContainer) return null;

  const enNodes = collectTextRecords(enContainer);
  const jaNodes = collectTextRecords(jaContainer);
  if (!enNodes.length || !jaNodes.length) return null;

  return {
    containers: {
      en: enContainer,
      ja: jaContainer
    },
    nodes: {
      en: enNodes,
      ja: jaNodes
    }
  };
}

function collectLanguagePairs() {
  const parents = new Set(
    [...document.querySelectorAll('.lang-en, .lang-ja')]
      .map(container => container.parentElement)
      .filter(Boolean)
  );

  return [...parents]
    .map(createLanguagePair)
    .filter(Boolean);
}

function isNearViewport(node) {
  const rect = node.parentElement.getBoundingClientRect();
  return (
    rect.bottom >= -VIEWPORT_PADDING &&
    rect.top <= window.innerHeight + VIEWPORT_PADDING
  );
}

function mapByRelativeIndex(items, index, outputLength) {
  if (!items.length) return null;

  const position = outputLength <= 1 ? 0 : index / (outputLength - 1);
  const mappedIndex = Math.min(
    items.length - 1,
    Math.floor(position * items.length)
  );
  return items[mappedIndex];
}

function codePointOf(grapheme) {
  return grapheme ? grapheme.codePointAt(0) : 0x20;
}

function isWhitespace(character) {
  return /^\s$/u.test(character);
}

function safeCodePoint(value) {
  let point = Math.round(value);
  point = Math.max(0x20, Math.min(0x10FFFF, point));

  if (point >= 0xD800 && point <= 0xDFFF) {
    point = point < 0xDC00 ? 0xD7FF : 0xE000;
  }
  return point;
}

function glyphFromCodePoint(value, fallback) {
  const point = safeCodePoint(value);

  try {
    const glyph = String.fromCodePoint(point);
    if (
      point === 0x7F ||
      (point >= 0x80 && point <= 0x9F) ||
      /\p{Cc}|\p{Cf}|\p{Cs}|\p{Co}|\p{Cn}/u.test(glyph)
    ) {
      return fallback;
    }
    return glyph;
  } catch {
    return fallback;
  }
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function deterministicPhase(sourceCode, targetCode, index, blockIndex) {
  const hash = (
    Math.imul(sourceCode + 1, 2654435761) ^
    Math.imul(targetCode + 1, 1597334677) ^
    Math.imul(index + 1, 374761393) ^
    Math.imul(blockIndex + 1, 668265263)
  ) >>> 0;

  return hash / 4294967295;
}

function createGlyphSlot(sourceCharacter, targetCharacter, index, blockIndex) {
  if (
    isWhitespace(sourceCharacter) &&
    isWhitespace(targetCharacter)
  ) {
    return { staticCharacter: ' ' };
  }

  const sourceCode = codePointOf(sourceCharacter);
  const targetCode = codePointOf(targetCharacter);

  return {
    sourceCharacter,
    targetCharacter,
    sourceCode,
    targetCode,
    phase: deterministicPhase(sourceCode, targetCode, index, blockIndex),
    direction: ((sourceCode ^ targetCode ^ index) & 1) ? 1 : -1,
    amplitude:
      180 +
      ((sourceCode + targetCode + index * 17 + blockIndex * 29) % 2600)
  };
}

function createGlyphSlots(source, target, blockIndex) {
  const outputLength = Math.max(1, source.length, target.length);
  return Array.from({ length: outputLength }, (_, index) =>
    createGlyphSlot(
      source[index] ?? ' ',
      target[index] ?? ' ',
      index,
      blockIndex
    )
  );
}

function createNodeTransition(sourceRecord, targetRecord, blockIndex) {
  return {
    sourceRecord,
    slots: createGlyphSlots(
      sourceRecord.characters,
      targetRecord.characters,
      blockIndex
    )
  };
}

function prepareTransitions(pairs, sourceLanguage, targetLanguage) {
  const transitions = [];
  const activePairs = new Set();
  let blockIndex = 0;

  pairs.forEach(pair => {
    const sourceNodes = pair.nodes[sourceLanguage];
    const targetNodes = pair.nodes[targetLanguage];

    sourceNodes.forEach((sourceRecord, sourceIndex) => {
      const targetRecord = mapByRelativeIndex(
        targetNodes,
        sourceIndex,
        sourceNodes.length
      );

      if (targetRecord && isNearViewport(sourceRecord.node)) {
        transitions.push(
          createNodeTransition(sourceRecord, targetRecord, blockIndex)
        );
        activePairs.add(pair);
      }
      blockIndex++;
    });
  });

  return {
    transitions,
    activePairs: [...activePairs]
  };
}

function renderGlyphSlot(slot, progress) {
  if (slot.staticCharacter !== undefined) return slot.staticCharacter;

  const localProgress = Math.max(
    0,
    Math.min(1, (progress - slot.phase * 0.38) / 0.62)
  );

  if (localProgress <= 0) return slot.sourceCharacter;
  if (localProgress >= 1) return slot.targetCharacter;

  const eased = easeInOutCubic(localProgress);
  const currentCode =
    slot.sourceCode +
    (slot.targetCode - slot.sourceCode) * eased +
    Math.sin(Math.PI * eased) * slot.amplitude * slot.direction;
  const fallback =
    eased < 0.5 ? slot.sourceCharacter : slot.targetCharacter;

  return glyphFromCodePoint(currentCode, fallback);
}

function renderTransitions(transitions, progress) {
  transitions.forEach(({ sourceRecord, slots }) => {
    sourceRecord.node.nodeValue = slots
      .map(slot => renderGlyphSlot(slot, progress))
      .join('');
  });
}

function createLayoutLock(pair, sourceLanguage) {
  const container = pair.containers[sourceLanguage];
  const previous = {
    height: container.style.height,
    overflow: container.style.overflow
  };

  container.style.height = 'auto';
  container.style.overflow = 'hidden';
  container.style.height = `${container.scrollHeight}px`;

  return {
    beginMeasurement() {
      container.style.height = 'auto';
    },
    measure() {
      return container.scrollHeight;
    },
    apply(height) {
      container.style.height = `${height}px`;
    },
    release() {
      container.style.height = previous.height;
      container.style.overflow = previous.overflow;
    }
  };
}

function synchronizeLayoutHeights(layoutLocks) {
  layoutLocks.forEach(lock => lock.beginMeasurement());
  const heights = layoutLocks.map(lock => lock.measure());
  layoutLocks.forEach((lock, index) => lock.apply(heights[index]));
}

function restoreTransitionText(transitions) {
  transitions.forEach(({ sourceRecord }) => {
    sourceRecord.node.nodeValue = sourceRecord.text;
  });
}

function disableScrollAnchoring() {
  const previous = {
    root: document.documentElement.style.overflowAnchor,
    body: document.body.style.overflowAnchor
  };

  document.documentElement.style.overflowAnchor = 'none';
  document.body.style.overflowAnchor = 'none';

  return () => {
    document.documentElement.style.overflowAnchor = previous.root;
    document.body.style.overflowAnchor = previous.body;
  };
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

async function preserveAnchorPosition(anchor, top) {
  if (!anchor || top === null) return;

  await nextFrame();
  const positionDelta = anchor.getBoundingClientRect().top - top;
  if (Math.abs(positionDelta) >= 0.5) {
    window.scrollBy(0, positionDelta);
  }
}

function animate(update) {
  return new Promise(resolve => {
    const start = performance.now();
    const frameInterval = 1000 / TRANSITION_FPS;
    let lastFrameTime = start - frameInterval;

    function frame(now) {
      const progress = Math.min(
        1,
        (now - start) / TRANSITION_DURATION
      );

      if (now - lastFrameTime >= frameInterval || progress >= 1) {
        lastFrameTime = now;
        update(progress);
      }

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(frame);
  });
}

export function createLanguageTransition() {
  const pairs = collectLanguagePairs();
  if (!pairs.length) return null;

  async function run(sourceLanguage, targetLanguage, commitLanguage) {
    const { transitions, activePairs } = prepareTransitions(
      pairs,
      sourceLanguage,
      targetLanguage
    );

    if (!transitions.length) {
      commitLanguage();
      return;
    }

    const layoutLocks = activePairs.map(pair =>
      createLayoutLock(pair, sourceLanguage)
    );
    const anchor = document.querySelector('.lang-buttons');
    const restoreScrollAnchoring = disableScrollAnchoring();
    let anchorTopBeforeCommit = null;

    try {
      await animate(progress => {
        renderTransitions(transitions, progress);
        synchronizeLayoutHeights(layoutLocks);
      });
      anchorTopBeforeCommit = anchor?.getBoundingClientRect().top ?? null;
      commitLanguage();
    } finally {
      restoreTransitionText(transitions);
      layoutLocks.forEach(lock => lock.release());
      void document.documentElement.offsetHeight;
      try {
        await preserveAnchorPosition(anchor, anchorTopBeforeCommit);
      } finally {
        restoreScrollAnchoring();
      }
    }
  }

  return { run };
}
