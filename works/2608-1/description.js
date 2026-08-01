    const integratedMode = Boolean(document.querySelector("#project-title"));

    function readLanguage() {
      if (integratedMode) {
        return document.documentElement.lang === "ja" ? "ja" : "en";
      }

      const requestedLanguage = new URLSearchParams(location.search).get("lang");
      if (requestedLanguage === "ja" || requestedLanguage === "en") {
        return requestedLanguage;
      }

      try {
        return localStorage.getItem("preferredLanguage") === "ja" ? "ja" : "en";
      } catch {
        return "en";
      }
    }

    const currentLanguage = readLanguage();
    const isJapanese = currentLanguage === "ja";
    document.documentElement.lang = currentLanguage;

    const titleElement = integratedMode
      ? document.querySelector("#project-title")
      : document.querySelector("#title");
    const descriptionRoot = integratedMode
      ? document.querySelector("#project-desc")
      : document.querySelector("#description");
    const description = integratedMode
      ? descriptionRoot?.querySelector(`.project-desc-lang.lang-${currentLanguage}`)
      : descriptionRoot;

    if (!titleElement || !description) {
      throw new Error("DESCRIPTION mount elements are missing.");
    }
    descriptionRoot.setAttribute("aria-live", "off");

    if (integratedMode) {
      document.body.classList.add("work-description-active");
      const stylesheetUrl = new URL("./description.css", import.meta.url).href;
      if (!document.querySelector(`link[href="${stylesheetUrl}"]`)) {
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = stylesheetUrl;
        document.head.append(stylesheet);
      }
    }

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const SOURCES_MANIFEST_URL = new URL(
      `./data/${currentLanguage}/manifest.json`,
      import.meta.url
    );
    const LOAD_ERROR_MESSAGE = "DESCRIPTION DATA COULD NOT BE LOADED.";
    const TITLE_DATABASE_PROBABILITY = 0.7;
    const TITLE_CORPUS_SEPARATOR = "\u0002";
    const TITLE_LENGTH_CLASSES = [
      "title-short",
      "title-medium",
      "title-long",
      "title-very-long"
    ];
    const INITIAL_TITLE_ENTRY = Object.freeze({
      id: "system_title_initial",
      text: "DESCRIPTION",
      sourceId: "system",
      sourceLabel: "System"
    });
    const CATEGORY_ORDER = [
      "overview",
      "editing",
      "implementation",
      "mutation",
      "viewing"
    ];

    const graphemeSegmenter = "Segmenter" in Intl
      ? new Intl.Segmenter(currentLanguage, { granularity: "grapheme" })
      : null;
    const wordSegmenter = "Segmenter" in Intl
      ? new Intl.Segmenter(currentLanguage, { granularity: "word" })
      : null;
    const sentenceSegmenter = "Segmenter" in Intl
      ? new Intl.Segmenter(currentLanguage, { granularity: "sentence" })
      : null;

    let paragraphs = [];
    let sentencePool = [];
    let phrasePool = [];
    let titlePool = [];
    let titlePhrasePool = [];
    let staticCorpus = "";
    let staticTitleCorpus = "";
    let currentTitleEntry = { ...INITIAL_TITLE_ENTRY };
    let rewriteCount = 0;
    let sentenceSequence = 0;
    let titleSequence = 0;
    let titleUpdateCount = 0;
    let lastSentenceId = null;
    let lastBodyDraftPhrase = null;
    let lastTitleDraftPhrase = null;
    let activeEdit = null;

    // Shared utilities
    function choose(array) {
      return array[Math.floor(Math.random() * array.length)];
    }

    function wait(milliseconds) {
      return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    function isNonEmptyString(value) {
      return typeof value === "string" && Boolean(value.trim());
    }

    function randomInsertionIndex(array) {
      return Math.floor(Math.random() * (array.length + 1));
    }

    function syncDataset(element, values) {
      for (const [key, value] of Object.entries(values)) {
        if (value === null || value === undefined || value === "") {
          delete element.dataset[key];
        } else {
          element.dataset[key] = value;
        }
      }
    }

    function recordBodyMutation(sentenceId = null) {
      rewriteCount += 1;
      lastSentenceId = sentenceId;
    }

    async function runExclusiveEdit(context, edit) {
      if (document.hidden) return "hidden";
      if (activeEdit) return "busy";

      activeEdit = context;
      try {
        return await edit();
      } finally {
        activeEdit = null;
      }
    }

    function splitSentences(paragraph) {
      if (sentenceSegmenter) {
        return [...sentenceSegmenter.segment(paragraph)]
          .map(item => item.segment.trim())
          .filter(Boolean);
      }

      const fallbackPattern = isJapanese
        ? /[^。！？]+[。！？]?/gu
        : /[^.!?]+[.!?]?/gu;
      return paragraph.match(fallbackPattern)
        ?.map(sentence => sentence.trim())
        .filter(Boolean) || [];
    }

    function splitGraphemes(text) {
      return graphemeSegmenter
        ? [...graphemeSegmenter.segment(text)].map(item => item.segment)
        : Array.from(text);
    }

    function tokenize(text) {
      if (wordSegmenter) {
        const segments = [...wordSegmenter.segment(text)]
          .map(item => item.segment);
        return isJapanese
          ? segments.filter(token => token.trim() || isPunctuation(token))
          : segments.filter(Boolean);
      }

      return isJapanese
        ? text.match(/[一-龠々〆ヵヶぁ-んァ-ヶーA-Za-z0-9]+|[。、，．！？]/gu) || []
        : text.match(/[A-Za-z0-9'’]+|\s+|[.,!?;:]/gu) || [];
    }

    function isPunctuation(text) {
      return isJapanese
        ? /^[。、，．！？]$/u.test(text)
        : /^[.,!?;:]$/u.test(text);
    }

    function isSentenceEnd(text) {
      return isJapanese
        ? /^[。！？]$/u.test(text)
        : /^[.!?]$/u.test(text);
    }

    function removeTrailingSentenceEnd(text) {
      return isJapanese
        ? text.replace(/[。！？]+$/u, "")
        : text.replace(/[.!?]+$/u, "");
    }

    function trailingSentenceEnd(text) {
      return isJapanese
        ? text.match(/[。！？]+$/u)?.[0] || ""
        : text.match(/[.!?]+$/u)?.[0] || "";
    }

    function makeSentence(text, category, entry) {
      const trimmed = text.trim();
      if (!trimmed) throw new Error(`No sentence text for category: ${category}`);
      const sentence = {
        id: `sentence-${sentenceSequence}`,
        category,
        originCategory: category,
        sourceId: entry.sourceId,
        entryId: entry.id,
        text: trimmed
      };
      sentenceSequence += 1;
      return sentence;
    }

    // Content loading and normalization
    function validateManifest(manifest) {
      if (!manifest || typeof manifest !== "object") {
        throw new Error("Sources manifest must be an object.");
      }
      if (!Number.isInteger(manifest.version) || manifest.version < 1) {
        throw new Error("Sources manifest version is invalid.");
      }
      if (manifest.language !== currentLanguage) {
        throw new Error("Sources manifest language does not match the page.");
      }
      if (
        !Array.isArray(manifest.sources) ||
        !manifest.sources.length ||
        !manifest.sources.every(isNonEmptyString)
      ) {
        throw new Error("Sources manifest entries are invalid.");
      }
      if (new Set(manifest.sources).size !== manifest.sources.length) {
        throw new Error("Sources manifest contains duplicate entries.");
      }
    }

    function validateEntry(entry, invalidMessage) {
      if (
        !entry ||
        typeof entry !== "object" ||
        !isNonEmptyString(entry.id) ||
        !isNonEmptyString(entry.text)
      ) {
        throw new Error(invalidMessage);
      }
    }

    function registerEntryId(entryIds, entry, duplicateLabel) {
      if (entryIds.has(entry.id)) {
        throw new Error(`${duplicateLabel}: ${entry.id}`);
      }
      entryIds.add(entry.id);
    }

    function validateContent(content) {
      if (!content || typeof content !== "object") {
        throw new Error("Content root must be an object.");
      }
      if (content.version !== 2) {
        throw new Error("Content version is invalid.");
      }
      if (
        !content.source ||
        typeof content.source !== "object" ||
        !isNonEmptyString(content.source.id) ||
        !isNonEmptyString(content.source.label)
      ) {
        throw new Error("Content source metadata is invalid.");
      }
      if (!content.categories || typeof content.categories !== "object") {
        throw new Error("Content categories are missing.");
      }

      const entryIds = new Set();
      if (!Array.isArray(content.titles) || !content.titles.length) {
        throw new Error("Titles are missing or empty.");
      }
      for (const entry of content.titles) {
        validateEntry(entry, "Title entry is invalid.");
        registerEntryId(entryIds, entry, "Duplicate title ID");
      }

      for (const category of CATEGORY_ORDER) {
        const entries = content.categories[category];
        if (!Array.isArray(entries)) {
          throw new Error(`Missing category: ${category}`);
        }
        if (!entries.length) {
          throw new Error(`Category is empty: ${category}`);
        }
        for (const entry of entries) {
          validateEntry(
            entry,
            `Category contains an invalid entry: ${category}`
          );
          registerEntryId(entryIds, entry, "Duplicate entry ID");
        }
      }
    }

    async function fetchJson(url, label) {
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`${label} request failed: ${response.status}`);
      }
      return response.json();
    }

    async function loadContentSource(sourceUrl) {
      const content = await fetchJson(sourceUrl, "Content");
      validateContent(content);
      return content;
    }

    async function loadContent() {
      const manifestUrl = SOURCES_MANIFEST_URL;
      const manifest = await fetchJson(manifestUrl, "Sources manifest");
      validateManifest(manifest);
      const sourceUrls = manifest.sources.map(source =>
        new URL(source, manifestUrl)
      );
      const results = await Promise.allSettled(
        sourceUrls.map(loadContentSource)
      );
      const contents = [];

      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          contents.push(result.value);
        } else {
          console.error(
            `Content source could not be loaded: ${sourceUrls[index]}`,
            result.reason
          );
        }
      });

      if (!contents.length) {
        throw new Error("No content source could be loaded.");
      }
      return contents;
    }

    function composeInitialParagraphs(entriesByCategory) {
      sentenceSequence = 0;
      return CATEGORY_ORDER.map(category => {
        const entry = choose(entriesByCategory[category]);
        const sentenceTexts = splitSentences(entry.text);
        if (!sentenceTexts.length) {
          throw new Error(`Sentence segmentation failed: ${category}`);
        }
        return {
          category,
          sentences: sentenceTexts.map(sentence =>
            makeSentence(sentence, category, entry)
          )
        };
      });
    }

    function initializeContent(contents) {
      const sourceIds = new Set();
      const entryIds = new Set();
      const nextTitlePool = [];
      const entriesByCategory = Object.fromEntries(
        CATEGORY_ORDER.map(category => [category, []])
      );

      for (const content of contents) {
        if (sourceIds.has(content.source.id)) {
          throw new Error(`Duplicate source ID: ${content.source.id}`);
        }
        sourceIds.add(content.source.id);

        for (const entry of content.titles) {
          registerEntryId(
            entryIds,
            entry,
            "Duplicate entry ID across sources"
          );
          nextTitlePool.push({
            id: entry.id,
            text: entry.text.trim(),
            sourceId: content.source.id,
            sourceLabel: content.source.label
          });
        }

        for (const category of CATEGORY_ORDER) {
          for (const entry of content.categories[category]) {
            registerEntryId(
              entryIds,
              entry,
              "Duplicate entry ID across sources"
            );
            entriesByCategory[category].push({
              id: entry.id,
              text: entry.text.trim(),
              sourceId: content.source.id,
              category
            });
          }
        }
      }

      const allEntries = CATEGORY_ORDER.flatMap(
        category => entriesByCategory[category]
      );
      if (!allEntries.length) {
        throw new Error("Static corpus is empty.");
      }
      if (!nextTitlePool.length) {
        throw new Error("Title pool is empty.");
      }

      sentencePool = allEntries.flatMap(entry =>
        splitSentences(entry.text).map(text => ({
          text,
          sourceId: entry.sourceId,
          category: entry.category,
          entryId: entry.id
        }))
      );
      if (!sentencePool.length) {
        throw new Error("Sentence pool is empty.");
      }
      phrasePool = buildPhrasePool(allEntries);

      paragraphs = composeInitialParagraphs(entriesByCategory);
      staticCorpus = allEntries
        .map(entry => entry.text)
        .join(isJapanese ? "" : " ");
      titlePool = nextTitlePool;
      titlePhrasePool = buildPhrasePool(
        titlePool.map(entry => ({ ...entry, category: "title" })),
        {
          maxWords: 3,
          minLength: 2,
          maxLength: 20,
          maxPerEntry: 48
        }
      );
      staticTitleCorpus = titlePool
        .map(entry => entry.text)
        .join(TITLE_CORPUS_SEPARATOR);
      currentTitleEntry = { ...INITIAL_TITLE_ENTRY };
      lastBodyDraftPhrase = null;
      lastTitleDraftPhrase = null;
      titleSequence = 0;
      titleUpdateCount = 0;
    }

    // Document model and rendering
    function allSentences() {
      return paragraphs.flatMap(paragraph => paragraph.sentences);
    }

    function currentDocumentText() {
      return allSentences()
        .map(sentence => sentence.text)
        .join(isJapanese ? "" : " ");
    }

    function findSentence(sentenceId) {
      for (const paragraph of paragraphs) {
        const sentenceIndex = paragraph.sentences
          .findIndex(sentence => sentence.id === sentenceId);
        if (sentenceIndex >= 0) {
          return {
            paragraph,
            sentence: paragraph.sentences[sentenceIndex]
          };
        }
      }
      return null;
    }

    function sentenceElement(sentenceId) {
      return description.querySelector(
        `[data-sentence-id="${sentenceId}"]`
      );
    }

    function syncSentenceDataset(element, sentence) {
      syncDataset(element, {
        sentenceId: sentence.id,
        category: sentence.category,
        originCategory: sentence.originCategory,
        sourceId: sentence.sourceId,
        entryId: sentence.entryId
      });
    }

    function createSentenceElement(sentence) {
      const element = document.createElement("span");
      element.className = "sentence";
      element.textContent = sentence.text;
      syncSentenceDataset(element, sentence);
      return element;
    }

    function renderDocument() {
      description.replaceChildren();

      for (const paragraphData of paragraphs) {
        const paragraphElement = document.createElement("p");
        paragraphElement.className = "paragraph";
        paragraphElement.dataset.category = paragraphData.category;

        for (const sentence of paragraphData.sentences) {
          paragraphElement.append(createSentenceElement(sentence));
        }

        description.append(paragraphElement);
      }
    }

    // Text generation
    function buildMarkov(tokens, order = 2) {
      const chain = new Map();
      for (let index = 0; index <= tokens.length - order - 1; index++) {
        const key = tokens.slice(index, index + order).join("\u0001");
        const next = tokens[index + order];
        if (!chain.has(key)) chain.set(key, []);
        chain.get(key).push(next);
      }
      return chain;
    }

    function chooseRecoverySentence() {
      if (!sentencePool.length) {
        throw new Error("No recovery sentence is available.");
      }
      return { ...choose(sentencePool) };
    }

    function generateMarkovSentence() {
      const dynamicCorpus = currentDocumentText();
      const tokens = tokenize(
        `${staticCorpus}${isJapanese ? "" : " "}${dynamicCorpus}`
      );
      const order = rewriteCount < 5 ? 3 : rewriteCount < 14 ? 2 : 1;
      const chain = buildMarkov(tokens, order);
      const keys = [...chain.keys()];

      if (!keys.length) {
        console.error("Markov model could not be generated.");
        return null;
      }

      const preferredKeys = keys.filter(key => {
        const first = key.split("\u0001")[0];
        return !isPunctuation(first);
      });
      let current = choose(preferredKeys.length ? preferredKeys : keys)
        .split("\u0001");
      const result = [...current];
      const targetLength = 26 + Math.floor(Math.random() * 35);

      for (let index = 0; index < targetLength; index++) {
        const key = current.slice(-order).join("\u0001");
        const options = chain.get(key);
        if (!options?.length) break;

        let next = choose(options);
        const recent = result.slice(-4);
        if (recent.filter(token => token === next).length >= 2) {
          const alternatives = options.filter(token => token !== next);
          if (alternatives.length) next = choose(alternatives);
        }

        result.push(next);
        current.push(next);
        if (isSentenceEnd(next) && result.length >= 14) break;
      }

      let text = result.join("");
      text = isJapanese
        ? text
            .replace(/\s+/g, "")
            .replace(/^[。、，．！？]+/u, "")
            .replace(/[。、，．！？]{2,}/gu, "。")
            .trim()
        : text
            .replace(/\s+/g, " ")
            .replace(/\s+([.,!?;:])/gu, "$1")
            .replace(/^[.,!?;:\s]+/u, "")
            .replace(/([.!?]){2,}/gu, "$1")
            .trim();

      if (!isSentenceEnd(text.slice(-1))) text += isJapanese ? "。" : ".";
      if (text.length < 18 || text.length > 150) return null;
      return text;
    }

    function chooseBodyMaterial() {
      if (Math.random() < 0.18) return chooseRecoverySentence();

      const generatedText = generateMarkovSentence();
      return generatedText
        ? {
            text: generatedText,
            sourceId: null,
            entryId: null,
            category: null
          }
        : chooseRecoverySentence();
    }

    function chooseSentenceId() {
      const candidates = allSentences();
      const lastIndex = candidates.findIndex(
        sentence => sentence.id === lastSentenceId
      );
      const weights = candidates.map((sentence, index) => {
        const distance = lastIndex < 0 ? 1 : Math.abs(index - lastIndex);
        return sentence.id === lastSentenceId
          ? 0.04
          : 1 + Math.min(distance, 4) * 0.18;
      });
      const total = weights.reduce((sum, value) => sum + value, 0);
      let cursor = Math.random() * total;

      for (let index = 0; index < weights.length; index++) {
        cursor -= weights[index];
        if (cursor <= 0) return candidates[index].id;
      }
      return candidates[0]?.id || null;
    }

    // Editing animation
    function setEditorText(element, text, showCaret = false) {
      element.replaceChildren(document.createTextNode(text));
      if (showCaret) {
        const caret = document.createElement("span");
        caret.className = "editor-caret";
        caret.setAttribute("aria-hidden", "true");
        element.append(caret);
      }
    }

    async function typeText(element, text) {
      const graphemes = splitGraphemes(text);
      let visible = "";

      for (let index = 0; index < graphemes.length; index++) {
        visible += graphemes[index];
        setEditorText(element, visible, true);

        const character = graphemes[index];
        const punctuationPause = isPunctuation(character) ? 58 : 0;
        const whitespacePause = /\s/u.test(character) ? 32 : 0;
        const burstPause =
          index > 0 && index % (5 + Math.floor(Math.random() * 6)) === 0
            ? 24 + Math.random() * 52
            : 0;
        await wait(
          8 + Math.random() * 18 + punctuationPause + whitespacePause + burstPause
        );

        if (
          index > 2 &&
          index < graphemes.length - 2 &&
          Math.random() < 0.018
        ) {
          visible = await maybeTypeCorrection(
            element,
            visible,
            graphemes.slice(index + 1).join("")
          );
        }
      }
    }

    function splitWordsForDeletion(text) {
      if (wordSegmenter) {
        return [...wordSegmenter.segment(text)].map(item => item.segment);
      }
      return text.match(
        /[一-龠々〆ヵヶぁ-んァ-ヶーA-Za-z0-9]+|[^一-龠々〆ヵヶぁ-んァ-ヶーA-Za-z0-9]/gu
      ) || splitGraphemes(text);
    }

    function isWordUnit(unit) {
      return /[一-龠々〆ヵヶぁ-んァ-ヶーA-Za-z0-9]/u.test(unit);
    }

    function wordUnitIndexes(units) {
      return units.flatMap((unit, index) => isWordUnit(unit) ? [index] : []);
    }

    function wordUnitRange(units, indexes, startPosition, wordCount) {
      const start = indexes[startPosition];
      const lastWord = indexes[startPosition + wordCount - 1];
      if (start === undefined || lastWord === undefined) return null;

      let end = lastWord + 1;
      while (
        end < units.length &&
        !isWordUnit(units[end]) &&
        !isSentenceEnd(units[end])
      ) {
        end += 1;
      }
      return { start, end };
    }

    function cleanDraftPhrase(text) {
      const trimmed = text.trim();
      return isJapanese
        ? trimmed.replace(/^[、，。！？\s]+|[、，。！？\s]+$/gu, "")
        : trimmed.replace(/^[,.;:!?\s]+|[,.;:!?\s]+$/gu, "");
    }

    function buildPhrasePool(entries, options = {}) {
      const {
        maxWords = 4,
        minLength = 3,
        maxLength = 24,
        maxPerEntry = 64
      } = options;
      const phrases = [];
      const seen = new Set();

      for (const entry of entries) {
        const units = splitWordsForDeletion(entry.text);
        const wordIndexes = wordUnitIndexes(units);
        let entryCount = 0;

        for (
          let start = 0;
          start < wordIndexes.length && entryCount < maxPerEntry;
          start++
        ) {
          const countLimit = Math.min(
            maxWords,
            wordIndexes.length - start
          );
          for (let count = 1; count <= countLimit; count++) {
            const range = wordUnitRange(units, wordIndexes, start, count);
            if (!range) continue;
            const text = cleanDraftPhrase(
              units.slice(range.start, range.end).join("")
            );
            const key = `${entry.sourceId}|${entry.id}|${text}`;
            if (
              text.length >= minLength &&
              text.length <= maxLength &&
              !seen.has(key)
            ) {
              seen.add(key);
              phrases.push({
                text,
                sourceId: entry.sourceId,
                entryId: entry.id,
                category: entry.category
              });
              entryCount += 1;
            }
          }
        }
      }
      return phrases;
    }

    function extractPhraseFromText(text, options = {}) {
      const {
        maxWords = 4,
        minLength = 3,
        maxLength = 24
      } = options;
      const units = splitWordsForDeletion(text);
      const wordIndexes = wordUnitIndexes(units);
      if (!wordIndexes.length) return null;

      const startPosition = Math.floor(Math.random() * wordIndexes.length);
      const count = Math.min(
        1 + Math.floor(Math.random() * maxWords),
        wordIndexes.length - startPosition
      );
      const range = wordUnitRange(units, wordIndexes, startPosition, count);
      if (!range) return null;
      const phrase = cleanDraftPhrase(
        units.slice(range.start, range.end).join("")
      );
      return phrase.length >= minLength && phrase.length <= maxLength
        ? phrase
        : null;
    }

    function isUsableDraftPhrase(phrase, nextText, lastPhrase) {
      const text = phrase?.trim();
      if (!text || text === lastPhrase || nextText.includes(text)) return false;
      if (!/[一-龠々〆ヵヶぁ-んァ-ヶーA-Za-z0-9]/u.test(text)) {
        return false;
      }
      if (/(.{1,6})\1{3,}/u.test(text)) return false;
      return true;
    }

    function findDraftPhrase(nextText, lastPhrase, options) {
      const {
        pool,
        getDynamicText,
        dynamicProbability,
        extractOptions
      } = options;

      for (let attempt = 0; attempt < 8; attempt++) {
        let phrase = null;
        const dynamicText = getDynamicText?.();
        if (dynamicText && Math.random() < dynamicProbability) {
          phrase = extractPhraseFromText(dynamicText, extractOptions);
        }
        if (!phrase && pool.length) phrase = choose(pool).text;
        if (isUsableDraftPhrase(phrase, nextText, lastPhrase)) return phrase;
      }
      return null;
    }

    function chooseBodyDraftPhrase(nextText = "") {
      const phrase = findDraftPhrase(nextText, lastBodyDraftPhrase, {
        pool: phrasePool,
        getDynamicText: currentDocumentText,
        dynamicProbability: 0.65
      });
      if (phrase) {
        lastBodyDraftPhrase = phrase;
      }
      return phrase;
    }

    function chooseTitleDraftPhrase(nextText = "") {
      const phrase = findDraftPhrase(nextText, lastTitleDraftPhrase, {
        pool: titlePhrasePool,
        getDynamicText: () => currentTitleEntry?.text,
        dynamicProbability: 0.60,
        extractOptions: {
          maxWords: 3,
          minLength: 2,
          maxLength: 20
        }
      });
      if (phrase) {
        lastTitleDraftPhrase = phrase;
      }
      return phrase;
    }

    function chooseWordMutation(previousText, sourceText) {
      const previousUnits = splitWordsForDeletion(previousText);
      const sourceUnits = splitWordsForDeletion(sourceText);
      const previousWordIndexes = wordUnitIndexes(previousUnits);
      const sourceWordIndexes = wordUnitIndexes(sourceUnits);

      if (!previousWordIndexes.length || !sourceWordIndexes.length) return null;

      const startWordPosition = Math.floor(
        Math.random() * previousWordIndexes.length
      );
      const wordCount = Math.min(
        1 + Math.floor(Math.random() * 4),
        previousWordIndexes.length - startWordPosition
      );
      const previousRange = wordUnitRange(
        previousUnits,
        previousWordIndexes,
        startWordPosition,
        wordCount
      );

      const sourceStartPosition = Math.floor(
        Math.random() * sourceWordIndexes.length
      );
      const sourceCount = Math.min(
        Math.max(1, wordCount + Math.floor(Math.random() * 3) - 1),
        sourceWordIndexes.length - sourceStartPosition
      );
      const sourceRange = wordUnitRange(
        sourceUnits,
        sourceWordIndexes,
        sourceStartPosition,
        sourceCount
      );
      if (!previousRange || !sourceRange) return null;

      const prefix = previousUnits.slice(0, previousRange.start).join("");
      const selected = previousUnits
        .slice(previousRange.start, previousRange.end)
        .join("");
      let replacement = sourceUnits
        .slice(sourceRange.start, sourceRange.end)
        .join("");
      replacement = removeTrailingSentenceEnd(replacement);
      const suffix = previousUnits.slice(previousRange.end).join("");

      if (!replacement.trim() || replacement === selected) return null;
      return {
        prefix,
        selected,
        replacement,
        suffix,
        finalText: `${prefix}${replacement}${suffix}`
      };
    }

    async function maybeTypeCorrection(element, visible, remainingText) {
      if (!remainingText || Math.random() >= 0.08) return visible;
      const wrong = choose(
        isJapanese
          ? ["の", "を", "に", "と", "は", "が"]
          : ["a", "e", "i", "o", "s", "t"]
      );
      setEditorText(element, visible + wrong, true);
      await wait(70 + Math.random() * 105);
      setEditorText(element, visible, true);
      await wait(55 + Math.random() * 90);
      return visible;
    }

    async function backspaceAndType(element, previousText, nextText) {
      const units = splitWordsForDeletion(previousText);
      for (let length = units.length; length >= 0; length--) {
        setEditorText(element, units.slice(0, length).join(""), true);
        const removed = units[length - 1] || "";
        await wait(
          isPunctuation(removed) ? 55 : 20 + Math.random() * 34
        );
      }
      await wait(120 + Math.random() * 150);
      await typeText(element, nextText);
    }

    async function animateSelectionOnly(element, text) {
      const characters = splitGraphemes(text).map(character => {
        const span = document.createElement("span");
        span.className = "editor-selection-character";
        span.textContent = character;
        return span;
      });
      element.replaceChildren(...characters);

      const order = Math.random() < 0.5
        ? characters
        : [...characters].reverse();
      const step = Math.max(2, Math.min(10, 220 / Math.max(order.length, 1)));

      for (let index = 0; index < order.length; index++) {
        order[index].classList.add("is-selected");
        if (index % 2 === 0 || index === order.length - 1) {
          await wait(step + Math.random() * 5);
        }
      }
    }

    async function selectDeleteAndType(element, previousText, nextText) {
      await animateSelectionOnly(element, previousText);
      await wait(140 + Math.random() * 170);
      setEditorText(element, "", true);
      await wait(95 + Math.random() * 140);
      await typeText(element, nextText);
    }

    async function typeThenEraseAndCorrect(
      element,
      previousText,
      nextText,
      chooseDraftPhrase
    ) {
      const phrase = chooseDraftPhrase?.(nextText);
      if (!phrase) {
        if (Math.random() < 0.5) {
          await selectDeleteAndType(element, previousText, nextText);
        } else {
          await backspaceAndType(element, previousText, nextText);
        }
        return;
      }

      const punctuation = trailingSentenceEnd(nextText);
      const cleanNext = punctuation
        ? nextText.slice(0, -punctuation.length)
        : nextText;
      const connector = choose(
        isJapanese
          ? ["", "、", " ", "という", "として", "によって"]
          : ["", ", ", " ", " as ", " through ", " because "]
      );
      const draftText = `${cleanNext}${connector}${phrase}${punctuation}`;

      if (draftText === nextText) {
        await backspaceAndType(element, previousText, nextText);
        return;
      }

      if (Math.random() < 0.5) {
        await selectDeleteAndType(element, previousText, draftText);
      } else {
        await backspaceAndType(element, previousText, draftText);
      }

      await wait(190 + Math.random() * 260);
      const draftGraphemes = splitGraphemes(draftText);
      const correctGraphemes = splitGraphemes(nextText);
      let commonLength = 0;

      while (
        commonLength < draftGraphemes.length &&
        commonLength < correctGraphemes.length &&
        draftGraphemes[commonLength] === correctGraphemes[commonLength]
      ) {
        commonLength += 1;
      }

      for (
        let length = draftGraphemes.length;
        length >= commonLength;
        length--
      ) {
        setEditorText(
          element,
          draftGraphemes.slice(0, length).join(""),
          true
        );
        await wait(8 + Math.random() * 16);
      }

      await wait(90 + Math.random() * 130);
      let visible = correctGraphemes.slice(0, commonLength).join("");
      for (const character of correctGraphemes.slice(commonLength)) {
        visible += character;
        setEditorText(element, visible, true);
        await wait(
          9 + Math.random() * 19 +
          (isPunctuation(character) ? 55 : 0)
        );
      }
    }

    function chooseEditMode() {
      const random = Math.random();
      if (random < 0.42) return "selection";
      if (random < 0.78) return "backspace";
      return "revision";
    }

    async function applyTextEdit(
      element,
      previousText,
      nextText,
      context = "body"
    ) {
      if (reducedMotion.matches) {
        element.textContent = nextText;
        return;
      }

      const mode = chooseEditMode();
      if (mode === "selection") {
        await selectDeleteAndType(element, previousText, nextText);
      } else if (mode === "backspace") {
        await backspaceAndType(element, previousText, nextText);
      } else {
        const chooseDraftPhrase = context === "title"
          ? chooseTitleDraftPhrase
          : chooseBodyDraftPhrase;
        await typeThenEraseAndCorrect(
          element,
          previousText,
          nextText,
          chooseDraftPhrase
        );
      }
    }

    // Body mutations
    async function rewriteWordRange(sentenceId, sourceText) {
      const location = findSentence(sentenceId);
      const element = sentenceElement(sentenceId);
      if (!location || !element) return false;

      const mutation = chooseWordMutation(location.sentence.text, sourceText);
      if (!mutation) return false;

      element.classList.add("is-rewriting");
      const prefixNode = document.createTextNode(mutation.prefix);
      const editable = document.createElement("span");
      editable.textContent = mutation.selected;
      const suffixNode = document.createTextNode(mutation.suffix);
      element.replaceChildren(prefixNode, editable, suffixNode);

      await applyTextEdit(
        editable,
        mutation.selected,
        mutation.replacement,
        "body"
      );

      location.sentence.text = mutation.finalText;
      element.textContent = mutation.finalText;
      element.classList.remove("is-rewriting");
      recordBodyMutation(sentenceId);
      return true;
    }

    async function rewriteSentence(sentenceId, material) {
      const location = findSentence(sentenceId);
      const element = sentenceElement(sentenceId);
      if (!location || !element || location.sentence.text === material.text) {
        return false;
      }

      const previousText = location.sentence.text;
      element.classList.add("is-rewriting");
      await applyTextEdit(element, previousText, material.text, "body");
      location.sentence.text = material.text;
      location.sentence.sourceId = material.sourceId;
      location.sentence.entryId = material.entryId;
      location.sentence.originCategory = material.category;
      element.textContent = material.text;
      syncSentenceDataset(element, location.sentence);
      element.classList.remove("is-rewriting");
      recordBodyMutation(sentenceId);
      return true;
    }

    async function moveSentenceByCutPaste() {
      const sourceParagraphs = paragraphs.filter(
        paragraph => paragraph.sentences.length > 1
      );
      if (!sourceParagraphs.length || paragraphs.length < 2) return false;

      const sourceParagraph = choose(sourceParagraphs);
      const sourceSentence = choose(sourceParagraph.sentences);
      const sourceElement = sentenceElement(sourceSentence.id);
      const targetParagraph = choose(
        paragraphs.filter(paragraph => paragraph !== sourceParagraph)
      );
      if (!sourceElement || !targetParagraph) return false;

      const movedText = sourceSentence.text;
      sourceElement.classList.add("is-rewriting");

      if (!reducedMotion.matches) {
        await animateSelectionOnly(sourceElement, movedText);
        await wait(120 + Math.random() * 140);
        setEditorText(sourceElement, "", true);
        await wait(105 + Math.random() * 125);
      }

      const sourceIndex = sourceParagraph.sentences.findIndex(
        sentence => sentence.id === sourceSentence.id
      );
      sourceParagraph.sentences.splice(sourceIndex, 1);
      sourceSentence.category = targetParagraph.category;
      sourceSentence.text = "";
      const insertionIndex = randomInsertionIndex(targetParagraph.sentences);
      targetParagraph.sentences.splice(insertionIndex, 0, sourceSentence);
      renderDocument();

      const pastedElement = sentenceElement(sourceSentence.id);
      if (!pastedElement) throw new Error("Paste target is missing.");

      if (reducedMotion.matches) {
        sourceSentence.text = movedText;
        pastedElement.textContent = movedText;
      } else {
        setEditorText(pastedElement, "", true);
        await wait(105 + Math.random() * 135);
        sourceSentence.text = movedText;
        pastedElement.textContent = movedText;
        await animateSelectionOnly(pastedElement, movedText);
        await wait(135 + Math.random() * 155);
        pastedElement.textContent = movedText;
      }

      recordBodyMutation(sourceSentence.id);
      return true;
    }

    async function deleteSentenceOnly() {
      const sourceParagraphs = paragraphs.filter(
        paragraph => paragraph.sentences.length > 1
      );
      if (!sourceParagraphs.length) return false;

      const paragraph = choose(sourceParagraphs);
      const sentence = choose(paragraph.sentences);
      const element = sentenceElement(sentence.id);
      if (!element) return false;

      element.classList.add("is-rewriting");
      if (!reducedMotion.matches) {
        await animateSelectionOnly(element, sentence.text);
        await wait(120 + Math.random() * 160);
        element.textContent = "";
        await wait(90 + Math.random() * 120);
      }

      const index = paragraph.sentences.findIndex(
        candidate => candidate.id === sentence.id
      );
      paragraph.sentences.splice(index, 1);
      renderDocument();
      recordBodyMutation();
      return true;
    }

    async function insertSentenceOnly(material) {
      const paragraph = choose(paragraphs);
      if (!paragraph || !material?.text) return false;

      const sentence = makeSentence(material.text, paragraph.category, {
        id: material.entryId,
        sourceId: material.sourceId
      });
      sentence.originCategory = material.category;
      const finalText = sentence.text;
      sentence.text = "";
      const insertionIndex = randomInsertionIndex(paragraph.sentences);
      paragraph.sentences.splice(insertionIndex, 0, sentence);
      renderDocument();

      const element = sentenceElement(sentence.id);
      if (!element) throw new Error("Inserted sentence element is missing.");

      if (reducedMotion.matches) {
        sentence.text = finalText;
        element.textContent = finalText;
      } else {
        setEditorText(element, "", true);
        await wait(100 + Math.random() * 160);
        await typeText(element, finalText);
        sentence.text = finalText;
        element.textContent = finalText;
      }

      syncSentenceDataset(element, sentence);
      recordBodyMutation(sentence.id);
      return true;
    }

    // Title generation and rendering
    function titleLengthClass(text) {
      const length = splitGraphemes(text).length;
      if (length <= 16) return "title-short";
      if (length <= 40) return "title-medium";
      if (length <= 90) return "title-long";
      return "title-very-long";
    }

    function updateTitleLengthClass(text) {
      titleElement.classList.remove(...TITLE_LENGTH_CLASSES);
      titleElement.classList.add(titleLengthClass(text));
    }

    function syncTitleDataset(entry) {
      syncDataset(titleElement, {
        titleId: entry?.id,
        sourceId: entry?.sourceId,
        sourceLabel: entry?.sourceLabel
      });
    }

    function setCurrentTitleEntry(entry) {
      currentTitleEntry = { ...entry };
      titleElement.textContent = currentTitleEntry.text;
      updateTitleLengthClass(currentTitleEntry.text);
      syncTitleDataset(currentTitleEntry);
    }

    function measureTitleHeight(text) {
      const parent = titleElement.parentElement;
      if (!parent) return titleElement.offsetHeight || 0;

      const probe = document.createElement("h1");
      probe.className = `title-measure ${titleLengthClass(text)}`;
      probe.textContent = text;
      probe.setAttribute("aria-hidden", "true");
      parent.append(probe);
      const height = probe.offsetHeight;
      probe.remove();
      return height;
    }

    function chooseNextTitleEntry() {
      const currentText = currentTitleEntry?.text.trim();
      const isFirstUpdate = titleUpdateCount === 0;
      const candidates = titlePool.filter(
        entry =>
          entry.id !== currentTitleEntry?.id &&
          (!isFirstUpdate || entry.text.trim() !== currentText)
      );
      return candidates.length ? { ...choose(candidates) } : null;
    }

    function generateTitleText() {
      const corpus = [staticTitleCorpus, currentTitleEntry?.text || ""]
        .filter(Boolean)
        .join(TITLE_CORPUS_SEPARATOR);
      const tokens = splitGraphemes(corpus);
      const order = titlePool.length < 5 ? 1 : 2;
      const chain = buildMarkov(tokens, order);
      const keys = [...chain.keys()].filter(key =>
        !key.includes(TITLE_CORPUS_SEPARATOR) && key.trim()
      );
      if (!keys.length) return null;

      let current = choose(keys).split("\u0001");
      const result = [...current];
      const targetLength = 12 + Math.floor(Math.random() * 109);

      for (let index = 0; index < targetLength; index++) {
        const key = current.slice(-order).join("\u0001");
        const options = chain.get(key)?.filter(
          token => token !== TITLE_CORPUS_SEPARATOR
        );
        if (!options?.length) break;

        let next = choose(options);
        const recent = result.slice(-8);
        if (recent.filter(token => token === next).length >= 4) {
          const alternatives = options.filter(token => token !== next);
          if (alternatives.length) next = choose(alternatives);
        }
        result.push(next);
        current.push(next);
      }

      const text = result.join("").trim();
      if (!text || text === currentTitleEntry?.text) return null;
      if (/(.{1,8})\1{5,}/u.test(text)) return null;
      return text;
    }

    function chooseNextTitleMaterial() {
      if (Math.random() >= TITLE_DATABASE_PROBABILITY) {
        const generatedText = generateTitleText();
        if (generatedText) {
          const entry = {
            id: `runtime_title_${titleSequence}`,
            text: generatedText,
            sourceId: "runtime",
            sourceLabel: "Runtime"
          };
          titleSequence += 1;
          return entry;
        }
      }
      return chooseNextTitleEntry();
    }

    async function performTitleRewrite() {
      return runExclusiveEdit("title", async () => {
        const nextEntry = chooseNextTitleMaterial();
        if (!nextEntry) return "skipped";

        const previousText = currentTitleEntry?.text || titleElement.textContent;
        const heldHeight = Math.max(
          titleElement.offsetHeight || 0,
          measureTitleHeight(nextEntry.text)
        );
        titleElement.style.minHeight = `${heldHeight}px`;

        try {
          await applyTextEdit(
            titleElement,
            previousText,
            nextEntry.text,
            "title"
          );
          setCurrentTitleEntry(nextEntry);
          titleUpdateCount += 1;
          return "completed";
        } catch (error) {
          console.error("Title edit failed.", error);
          setCurrentTitleEntry(nextEntry);
          titleUpdateCount += 1;
          return "failed";
        } finally {
          titleElement.style.removeProperty("min-height");
        }
      });
    }

    function getDocumentOperationWeights() {
      const count = allSentences().length;

      if (count > 28) {
        return { delete: 0.25, insert: 0.05, move: 0.20 };
      }
      if (count < 12) {
        return { delete: 0.05, insert: 0.25, move: 0.20 };
      }
      return { delete: 0.10, insert: 0.20, move: 0.20 };
    }

    async function performBodyRewrite() {
      return runExclusiveEdit("body", async () => {
        description.style.minHeight = `${description.offsetHeight}px`;
        try {
          const operation = Math.random();
          const weights = getDocumentOperationWeights();
          const deleteThreshold = weights.delete;
          const insertThreshold = deleteThreshold + weights.insert;
          const moveThreshold = insertThreshold + weights.move;

          if (operation < deleteThreshold) {
            const deleted = await deleteSentenceOnly();
            if (deleted) return "completed";
          } else if (operation < insertThreshold) {
            const inserted = await insertSentenceOnly(chooseBodyMaterial());
            if (inserted) return "completed";
          } else if (operation < moveThreshold) {
            const moved = await moveSentenceByCutPaste();
            if (moved) return "completed";
          }

          const sentenceId = chooseSentenceId();
          if (!sentenceId) throw new Error("No editable sentence exists.");
          const material = chooseBodyMaterial();

          if (Math.random() < 0.38) {
            const rewritten = await rewriteWordRange(sentenceId, material.text);
            if (rewritten) return "completed";
          }

          await rewriteSentence(sentenceId, material);
          return "completed";
        } catch (error) {
          console.error("Body edit failed.", error);
          renderDocument();
          return "failed";
        } finally {
          description.style.removeProperty("min-height");
        }
      });
    }

    // Scheduling and startup
    function retryDelay() {
      return 800 + Math.random() * 700;
    }

    function nextBodyDelay() {
      const mean = 3500;
      const raw = -Math.log(1 - Math.random()) * mean;
      return Math.max(2000, Math.min(raw, 5000));
    }

    function nextTitleDelay() {
      return 18000 + Math.pow(Math.random(), 2.2) * 50000;
    }

    function nextFirstTitleDelay() {
      return 20000 + Math.random() * 25000;
    }

    function scheduleRewrite(performRewrite, getNextDelay, delay) {
      setTimeout(async () => {
        const result = await performRewrite();
        const nextDelay = result === "busy" ? retryDelay() : getNextDelay();
        scheduleRewrite(performRewrite, getNextDelay, nextDelay);
      }, delay);
    }

    function scheduleBodyRewrite(delay = nextBodyDelay()) {
      scheduleRewrite(performBodyRewrite, nextBodyDelay, delay);
    }

    function scheduleTitleRewrite(delay = nextTitleDelay()) {
      scheduleRewrite(performTitleRewrite, nextTitleDelay, delay);
    }

    function scheduleFirstTitleRewrite(delay = nextFirstTitleDelay()) {
      setTimeout(async () => {
        const result = await performTitleRewrite();
        if (result === "completed" || result === "failed") {
          scheduleTitleRewrite();
        } else {
          scheduleFirstTitleRewrite(retryDelay());
        }
      }, delay);
    }

    async function start() {
      try {
        const contents = await loadContent();
        initializeContent(contents);
        if (
          paragraphs.length !== CATEGORY_ORDER.length ||
          paragraphs.some(paragraph => !paragraph.sentences.length)
        ) {
          throw new Error("The initial five-paragraph structure is invalid.");
        }
        if (!currentTitleEntry || !titlePool.length) {
          throw new Error("The title database is empty.");
        }

        setCurrentTitleEntry(currentTitleEntry);
        renderDocument();
        scheduleFirstTitleRewrite();
        scheduleBodyRewrite(2600);
      } catch (error) {
        console.error("Description data could not be loaded.", error);
        titleElement.textContent = "";
        syncTitleDataset(null);
        description.textContent = LOAD_ERROR_MESSAGE;
      }
    }

    if (integratedMode) {
      const languageObserver = new MutationObserver(() => {
        const nextLanguage = document.documentElement.lang === "ja" ? "ja" : "en";
        if (nextLanguage !== currentLanguage) location.reload();
      });
      languageObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["lang"]
      });
    }

    void start();
