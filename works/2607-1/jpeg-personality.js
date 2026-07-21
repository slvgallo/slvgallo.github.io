/*
 * JPEG PERSONALITY — PHASE P1 RAW FEATURE MEASUREMENT
 *
 * This module is intentionally independent from the glitch Runtime. It reads
 * only the source JPEG analysis objects supplied to analyzeFeatures(), never
 * consumes RNG, and does not influence generation.
 */
(function installJpegPersonality(globalScope) {
  "use strict";

  const VERSION = "p1.0";
  const CORE_AXIS_VERSION = "p2.0";
  const BEHAVIOR_TRAIT_VERSION = "p3.0";
  const SCAN_REFERENCE_MAX = 16;
  const DHT_CODE_LENGTH_COUNT = 16;
  const DHT_SYMBOL_REFERENCE_MAX = 256;
  const DHT_VARIANCE_REFERENCE = 32;
  const RGB_CHANNEL_VARIANCE_MAX = 2 / 9;
  const JPEG_SOF0_MARKER = 0xC0;
  const JPEG_SOF2_MARKER = 0xC2;
  const JPEG_APP_FIRST_MARKER = 0xE0;
  const JPEG_APP_LAST_MARKER = 0xEF;
  const JPEG_COMMENT_MARKER = 0xFE;
  const JPEG_DCT_BLOCK_SIZE = 8;
  const FEATURE_NAMES = Object.freeze([
    "encodingMode",
    "scanCount",
    "samplingComplexity",
    "restartDensity",
    "dqtSeverity",
    "dhtComplexity",
    "entropyRatio",
    "mutableDensity",
    "coarseByteVariance",
    "meanEdge",
    "meanTexture",
    "channelVariance"
  ]);

  function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }

  function safeDivide(numerator, denominator, fallback = 0) {
    if (!Number.isFinite(numerator)) return fallback;
    if (!Number.isFinite(denominator) || denominator <= 0) return fallback;
    return numerator / denominator;
  }

  function normalizeLinear(value, minimum, maximum) {
    if (!Number.isFinite(value) || maximum <= minimum) return 0;
    return clamp01((value - minimum) / (maximum - minimum));
  }

  function mean(values) {
    if (!values?.length) return 0;
    let sum = 0;
    for (const value of values) sum += Number(value) || 0;
    return sum / values.length;
  }

  function summarizeValues(values) {
    if (!values?.length) {
      return { count: 0, mean: 0, variance: 0, min: 0, max: 0 };
    }
    let sum = 0;
    let sumSquare = 0;
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const rawValue of values) {
      const value = Number.isFinite(rawValue) ? rawValue : 0;
      sum += value;
      sumSquare += value * value;
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    const valueMean = sum / values.length;
    return {
      count: values.length,
      mean: valueMean,
      variance: Math.max(0, sumSquare / values.length - valueMean * valueMean),
      min: minimum,
      max: maximum
    };
  }

  function pushWarning(warnings, warning) {
    if (!warnings.includes(warning)) warnings.push(warning);
  }

  function findFrameForScan(structure, scan) {
    const frames = structure?.frames || [];
    if (!frames.length) return null;
    if (Number.isFinite(scan?.frameMarkerOffset)) {
      return frames.find(
        (frame) => frame.markerOffset === scan.frameMarkerOffset
      ) || null;
    }
    return frames
      .filter((frame) => frame.markerOffset < (scan?.offset ?? Infinity))
      .sort((left, right) => right.markerOffset - left.markerOffset)[0] ||
      frames[0];
  }

  function getScanMcuCount(frame, scan) {
    if (!frame || !scan || frame.width <= 0 || frame.height <= 0) return null;
    if ((scan.componentIds || []).length > 1) {
      return (
        Math.ceil(frame.width / (JPEG_DCT_BLOCK_SIZE * frame.hMax)) *
        Math.ceil(frame.height / (JPEG_DCT_BLOCK_SIZE * frame.vMax))
      );
    }
    const componentId = scan.componentIds?.[0];
    const component = frame.components?.find((item) => item.id === componentId);
    if (!component) return null;
    const componentWidth = Math.ceil(frame.width * component.h / frame.hMax);
    const componentHeight = Math.ceil(frame.height * component.v / frame.vMax);
    return (
      Math.ceil(componentWidth / JPEG_DCT_BLOCK_SIZE) *
      Math.ceil(componentHeight / JPEG_DCT_BLOCK_SIZE)
    );
  }

  function countUniqueSortedIndices(indices) {
    if (!indices?.length) return 0;
    let count = 0;
    let previous = null;
    for (const rawIndex of indices) {
      const index = Number(rawIndex);
      if (!Number.isInteger(index) || index < 0 || index === previous) continue;
      count++;
      previous = index;
    }
    return count;
  }

  function getCoreJpegByteLength(jpegByteLength, segments) {
    let metadataByteLength = 0;
    for (const segment of segments || []) {
      const marker = segment.marker;
      if (
        (marker >= JPEG_APP_FIRST_MARKER && marker <= JPEG_APP_LAST_MARKER) ||
        marker === JPEG_COMMENT_MARKER
      ) {
        metadataByteLength += Math.max(0, (segment.segmentLength || 0) + 2);
      }
    }
    return {
      coreJpegByteLength: Math.max(1, jpegByteLength - metadataByteLength),
      metadataByteLength
    };
  }

  function classifyDqtBand(zigzagIndex) {
    // JPEG DQT values are stored in zigzag order. These boundaries correspond
    // to diagonal frequency shells: 0..3 low, 4..7 mid, 8..14 high.
    if (zigzagIndex < 10) return "low";
    if (zigzagIndex < 36) return "mid";
    return "high";
  }

  function analyzeDqtTables(tables) {
    const tableSummaries = [];
    for (const table of tables || []) {
      if (!table?.values?.length) continue;
      const coefficientMaximum = table.precision === 1 ? 65535 : 255;
      const bands = { low: [], mid: [], high: [] };
      const normalized = [];
      for (let index = 0; index < table.values.length; index++) {
        const value = clamp01(safeDivide(table.values[index], coefficientMaximum));
        normalized.push(value);
        bands[classifyDqtBand(index)].push(value);
      }
      const lowMean = mean(bands.low);
      const midMean = mean(bands.mid);
      const highMean = mean(bands.high);
      tableSummaries.push({
        id: table.id,
        precision: table.precision,
        lowMean,
        midMean,
        highMean,
        rawMean: mean(normalized),
        severity: clamp01(lowMean * 0.2 + midMean * 0.3 + highMean * 0.5)
      });
    }
    return {
      tableSummaries,
      severity: mean(tableSummaries.map((table) => table.severity)),
      lowMean: mean(tableSummaries.map((table) => table.lowMean)),
      midMean: mean(tableSummaries.map((table) => table.midMean)),
      highMean: mean(tableSummaries.map((table) => table.highMean)),
      rawMean: mean(tableSummaries.map((table) => table.rawMean))
    };
  }

  function analyzeDhtTables(tables) {
    const tableSummaries = [];
    for (const table of tables || []) {
      const counts = Array.from(table?.counts || []);
      if (counts.length !== DHT_CODE_LENGTH_COUNT) continue;
      const symbolCount = counts.reduce((sum, count) => sum + count, 0);
      const activeCodeLengthCount = counts.filter((count) => count > 0).length;
      let weightedLength = 0;
      for (let index = 0; index < counts.length; index++) {
        weightedLength += counts[index] * (index + 1);
      }
      const meanCodeLength = safeDivide(weightedLength, symbolCount);
      let weightedVariance = 0;
      for (let index = 0; index < counts.length; index++) {
        weightedVariance += counts[index] * Math.pow(index + 1 - meanCodeLength, 2);
      }
      const codeLengthVariance = safeDivide(weightedVariance, symbolCount);
      const complexity = clamp01(
        activeCodeLengthCount / DHT_CODE_LENGTH_COUNT * 0.25 +
        meanCodeLength / DHT_CODE_LENGTH_COUNT * 0.25 +
        clamp01(codeLengthVariance / DHT_VARIANCE_REFERENCE) * 0.25 +
        clamp01(symbolCount / DHT_SYMBOL_REFERENCE_MAX) * 0.25
      );
      tableSummaries.push({
        tableClass: table.tableClass,
        id: table.id,
        activeCodeLengthCount,
        meanCodeLength,
        codeLengthVariance,
        symbolCount,
        complexity
      });
    }
    return {
      tableSummaries,
      complexity: mean(tableSummaries.map((table) => table.complexity)),
      dcTableCount: tableSummaries.filter((table) => table.tableClass === 0).length,
      acTableCount: tableSummaries.filter((table) => table.tableClass === 1).length
    };
  }

  function computeRgbChannelVariance(originalImageData) {
    const pixels = originalImageData?.data;
    if (!pixels?.length) return null;
    let sum = 0;
    let count = 0;
    for (let index = 0; index + 2 < pixels.length; index += 4) {
      const red = pixels[index] / 255;
      const green = pixels[index + 1] / 255;
      const blue = pixels[index + 2] / 255;
      const channelMean = (red + green + blue) / 3;
      sum += (
        Math.pow(red - channelMean, 2) +
        Math.pow(green - channelMean, 2) +
        Math.pow(blue - channelMean, 2)
      ) / 3;
      count++;
    }
    if (!count) return null;
    const rawMean = sum / count;
    return {
      rawMean,
      theoreticalMaximum: RGB_CHANNEL_VARIANCE_MAX,
      normalized: clamp01(rawMean / RGB_CHANNEL_VARIANCE_MAX),
      pixelCount: count
    };
  }

  function analyzePersonalityFeatures(input = {}) {
    const measure = typeof input.onTiming === "function" &&
      globalScope.performance?.now
      ? () => globalScope.performance.now()
      : null;
    const startedAt = measure ? measure() : 0;
    const jpegBytes = input.jpegBytes;
    const structure = input.jpegStructure || {};
    const analysis = input.analysis || {};
    const fields = input.fields || {};
    const warnings = [];
    const availability = Object.fromEntries(
      FEATURE_NAMES.map((name) => [name, true])
    );
    const frame = structure.frames?.[0] || null;
    const frameMarker = frame?.marker;
    let encodingModeLabel = "other";
    let rawEncodingMode = 0;
    if (frameMarker === JPEG_SOF0_MARKER) encodingModeLabel = "baseline";
    else if (frameMarker === JPEG_SOF2_MARKER) {
      encodingModeLabel = "progressive";
      rawEncodingMode = 1;
    } else {
      pushWarning(warnings, "encodingMode:unsupported-sof");
      availability.encodingMode = Boolean(frame);
    }

    const rawScanCount = Math.max(
      0,
      Number(structure.scanCount ?? structure.scans?.length) || 0
    );
    if (!rawScanCount) {
      availability.scanCount = false;
      pushWarning(warnings, "scanCount:missing-scans");
    }

    const components = frame?.components || [];
    const samplingLoads = components.map(
      (component) => Math.max(0, component.h * component.v)
    );
    const maximumSamplingLoad = samplingLoads.length
      ? Math.max(...samplingLoads)
      : 0;
    const minimumSamplingLoad = samplingLoads.length
      ? Math.min(...samplingLoads)
      : 0;
    if (!components.length) {
      availability.samplingComplexity = false;
      pushWarning(warnings, "samplingComplexity:missing-components");
    }

    const scans = structure.scans || [];
    const restartMarkerCount = scans.reduce(
      (sum, scan) => sum + (scan.restartMarkers?.length || 0),
      0
    );
    const totalScanMcuCount = scans.reduce((sum, scan) => {
      const scanMcuCount = getScanMcuCount(
        findFrameForScan(structure, scan),
        scan
      );
      return sum + (Number.isFinite(scanMcuCount) ? scanMcuCount : 0);
    }, 0);
    const entropyByteLength = Math.max(0, Number(structure.entropyBytes) || 0);
    let restartDenominator = totalScanMcuCount;
    let restartNormalization = "mcu";
    if (!(restartDenominator > 0)) {
      restartDenominator = entropyByteLength / 1024;
      restartNormalization = "entropy-kibibyte";
      pushWarning(warnings, "restartDensity:fallback-byte-normalization");
    }
    if (!(restartDenominator > 0)) {
      availability.restartDensity = false;
      pushWarning(warnings, "restartDensity:missing-denominator");
    }

    const dqt = analyzeDqtTables(structure.quantTables);
    if (!dqt.tableSummaries.length) {
      availability.dqtSeverity = false;
      pushWarning(warnings, "dqtSeverity:missing-dqt");
    }
    const dht = analyzeDhtTables(structure.huffmanTables);
    if (!dht.tableSummaries.length) {
      availability.dhtComplexity = false;
      pushWarning(warnings, "dhtComplexity:missing-dht");
    }
    const markerFeaturesEndedAt = measure ? measure() : 0;

    const jpegByteLength = Math.max(
      0,
      Number(jpegBytes?.byteLength ?? jpegBytes?.length ?? structure.byteLength) || 0
    );
    const coreLengths = getCoreJpegByteLength(
      jpegByteLength,
      structure.segments
    );
    if (!(jpegByteLength > 0 && entropyByteLength > 0)) {
      availability.entropyRatio = false;
      pushWarning(warnings, "entropyRatio:missing-byte-length");
    }

    const mutableByteCount = countUniqueSortedIndices(structure.mutableIndices);
    if (!(entropyByteLength > 0)) {
      availability.mutableDensity = false;
      pushWarning(warnings, "mutableDensity:missing-entropy-length");
    }

    const coarseField = fields.byteVarianceCoarse || input.byteVarianceCoarse;
    const coarseSummary = summarizeValues(coarseField?.values);
    if (!coarseSummary.count) {
      availability.coarseByteVariance = false;
      pushWarning(warnings, "coarseByteVariance:missing-field");
    }
    const byteFeaturesEndedAt = measure ? measure() : 0;

    const edgeSummary = summarizeValues(
      fields.edge || analysis.edge
    );
    if (!edgeSummary.count) {
      availability.meanEdge = false;
      pushWarning(warnings, "meanEdge:missing-field");
    }
    const textureSummary = summarizeValues(
      fields.texture || analysis.texture
    );
    if (!textureSummary.count) {
      availability.meanTexture = false;
      pushWarning(warnings, "meanTexture:missing-field");
    }
    pushWarning(warnings, "meanTexture:possible-edge-overlap");

    const rgbChannelVariance = computeRgbChannelVariance(
      input.originalImageData
    );
    if (!rgbChannelVariance) {
      availability.channelVariance = false;
      pushWarning(warnings, "channelVariance:missing-original-image-data");
    }
    if (measure) {
      const visualFeaturesEndedAt = measure();
      input.onTiming({
        markerDerivedMilliseconds: markerFeaturesEndedAt - startedAt,
        byteDerivedMilliseconds: byteFeaturesEndedAt - markerFeaturesEndedAt,
        visualDerivedMilliseconds: visualFeaturesEndedAt - byteFeaturesEndedAt
      });
    }

    return {
      sourceIdentity: {
        byteLength: jpegByteLength,
        width: frame?.width || structure.width || 0,
        height: frame?.height || structure.height || 0,
        sofMarker: Number.isFinite(frameMarker) ? frameMarker : null,
        hash: null
      },
      raw: {
        encodingMode: rawEncodingMode,
        scanCount: rawScanCount,
        componentCount: components.length,
        maximumSamplingLoad,
        minimumSamplingLoad,
        samplingImbalance: maximumSamplingLoad > 0
          ? (maximumSamplingLoad - minimumSamplingLoad) / maximumSamplingLoad
          : 0,
        restartMarkerCount,
        totalScanMcuCount,
        dqtSeverity: dqt.severity,
        dhtComplexity: dht.complexity,
        entropyByteLength,
        entropyToFileRatio: safeDivide(entropyByteLength, jpegByteLength),
        entropyToCoreJpegRatio: safeDivide(
          entropyByteLength,
          coreLengths.coreJpegByteLength
        ),
        mutableByteCount,
        coarseByteVariance: coarseSummary.mean,
        meanEdge: edgeSummary.mean,
        meanTexture: textureSummary.mean,
        channelVariance: rgbChannelVariance?.rawMean ?? 0
      },
      metadata: {
        encodingModeLabel,
        scanReferenceMax: SCAN_REFERENCE_MAX,
        componentCount: components.length,
        samplingSignature: components.map(
          (component) => `${component.id}:${component.h}x${component.v}`
        ).join(","),
        hMax: frame?.hMax || 0,
        vMax: frame?.vMax || 0,
        restartNormalization,
        restartMarkerCount,
        restartIntervalDefinitions: (structure.driDefinitions || []).map(
          (definition) => definition.intervalMcuCount
        ),
        totalScanMcuCount,
        dqtTableCount: dqt.tableSummaries.length,
        dqtLowMean: dqt.lowMean,
        dqtMidMean: dqt.midMean,
        dqtHighMean: dqt.highMean,
        rawDqtMean: dqt.rawMean,
        dqtTables: dqt.tableSummaries,
        dhtTableCount: dht.tableSummaries.length,
        dhtDcTableCount: dht.dcTableCount,
        dhtAcTableCount: dht.acTableCount,
        dhtTables: dht.tableSummaries,
        jpegByteLength,
        coreJpegByteLength: coreLengths.coreJpegByteLength,
        metadataByteLength: coreLengths.metadataByteLength,
        entropyByteLength,
        mutableByteCount,
        mutableRangeCount: structure.scanRanges?.length || 0,
        coarseByteVariance: coarseSummary,
        edgeField: {
          ...edgeSummary,
          kind: "gradient-magnitude"
        },
        textureField: {
          ...textureSummary,
          kind: "continuous"
        },
        meanSaturation: clamp01(analysis.stats?.saturation),
        channelVariance: rgbChannelVariance || {
          rawMean: 0,
          theoreticalMaximum: RGB_CHANNEL_VARIANCE_MAX,
          normalized: 0,
          pixelCount: 0
        }
      },
      availability,
      warnings
    };
  }

  function normalizePersonalityFeatures(rawFeatures) {
    const raw = rawFeatures.raw;
    const componentTerm = normalizeLinear(raw.componentCount, 1, 4);
    const samplingLoadTerm = normalizeLinear(raw.maximumSamplingLoad, 1, 4);
    const imbalanceTerm = clamp01(raw.samplingImbalance);
    return {
      encodingMode: clamp01(raw.encodingMode),
      scanCount: clamp01(
        Math.log2(1 + raw.scanCount) / Math.log2(1 + SCAN_REFERENCE_MAX)
      ),
      samplingComplexity: clamp01(
        componentTerm * 0.25 +
        samplingLoadTerm * 0.35 +
        imbalanceTerm * 0.4
      ),
      restartDensity: clamp01(safeDivide(
        raw.restartMarkerCount,
        rawFeatures.metadata.restartNormalization === "mcu"
          ? raw.totalScanMcuCount
          : raw.entropyByteLength / 1024
      )),
      dqtSeverity: clamp01(raw.dqtSeverity),
      dhtComplexity: clamp01(raw.dhtComplexity),
      entropyRatio: clamp01(raw.entropyToCoreJpegRatio),
      mutableDensity: clamp01(
        safeDivide(raw.mutableByteCount, raw.entropyByteLength)
      ),
      coarseByteVariance: clamp01(raw.coarseByteVariance),
      meanEdge: clamp01(raw.meanEdge),
      meanTexture: clamp01(raw.meanTexture),
      channelVariance: clamp01(
        safeDivide(raw.channelVariance, RGB_CHANNEL_VARIANCE_MAX)
      )
    };
  }

  function validatePersonalityFeatures(result) {
    const errors = [];
    const unavailable = [];
    for (const name of FEATURE_NAMES) {
      const value = result?.vector?.[name];
      if (!Number.isFinite(value)) errors.push(`${name}:non-finite`);
      else if (value < 0 || value > 1) errors.push(`${name}:out-of-range`);
      if (result?.availability?.[name] !== true) unavailable.push(name);
    }
    const availableCount = FEATURE_NAMES.length - unavailable.length;
    return {
      valid: errors.length === 0 && availableCount >= 9,
      errors,
      unavailable,
      availableCount
    };
  }

  function serializePersonalityFeatures(features) {
    return JSON.stringify(features);
  }

  async function createSourceHash(jpegBytes) {
    if (!jpegBytes?.byteLength && !jpegBytes?.length) return null;
    if (!globalScope.crypto?.subtle) return null;
    const bytes = jpegBytes instanceof Uint8Array
      ? jpegBytes
      : new Uint8Array(jpegBytes);
    const digest = await globalScope.crypto.subtle.digest(
      "SHA-256",
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    );
    return Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }

  async function analyzeFeatures(input = {}) {
    const analyzed = analyzePersonalityFeatures(input);
    analyzed.sourceIdentity.hash = await createSourceHash(input.jpegBytes);
    if (!analyzed.sourceIdentity.hash) {
      pushWarning(analyzed.warnings, "sourceIdentity:sha256-unavailable");
    }
    const vector = normalizePersonalityFeatures(analyzed);
    const groups = {
      encoding: Object.fromEntries(FEATURE_NAMES.slice(0, 6).map(
        (name) => [name, vector[name]]
      )),
      byte: Object.fromEntries(FEATURE_NAMES.slice(6, 9).map(
        (name) => [name, vector[name]]
      )),
      visual: Object.fromEntries(FEATURE_NAMES.slice(9).map(
        (name) => [name, vector[name]]
      ))
    };
    const result = {
      version: VERSION,
      sourceIdentity: analyzed.sourceIdentity,
      groups,
      vector,
      raw: analyzed.raw,
      metadata: analyzed.metadata,
      availability: analyzed.availability,
      warnings: analyzed.warnings,
      valid: false
    };
    const validation = validatePersonalityFeatures(result);
    result.valid = validation.valid;
    result.validation = validation;
    return result;
  }

  function deriveCoreAxes(featureResult = {}) {
    const vector = featureResult.vector || {};
    const availability = featureResult.availability || {};
    const warnings = [];
    const requiredFeatures = [
      "scanCount",
      "samplingComplexity",
      "dqtSeverity",
      "entropyRatio",
      "mutableDensity",
      "meanEdge",
      "meanTexture",
      "channelVariance"
    ];
    for (const name of requiredFeatures) {
      if (availability[name] !== true) {
        warnings.push(`core-axis:missing-feature:${name}`);
      }
    }
    const value = (name) => clamp01(vector[name]);
    const contributions = {
      structuralComplexity: {
        scanCount: { value: value("scanCount"), weight: 0.6 },
        samplingComplexity: {
          value: value("samplingComplexity"),
          weight: 0.4
        }
      },
      compressionTension: {
        dqtSeverity: { value: value("dqtSeverity"), weight: 0.6 },
        inverseEntropyRatio: {
          value: 1 - value("entropyRatio"),
          weight: 0.25
        },
        inverseMutableDensity: {
          value: 1 - value("mutableDensity"),
          weight: 0.15
        }
      },
      visualDensity: {
        meanEdge: { value: value("meanEdge"), weight: 0.5 },
        meanTexture: { value: value("meanTexture"), weight: 0.5 }
      },
      chromaticSeparation: {
        channelVariance: { value: value("channelVariance"), weight: 1 }
      }
    };
    const axes = Object.fromEntries(Object.entries(contributions).map(
      ([axisName, axisContributions]) => [
        axisName,
        clamp01(Object.values(axisContributions).reduce(
          (sum, contribution) => sum + contribution.value * contribution.weight,
          0
        ))
      ]
    ));
    const errors = Object.entries(axes)
      .filter(([, axisValue]) => (
        !Number.isFinite(axisValue) || axisValue < 0 || axisValue > 1
      ))
      .map(([axisName]) => `${axisName}:invalid-value`);
    return {
      version: CORE_AXIS_VERSION,
      axes,
      rawContributions: contributions,
      availability: {
        structuralComplexity: availability.scanCount === true &&
          availability.samplingComplexity === true,
        compressionTension: availability.dqtSeverity === true &&
          availability.entropyRatio === true &&
          availability.mutableDensity === true,
        visualDensity: availability.meanEdge === true &&
          availability.meanTexture === true,
        chromaticSeparation: availability.channelVariance === true
      },
      warnings,
      valid: errors.length === 0 && warnings.length === 0,
      validation: { errors }
    };
  }

  function deriveBehaviorTraits(coreAxisResult = {}) {
    const axes = coreAxisResult.axes || {};
    const axisAvailability = coreAxisResult.availability || {};
    const warnings = [];
    const axisValue = (name) => clamp01(axes[name]);
    const contributions = {
      mutationBreadth: {
        structuralComplexity: 0.45,
        compressionTension: 0.3,
        visualDensity: 0.15,
        chromaticSeparation: 0.1
      },
      mutationDepth: {
        structuralComplexity: 0.2,
        compressionTension: 0.55,
        visualDensity: 0.15,
        chromaticSeparation: 0.1
      },
      spatialFragmentation: {
        structuralComplexity: 0.25,
        compressionTension: 0,
        visualDensity: 0.45,
        chromaticSeparation: 0.3
      },
      maskSelectivity: {
        inverseStructuralComplexity: 0.2,
        compressionTension: 0,
        visualDensity: 0.5,
        chromaticSeparation: 0.3
      },
      transitionPersistence: {
        structuralComplexity: 0.4,
        compressionTension: 0.3,
        inverseVisualDensity: 0.2,
        inverseChromaticSeparation: 0.1
      },
      audioDensity: {
        structuralComplexity: 0.15,
        compressionTension: 0.25,
        visualDensity: 0.5,
        chromaticSeparation: 0.1
      }
    };
    const requiredAxes = {
      mutationBreadth: [
        "structuralComplexity",
        "compressionTension",
        "visualDensity",
        "chromaticSeparation"
      ],
      mutationDepth: [
        "structuralComplexity",
        "compressionTension",
        "visualDensity",
        "chromaticSeparation"
      ],
      spatialFragmentation: [
        "structuralComplexity",
        "visualDensity",
        "chromaticSeparation"
      ],
      maskSelectivity: [
        "structuralComplexity",
        "visualDensity",
        "chromaticSeparation"
      ],
      transitionPersistence: [
        "structuralComplexity",
        "compressionTension",
        "visualDensity",
        "chromaticSeparation"
      ],
      audioDensity: [
        "structuralComplexity",
        "compressionTension",
        "visualDensity",
        "chromaticSeparation"
      ]
    };
    const availability = Object.fromEntries(Object.entries(requiredAxes).map(
      ([traitName, names]) => {
        const available = names.every((name) => (
          axisAvailability[name] === true && Number.isFinite(axes[name])
        ));
        if (!available) warnings.push(`${traitName}:missing-core-axis`);
        return [traitName, available];
      }
    ));
    const structuralComplexity = axisValue("structuralComplexity");
    const compressionTension = axisValue("compressionTension");
    const visualDensity = axisValue("visualDensity");
    const chromaticSeparation = axisValue("chromaticSeparation");
    const derivedTraits = {
      mutationBreadth: clamp01(
        structuralComplexity * 0.45 +
        compressionTension * 0.3 +
        visualDensity * 0.15 +
        chromaticSeparation * 0.1
      ),
      mutationDepth: clamp01(
        structuralComplexity * 0.2 +
        compressionTension * 0.55 +
        visualDensity * 0.15 +
        chromaticSeparation * 0.1
      ),
      spatialFragmentation: clamp01(
        structuralComplexity * 0.25 +
        visualDensity * 0.45 +
        chromaticSeparation * 0.3
      ),
      maskSelectivity: clamp01(
        (1 - structuralComplexity) * 0.2 +
        visualDensity * 0.5 +
        chromaticSeparation * 0.3
      ),
      transitionPersistence: clamp01(
        structuralComplexity * 0.4 +
        compressionTension * 0.3 +
        (1 - visualDensity) * 0.2 +
        (1 - chromaticSeparation) * 0.1
      ),
      audioDensity: clamp01(
        structuralComplexity * 0.15 +
        compressionTension * 0.25 +
        visualDensity * 0.5 +
        chromaticSeparation * 0.1
      )
    };
    const traits = Object.fromEntries(Object.entries(derivedTraits).map(
      ([traitName, traitValue]) => [
        traitName,
        availability[traitName] ? traitValue : 0
      ]
    ));
    const errors = Object.entries(traits)
      .filter(([, traitValue]) => (
        !Number.isFinite(traitValue) || traitValue < 0 || traitValue > 1
      ))
      .map(([traitName]) => `${traitName}:invalid-value`);
    return {
      version: BEHAVIOR_TRAIT_VERSION,
      traits,
      contributions,
      availability,
      warnings,
      valid: errors.length === 0 && warnings.length === 0,
      validation: { errors }
    };
  }

  globalScope.JpegPersonality = Object.freeze({
    VERSION,
    CORE_AXIS_VERSION,
    BEHAVIOR_TRAIT_VERSION,
    FEATURE_NAMES,
    analyzeFeatures,
    normalizeFeatures: normalizePersonalityFeatures,
    validateFeatures: validatePersonalityFeatures,
    serializeFeatures: serializePersonalityFeatures,
    deriveCoreAxes,
    deriveBehaviorTraits
  });
})(globalThis);
