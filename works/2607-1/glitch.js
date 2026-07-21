    /*
     * JPGL GLITCH RUNTIME
     *
     * 01. DOM AND REGISTRY
     * 02. APPLICATION STATE
     * 03. GENERAL UTILITIES
     * 04. RUNTIME CONFIG AND TELEMETRY
     * 05. SOURCE LIFECYCLE
     * 06. JPEG MARKER AND STRUCTURE CORE
     * 07. ENTROPY BIT IO
     * 08. BASELINE COEFFICIENT CODEC
     * 09. PROGRESSIVE COEFFICIENT CODEC
     * 10. CANDIDATE DOMAINS AND SELECTORS
     * 11. JPEG MUTATION KERNELS
     * 12. RECIPE AND ELIGIBILITY
     * 13. FAILURE STATE
     * 14. COMPOSITE AND MASK
     * 15. JPEG TRANSITION
     * 16. FRAME PREPARATION AND PRESENTATION
     * 17. PLAYBACK AND AUDIO
     * 18. BOOTSTRAP
     *
     * Function declarations remain order-independent. Stateful declarations,
     * frozen registries, classes, Maps, Sets, and other eagerly evaluated
     * values retain their initialization order throughout this refactor.
     */

    // ========================================================================
    // 01. DOM AND REGISTRY
    // ========================================================================
    const backgroundImg = document.getElementById("backgroundImg");
    const runtimeControls = document.getElementById("runtimeControls");
    const runtimeOverlay = document.getElementById("runtimeOverlay");
    const playbackButton = document.getElementById("playbackButton");
    const variantDefinitions = Object.freeze({
      entropy: Object.freeze({
        label: "ENT",
        defaultEnabled: true,
        strengthRange: Object.freeze({ min: 0.4, max: 4, step: 0.1 }),
        compositeOrder: 0
      }),
      mcu: Object.freeze({
        label: "MCU",
        defaultEnabled: true,
        strengthRange: Object.freeze({ min: 0.4, max: 3.5, step: 0.1 }),
        compositeOrder: 2
      }),
      dqt: Object.freeze({
        label: "DQT",
        defaultEnabled: false,
        strengthRange: Object.freeze({ min: 0.6, max: 3, step: 0.1 }),
        compositeOrder: 1
      }),
      dht: Object.freeze({
        label: "DHT",
        defaultEnabled: false,
        strengthRange: Object.freeze({ min: 0.1, max: 3.2, step: 0.1 }),
        compositeOrder: 3
      }),
      sof: Object.freeze({
        label: "SOF",
        defaultEnabled: false,
        strengthRange: Object.freeze({ min: 1, max: 1, step: 1 }),
        compositeOrder: 4
      }),
      sos: Object.freeze({
        label: "SOS",
        defaultEnabled: false,
        strengthRange: Object.freeze({ min: 0.1, max: 3.6, step: 0.1 }),
        compositeOrder: 5
      }),
      progressive: Object.freeze({
        label: "PRG",
        defaultEnabled: false,
        strengthRange: Object.freeze({ min: 1, max: 1, step: 1 }),
        compositeOrder: 6,
        transitionStateMode: "fixed"
      }),
      restart: Object.freeze({
        label: "RST",
        defaultEnabled: false,
        strengthRange: Object.freeze({ min: 1, max: 1, step: 1 }),
        compositeOrder: 7,
        transitionStateMode: "fixed"
      }),
      component: Object.freeze({
        label: "CMP",
        defaultEnabled: false,
        strengthRange: Object.freeze({ min: 1, max: 1, step: 1 }),
        compositeOrder: 8,
        transitionStateMode: "scaled",
        maskProfile: "entropy"
      }),
      coefficient: Object.freeze({
        label: "DCC",
        defaultEnabled: false,
        strengthRange: Object.freeze({ min: 1, max: 8, step: 1 }),
        compositeOrder: 9,
        transitionStateMode: "direct",
        maskProfile: "dqt"
      })
    });
    const techniqueRegistry = Object.freeze(Object.entries(variantDefinitions)
      .map(([name, definition]) => Object.freeze({
        name,
        definition
      })));
    const mutationRateTechniqueNames = new Set([
      "entropy",
      "mcu",
      "dqt",
      "component"
    ]);
    const layerNames = techniqueRegistry.map((technique) => technique.name);
    const failureEventFamilyIds = Object.freeze(Object.fromEntries(
      [...layerNames, "composite"].map((name, index) => [name, index])
    ));
    const failureEventStageIds = Object.freeze({
      "final-frame": 0,
      "transition-state": 1
    });
    const failureEventCodeIds = Object.freeze(Object.fromEntries([
      "generation-failed",
      "mutation-failed",
      "no-changed-bytes",
      "decode-failed",
      "layer-composite-failed",
      "frame-attempt-failed"
    ].map((code, index) => [code, index])));
    const runtimeVariantLabels = Object.fromEntries(
      layerNames.map((name) => [name, variantDefinitions[name].label])
    );
    const compositeLayerNames = [...layerNames].sort((left, right) => {
      const leftDefinition = variantDefinitions[left];
      const rightDefinition = variantDefinitions[right];
      return leftDefinition.compositeOrder - rightDefinition.compositeOrder;
    });
    // Mirrors mutation execution order for UI only.
    // Do not use this array to control mutation execution.
    const variantDisplayOrder = Object.freeze([...compositeLayerNames]);
    const layerStrengthRanges = Object.fromEntries(
      layerNames.map((name) => [name, variantDefinitions[name].strengthRange])
    );
    const entropyMutationModes = Object.freeze(["organic", "bit-flip"]);
    const variantExplorationMetadataByConfig = new WeakMap();
    const registryGenerationMetadataByConfig = new WeakMap();
    let latestRegistryGenerationRecord = null;
    const BITS_PER_BYTE = Uint8Array.BYTES_PER_ELEMENT * 8;
    const MAX_STORED_JPEG_DIFFERENCES = 65536;
    const PROCESS_PCM_SAMPLE_COUNT = 8192;
    const PROCESS_PCM_SAMPLE_RATE = 48000;
    const FAILURE_PCM_SAMPLE_COUNT = 512;
    const JPEG_PCM_TARGET_PEAK = 0.9;
    const MAX_FAILURE_AUDIO_EVENTS_PER_TRANSITION = 64;
    const FAILURE_SOUND_MIN_SPACING_MS = 4;
    const FAILURE_SOUND_GAIN = 0.045;
    const FAILURE_PLAYBACK_RATE = 1;
    const FAILURE_PHASE_FLASH_MS = 120;
    const TECHNIQUE_METER_FILL_DURATION_MS = 75;
    const COMPOSITE_MASK_COMPARISON_TILE_SIZE = 256;
    const mutationRangeConfig = {
      mutationRate: { min: 0.0005, max: 0.035, step: 0.0005 },
      maxLayerStrength: Math.max(
        ...layerNames.map((name) => variantDefinitions[name].strengthRange.max)
      ),
      layerStrength: layerStrengthRanges,
      entropy: {
        clusterCountScale: 1.6,
        clusterLengthScale: 1.75
      }
    };
    const DEFAULT_SOURCE_URL = "./assets/1.jpg";
    const SOURCE_RESOLUTION_SCALES = Object.freeze([
      0.25,
      0.375,
      0.5,
      0.75,
      1
    ]);
    const ENABLE_RUNTIME_OVERLAY = true;

    // ========================================================================
    // 02. APPLICATION STATE
    // ========================================================================
    const appState = {
      config: createDefaultRuntimeConfig(),
      source: {
        descriptor: null,
        bytes: null,
        image: null,
        objectUrl: null,
        analysis: null,
        structure: null,
        baselineCoefficientContext: null,
        progressiveCoefficientContext: null,
        failureState: null,
        byteVarianceCoarse: null,
        byteVarianceFine: null,
        spectralField: null,
        personalityFeatures: null,
        personalityCoreAxes: null,
        personalityTraits: null,
        resolutionVariants: [],
        loadRunId: 0
      },
      playback: {
        autoTimer: null,
        autoRunning: false,
        hasStarted: false,
        paused: true,
        pausedRuntimePhase: "idle",
        pauseWaiters: new Set(),
        autoResumeWaiters: new Set(),
        autoDelayWaiters: new Set(),
        autoRunId: 0,
        frame: 0,
        activeAutoLoopPromise: null,
        activeAutoLoopRunId: null
      },
      pipeline: {
        generationRunId: 0,
        transitionRunId: 0,
        preparationRunId: 0,
        isGenerating: false,
        preparationPromise: null,
        preparedPackage: null,
        displayedFrameBlob: null,
        displayedFrameBytes: null,
        displayedFramePresentedAt: 0,
        displayedFrameHoldMilliseconds: 0,
        displayedSpectralFieldPromise: null,
        failureEvents: [],
        variantExploration: null
      },
      resources: {
        displayedUrl: null,
        transitionResources: [],
        transitionHoldTimer: null,
        transitionHoldResolve: null,
        reusableCanvases: new Map(),
        recordedFailureEventsByError: new WeakMap()
      },
      ui: {
        runtimeStatus: { message: "initializing", isError: false },
        runtimePhase: "loading",
        overlayElements: null,
        overlayRenderFrame: null,
        techniqueMeters: Object.fromEntries(layerNames.map((name) => [name, {
          status: "idle",
          value: 0
        }])),
        techniqueMeterAnimations: new Map(),
        failurePhaseFlashTimer: null,
        playbackTap: null,
        dropTargetInstalled: false,
        playbackToggleInstalled: false
      },
      audio: {
        context: null,
        unlockInstalled: false,
        activeProcessSound: null,
        processAudioBufferCache: null,
        activeFailureSounds: new Set(),
        pendingFailureSoundTimers: new Set(),
        failureAudioBufferCache: null
      }
    };

    // Runtime aliases keep state centralized in appState while allowing the
    // pipeline below to use concise property names.
    const runtimeStateBindings = {
      runtimeConfig: ["config"],
      currentSource: ["source", "descriptor"],
      currentBytes: ["source", "bytes"],
      sourceImage: ["source", "image"],
      sourceObjectUrl: ["source", "objectUrl"],
      sourceAnalysis: ["source", "analysis"],
      sourceStructure: ["source", "structure"],
      sourceBaselineCoefficientContext:
        ["source", "baselineCoefficientContext"],
      sourceProgressiveCoefficientContext:
        ["source", "progressiveCoefficientContext"],
      failureState: ["source", "failureState"],
      byteVarianceCoarse: ["source", "byteVarianceCoarse"],
      byteVarianceFine: ["source", "byteVarianceFine"],
      jpegSpectralField: ["source", "spectralField"],
      sourcePersonalityFeatures: ["source", "personalityFeatures"],
      sourcePersonalityCoreAxes: ["source", "personalityCoreAxes"],
      sourcePersonalityTraits: ["source", "personalityTraits"],
      sourceResolutionVariants: ["source", "resolutionVariants"],
      sourceLoadRunId: ["source", "loadRunId"],
      autoTimer: ["playback", "autoTimer"],
      autoRunning: ["playback", "autoRunning"],
      hasPlaybackStarted: ["playback", "hasStarted"],
      playbackPaused: ["playback", "paused"],
      pausedRuntimePhase: ["playback", "pausedRuntimePhase"],
      playbackPauseWaiters: ["playback", "pauseWaiters"],
      autoResumeWaiters: ["playback", "autoResumeWaiters"],
      autoDelayWaiters: ["playback", "autoDelayWaiters"],
      autoRunId: ["playback", "autoRunId"],
      autoFrame: ["playback", "frame"],
      activeAutoLoopPromise: ["playback", "activeAutoLoopPromise"],
      activeAutoLoopRunId: ["playback", "activeAutoLoopRunId"],
      generationRunId: ["pipeline", "generationRunId"],
      transitionRunId: ["pipeline", "transitionRunId"],
      preparationRunId: ["pipeline", "preparationRunId"],
      isGenerating: ["pipeline", "isGenerating"],
      preparationPromise: ["pipeline", "preparationPromise"],
      preparedFramePackage: ["pipeline", "preparedPackage"],
      displayedFrameBlob: ["pipeline", "displayedFrameBlob"],
      displayedFrameBytes: ["pipeline", "displayedFrameBytes"],
      displayedFramePresentedAt:
        ["pipeline", "displayedFramePresentedAt"],
      displayedFrameHoldMilliseconds:
        ["pipeline", "displayedFrameHoldMilliseconds"],
      displayedSpectralFieldPromise:
        ["pipeline", "displayedSpectralFieldPromise"],
      currentFailureEvents: ["pipeline", "failureEvents"],
      runtimeVariantExploration: ["pipeline", "variantExploration"],
      glitchedUrl: ["resources", "displayedUrl"],
      activeTransitionResources: ["resources", "transitionResources"],
      activeTransitionHoldTimer: ["resources", "transitionHoldTimer"],
      activeTransitionHoldResolve: ["resources", "transitionHoldResolve"],
      reusableCanvases: ["resources", "reusableCanvases"],
      recordedFailureEventsByError:
        ["resources", "recordedFailureEventsByError"],
      runtimeStatus: ["ui", "runtimeStatus"],
      runtimePhase: ["ui", "runtimePhase"],
      runtimeOverlayElements: ["ui", "overlayElements"],
      runtimeOverlayRenderFrame: ["ui", "overlayRenderFrame"],
      runtimeTechniqueMeters: ["ui", "techniqueMeters"],
      runtimeTechniqueMeterAnimations: ["ui", "techniqueMeterAnimations"],
      failurePhaseFlashTimer: ["ui", "failurePhaseFlashTimer"],
      playbackTap: ["ui", "playbackTap"],
      dropTargetInstalled: ["ui", "dropTargetInstalled"],
      playbackToggleInstalled: ["ui", "playbackToggleInstalled"],
      transitionAudioContext: ["audio", "context"],
      transitionAudioUnlockInstalled: ["audio", "unlockInstalled"],
      activeProcessSound: ["audio", "activeProcessSound"],
      processAudioBufferCache: ["audio", "processAudioBufferCache"],
      activeFailureSounds: ["audio", "activeFailureSounds"],
      pendingFailureSoundTimers: ["audio", "pendingFailureSoundTimers"],
      failureAudioBufferCache: ["audio", "failureAudioBufferCache"]
    };
    for (const [name, path] of Object.entries(runtimeStateBindings)) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          return path.reduce((value, key) => value[key], appState);
        },
        set(nextValue) {
          const owner = path.slice(0, -1).reduce(
            (value, key) => value[key],
            appState
          );
          owner[path[path.length - 1]] = nextValue;
        }
      });
    }

    // ========================================================================
    // 03. GENERAL UTILITIES
    // ========================================================================
    function clamp01(value) {
      return Math.max(0, Math.min(1, value));
    }

    function lerp(a, b, amount) {
      return a + (b - a) * amount;
    }

    function revokeObjectUrl(url, preservedUrls = []) {
      if (!url || preservedUrls.includes(url)) return false;
      URL.revokeObjectURL(url);
      return true;
    }

    function replaceOwnedObjectUrl({
      previousUrl,
      nextUrl,
      preservedUrls = []
    }) {
      if (previousUrl && previousUrl !== nextUrl) {
        revokeObjectUrl(previousUrl, [nextUrl, ...preservedUrls]);
      }
      return nextUrl || null;
    }

    function releaseTransitionStateResources(resources = activeTransitionResources) {
      for (const state of resources) {
        if (state?.url) URL.revokeObjectURL(state.url);
        if (state) state.url = null;
      }
      if (resources === activeTransitionResources) activeTransitionResources = [];
    }

    function waitForTransitionHold(milliseconds, runId) {
      return new Promise((resolve) => {
        if (runId !== transitionRunId) {
          resolve(false);
          return;
        }
        activeTransitionHoldResolve = resolve;
        activeTransitionHoldTimer = setTimeout(() => {
          activeTransitionHoldTimer = null;
          activeTransitionHoldResolve = null;
          resolve(runId === transitionRunId);
        }, milliseconds);
      });
    }

    async function waitForPausableTransitionHold(milliseconds, runId) {
      let remaining = Math.max(0, Number(milliseconds) || 0);
      while (remaining > 0) {
        if (!await waitForPlaybackResume(runId)) return false;
        if (runId !== transitionRunId) return false;
        const startedAt = performance.now();
        if (!await waitForTransitionHold(remaining, runId)) return false;
        remaining = Math.max(
          0,
          remaining - Math.max(0, performance.now() - startedAt)
        );
      }
      return runId === transitionRunId;
    }

    function getActiveRecipeVariantNames(recipe) {
      return layerNames.filter((name) => recipe[name] > 0);
    }

    function getRecipeVariantTransitionMode(name, recipe) {
      return variantDefinitions[name].transitionStateMode || "scaled";
    }

    function getRecipeVariantMaskProfile(name, recipe) {
      return variantDefinitions[name].maskProfile ?? name;
    }

    // ========================================================================
    // 04. RUNTIME CONFIG AND TELEMETRY
    // ========================================================================
    function createDefaultRuntimeConfig() {
      return {
        mutationRate: 0.003,
        seed: 12345,
        mode: "organic",
        region: "full",
        intervalSeconds: 1.5,
        maskCoverage: 1,
        maskOpacity: 1,
        layers: Object.fromEntries(layerNames.map((name) => [
          name,
          {
            enabled: variantDefinitions[name].defaultEnabled,
            strength: 1
          }
        ]))
      };
    }

    function normalizeRuntimeConfig(config = {}) {
      const defaults = createDefaultRuntimeConfig();
      const mutationRate = Number(config.mutationRate);
      const seed = Number(config.seed);
      const intervalSeconds = Number(config.intervalSeconds);
      const maskCoverage = Number(config.maskCoverage);
      const knownModes = new Set([
        "organic",
        "xor",
        "replace",
        "add",
        "bit-flip"
      ]);
      const knownRegions = new Set(["full", "first", "second", "middle"]);
      const layers = Object.fromEntries(layerNames.map((name) => {
        const input = config.layers?.[name] || defaults.layers[name];
        const strength = Number(input.strength);
        return [name, {
          enabled: input.enabled === true,
          strength: Math.max(
            0.1,
            Math.min(
              mutationRangeConfig.maxLayerStrength,
              Number.isFinite(strength) ? strength : 1
            )
          )
        }];
      }));
      return {
        mutationRate: Math.max(
          mutationRangeConfig.mutationRate.min,
          Math.min(
            mutationRangeConfig.mutationRate.max,
            Number.isFinite(mutationRate) ? mutationRate : defaults.mutationRate
          )
        ),
        seed: Number.isFinite(seed) && seed > 0
          ? Math.max(1, Math.floor(seed))
          : defaults.seed,
        mode: knownModes.has(config.mode) ? config.mode : defaults.mode,
        region: knownRegions.has(config.region) ? config.region : defaults.region,
        intervalSeconds: Math.max(
          0.5,
          Math.min(8, Number.isFinite(intervalSeconds) ? intervalSeconds : defaults.intervalSeconds)
        ),
        maskCoverage: Math.max(
          0.1,
          Math.min(2, Number.isFinite(maskCoverage) ? maskCoverage : defaults.maskCoverage)
        ),
        maskOpacity: 1,
        layers
      };
    }

    function cloneRuntimeConfig(config = runtimeConfig) {
      const normalized = normalizeRuntimeConfig(config);
      const cloned = {
        ...normalized,
        layers: Object.fromEntries(layerNames.map((name) => [
          name,
          { ...normalized.layers[name] }
        ]))
      };
      const variantExploration = variantExplorationMetadataByConfig.get(config);
      if (variantExploration) {
        variantExplorationMetadataByConfig.set(
          cloned,
          JSON.parse(JSON.stringify(variantExploration))
        );
      }
      const registryGeneration = registryGenerationMetadataByConfig.get(config);
      if (registryGeneration) {
        registryGenerationMetadataByConfig.set(
          cloned,
          JSON.parse(JSON.stringify(registryGeneration))
        );
      }
      return cloned;
    }

    function initializeRuntimeOverlay() {
      if (!ENABLE_RUNTIME_OVERLAY || !runtimeOverlay || runtimeOverlayElements) return;
      runtimeOverlay.style.setProperty(
        "--runtime-variant-count",
        String(variantDisplayOrder.length)
      );
      runtimeOverlay.innerHTML = `
        <div class="runtime-primary">
          <div class="runtime-state">
            <span id="runtimePhase" class="runtime-phase is-pending"></span>
            <b id="runtimeFrame" class="runtime-frame-value">000</b>
          </div>
          <div class="runtime-seed">
            <span class="runtime-stack-label">SEED</span>
            <b id="runtimeSeed" class="runtime-seed-value">000000000</b>
          </div>
          <div class="runtime-section runtime-parameters">
            <div class="runtime-variant">
              <span>MUT</span>
              <span class="runtime-meter"><i id="runtimeMutationMeter"></i></span>
            </div>
            <div class="runtime-variant">
              <span>COV</span>
              <span class="runtime-meter"><i id="runtimeCoverageMeter"></i></span>
            </div>
          </div>
          <div class="runtime-section runtime-variants">
            <div class="runtime-variant-grid">
              ${variantDisplayOrder.map((name) => `
                <div class="runtime-variant">
                  <span>${runtimeVariantLabels[name]}</span>
                  <span class="runtime-meter"><i id="runtimeVariantMeter-${name}"></i></span>
                </div>
              `).join("")}
            </div>
          </div>
        </div>
      `;
      runtimeOverlayElements = {
        phase: runtimeOverlay.querySelector("#runtimePhase"),
        frame: runtimeOverlay.querySelector("#runtimeFrame"),
        seed: runtimeOverlay.querySelector("#runtimeSeed"),
        mutationMeter: runtimeOverlay.querySelector("#runtimeMutationMeter"),
        coverageMeter: runtimeOverlay.querySelector("#runtimeCoverageMeter"),
        variants: Object.fromEntries(variantDisplayOrder.map((name) => [name, {
          meter: runtimeOverlay.querySelector(`#runtimeVariantMeter-${name}`),
          track: runtimeOverlay.querySelector(`#runtimeVariantMeter-${name}`)
            ?.parentElement || null
        }]))
      };
      window.addEventListener("resize", requestRuntimeOverlayRender);
    }

    function getRenderedImageBounds() {
      const image = backgroundImg.naturalWidth && backgroundImg.naturalHeight
        ? backgroundImg
        : sourceImage;
      const imageWidth = image?.naturalWidth || 0;
      const imageHeight = image?.naturalHeight || 0;
      if (!imageWidth || !imageHeight) return null;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const imageScale = Math.min(
        viewportWidth / imageWidth,
        viewportHeight / imageHeight
      );
      const renderedWidth = imageWidth * imageScale;
      const renderedHeight = imageHeight * imageScale;
      const imageLeft = (viewportWidth - renderedWidth) * 0.5;
      const imageTop = (viewportHeight - renderedHeight) * 0.5;
      return {
        left: imageLeft,
        top: imageTop,
        right: imageLeft + renderedWidth,
        bottom: imageTop + renderedHeight,
        width: renderedWidth,
        height: renderedHeight
      };
    }

    function positionRuntimeControlsOnImage() {
      if (!runtimeControls || !runtimeOverlay) return;
      const bounds = getRenderedImageBounds();
      if (!bounds) return;
      const inset = Math.min(
        18,
        Math.max(8, Math.min(bounds.width, bounds.height) * 0.025)
      );
      const controlGap = 5;
      const overlayWidth = Math.max(1, runtimeOverlay.offsetWidth);
      const overlayHeight = Math.max(1, runtimeOverlay.offsetHeight);
      const availableWidth = Math.max(1, bounds.width - inset * 2);
      const availableHeight = Math.max(1, bounds.height - inset * 2);
      const overlayScale = Math.min(
        1,
        availableWidth / (overlayWidth + overlayHeight + controlGap),
        availableHeight / overlayHeight
      );
      runtimeControls.style.setProperty(
        "--runtime-controls-left",
        `${bounds.left + inset}px`
      );
      runtimeControls.style.setProperty(
        "--runtime-controls-bottom",
        `${window.innerHeight - bounds.bottom + inset}px`
      );
      runtimeControls.style.setProperty(
        "--runtime-controls-scale",
        String(overlayScale)
      );
      runtimeControls.style.setProperty(
        "--runtime-control-height",
        `${overlayHeight}px`
      );
      runtimeControls.style.setProperty(
        "--runtime-control-gap",
        `${controlGap}px`
      );
    }

    function setRuntimeOverlaySourceAvailable(hasSource) {
      if (!ENABLE_RUNTIME_OVERLAY || !runtimeOverlay) return;
      runtimeOverlay.classList.toggle("has-source", Boolean(hasSource));
    }

    function setRuntimePhase(nextPhase) {
      const normalized = String(nextPhase || "idle").toLowerCase();
      const knownPhases = new Set([
        "loading", "generating", "transition", "hold", "idle", "error"
      ]);
      runtimePhase = knownPhases.has(normalized) ? normalized : "idle";
      requestRuntimeOverlayRender();
    }

    function clearRuntimePhaseFailureFlash() {
      if (failurePhaseFlashTimer !== null) {
        clearTimeout(failurePhaseFlashTimer);
        failurePhaseFlashTimer = null;
      }
      runtimeOverlayElements?.phase?.classList.remove("is-failure-flash");
    }

    function flashRuntimePhaseFailureMarker() {
      const marker = runtimeOverlayElements?.phase;
      if (!marker) return;
      marker.classList.add("is-failure-flash");
      if (failurePhaseFlashTimer !== null) {
        clearTimeout(failurePhaseFlashTimer);
      }
      failurePhaseFlashTimer = setTimeout(() => {
        marker.classList.remove("is-failure-flash");
        failurePhaseFlashTimer = null;
      }, FAILURE_PHASE_FLASH_MS);
    }

    function setRuntimeMeter(element, value) {
      if (!element) return;
      element.style.setProperty("--value", `${(clamp01(Number(value) || 0) * 100).toFixed(2)}%`);
    }

    function cancelRuntimeTechniqueMeterAnimation(name, finish = false) {
      const animation = runtimeTechniqueMeterAnimations.get(name);
      if (!animation) return;
      if (finish) {
        try {
          animation.finish();
        } catch {
          // A cancelled or zero-duration animation needs no further handling.
        }
      }
      animation.cancel();
      runtimeTechniqueMeterAnimations.delete(name);
    }

    function renderRuntimeTechniqueMeter(name) {
      const elements = runtimeOverlayElements?.variants?.[name];
      const state = runtimeTechniqueMeters[name];
      if (!elements || !state) return;
      for (const status of ["pending", "active", "success", "reject"]) {
        elements.track?.classList.toggle(
          `is-${status}`,
          state.status === status
        );
      }
      if (state.status !== "active") {
        setRuntimeMeter(elements.meter, state.value);
      }
    }

    function setRuntimeTechniqueMeterState(
      name,
      status,
      targetValue = 0,
      { finishAnimation = false } = {}
    ) {
      if (!runtimeTechniqueMeters[name]) return null;
      cancelRuntimeTechniqueMeterAnimation(name, finishAnimation);
      const value = clamp01(Number(targetValue) || 0);
      runtimeTechniqueMeters[name] = { status, value };
      const elements = runtimeOverlayElements?.variants?.[name] || null;
      if (elements?.meter) elements.meter.style.transitionDuration = "0ms";
      renderRuntimeTechniqueMeter(name);
      return { elements, value };
    }

    function resetRuntimeTechniqueMeters(registryGeneration = null) {
      const selectedNames = new Set(
        registryGeneration?.selectedTechniqueNames || []
      );
      for (const name of layerNames) {
        setRuntimeTechniqueMeterState(
          name,
          selectedNames.has(name) ? "pending" : "idle"
        );
      }
    }

    function beginRuntimeTechniqueMeter(name, targetValue) {
      const elements = runtimeOverlayElements?.variants?.[name];
      if (!elements?.meter || !runtimeTechniqueMeters[name]) return;
      const normalizedTarget = clamp01(Number(targetValue) || 0);
      const durationMs = Math.max(
        1,
        TECHNIQUE_METER_FILL_DURATION_MS * normalizedTarget
      );
      setRuntimeTechniqueMeterState(name, "active", normalizedTarget);
      setRuntimeMeter(elements.meter, 0);
      if (typeof elements.meter.animate !== "function") {
        elements.meter.style.transitionDuration = `${durationMs}ms`;
        requestAnimationFrame(() => {
          if (runtimeTechniqueMeters[name]?.status === "active") {
            setRuntimeMeter(elements.meter, normalizedTarget);
          }
        });
        return;
      }
      const animation = elements.meter.animate(
        [
          { width: "0%" },
          { width: `${(normalizedTarget * 100).toFixed(2)}%` }
        ],
        {
          duration: durationMs,
          easing: "linear",
          fill: "forwards"
        }
      );
      runtimeTechniqueMeterAnimations.set(name, animation);
    }

    function completeRuntimeTechniqueMeter(name, targetValue) {
      setRuntimeTechniqueMeterState(name, "success", targetValue, {
        finishAnimation: true
      });
    }

    function rejectRuntimeTechniqueMeter(name, targetValue) {
      setRuntimeTechniqueMeterState(name, "reject", targetValue);
    }

    function pauseRuntimeTechniqueMeterAnimations() {
      for (const animation of runtimeTechniqueMeterAnimations.values()) {
        animation.pause();
      }
    }

    function resumeRuntimeTechniqueMeterAnimations() {
      for (const animation of runtimeTechniqueMeterAnimations.values()) {
        animation.play();
      }
    }

    function getAllRejectedRegistryGeneration(config) {
      const record = latestRegistryGenerationRecord;
      const selectedNames = record?.selectedTechniqueNames || [];
      if (
        selectedNames.length === 0 ||
        record.successfulVariantCount !== 0 ||
        Number(record.seed) !== Number(config?.seed)
      ) {
        return null;
      }
      const entryByName = new Map(
        (record.techniques || []).map((entry) => [entry.name, entry])
      );
      if (!selectedNames.every((name) =>
        entryByName.get(name)?.status === "reject"
      )) {
        return null;
      }
      return JSON.parse(JSON.stringify(record));
    }

    async function playAllRejectedTechniqueMeters(record, runId) {
      const selectedNames = record?.selectedTechniqueNames || [];
      if (selectedNames.length === 0) return false;
      const transitionId = ++transitionRunId;
      resetRuntimeTechniqueMeters(record);
      setRuntimePhase("transition");
      const equalHold = Math.floor(
        transitionPlaybackConfig.totalDuration / selectedNames.length
      );
      let remainder = transitionPlaybackConfig.totalDuration -
        equalHold * selectedNames.length;
      const entryByName = new Map(
        (record.techniques || []).map((entry) => [entry.name, entry])
      );
      for (const name of selectedNames) {
        if (!await waitForPlaybackResume(transitionId)) return false;
        if (transitionId !== transitionRunId || runId !== autoRunId) {
          return false;
        }
        rejectRuntimeTechniqueMeter(
          name,
          normalizeLayerStrength(
            name,
            entryByName.get(name)?.parameters?.strength
          )
        );
        const holdMs = equalHold + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        if (!await waitForPausableTransitionHold(holdMs, transitionId)) {
          return false;
        }
      }
      if (transitionId !== transitionRunId || runId !== autoRunId) {
        return false;
      }
      setRuntimePhase("hold");
      return true;
    }

    function renderRuntimePhaseIndicator(element, phase) {
      if (!element) return;
      const isTransition = phase === "transition";
      const isError = phase === "error";
      element.classList.toggle("is-filled", phase === "hold");
      element.classList.toggle("is-error", isError);
      element.classList.toggle(
        "is-pending",
        !isError && !isTransition && phase !== "hold"
      );
    }

    function renderRuntimeOverlay(snapshot) {
      if (!ENABLE_RUNTIME_OVERLAY || !runtimeOverlayElements || !snapshot) return;
      const elements = runtimeOverlayElements;
      const hasStarted = snapshot.hasPlaybackStarted;
      renderRuntimePhaseIndicator(elements.phase, snapshot.phase);
      elements.frame.textContent = String(
        Math.floor(Math.max(0, snapshot.frame || 0)) % 1000
      ).padStart(3, "0");
      elements.seed.textContent = hasStarted
        ? String(snapshot.seed)
        : "000000000";
      setRuntimeMeter(
        elements.mutationMeter,
        hasStarted ? snapshot.meters.mutation : 0
      );
      setRuntimeMeter(
        elements.coverageMeter,
        hasStarted ? snapshot.meters.coverage : 0
      );

      for (const name of layerNames) renderRuntimeTechniqueMeter(name);
      positionRuntimeControlsOnImage();
    }

    function requestRuntimeOverlayRender() {
      if (!ENABLE_RUNTIME_OVERLAY || !runtimeOverlayElements) return;
      if (runtimeOverlayRenderFrame !== null) return;
      runtimeOverlayRenderFrame = requestAnimationFrame(() => {
        runtimeOverlayRenderFrame = null;
        try {
          renderRuntimeOverlay(getRuntimeTelemetrySnapshot());
        } catch (error) {
          console.warn("Runtime overlay render failed:", error);
        }
      });
    }

    function setStatus(message, isError = false) {
      runtimeStatus = {
        message: String(message),
        isError: Boolean(isError)
      };
    }

    function cancelActiveTransitionHold() {
      if (activeTransitionHoldTimer !== null) {
        clearTimeout(activeTransitionHoldTimer);
      }
      activeTransitionHoldTimer = null;
      if (activeTransitionHoldResolve) activeTransitionHoldResolve(false);
      activeTransitionHoldResolve = null;
    }

    function finishActiveTransitionHold() {
      if (activeTransitionHoldTimer !== null) {
        clearTimeout(activeTransitionHoldTimer);
      }
      activeTransitionHoldTimer = null;
      const resolve = activeTransitionHoldResolve;
      activeTransitionHoldResolve = null;
      if (resolve) resolve(true);
    }

    function settlePlaybackPauseWaiters(shouldResume) {
      for (const waiter of playbackPauseWaiters) {
        waiter.resolve(
          Boolean(shouldResume) && waiter.runId === transitionRunId
        );
      }
      playbackPauseWaiters.clear();
    }

    function waitForPlaybackResume(runId) {
      if (runId !== transitionRunId) return Promise.resolve(false);
      if (!playbackPaused) return Promise.resolve(true);
      return new Promise((resolve) => {
        playbackPauseWaiters.add({ runId, resolve });
      });
    }

    // ========================================================================
    // 05. SOURCE LIFECYCLE
    // ========================================================================
    function resetOutputState() {
      generationRunId++;
      preparationRunId++;
      transitionRunId++;
      hasPlaybackStarted = false;
      playbackPaused = true;
      settlePlaybackPauseWaiters(false);
      clearRuntimePhaseFailureFlash();
      stopAllProcessSounds({ releaseCache: true });
      stopAllFailureSounds({ releaseCache: true, reason: "reset" });
      cancelActiveTransitionHold();
      document.body.classList.remove("has-background");
      backgroundImg.removeAttribute("src");
      releaseTransitionStateResources();
      releasePreparedFramePackage(preparedFramePackage);
      preparedFramePackage = null;
      preparationPromise = null;
      displayedFrameBlob = null;
      displayedFrameBytes = null;
      displayedFramePresentedAt = 0;
      displayedFrameHoldMilliseconds = 0;
      displayedSpectralFieldPromise = null;
      runtimeVariantExploration = null;
      resetRuntimeTechniqueMeters();
      if (glitchedUrl) {
        if (glitchedUrl !== sourceObjectUrl) URL.revokeObjectURL(glitchedUrl);
        glitchedUrl = null;
      }
      setRuntimePhase("idle");
    }

    function releaseResolutionVariantImages(variants, retainedImage = null) {
      for (const variant of variants || []) {
        if (variant?.image && variant.image !== retainedImage) {
          variant.image.removeAttribute("src");
        }
      }
    }

    function releaseCurrentSourceData() {
      preparationRunId++;
      clearRuntimePhaseFailureFlash();
      stopAllProcessSounds({ releaseCache: true });
      stopAllFailureSounds({ releaseCache: true, reason: "source-release" });
      releasePreparedFramePackage(preparedFramePackage);
      preparedFramePackage = null;
      preparationPromise = null;
      displayedFrameBlob = null;
      displayedFrameBytes = null;
      displayedFramePresentedAt = 0;
      displayedFrameHoldMilliseconds = 0;
      displayedSpectralFieldPromise = null;
      if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
      sourceObjectUrl = null;
      releaseResolutionVariantImages(sourceResolutionVariants, sourceImage);
      sourceResolutionVariants = [];
      if (sourceImage) sourceImage.removeAttribute("src");
      sourceImage = null;
      currentSource = null;
      currentBytes = null;
      sourceAnalysis = null;
      sourceStructure = null;
      sourceBaselineCoefficientContext = null;
      sourceProgressiveCoefficientContext = null;
      failureState = null;
      byteVarianceCoarse = null;
      byteVarianceFine = null;
      jpegSpectralField = null;
      sourcePersonalityFeatures = null;
      sourcePersonalityCoreAxes = null;
      sourcePersonalityTraits = null;
      currentFailureEvents = [];
      runtimeVariantExploration = null;
      resetRuntimeTechniqueMeters();
      setRuntimeOverlaySourceAvailable(false);
      updatePlaybackButton();
    }

    function validateJpeg(bytes) {
      if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
        throw new Error("JPEG start marker is missing");
      }
      let hasEoi = false;
      for (let index = bytes.length - 2; index >= 2; index--) {
        if (bytes[index] === 0xFF && bytes[index + 1] === 0xD9) {
          hasEoi = true;
          break;
        }
      }
      if (!hasEoi) throw new Error("JPEG end marker is missing");
      if (findJpegScanDataRanges(bytes).length === 0) {
        throw new Error("JPEG scan data is missing");
      }
    }

    function resizeImageToJpegBlob(image, width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Resolution canvas is unavailable");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);
      return canvasToJpegBlob(canvas);
    }

    function createJpegCoefficientContexts(bytes, structure, {
      warnOnFailure = false
    } = {}) {
      try {
        const frameMarker = structure.frames?.[0]?.marker;
        return {
          baseline: frameMarker === JPEG_SOF0_MARKER
            ? createBaselineCoefficientContext(bytes, structure)
            : createUnsupportedCoefficientContext("not-sof0"),
          progressive: frameMarker === JPEG_SOF2_MARKER
            ? createProgressiveCoefficientContext(bytes, structure)
            : createUnsupportedProgressiveCoefficientContext("not-sof2")
        };
      } catch (error) {
        if (warnOnFailure) {
          console.warn("Coefficient context unavailable:", error);
        }
        return {
          baseline: createUnsupportedCoefficientContext(
            error.code || "coefficient-context-error",
            error
          ),
          progressive: createUnsupportedProgressiveCoefficientContext(
            error.code || "progressive-coefficient-context-error",
            error
          )
        };
      }
    }

    function createByteVarianceFields(bytes, structure) {
      const { gridSize, windowCoarse, windowFine } = deriveByteFieldParams(
        structure.mutableIndices.length
      );
      return {
        coarse: buildByteVarianceGrid(
          bytes,
          structure.mutableIndices,
          gridSize,
          windowCoarse
        ),
        fine: buildByteVarianceGrid(
          bytes,
          structure.mutableIndices,
          gridSize,
          windowFine
        )
      };
    }

    function createResolutionVariant({
      blob,
      bytes,
      image,
      scale,
      generated,
      analysis,
      structure,
      baselineCoefficientContext,
      progressiveCoefficientContext,
      failureState,
      byteVarianceCoarse,
      byteVarianceFine,
      jpegSpectralField
    }) {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      return Object.freeze({
        id: `${width}x${height}`,
        width,
        height,
        scale,
        generated,
        blob,
        bytes,
        image,
        analysis,
        structure,
        baselineCoefficientContext,
        progressiveCoefficientContext,
        failureState,
        byteVarianceCoarse,
        byteVarianceFine,
        jpegSpectralField
      });
    }

    async function createResolutionMutationContext({
      blob,
      scale,
      generated
    }) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      validateJpeg(bytes);
      const structure = analyzeJpegStructure(bytes);
      structure.jfif = parseJfifDescriptor(bytes, structure);
      const coefficientContexts = createJpegCoefficientContexts(
        bytes,
        structure
      );
      const failureState = createFailureState(structure);
      const varianceFields = createByteVarianceFields(bytes, structure);
      const image = await decodeImageBlob(blob);
      const analysis = analyzeSourceImage(image);
      const jpegSpectralField = buildJpegSpectralField(
        bytes,
        structure,
        analysis
      );
      return createResolutionVariant({
        scale,
        generated,
        blob,
        bytes,
        image,
        analysis,
        structure,
        baselineCoefficientContext: coefficientContexts.baseline,
        progressiveCoefficientContext: coefficientContexts.progressive,
        failureState,
        byteVarianceCoarse: varianceFields.coarse,
        byteVarianceFine: varianceFields.fine,
        jpegSpectralField
      });
    }

    async function createSourceResolutionVariants({
      blob,
      bytes,
      image,
      analysis,
      structure,
      baselineCoefficientContext,
      progressiveCoefficientContext,
      failureState,
      byteVarianceCoarse,
      byteVarianceFine,
      jpegSpectralField,
      shouldContinue
    }) {
      const sourceWidth = image.naturalWidth;
      const sourceHeight = image.naturalHeight;
      const targetScales = SOURCE_RESOLUTION_SCALES.filter(
        (scale) => scale < 1
      );
      const generatedVariants = [];
      const generatedSizes = new Set();
      for (const scale of targetScales) {
        if (shouldContinue && !shouldContinue()) return [];
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const sizeKey = `${width}x${height}`;
        if (generatedSizes.has(sizeKey)) continue;
        generatedSizes.add(sizeKey);
        const resizedBlob = await resizeImageToJpegBlob(image, width, height);
        if (shouldContinue && !shouldContinue()) return [];
        generatedVariants.push(await createResolutionMutationContext({
          blob: resizedBlob,
          scale,
          generated: true
        }));
      }
      generatedVariants.push(createResolutionVariant({
        scale: 1,
        generated: false,
        blob,
        bytes,
        image,
        analysis,
        structure,
        baselineCoefficientContext,
        progressiveCoefficientContext,
        failureState,
        byteVarianceCoarse,
        byteVarianceFine,
        jpegSpectralField
      }));
      return Object.freeze(generatedVariants);
    }

    async function loadJpegSource({
      blob,
      name,
      origin,
      sourceUrl = null,
      loadRunId: reservedLoadRunId = null
    }) {
      const loadRunId = reservedLoadRunId ?? ++sourceLoadRunId;
      if (loadRunId !== sourceLoadRunId) return false;
      stopAuto();
      resetOutputState();
      releaseCurrentSourceData();
      setRuntimePhase("loading");

      let candidateObjectUrl = null;
      try {
        if (!(blob instanceof Blob)) throw new Error("JPEG source blob is required");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (loadRunId !== sourceLoadRunId) return false;
        validateJpeg(bytes);

        const structure = analyzeJpegStructure(bytes);
        structure.jfif = parseJfifDescriptor(bytes, structure);
        const coefficientContexts = createJpegCoefficientContexts(
          bytes,
          structure,
          { warnOnFailure: true }
        );
        const nextCoefficientContext = coefficientContexts.baseline;
        const nextProgressiveCoefficientContext =
          coefficientContexts.progressive;
        const nextFailureState = createFailureState(structure);
        const varianceFields = createByteVarianceFields(bytes, structure);
        const nextVarianceCoarse = varianceFields.coarse;
        const nextVarianceFine = varianceFields.fine;

        candidateObjectUrl = URL.createObjectURL(blob);
        const candidateImage = new Image();
        candidateImage.src = candidateObjectUrl;
        await candidateImage.decode();
        if (loadRunId !== sourceLoadRunId) {
          URL.revokeObjectURL(candidateObjectUrl);
          return false;
        }
        const analysis = analyzeSourceImage(candidateImage, {
          captureOriginalImageData: true
        });
        let nextPersonalityFeatures;
        let nextPersonalityCoreAxes;
        let nextPersonalityTraits;
        try {
          if (
            !globalThis.JpegPersonality?.analyzeFeatures ||
            !globalThis.JpegPersonality?.deriveCoreAxes ||
            !globalThis.JpegPersonality?.deriveBehaviorTraits
          ) {
            throw new Error("JPEG Personality analyzer is unavailable");
          }
          nextPersonalityFeatures = await JpegPersonality.analyzeFeatures({
            jpegBytes: bytes,
            jpegStructure: structure,
            originalImageData: analysis.originalImageData,
            analysis,
            fields: {
              byteVarianceCoarse: nextVarianceCoarse,
              edge: analysis.edge,
              texture: analysis.texture
            }
          });
          nextPersonalityCoreAxes = JpegPersonality.deriveCoreAxes(
            nextPersonalityFeatures
          );
          nextPersonalityTraits = JpegPersonality.deriveBehaviorTraits(
            nextPersonalityCoreAxes
          );
        } finally {
          delete analysis.originalImageData;
        }
        if (loadRunId !== sourceLoadRunId) {
          URL.revokeObjectURL(candidateObjectUrl);
          return false;
        }
        const nextSpectralField = buildJpegSpectralField(bytes, structure, analysis);
        if (loadRunId !== sourceLoadRunId) {
          URL.revokeObjectURL(candidateObjectUrl);
          return false;
        }
        const nextResolutionVariants = await createSourceResolutionVariants({
          blob,
          bytes,
          image: candidateImage,
          analysis,
          structure,
          baselineCoefficientContext: nextCoefficientContext,
          progressiveCoefficientContext: nextProgressiveCoefficientContext,
          failureState: nextFailureState,
          byteVarianceCoarse: nextVarianceCoarse,
          byteVarianceFine: nextVarianceFine,
          jpegSpectralField: nextSpectralField,
          shouldContinue: () => loadRunId === sourceLoadRunId
        });
        if (loadRunId !== sourceLoadRunId) {
          URL.revokeObjectURL(candidateObjectUrl);
          return false;
        }

        currentSource = {
          name: String(name || "source.jpg"),
          blob,
          origin: origin === "drop" ? "drop" : "asset",
          sourceUrl: sourceUrl ? String(sourceUrl) : null
        };
        currentBytes = bytes;
        sourceImage = candidateImage;
        sourceObjectUrl = candidateObjectUrl;
        sourceAnalysis = analysis;
        sourceStructure = structure;
        sourceBaselineCoefficientContext = nextCoefficientContext;
        sourceProgressiveCoefficientContext =
          nextProgressiveCoefficientContext;
        failureState = nextFailureState;
        byteVarianceCoarse = nextVarianceCoarse;
        byteVarianceFine = nextVarianceFine;
        jpegSpectralField = nextSpectralField;
        sourcePersonalityFeatures = nextPersonalityFeatures;
        sourcePersonalityCoreAxes = nextPersonalityCoreAxes;
        sourcePersonalityTraits = nextPersonalityTraits;
        sourceResolutionVariants = nextResolutionVariants;
        currentFailureEvents = [];
        autoFrame = 0;
        hasPlaybackStarted = false;
        playbackPaused = true;
        glitchedUrl = sourceObjectUrl;
        backgroundImg.src = sourceObjectUrl;
        document.body.classList.add("has-background");
        candidateObjectUrl = null;
        setStatus(
          `source ready: ${currentSource.name} / ${sourceResolutionVariants.length} resolutions / tap to play`
        );
        setRuntimeOverlaySourceAvailable(true);
        updatePlaybackButton();
        setRuntimePhase("idle");
        requestRuntimeOverlayRender();
        return true;
      } catch (error) {
        if (candidateObjectUrl) URL.revokeObjectURL(candidateObjectUrl);
        if (loadRunId !== sourceLoadRunId) return false;
        releaseCurrentSourceData();
        resetOutputState();
        setRuntimePhase("error");
        console.error(`JPEG source load failed (${name || "unknown"}):`, error);
        return false;
      }
    }

    async function loadDefaultAsset() {
      const loadRunId = ++sourceLoadRunId;
      setRuntimeOverlaySourceAvailable(false);
      setRuntimePhase("loading");
      const resolvedUrl = new URL(DEFAULT_SOURCE_URL, document.baseURI);
      const response = await fetch(resolvedUrl);
      if (loadRunId !== sourceLoadRunId) return false;
      if (!response.ok) {
        throw new Error(`Default JPEG load failed: ${response.status}`);
      }
      const blob = await response.blob();
      if (loadRunId !== sourceLoadRunId) return false;
      return loadJpegSource({
        blob,
        name: "1.jpg",
        origin: "asset",
        sourceUrl: resolvedUrl.href,
        loadRunId
      });
    }

    function handleDragOver(event) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }

    async function loadDroppedJpegFile(file) {
      if (!file) return;
      try {
        const marker = new Uint8Array(await file.slice(0, 2).arrayBuffer());
        if (marker[0] !== 0xFF || marker[1] !== 0xD8) {
          throw new Error("The dropped file is not a JPEG");
        }
        return await loadJpegSource({
          blob: file,
          name: file.name || "local-source.jpg",
          origin: "drop",
          sourceUrl: null
        });
      } catch (error) {
        setRuntimePhase("error");
        console.warn("Dropped JPEG load failed.", error);
        return false;
      }
    }

    async function handleDrop(event) {
      event.preventDefault();
      await loadDroppedJpegFile(event.dataTransfer?.files?.[0]);
    }

    function installDropTarget() {
      if (dropTargetInstalled) return;
      document.documentElement.addEventListener("dragover", handleDragOver);
      document.documentElement.addEventListener("drop", handleDrop);
      dropTargetInstalled = true;
    }

    function isPointInsideRenderedImage(clientX, clientY) {
      const bounds = getRenderedImageBounds();
      return Boolean(bounds) &&
        clientX >= bounds.left && clientX <= bounds.right &&
        clientY >= bounds.top && clientY <= bounds.bottom;
    }

    function handlePlaybackPointerDown(event) {
      if (!currentSource || !event.isPrimary || event.button !== 0) return;
      if (!isPointInsideRenderedImage(event.clientX, event.clientY)) return;
      playbackTap = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startedAt: performance.now()
      };
    }

    function handlePlaybackPointerUp(event) {
      const tap = playbackTap;
      playbackTap = null;
      if (!tap || tap.pointerId !== event.pointerId || !currentSource) return;
      const distance = Math.hypot(event.clientX - tap.x, event.clientY - tap.y);
      const elapsed = performance.now() - tap.startedAt;
      if (distance > 12 || elapsed > 600) return;
      if (!isPointInsideRenderedImage(event.clientX, event.clientY)) return;
      event.preventDefault();
      toggleAutoPlayback();
    }

    function clearPlaybackTap(event) {
      if (!event || playbackTap?.pointerId === event.pointerId) playbackTap = null;
    }

    function updatePlaybackButton() {
      if (!playbackButton) return;
      const visible = Boolean(currentSource);
      playbackButton.classList.toggle("is-visible", visible);
      playbackButton.classList.toggle("is-playing", visible && autoRunning);
      if (!visible) setRuntimeControlsHovered(false);
      playbackButton.disabled = !visible;
      playbackButton.setAttribute("aria-hidden", String(!visible));
      playbackButton.setAttribute("aria-label", autoRunning ? "一時停止" : "再生");
      positionRuntimeControlsOnImage();
    }

    function setRuntimeControlsHovered(hovered) {
      runtimeControls?.classList.toggle("is-output-hovered", Boolean(hovered));
    }

    function handlePlaybackHover(event) {
      setRuntimeControlsHovered(
        isPointInsideRenderedImage(event.clientX, event.clientY)
      );
    }

    function clearPlaybackHover() {
      setRuntimeControlsHovered(false);
    }

    function handlePlaybackButtonClick(event) {
      event.preventDefault();
      event.stopPropagation();
      toggleAutoPlayback();
    }

    function installPlaybackToggle() {
      if (playbackToggleInstalled) return;
      document.addEventListener("pointerdown", handlePlaybackPointerDown);
      document.addEventListener("pointerup", handlePlaybackPointerUp);
      document.addEventListener("pointercancel", clearPlaybackTap);
      document.addEventListener("pointermove", handlePlaybackHover);
      document.documentElement.addEventListener("pointerleave", clearPlaybackHover);
      window.addEventListener("resize", updatePlaybackButton);
      backgroundImg.addEventListener("load", updatePlaybackButton);
      playbackButton?.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      playbackButton?.addEventListener("pointerup", (event) => {
        event.stopPropagation();
      });
      playbackButton?.addEventListener("click", handlePlaybackButtonClick);
      playbackToggleInstalled = true;
    }

    function randomSteppedValue(minimum, maximum, step, random) {
      const steps = Math.round((maximum - minimum) / step);
      return minimum + Math.floor(random() * (steps + 1)) * step;
    }

    function selectUniformItem(values, random) {
      if (!values.length) return null;
      return values[Math.floor(random() * values.length)];
    }

    function selectUniformUniqueItems(values, count, random) {
      const available = values.slice();
      const selected = [];
      const limit = Math.min(available.length, Math.max(0, count));
      for (let index = 0; index < limit; index++) {
        const swapIndex = index + Math.floor(
          random() * (available.length - index)
        );
        [available[index], available[swapIndex]] = [
          available[swapIndex],
          available[index]
        ];
        selected.push(available[index]);
      }
      return selected;
    }

    function createRandomSeed() {
      const values = new Uint32Array(1);
      crypto.getRandomValues(values);
      return (values[0] >>> 0) || 1;
    }

    function randomizeSeed(config = runtimeConfig) {
      config.seed = createRandomSeed();
      return config;
    }

    function randomizeAutoSettings(
      config = runtimeConfig,
      analysis = sourceAnalysis,
      structure = sourceStructure,
      sourceBytes = currentBytes
    ) {
      const random = createPcg32Stream(
        config.seed,
        "auto-settings",
        analysis?.fingerprint || 0
      );
      const eligibleTechniqueNames = new Set(getEligibleLayerNames(
        structure,
        sourceBytes,
        sourceBaselineCoefficientContext,
        sourceProgressiveCoefficientContext
      ));
      const selectableTechniques = techniqueRegistry.filter(
        ({ name }) => eligibleTechniqueNames.has(name)
      );
      const registrySize = selectableTechniques.length;
      const requestedVariantCount = registrySize === 0
        ? 0
        : 1 + Math.floor(random() * registrySize);
      const shuffledTechniques = selectableTechniques.slice();
      for (let index = shuffledTechniques.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(random() * (index + 1));
        [shuffledTechniques[index], shuffledTechniques[swapIndex]] =
          [shuffledTechniques[swapIndex], shuffledTechniques[index]];
      }
      const selectedTechniques = shuffledTechniques.slice(
        0,
        requestedVariantCount
      );
      const selected = new Set(selectedTechniques.map(({ name }) => name));
      const parameterSets = {};
      for (const { name } of techniqueRegistry) {
        const parameters = createTechniqueParameterSet(
          name,
          config.seed,
          analysis
        );
        config.layers[name] = {
          enabled: selected.has(name),
          strength: parameters.strength
        };
        parameterSets[name] = parameters;
      }
      if (selectedTechniques.length > 0) {
        const selectedMutationRate = selectedTechniques
          .map(({ name }) => parameterSets[name].mutationRate)
          .find(Number.isFinite);
        if (Number.isFinite(selectedMutationRate)) {
          config.mutationRate = selectedMutationRate;
        }
      }
      config.mode = parameterSets.entropy.mode;
      config.region = "full";
      config.maskCoverage = randomSteppedValue(1.2, 2, 0.1, random);
      const normalized = normalizeRuntimeConfig(config);
      const slots = selectedTechniques.map(({ name: family }, slot) => ({
        slot,
        family,
        priority: null,
        variantSeed: mixSeed(
          config.seed,
          `variant-slot:${family}`,
          analysis?.fingerprint || 0
        ) >>> 0,
        eligible: true,
        strategy: parameterSets[family].mode,
        parameters: { ...parameterSets[family] }
      }));
      const variantExploration = {
        enabled: true,
        connected: true,
        source: "technique-registry-uniform",
        requestedCount: requestedVariantCount,
        resolvedCount: requestedVariantCount,
        minimum: registrySize > 0 ? 1 : 0,
        maximum: registrySize,
        fallbackUsed: false,
        attemptedCount: 0,
        successfulCount: 0,
        compositedCount: 0,
        slots
      };
      const registryMetadata = {
        seed: config.seed,
        requestedVariantCount,
        eligibleTechniqueNames: selectableTechniques.map(({ name }) => name),
        excludedTechniqueNames: techniqueRegistry
          .filter(({ name }) => !selectableTechniques.some(
            (technique) => technique.name === name
          ))
          .map(({ name }) => name),
        selectedTechniqueNames: slots.map((slot) => slot.family),
        techniques: slots.map((slot) => ({
          name: slot.family,
          parameters: { ...slot.parameters },
          status: "pending",
          rejectReason: null
        })),
        successfulVariantCount: 0
      };
      variantExplorationMetadataByConfig.set(config, variantExploration);
      variantExplorationMetadataByConfig.set(normalized, variantExploration);
      registryGenerationMetadataByConfig.set(config, registryMetadata);
      registryGenerationMetadataByConfig.set(normalized, registryMetadata);
      return normalized;
    }

    function createTechniqueParameterSet(name, seed, analysis = null) {
      if (!variantDefinitions[name]) {
        throw new RangeError(`unknown-technique:${name}`);
      }
      const parameterRandom = createPcg32Stream(
        seed,
        `technique-parameters:${name}`,
        analysis?.fingerprint || 0
      );
      const rateRange = variantDefinitions[name].mutationRateRange ||
        mutationRangeConfig.mutationRate;
      const strengthRange = mutationRangeConfig.layerStrength[name];
      const mutationRate = randomSteppedValue(
        rateRange.min,
        rateRange.max,
        rateRange.step,
        parameterRandom
      );
      const strength = strengthRange.min === strengthRange.max
        ? strengthRange.min
        : randomSteppedValue(
            strengthRange.min,
            strengthRange.max,
            strengthRange.step,
            parameterRandom
          );
      const mode = name === "entropy"
        ? selectUniformItem(entropyMutationModes, parameterRandom)
        : null;
      const maskCoverage = randomSteppedValue(
        1,
        2,
        0.1,
        parameterRandom
      );
      return {
        ...(mutationRateTechniqueNames.has(name) ? { mutationRate } : {}),
        strength,
        mode,
        region: "full",
        maskCoverage
      };
    }

    function getLayerSettings(config = runtimeConfig) {
      return Object.fromEntries(layerNames.map((name) => [
        name,
        {
          enabled: Boolean(config.layers?.[name]?.enabled),
          strength: Number(config.layers?.[name]?.strength)
        }
      ]));
    }

    function normalizeTelemetryMeter(value, minimum, maximum) {
      return clamp01((Number(value) - minimum) / Math.max(Number.EPSILON, maximum - minimum));
    }

    function normalizeLayerStrength(name, strength) {
      const range = mutationRangeConfig.layerStrength[name];
      if (range.min === range.max) {
        return Number(strength) === range.min ? 1 : 0;
      }
      return normalizeTelemetryMeter(strength, range.min, range.max);
    }

    function getRuntimeTelemetrySnapshot() {
      const config = cloneRuntimeConfig(runtimeConfig);
      const byFamily = {};
      const byStage = {};
      for (const event of currentFailureEvents || []) {
        byFamily[event.family] = (byFamily[event.family] || 0) + 1;
        byStage[event.stage] = (byStage[event.stage] || 0) + 1;
      }
      const latestFailure = currentFailureEvents?.[currentFailureEvents.length - 1] || null;
      const state = failureState;
      return {
        phase: runtimePhase,
        hasPlaybackStarted,
        seed: config.seed,
        frame: autoFrame,
        mutationRate: config.mutationRate,
        maskCoverage: config.maskCoverage,
        maskOpacity: config.maskOpacity,
        holdSeconds: config.intervalSeconds,
        activeVariants: layerNames.filter((name) => config.layers[name].enabled),
        variantStrengths: Object.fromEntries(layerNames.map((name) => [
          name,
          config.layers[name].strength
        ])),
        meters: {
          mutation: normalizeTelemetryMeter(
            config.mutationRate,
            mutationRangeConfig.mutationRate.min,
            mutationRangeConfig.mutationRate.max
          ),
          coverage: normalizeTelemetryMeter(config.maskCoverage, 0.1, 2),
          hold: normalizeTelemetryMeter(config.intervalSeconds, 0.5, 8),
          variants: Object.fromEntries(layerNames.map((name) => [
            name,
            normalizeLayerStrength(name, config.layers[name].strength)
          ]))
        },
        rejectedAttempts: {
          total: currentFailureEvents?.length || 0,
          byFamily,
          byStage,
          latestFamily: latestFailure?.family ? String(latestFailure.family) : null,
          latestCode: latestFailure?.code ? String(latestFailure.code) : null
        },
        failure: {
          scanMean: clamp01(state?.stats?.scanMean || 0),
          scanMax: clamp01(state?.stats?.scanMax || 0),
          dqtPressure: clamp01(state?.pressures?.dqt || 0),
          dhtPressure: clamp01(state?.pressures?.dht || 0),
          sofPressure: clamp01(state?.pressures?.sof || 0),
          sosPressure: clamp01(state?.pressures?.sos || 0),
          globalPressure: clamp01(state?.pressures?.global || 0)
        },
        generation: {
          autoRunning,
          isGenerating,
          isPreparingNextFrame: Boolean(preparationPromise),
          hasPreparedFrame: Boolean(preparedFramePackage)
        },
        source: currentSource ? {
          name: currentSource.name,
          origin: currentSource.origin
        } : null,
        status: { ...runtimeStatus }
      };
    }

    function getIntervalMilliseconds(config = runtimeConfig) {
      return normalizeRuntimeConfig(config).intervalSeconds * 1000;
    }

    function settleAutoResumeWaiters(shouldResume) {
      for (const waiter of autoResumeWaiters) {
        waiter.resolve(Boolean(shouldResume) && waiter.runId === autoRunId);
      }
      autoResumeWaiters.clear();
    }

    function waitForAutoResume(runId) {
      if (runId !== autoRunId || !currentBytes) return Promise.resolve(false);
      if (autoRunning) return Promise.resolve(true);
      return new Promise((resolve) => {
        autoResumeWaiters.add({ runId, resolve });
      });
    }

    function settleAutoDelayWaiters(shouldContinue) {
      for (const waiter of autoDelayWaiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(
          Boolean(shouldContinue) && waiter.runId === autoRunId
        );
      }
      autoDelayWaiters.clear();
    }

    function waitForAutoDelay(milliseconds, runId) {
      if (runId !== autoRunId || !currentBytes) return Promise.resolve(false);
      const delay = Math.max(0, Number(milliseconds) || 0);
      return new Promise((resolve) => {
        const waiter = { runId, timer: null, resolve };
        waiter.timer = setTimeout(() => {
          autoDelayWaiters.delete(waiter);
          resolve(runId === autoRunId && Boolean(currentBytes));
        }, delay);
        autoDelayWaiters.add(waiter);
      });
    }

    function waitForDisplayedFrameHold({
      presentedAt,
      holdMilliseconds,
      runId
    }) {
      const remaining = Math.max(
        0,
        presentedAt + holdMilliseconds - performance.now()
      );
      return waitForAutoDelay(remaining, runId);
    }

    async function prepareNextAutoFrame({ runId, frameNumber, config }) {
      if (runId !== autoRunId || !currentBytes) return null;
      if (preparedFramePackage) return preparedFramePackage;
      if (preparationPromise) return preparationPromise;
      const detail = (
        sourceAnalysis.stats.edge + sourceAnalysis.stats.texture
      ) * 0.5;
      const phase = frameNumber /
        (1 + detail * 4 + sourceAnalysis.stats.saliency);
      decayFailureState(failureState);
      preparationPromise = prepareFramePackage({
        config,
        temporalPhase: phase,
        frameNumber
      });
      try {
        const prepared = await preparationPromise;
        if (runId !== autoRunId || !currentBytes) {
          releasePreparedFramePackage(prepared);
          return null;
        }
        preparedFramePackage = prepared;
        return prepared;
      } finally {
        preparationPromise = null;
        requestRuntimeOverlayRender();
      }
    }

    async function runAutoLoop(runId) {
      try {
        while (runId === autoRunId && currentBytes) {
          if (displayedSpectralFieldPromise) {
            const pendingSpectralField = displayedSpectralFieldPromise;
            displayedSpectralFieldPromise = null;
            try {
              const nextSpectralField = await pendingSpectralField;
              if (runId !== autoRunId || !currentBytes) break;
              if (nextSpectralField) jpegSpectralField = nextSpectralField;
            } catch {
              // Keep the last valid field when feedback preparation fails.
            }
          }
          const frameNumber = autoFrame;
          const nextConfig = createPreparedFrameConfig(runtimeConfig);
          const preparation = prepareNextAutoFrame({
            runId,
            frameNumber,
            config: nextConfig
          });
          const hold = displayedFramePresentedAt > 0
            ? waitForDisplayedFrameHold({
                presentedAt: displayedFramePresentedAt,
                holdMilliseconds: displayedFrameHoldMilliseconds,
                runId
              })
            : Promise.resolve(true);
          const [holdCompleted, prepared] = await Promise.all([
            hold,
            preparation
          ]);
          if (!holdCompleted || runId !== autoRunId || !currentBytes) {
            if (prepared && runId !== autoRunId) {
              releasePreparedFramePackage(prepared);
            }
            if (runId !== autoRunId || !currentBytes) break;
            if (!await waitForAutoDelay(200, runId)) break;
            continue;
          }
          if (!prepared) {
            if (!autoRunning && !await waitForAutoResume(runId)) break;
            const rejectedGeneration = getAllRejectedRegistryGeneration(
              nextConfig
            );
            if (rejectedGeneration) {
              await playAllRejectedTechniqueMeters(
                rejectedGeneration,
                runId
              );
            }
            if (runId !== autoRunId || !currentBytes) break;
            if (!await waitForAutoDelay(200, runId)) break;
            continue;
          }
          if (!autoRunning && !await waitForAutoResume(runId)) break;
          if (runId !== autoRunId || !currentBytes) break;
          const presented = await presentPreparedFrame(prepared, { runId });
          if (!presented) {
            if (runId !== autoRunId || !currentBytes) break;
            if (!autoRunning && !await waitForAutoResume(runId)) break;
            if (!await waitForAutoDelay(200, runId)) break;
            continue;
          }
          autoFrame++;
          requestRuntimeOverlayRender();
        }
      } finally {
        if (activeAutoLoopRunId === runId) {
          activeAutoLoopPromise = null;
          activeAutoLoopRunId = null;
        }
        if (!autoRunning && currentSource && runId === autoRunId) {
          setStatus("paused");
          setRuntimePhase("idle");
        }
      }
    }

    function startAuto({ resetFrame = true } = {}) {
      if (!currentBytes || autoRunning) return;
      autoRunning = true;
      hasPlaybackStarted = true;
      playbackPaused = false;
      updatePlaybackButton();
      settlePlaybackPauseWaiters(true);
      settleAutoResumeWaiters(true);
      if (resetFrame) autoFrame = 0;
      if (activeAutoLoopPromise && activeAutoLoopRunId === autoRunId) {
        resumeRuntimeTechniqueMeterAnimations();
        setStatus("playing");
        setRuntimePhase(
          pausedRuntimePhase === "transition" ? "transition" : "hold"
        );
        requestRuntimeOverlayRender();
        return;
      }
      const runId = ++autoRunId;
      resumeRuntimeTechniqueMeterAnimations();
      activeAutoLoopRunId = runId;
      activeAutoLoopPromise = runAutoLoop(runId);
    }

    function pauseAuto() {
      if (!autoRunning) return;
      autoRunning = false;
      playbackPaused = true;
      pausedRuntimePhase = runtimePhase;
      if (autoTimer !== null) clearTimeout(autoTimer);
      autoTimer = null;
      finishActiveTransitionHold();
      clearPendingFailureSoundTimers("pause");
      const context = transitionAudioContext;
      if (context?.state === "running") {
        context.suspend().catch(() => {
          // Audio suspension is best-effort; visual playback still pauses.
        });
        installTransitionAudioUnlock();
      }
      pauseRuntimeTechniqueMeterAnimations();
      setStatus("paused");
      setRuntimePhase("idle");
      updatePlaybackButton();
      requestRuntimeOverlayRender();
    }

    function toggleAutoPlayback() {
      if (!currentBytes) return;
      if (autoRunning) {
        pauseAuto();
      } else {
        startAuto({ resetFrame: false });
      }
    }

    function stopAuto() {
      playbackTap = null;
      playbackPaused = false;
      autoRunning = false;
      autoRunId++;
      preparationRunId++;
      generationRunId++;
      transitionRunId++;
      clearRuntimePhaseFailureFlash();
      updatePlaybackButton();
      settlePlaybackPauseWaiters(false);
      settleAutoResumeWaiters(false);
      settleAutoDelayWaiters(false);
      cancelActiveTransitionHold();
      stopAllProcessSounds({ releaseCache: true });
      stopAllFailureSounds({ releaseCache: true, reason: "stop" });
      for (const name of layerNames) {
        cancelRuntimeTechniqueMeterAnimation(name);
      }
      if (autoTimer !== null) clearTimeout(autoTimer);
      autoTimer = null;
      releasePreparedFramePackage(preparedFramePackage);
      preparedFramePackage = null;
      preparationPromise = null;
      if (currentSource) setRuntimePhase("idle");
    }

    async function initializeApp() {
      runtimeConfig = normalizeRuntimeConfig(createDefaultRuntimeConfig());
      clearRuntimePhaseFailureFlash();
      installTransitionAudioUnlock();
      try {
        initializeRuntimeOverlay();
        requestRuntimeOverlayRender();
      } catch (error) {
        console.warn("Runtime overlay initialization failed:", error);
      }
      installDropTarget();
      installPlaybackToggle();
      try {
        await loadDefaultAsset();
      } catch (error) {
        setRuntimePhase("error");
        if (location.protocol === "file:") {
          console.error(
            "assets/1.jpg could not be loaded. Open this page through a local HTTP server.",
            error
          );
        } else {
          console.error("Default asset load failed:", error);
        }
      }
    }

    function createPreparedFrameConfig(currentConfig = runtimeConfig) {
      const next = cloneRuntimeConfig(currentConfig);
      randomizeSeed(next);
      return randomizeAutoSettings(
        next,
        sourceAnalysis,
        sourceStructure,
        currentBytes
      );
    }

    function captureSourceContext() {
      return Object.freeze({
        source: currentSource,
        bytes: currentBytes,
        image: sourceImage,
        analysis: sourceAnalysis,
        structure: sourceStructure,
        baselineCoefficientContext: sourceBaselineCoefficientContext,
        progressiveCoefficientContext: sourceProgressiveCoefficientContext,
        failureState,
        byteVarianceCoarse,
        byteVarianceFine,
        jpegSpectralField,
        resolutionVariants: sourceResolutionVariants
      });
    }

    function createSourceToken(context) {
      return Object.freeze({
        source: context.source,
        bytes: context.bytes,
        structure: context.structure,
        resolutionVariants: context.resolutionVariants,
        loadRunId: sourceLoadRunId
      });
    }

    function isSourceTokenCurrent(token) {
      return Boolean(
        token &&
        token.source === currentSource &&
        token.bytes === currentBytes &&
        token.structure === sourceStructure &&
        token.resolutionVariants === sourceResolutionVariants &&
        token.loadRunId === sourceLoadRunId
      );
    }

    function createFramePreparationContext({
      sourceContext,
      config,
      frameNumber,
      generationRunId: frameGenerationRunId,
      preparationRunId: framePreparationRunId
    }) {
      return Object.freeze({
        source: sourceContext,
        config,
        frameNumber,
        generationRunId: frameGenerationRunId,
        preparationRunId: framePreparationRunId
      });
    }

    function normalizeGenerationOptions(options, sourceContext) {
      return {
        ...options,
        structure: options.structure ?? sourceContext.structure,
        analysis: options.analysis ?? sourceContext.analysis,
        coefficientContext: options.coefficientContext ??
          sourceContext.baselineCoefficientContext,
        progressiveCoefficientContext:
          options.progressiveCoefficientContext ??
          sourceContext.progressiveCoefficientContext,
        failureState: options.failureState ?? sourceContext.failureState,
        byteVarianceCoarse: options.byteVarianceCoarse ??
          sourceContext.byteVarianceCoarse,
        byteVarianceFine: options.byteVarianceFine ??
          sourceContext.byteVarianceFine,
        jpegSpectralField: options.jpegSpectralField ??
          sourceContext.jpegSpectralField,
        resolutionVariants: options.resolutionVariants ??
          sourceContext.resolutionVariants
      };
    }

    // ========================================================================
    // 06. JPEG MARKER AND STRUCTURE CORE
    // ========================================================================
    function analyzeJpegStructure(bytes) {
      const segments = findJpegSegments(bytes);
      const scanRanges = findJpegScanDataRanges(bytes);
      const entropyBytes = scanRanges.reduce((sum, range) => sum + range.end - range.start, 0);
      const frameSegments = segments.filter((segment) =>
        JPEG_FRAME_MARKERS.has(segment.marker)
      );
      const frames = frameSegments
        .map((segment) => parseJpegFrame(bytes, segment))
        .filter(Boolean);
      const scans = segments
        .filter((segment) => segment.marker === 0xDA)
        .map((segment) => parseJpegScan(bytes, segment))
        .filter(Boolean);
      for (const scan of scans) {
        const owningFrame = frames
          .filter((frame) => frame.markerOffset < scan.offset)
          .sort((left, right) => right.markerOffset - left.markerOffset)[0];
        scan.frameMarkerOffset = owningFrame?.markerOffset ?? null;
      }
      const driDefinitions = segments
        .map((segment) => parseDriDefinition(bytes, segment))
        .filter(Boolean)
        .sort((left, right) => left.definitionOffset - right.definitionOffset);
      for (const scan of scans) {
        scan.dri = resolveDriForScan(scan, driDefinitions);
        scan.restartMarkers = parseRestartMarkersInScan(bytes, scan);
      }
      const quantTables = parseJpegQuantTableTimeline(bytes, segments);
      const huffmanTables = parseJpegHuffmanTableTimeline(bytes, segments);
      let width = 0;
      let height = 0;
      let componentCount = 0;
      let blockCount = 0;

      if (frames.length) {
        const frame = frames[0];
        height = frame.height;
        width = frame.width;
        componentCount = frame.components.length;
        const maxHorizontal = frame.hMax;
        const maxVertical = frame.vMax;
        const mcuColumns = Math.ceil(width / (8 * maxHorizontal));
        const mcuRows = Math.ceil(height / (8 * maxVertical));
        const blocksPerMcu = frame.components.reduce(
          (sum, item) => sum + item.h * item.v,
          0
        );
        blockCount = mcuColumns * mcuRows * Math.max(1, blocksPerMcu);
      }

      return {
        segments,
        byteLength: bytes.length,
        width,
        height,
        componentCount,
        blockCount: Math.max(1, blockCount),
        entropyBytes: Math.max(1, entropyBytes),
        scanCount: scanRanges.length,
        dqtTableCount: quantTables.length,
        dhtTableCount: huffmanTables.length,
        scanRanges,
        frames,
        scans,
        driDefinitions,
        quantTables,
        huffmanTables,
        mutableIndices: collectMutableIndices(bytes, scanRanges, "full"),
        dqtSegments: segments.filter((segment) => segment.marker === 0xDB),
        dhtSegments: segments.filter((segment) => segment.marker === 0xC4),
        sofSegments: frameSegments,
        sosSegments: segments.filter((segment) => segment.marker === 0xDA)
      };
    }

    class JpegEntropyDecodeError extends Error {
      constructor(code, context = {}) {
        super(code);
        this.name = "JpegEntropyDecodeError";
        this.code = code;
        Object.assign(this, context);
      }
    }

    function createJpegEntropyDecodeError(code, context = {}) {
      return new JpegEntropyDecodeError(code, context);
    }

    function getBaselineCoefficientDecodeSupport(structure) {
      if (!structure) {
        return { supported: false, reason: "missing-structure" };
      }
      if (structure.frames?.length !== 1) {
        return { supported: false, reason: "frame-count-not-one" };
      }

      const frame = structure.frames[0];
      if (frame.marker !== 0xC0) {
        return { supported: false, reason: "not-sof0" };
      }
      if (frame.precision !== 8) {
        return { supported: false, reason: "sample-precision-not-eight" };
      }
      if (
        !Number.isInteger(frame.width) ||
        !Number.isInteger(frame.height) ||
        frame.width <= 0 ||
        frame.height <= 0
      ) {
        return { supported: false, reason: "frame-dimensions-unresolved" };
      }

      const scans = structure.scans || [];
      if (scans.length !== 1) {
        return { supported: false, reason: "scan-count-not-one" };
      }
      const scan = scans[0];
      if (
        scan.spectralStart !== 0 ||
        scan.spectralEnd !== 63 ||
        scan.successiveHigh !== 0 ||
        scan.successiveLow !== 0
      ) {
        return { supported: false, reason: "not-baseline-sequential-scan" };
      }

      const frameIds = frame.components
        .map((component) => component.id)
        .sort((left, right) => left - right);
      const scanIds = scan.componentIds
        .slice()
        .sort((left, right) => left - right);
      if (new Set(frameIds).size !== frameIds.length) {
        return { supported: false, reason: "duplicate-frame-component-id" };
      }
      if (new Set(scanIds).size !== scanIds.length) {
        return { supported: false, reason: "duplicate-scan-component-id" };
      }
      if (
        frameIds.length !== scanIds.length ||
        frameIds.some((id, index) => id !== scanIds[index])
      ) {
        return {
          supported: false,
          reason: "scan-does-not-cover-frame-components"
        };
      }

      return { supported: true, reason: null, frame, scan };
    }

    function parseHuffmanDefinitions(bytes, structure) {
      const definitions = [];
      const segments = (structure?.dhtSegments || [])
        .slice()
        .sort((left, right) => left.markerOffset - right.markerOffset);

      for (const segment of segments) {
        let position = segment.payloadStart;
        while (position < segment.payloadEnd) {
          const definitionOffset = position;
          if (position + 17 > segment.payloadEnd) {
            throw createJpegEntropyDecodeError(
              "truncated-huffman-definition",
              { byteOffset: position, segmentMarkerOffset: segment.markerOffset }
            );
          }

          const descriptor = bytes[position++];
          const tableClass = descriptor >>> 4;
          const tableId = descriptor & 0x0F;
          if (tableClass !== 0 && tableClass !== 1) {
            throw createJpegEntropyDecodeError(
              "invalid-huffman-table-class",
              {
                byteOffset: definitionOffset,
                segmentMarkerOffset: segment.markerOffset,
                tableClass,
                tableId
              }
            );
          }
          if (tableId > 3) {
            throw createJpegEntropyDecodeError(
              "huffman-table-id-out-of-range",
              {
                byteOffset: definitionOffset,
                segmentMarkerOffset: segment.markerOffset,
                tableClass,
                tableId
              }
            );
          }

          const codeCounts = new Uint8Array(bytes.slice(position, position + 16));
          position += 16;
          const symbolCount = codeCounts.reduce(
            (sum, count) => sum + count,
            0
          );
          if (position + symbolCount > segment.payloadEnd) {
            throw createJpegEntropyDecodeError(
              "truncated-huffman-symbols",
              {
                byteOffset: position,
                segmentMarkerOffset: segment.markerOffset,
                tableClass,
                tableId,
                symbolCount
              }
            );
          }
          const symbols = new Uint8Array(
            bytes.slice(position, position + symbolCount)
          );
          position += symbolCount;
          definitions.push({
            tableClass,
            tableId,
            definitionOffset,
            segmentMarkerOffset: segment.markerOffset,
            codeCounts,
            symbols,
            symbolCount
          });
        }
        if (position !== segment.payloadEnd) {
          throw createJpegEntropyDecodeError(
            "unused-huffman-segment-bytes-remain",
            {
              byteOffset: position,
              segmentMarkerOffset: segment.markerOffset
            }
          );
        }
      }
      return definitions;
    }

    function resolveHuffmanDefinition(
      definitions,
      scanOffset,
      tableClass,
      tableId
    ) {
      let selected = null;
      for (const definition of definitions) {
        if (definition.definitionOffset >= scanOffset) break;
        if (
          definition.tableClass === tableClass &&
          definition.tableId === tableId
        ) {
          selected = definition;
        }
      }
      return selected;
    }

    class JpegProgressiveScriptError extends Error {
      constructor(code, context = {}) {
        super(code);
        this.name = "JpegProgressiveScriptError";
        this.code = code;
        Object.assign(this, context);
      }
    }

    function getProgressiveCoefficientScriptSupport(structure) {
      if (!structure) {
        return { supported: false, reason: "missing-structure" };
      }
      if (structure.frames?.length !== 1) {
        return { supported: false, reason: "frame-count-not-one" };
      }
      const frame = structure.frames[0];
      if (frame.marker !== JPEG_SOF2_MARKER) {
        return { supported: false, reason: "not-sof2" };
      }
      if (frame.precision !== 8) {
        return { supported: false, reason: "sample-precision-not-eight" };
      }
      if (
        !Number.isInteger(frame.width) ||
        !Number.isInteger(frame.height) ||
        frame.width <= 0 ||
        frame.height <= 0
      ) {
        return { supported: false, reason: "frame-dimensions-unresolved" };
      }
      if (!Array.isArray(structure.scans) || structure.scans.length === 0) {
        return { supported: false, reason: "scan-list-empty" };
      }
      return { supported: true, reason: null, frame };
    }

    function resolveProgressiveScanComponents(frame, scan, scanIndex) {
      if (!Array.isArray(scan?.components) || scan.components.length === 0) {
        throw new JpegProgressiveScriptError(
          "scan-component-list-empty",
          { scanIndex, scanOffset: scan?.offset ?? null }
        );
      }
      const components = [];
      const seenIds = new Set();
      let previousFrameIndex = -1;
      for (const scanComponent of scan.components) {
        const componentId = scanComponent.id;
        if (seenIds.has(componentId)) {
          throw new JpegProgressiveScriptError(
            "duplicate-scan-component",
            { scanIndex, scanOffset: scan.offset, componentId }
          );
        }
        const componentIndex = frame.components.findIndex(
          (component) => component.id === componentId
        );
        if (componentIndex < 0) {
          throw new JpegProgressiveScriptError(
            "scan-component-not-in-frame",
            { scanIndex, scanOffset: scan.offset, componentId }
          );
        }
        if (componentIndex <= previousFrameIndex) {
          throw new JpegProgressiveScriptError(
            "scan-component-order-invalid",
            {
              scanIndex,
              scanOffset: scan.offset,
              componentId,
              componentIndex,
              previousFrameIndex
            }
          );
        }
        seenIds.add(componentId);
        previousFrameIndex = componentIndex;
        components.push({
          ...scanComponent,
          componentIndex,
          frameComponent: frame.components[componentIndex]
        });
      }
      return components;
    }

    function validateProgressiveScanSampling(scanComponents, scanIndex) {
      for (const item of scanComponents) {
        const { h, v } = item.frameComponent;
        if (
          !Number.isInteger(h) || !Number.isInteger(v) ||
          h < 1 || h > 4 || v < 1 || v > 4
        ) {
          throw new JpegProgressiveScriptError(
            "invalid-frame-sampling-factor",
            { scanIndex, componentId: item.id, horizontal: h, vertical: v }
          );
        }
      }
      if (scanComponents.length <= 1) return;
      const samplingSum = scanComponents.reduce(
        (sum, item) => sum + item.frameComponent.h * item.frameComponent.v,
        0
      );
      if (samplingSum > 10) {
        throw new JpegProgressiveScriptError(
          "interleaved-sampling-sum-exceeds-ten",
          { scanIndex, samplingSum }
        );
      }
    }

    function classifyProgressiveScan(scan, scanComponents, scanIndex) {
      const Ss = scan.spectralStart;
      const Se = scan.spectralEnd;
      const Ah = scan.successiveHigh;
      const Al = scan.successiveLow;
      if (
        !Number.isInteger(Ss) || !Number.isInteger(Se) ||
        Ss < 0 || Ss > JPEG_LAST_AC_COEFFICIENT_INDEX ||
        Se < 0 || Se > JPEG_LAST_AC_COEFFICIENT_INDEX
      ) {
        throw new JpegProgressiveScriptError(
          "spectral-selection-out-of-range",
          { scanIndex, scanOffset: scan.offset, Ss, Se }
        );
      }
      if (
        !Number.isInteger(Ah) || !Number.isInteger(Al) ||
        Ah < 0 || Al < 0 ||
        Ah > JPEG_PROGRESSIVE_MAX_SUCCESSIVE_APPROXIMATION ||
        Al > JPEG_PROGRESSIVE_MAX_SUCCESSIVE_APPROXIMATION
      ) {
        throw new JpegProgressiveScriptError(
          "successive-approximation-out-of-range",
          { scanIndex, scanOffset: scan.offset, Ah, Al }
        );
      }
      const isDcBand = Ss === JPEG_DC_COEFFICIENT_INDEX;
      if (isDcBand) {
        if (Se !== JPEG_DC_COEFFICIENT_INDEX) {
          throw new JpegProgressiveScriptError(
            "dc-scan-se-not-zero",
            { scanIndex, scanOffset: scan.offset, Ss, Se }
          );
        }
      } else {
        if (Ss < JPEG_FIRST_AC_COEFFICIENT_INDEX || Ss > Se) {
          throw new JpegProgressiveScriptError(
            "ac-spectral-band-invalid",
            { scanIndex, scanOffset: scan.offset, Ss, Se }
          );
        }
        if (scanComponents.length !== 1) {
          throw new JpegProgressiveScriptError(
            "ac-scan-not-single-component",
            { scanIndex, componentCount: scanComponents.length }
          );
        }
      }
      if (Ah > 0 && Al !== Ah - 1) {
        throw new JpegProgressiveScriptError(
          "refinement-step-not-one-bit",
          { scanIndex, scanOffset: scan.offset, Ah, Al }
        );
      }
      if (isDcBand) return Ah === 0 ? "dc-first" : "dc-refine";
      return Ah === 0 ? "ac-first" : "ac-refine";
    }

    function createProgressiveCoefficientState(frame) {
      return new Map(frame.components.map((component) => [
        component.id,
        new Int8Array(JPEG_DCT_COEFFICIENT_COUNT).fill(-1)
      ]));
    }

    function cloneCoefficientState(coefficientState) {
      return new Map([...coefficientState].map(([componentId, state]) => [
        componentId,
        new Int8Array(state)
      ]));
    }

    function compactProgressiveStateForBand(
      coefficientState,
      scanComponents,
      from,
      to
    ) {
      const ranges = [];
      for (const component of scanComponents) {
        const state = coefficientState.get(component.id);
        let rangeStart = from;
        let bitPosition = state[from];
        for (let index = from + 1; index <= to + 1; index++) {
          const next = index <= to ? state[index] : null;
          if (index <= to && next === bitPosition) continue;
          ranges.push({
            componentId: component.id,
            from: rangeStart,
            to: index - 1,
            bitPosition
          });
          rangeStart = index;
          bitPosition = next;
        }
      }
      return ranges;
    }

    function applyProgressiveScanToState({
      scanIndex,
      scanType,
      scan,
      scanComponents,
      coefficientState
    }) {
      const Ss = scan.spectralStart;
      const Se = scan.spectralEnd;
      const Ah = scan.successiveHigh;
      const Al = scan.successiveLow;
      for (const scanComponent of scanComponents) {
        const componentId = scanComponent.id;
        const state = coefficientState.get(componentId);
        if (!state) {
          throw new JpegProgressiveScriptError(
            "coefficient-state-component-missing",
            { scanIndex, componentId }
          );
        }
        if (
          (scanType === "ac-first" || scanType === "ac-refine") &&
          state[JPEG_DC_COEFFICIENT_INDEX] < 0
        ) {
          throw new JpegProgressiveScriptError(
            "ac-before-first-dc",
            { scanIndex, componentId }
          );
        }
        for (let coefficientIndex = Ss; coefficientIndex <= Se; coefficientIndex++) {
          const previousAl = state[coefficientIndex];
          if (Ah === 0 && previousAl >= 0) {
            throw new JpegProgressiveScriptError(
              "progressive-first-band-duplicate",
              { scanIndex, componentId, coefficientIndex, previousAl, Al }
            );
          }
          const expectedAh = previousAl < 0 ? 0 : previousAl;
          if (Ah !== expectedAh) {
            throw new JpegProgressiveScriptError(
              "progression-history-mismatch",
              {
                scanIndex,
                componentId,
                coefficientIndex,
                previousAl,
                expectedAh,
                actualAh: Ah,
                Al
              }
            );
          }
          state[coefficientIndex] = Al;
        }
      }
    }

    function getProgressiveHuffmanDefinitions(structure) {
      return (structure?.huffmanTables || [])
        .map((definition) => ({
          ...definition,
          tableId: definition.id,
          codeCounts: new Uint8Array(definition.counts || []),
          symbols: new Uint8Array(definition.symbols || [])
        }))
        .sort((left, right) => left.definitionOffset - right.definitionOffset);
    }

    function resolveProgressiveScanTables({
      definitions,
      scan,
      scanIndex,
      scanType,
      scanComponents
    }) {
      const tables = [];
      for (const component of scanComponents) {
        let dcDefinition = null;
        let acDefinition = null;
        if (scanType === "dc-first") {
          dcDefinition = resolveHuffmanDefinition(
            definitions,
            scan.offset,
            0,
            component.dcTableId
          );
          if (!dcDefinition) {
            throw new JpegProgressiveScriptError(
              "progressive-dc-table-missing",
              {
                scanIndex,
                componentId: component.id,
                tableClass: 0,
                tableId: component.dcTableId
              }
            );
          }
        }
        if (scanType === "ac-first" || scanType === "ac-refine") {
          acDefinition = resolveHuffmanDefinition(
            definitions,
            scan.offset,
            1,
            component.acTableId
          );
          if (!acDefinition) {
            throw new JpegProgressiveScriptError(
              "progressive-ac-table-missing",
              {
                scanIndex,
                componentId: component.id,
                tableClass: 1,
                tableId: component.acTableId
              }
            );
          }
        }
        tables.push({ componentId: component.id, dcDefinition, acDefinition });
      }
      return tables;
    }

    function resolveQuantizationDefinition(definitions, scanOffset, tableId) {
      let selected = null;
      for (const definition of definitions || []) {
        if (definition.definitionOffset >= scanOffset) break;
        if (definition.id === tableId) selected = definition;
      }
      return selected;
    }

    function createQuantizationDefinitionSignature(definition) {
      if (!definition) return null;
      return [definition.precision, ...definition.values].join(",");
    }

    function validateProgressiveQuantizationContinuity({
      scanIndex,
      scan,
      scanComponents,
      quantizationDefinitions,
      signatureByComponentId
    }) {
      const resolved = [];
      for (const scanComponent of scanComponents) {
        const frameComponent = scanComponent.frameComponent;
        const definition = resolveQuantizationDefinition(
          quantizationDefinitions,
          scan.offset,
          frameComponent.tq
        );
        if (!definition) {
          throw new JpegProgressiveScriptError(
            "progressive-quantization-table-missing",
            {
              scanIndex,
              componentId: scanComponent.id,
              tableId: frameComponent.tq
            }
          );
        }
        const signature = createQuantizationDefinitionSignature(definition);
        const previousSignature = signatureByComponentId.get(scanComponent.id);
        if (previousSignature != null && previousSignature !== signature) {
          throw new JpegProgressiveScriptError(
            "progressive-quantization-table-changed",
            {
              scanIndex,
              componentId: scanComponent.id,
              tableId: frameComponent.tq,
              definitionOffset: definition.definitionOffset
            }
          );
        }
        if (previousSignature == null) {
          signatureByComponentId.set(scanComponent.id, signature);
        }
        resolved.push({
          componentId: scanComponent.id,
          tableId: frameComponent.tq,
          definitionOffset: definition.definitionOffset,
          precision: definition.precision,
          signature
        });
      }
      return resolved;
    }

    function createProgressiveComponentTopologies(frame) {
      return frame.components.map((component, componentIndex) =>
        createDctComponentTopology(
          frame,
          component,
          componentIndex,
          frame.components.length === 1
        )
      );
    }

    function getProgressiveScanMcuCount(
      frame,
      scanComponents,
      componentTopologyById
    ) {
      if (scanComponents.length > 1) {
        return (
          Math.ceil(frame.width / (JPEG_DCT_BLOCK_SIZE * frame.hMax)) *
          Math.ceil(frame.height / (JPEG_DCT_BLOCK_SIZE * frame.vMax))
        );
      }
      const component = componentTopologyById.get(scanComponents[0].id);
      if (!component) {
        throw new JpegProgressiveScriptError(
          "component-topology-missing",
          { componentId: scanComponents[0].id }
        );
      }
      return component.visibleBlockColumns * component.visibleBlockRows;
    }

    function forEachProgressiveBlockInMcuRange({
      frame,
      scan,
      scanComponents,
      componentTopologyById,
      firstMcuIndex,
      mcuCount,
      callback
    }) {
      const totalMcuCount = getProgressiveScanMcuCount(
        frame,
        scanComponents,
        componentTopologyById
      );
      if (
        !Number.isSafeInteger(firstMcuIndex) ||
        !Number.isSafeInteger(mcuCount) ||
        firstMcuIndex < 0 || mcuCount < 0 ||
        firstMcuIndex + mcuCount > totalMcuCount
      ) {
        throw new JpegProgressiveScriptError(
          "progressive-mcu-range-invalid",
          { firstMcuIndex, mcuCount, totalMcuCount }
        );
      }
      if (scanComponents.length > 1) {
        const frameMcuColumns = Math.ceil(
          frame.width / (JPEG_DCT_BLOCK_SIZE * frame.hMax)
        );
        for (let localMcuIndex = 0; localMcuIndex < mcuCount; localMcuIndex++) {
          const mcuIndex = firstMcuIndex + localMcuIndex;
          const mcuX = mcuIndex % frameMcuColumns;
          const mcuY = Math.floor(mcuIndex / frameMcuColumns);
          for (const scanComponent of scanComponents) {
            const component = componentTopologyById.get(scanComponent.id);
            for (let vertical = 0; vertical < component.v; vertical++) {
              for (let horizontal = 0; horizontal < component.h; horizontal++) {
                const blockX = mcuX * component.h + horizontal;
                const blockY = mcuY * component.v + vertical;
                callback({
                  mcuIndex,
                  mcuX,
                  mcuY,
                  componentId: component.id,
                  componentIndex: component.componentIndex,
                  blockX,
                  blockY,
                  blockIndex: blockY * component.codedBlockColumns + blockX,
                  isVisible:
                    blockX < component.visibleBlockColumns &&
                    blockY < component.visibleBlockRows
                });
              }
            }
          }
        }
        return;
      }
      const component = componentTopologyById.get(scanComponents[0].id);
      for (let localMcuIndex = 0; localMcuIndex < mcuCount; localMcuIndex++) {
        const mcuIndex = firstMcuIndex + localMcuIndex;
        const blockX = mcuIndex % component.visibleBlockColumns;
        const blockY = Math.floor(mcuIndex / component.visibleBlockColumns);
        callback({
          mcuIndex,
          mcuX: null,
          mcuY: null,
          componentId: component.id,
          componentIndex: component.componentIndex,
          blockX,
          blockY,
          blockIndex: blockY * component.codedBlockColumns + blockX,
          isVisible: true
        });
      }
    }

    function getProgressiveRestartTopology({
      bytes,
      structure,
      scan,
      scanIndex,
      scanMcuCount
    }) {
      const dri = resolveDriForScan(scan, structure.driDefinitions || []);
      const restartMarkers = scan.restartMarkers ||
        parseRestartMarkersInScan(bytes, scan);
      if (!dri.enabled) {
        if (restartMarkers.length > 0) {
          throw new JpegProgressiveScriptError(
            "restart-marker-without-active-dri",
            { scanIndex, scanOffset: scan.offset }
          );
        }
        return {
          intervalMcuCount: 0,
          definitionOffset: dri.definitionOffset,
          markerCount: 0,
          markerCodes: [],
          markerTokens: [],
          intervalCount: 1,
          intervals: [{
            intervalIndex: 0,
            payloadStart: scan.entropyStart,
            payloadEnd: scan.endOffset,
            mcuCount: scanMcuCount,
            markerStart: null,
            markerEnd: null,
            markerCode: null,
            markerToken: null,
            isFinal: true
          }]
        };
      }
      if (!hasValidRestartSequence(restartMarkers)) {
        throw new JpegProgressiveScriptError(
          "restart-marker-sequence-invalid",
          { scanIndex, scanOffset: scan.offset }
        );
      }
      const expectedMarkerCount = Math.floor(
        (scanMcuCount - 1) / dri.intervalMcuCount
      );
      if (restartMarkers.length !== expectedMarkerCount) {
        throw new JpegProgressiveScriptError(
          "restart-marker-count-mismatch",
          {
            scanIndex,
            expectedMarkerCount,
            actualMarkerCount: restartMarkers.length
          }
        );
      }
      const intervals = buildRestartIntervals(
        scan,
        restartMarkers,
        dri.intervalMcuCount,
        scanMcuCount
      ).map((interval) => ({
        intervalIndex: interval.index,
        payloadStart: interval.payloadStart,
        payloadEnd: interval.payloadEnd,
        mcuCount: interval.mcuCount,
        markerStart: interval.markerStart,
        markerEnd: interval.markerEnd,
        markerCode: interval.markerCode,
        markerToken: interval.markerCode == null
          ? null
          : `RST${interval.markerCode - JPEG_RST_FIRST_MARKER}`,
        isFinal: interval.isFinal
      }));
      validateProgressiveRestartIntervals(
        intervals,
        scanMcuCount,
        scanIndex
      );
      return {
        intervalMcuCount: dri.intervalMcuCount,
        definitionOffset: dri.definitionOffset,
        markerCount: restartMarkers.length,
        markerCodes: restartMarkers.map((marker) => marker.code),
        markerTokens: restartMarkers.map(
          (marker) => `RST${marker.code - JPEG_RST_FIRST_MARKER}`
        ),
        intervalCount: intervals.length,
        intervals
      };
    }

    function validateProgressiveRestartIntervals(
      intervals,
      scanMcuCount,
      scanIndex
    ) {
      const intervalMcuTotal = intervals.reduce(
        (sum, interval) => sum + interval.mcuCount,
        0
      );
      if (intervalMcuTotal !== scanMcuCount) {
        throw new JpegProgressiveScriptError(
          "restart-interval-mcu-count-mismatch",
          { scanIndex, intervalMcuTotal, scanMcuCount }
        );
      }
    }

    function summarizeProgressiveState(coefficientState) {
      const components = [];
      let unsentCoefficientCount = 0;
      let finalCoefficientCount = 0;
      let partialCoefficientCount = 0;
      for (const [componentId, state] of coefficientState) {
        let unsent = 0;
        let final = 0;
        let partial = 0;
        for (const bitPosition of state) {
          if (bitPosition < 0) unsent++;
          else if (bitPosition === 0) final++;
          else partial++;
        }
        components.push({
          componentId,
          unsentCoefficientCount: unsent,
          finalCoefficientCount: final,
          partialCoefficientCount: partial
        });
        unsentCoefficientCount += unsent;
        finalCoefficientCount += final;
        partialCoefficientCount += partial;
      }
      return {
        components,
        unsentCoefficientCount,
        finalCoefficientCount,
        partialCoefficientCount
      };
    }

    // ========================================================================
    // 07. ENTROPY BIT IO
    // ========================================================================
    class JpegEntropyBitReader {
      constructor(bytes, start, end, context = {}) {
        this.bytes = bytes;
        this.start = start;
        this.end = end;
        this.offset = start;
        this.currentByte = 0;
        this.bitsRemaining = 0;
        this.context = { ...context };
        this.bitsRead = 0;
        this.dataBytesRead = 0;
        this.stuffedByteCount = 0;
      }

      setContext(context = {}) {
        Object.assign(this.context, context);
      }

      error(code, context = {}) {
        return createJpegEntropyDecodeError(code, {
          ...this.context,
          byteOffset: this.offset,
          bitsRemaining: this.bitsRemaining,
          ...context
        });
      }

      readDataByte() {
        if (this.offset >= this.end) {
          throw this.error("unexpected-end-of-entropy-data");
        }
        const value = this.bytes[this.offset++];
        if (value !== JPEG_MARKER_PREFIX) {
          this.dataBytesRead++;
          return value;
        }
        if (
          this.offset >= this.end ||
          this.bytes[this.offset] !== 0x00
        ) {
          throw this.error("unescaped-marker-inside-entropy-payload");
        }
        this.offset++;
        this.stuffedByteCount++;
        this.dataBytesRead++;
        return JPEG_MARKER_PREFIX;
      }

      readBit() {
        if (this.bitsRemaining === 0) {
          this.currentByte = this.readDataByte();
          this.bitsRemaining = BITS_PER_BYTE;
        }
        const bit = (
          this.currentByte >>> (this.bitsRemaining - 1)
        ) & 1;
        this.bitsRemaining--;
        this.bitsRead++;
        return bit;
      }

      readBits(count) {
        let value = 0;
        for (let index = 0; index < count; index++) {
          value = (value << 1) | this.readBit();
        }
        return value;
      }

      finish() {
        let paddingBitCount = 0;
        if (this.bitsRemaining > 0) {
          const mask = (1 << this.bitsRemaining) - 1;
          const remainingBits = this.currentByte & mask;
          if (remainingBits !== mask) {
            throw this.error("entropy-padding-is-not-all-ones");
          }
          paddingBitCount = this.bitsRemaining;
          this.bitsRemaining = 0;
        }
        if (this.offset !== this.end) {
          throw this.error("unused-entropy-bytes-remain");
        }
        return {
          bitsRead: this.bitsRead,
          dataBytesRead: this.dataBytesRead,
          stuffedByteCount: this.stuffedByteCount,
          paddingBitCount
        };
      }
    }

    function receiveAndExtend(reader, size) {
      if (size === 0) return 0;
      const value = reader.readBits(size);
      const threshold = 1 << (size - 1);
      if (value >= threshold) return value;
      return value - ((1 << size) - 1);
    }

    function decodeBaselineDc(reader, dcTable, predictor, histogram = null) {
      const category = decodeHuffmanSymbol(reader, dcTable);
      if (category > 11) {
        throw reader.error("baseline-dc-category-out-of-range", {
          tableClass: dcTable.tableClass,
          tableId: dcTable.tableId,
          symbol: category
        });
      }
      if (histogram) histogram[category]++;
      const difference = receiveAndExtend(reader, category);
      const value = predictor + difference;
      if (value < -1024 || value > 1023) {
        throw reader.error("baseline-dc-coefficient-out-of-range", {
          tableClass: dcTable.tableClass,
          tableId: dcTable.tableId,
          symbol: category
        });
      }
      return { value, difference, category };
    }

    function decodeBaselineAc(reader, acTable, coefficients, histogram = null) {
      let index = 1;
      while (index < 64) {
        const symbol = decodeHuffmanSymbol(reader, acTable);
        if (histogram) histogram[symbol]++;
        const zeroRun = symbol >>> 4;
        const size = symbol & 0x0F;
        if (size === 0) {
          if (zeroRun === 0) return { endedByEob: true };
          if (zeroRun === 15) {
            index += 16;
            if (index > 64) {
              throw reader.error("ac-zrl-exceeds-block", {
                tableClass: acTable.tableClass,
                tableId: acTable.tableId,
                symbol
              });
            }
            continue;
          }
          throw reader.error("invalid-zero-size-ac-symbol", {
            tableClass: acTable.tableClass,
            tableId: acTable.tableId,
            symbol
          });
        }
        if (size > 10) {
          throw reader.error("baseline-ac-category-out-of-range", {
            tableClass: acTable.tableClass,
            tableId: acTable.tableId,
            symbol
          });
        }
        index += zeroRun;
        if (index >= 64) {
          throw reader.error("ac-run-exceeds-block", {
            tableClass: acTable.tableClass,
            tableId: acTable.tableId,
            symbol
          });
        }
        coefficients[index] = receiveAndExtend(reader, size);
        index++;
      }
      return { endedByEob: false };
    }

    function decodeBaselineBlock({
      reader,
      dcTable,
      acTable,
      predictor,
      dcCategoryHistogram = null,
      acSymbolHistogram = null
    }) {
      const coefficients = new Int16Array(64);
      const dc = decodeBaselineDc(
        reader,
        dcTable,
        predictor,
        dcCategoryHistogram
      );
      coefficients[0] = dc.value;
      const ac = decodeBaselineAc(
        reader,
        acTable,
        coefficients,
        acSymbolHistogram
      );
      return {
        coefficients,
        nextPredictor: dc.value,
        dcCategory: dc.category,
        dcDifference: dc.difference,
        endedByEob: ac.endedByEob
      };
    }

    function multiplySafeInteger(left, right, errorCode, context = {}) {
      const value = left * right;
      if (!Number.isSafeInteger(value) || value < 0) {
        throw createJpegEntropyDecodeError(errorCode, context);
      }
      return value;
    }

    function createDctComponentTopology(
      frame,
      component,
      componentIndex,
      singleComponentFrame = frame.components.length === 1
    ) {
      const visibleBlockColumns = Math.ceil(
        frame.width * component.h /
        (frame.hMax * JPEG_DCT_BLOCK_SIZE)
      );
      const visibleBlockRows = Math.ceil(
        frame.height * component.v /
        (frame.vMax * JPEG_DCT_BLOCK_SIZE)
      );
      const frameMcuColumns = Math.ceil(
        frame.width / (JPEG_DCT_BLOCK_SIZE * frame.hMax)
      );
      const frameMcuRows = Math.ceil(
        frame.height / (JPEG_DCT_BLOCK_SIZE * frame.vMax)
      );
      const codedBlockColumns = singleComponentFrame
        ? visibleBlockColumns
        : frameMcuColumns * component.h;
      const codedBlockRows = singleComponentFrame
        ? visibleBlockRows
        : frameMcuRows * component.v;
      return {
        id: component.id,
        componentIndex,
        h: component.h,
        v: component.v,
        quantTableId: component.tq,
        visibleBlockColumns,
        visibleBlockRows,
        codedBlockColumns,
        codedBlockRows
      };
    }

    function createBaselineCoefficientBuffer(frame, component, componentIndex, isGray) {
      const topology = createDctComponentTopology(
        frame,
        component,
        componentIndex,
        isGray
      );
      const codedBlockCount = multiplySafeInteger(
        topology.codedBlockColumns,
        topology.codedBlockRows,
        "coefficient-block-count-out-of-range",
        { componentId: component.id }
      );
      const coefficientCount = multiplySafeInteger(
        codedBlockCount,
        64,
        "coefficient-array-length-out-of-range",
        { componentId: component.id }
      );
      try {
        return {
          ...topology,
          coefficients: new Int16Array(coefficientCount),
          decodedBlockMask: new Uint8Array(codedBlockCount),
          decodedBlockCount: 0
        };
      } catch (error) {
        if (error instanceof RangeError) {
          throw createJpegEntropyDecodeError(
            "coefficient-buffer-allocation-failed",
            { componentId: component.id, coefficientCount }
          );
        }
        throw error;
      }
    }

    function forEachBaselineBlockInMcuRange({
      frame,
      scan,
      componentsById,
      frameMcuColumns,
      frameMcuRows,
      firstMcuIndex,
      mcuCount,
      callback,
      createRangeError = createJpegEntropyDecodeError
    }) {
      const totalMcuCount = frameMcuColumns * frameMcuRows;
      if (
        !Number.isSafeInteger(firstMcuIndex) ||
        !Number.isSafeInteger(mcuCount) ||
        firstMcuIndex < 0 ||
        mcuCount < 0 ||
        firstMcuIndex + mcuCount > totalMcuCount
      ) {
        throw createRangeError(
          "baseline-mcu-range-invalid",
          { firstMcuIndex, mcuCount, totalMcuCount }
        );
      }

      const isGray = frame.components.length === 1;
      for (let offset = 0; offset < mcuCount; offset++) {
        const mcuIndex = firstMcuIndex + offset;
        const mcuX = mcuIndex % frameMcuColumns;
        const mcuY = Math.floor(mcuIndex / frameMcuColumns);
        for (const scanComponent of scan.components) {
          const component = componentsById.get(scanComponent.id);
          if (!component) {
            throw createRangeError(
              "coefficient-component-buffer-missing",
              { componentId: scanComponent.id, mcuIndex }
            );
          }
          const horizontalSamples = isGray ? 1 : component.h;
          const verticalSamples = isGray ? 1 : component.v;
          for (let vertical = 0; vertical < verticalSamples; vertical++) {
            for (let horizontal = 0; horizontal < horizontalSamples; horizontal++) {
              const blockX = isGray
                ? mcuX
                : mcuX * component.h + horizontal;
              const blockY = isGray
                ? mcuY
                : mcuY * component.v + vertical;
              const blockIndex = blockY * component.codedBlockColumns + blockX;
              callback({
                mcuIndex,
                mcuX,
                mcuY,
                componentId: component.id,
                componentIndex: component.componentIndex,
                scanComponent,
                component,
                blockX,
                blockY,
                blockIndex,
                coefficientOffset: blockIndex * 64
              });
            }
          }
        }
      }
    }

    function getBaselineEntropyIntervals(bytes, structure, frame, scan, scanMcuCount) {
      const dri = resolveDriForScan(scan, structure.driDefinitions || []);
      const restartMarkers = scan.restartMarkers ||
        parseRestartMarkersInScan(bytes, scan);
      if (!dri.enabled) {
        if (restartMarkers.length > 0) {
          throw createJpegEntropyDecodeError(
            "restart-marker-without-active-dri",
            { scanIndex: 0, byteOffset: restartMarkers[0].markerStart }
          );
        }
        return [{
          index: 0,
          payloadStart: scan.entropyStart,
          payloadEnd: scan.endOffset,
          payloadLength: scan.endOffset - scan.entropyStart,
          markerStart: null,
          markerEnd: null,
          markerCode: null,
          mcuCount: scanMcuCount,
          isFinal: true
        }];
      }
      if (!hasValidRestartSequence(restartMarkers)) {
        throw createJpegEntropyDecodeError(
          "restart-marker-sequence-invalid",
          { scanIndex: 0 }
        );
      }
      const expectedMarkerCount = Math.floor(
        (scanMcuCount - 1) / dri.intervalMcuCount
      );
      if (restartMarkers.length !== expectedMarkerCount) {
        throw createJpegEntropyDecodeError(
          "restart-marker-count-mismatch",
          {
            scanIndex: 0,
            expectedRestartMarkerCount: expectedMarkerCount,
            actualRestartMarkerCount: restartMarkers.length
          }
        );
      }
      const intervals = buildRestartIntervals(
        scan,
        restartMarkers,
        dri.intervalMcuCount,
        scanMcuCount
      );
      const intervalMcuTotal = intervals.reduce(
        (sum, interval) => sum + interval.mcuCount,
        0
      );
      if (intervalMcuTotal !== scanMcuCount) {
        throw createJpegEntropyDecodeError(
          "restart-interval-mcu-count-mismatch",
          { scanIndex: 0, intervalMcuTotal, scanMcuCount }
        );
      }
      return intervals;
    }

    // ========================================================================
    // 08. BASELINE COEFFICIENT CODEC
    // ========================================================================
    function decodeBaselineHuffmanCoefficients(bytes, structure) {
      const support = getBaselineCoefficientDecodeSupport(structure);
      if (!support.supported) {
        return { supported: false, reason: support.reason, decoded: null };
      }

      const { frame, scan } = support;
      if (
        scan.components.length !== scan.componentIds.length ||
        scan.components.some(
          (component, index) => component.id !== scan.componentIds[index]
        )
      ) {
        throw createJpegEntropyDecodeError(
          "scan-component-descriptor-mismatch",
          { scanIndex: 0 }
        );
      }
      for (const component of frame.components) {
        if (
          !Number.isInteger(component.h) ||
          !Number.isInteger(component.v) ||
          component.h < 1 || component.h > 4 ||
          component.v < 1 || component.v > 4
        ) {
          throw createJpegEntropyDecodeError(
            "invalid-frame-sampling-factor",
            { componentId: component.id }
          );
        }
      }
      if (
        frame.components.length > 1 &&
        frame.components.reduce(
          (sum, component) => sum + component.h * component.v,
          0
        ) > 10
      ) {
        throw createJpegEntropyDecodeError(
          "interleaved-blocks-per-mcu-exceeds-baseline-limit",
          { scanIndex: 0 }
        );
      }
      if (
        !Number.isInteger(scan.entropyStart) ||
        !Number.isInteger(scan.endOffset) ||
        scan.entropyStart < 0 ||
        scan.endOffset < scan.entropyStart ||
        scan.endOffset > bytes.length
      ) {
        throw createJpegEntropyDecodeError(
          "entropy-payload-range-invalid",
          { scanIndex: 0 }
        );
      }
      const definitions = parseHuffmanDefinitions(bytes, structure);
      const decoderCache = new Map();
      const resolvedScanComponents = scan.components.map((scanComponent) => {
        const frameComponent = frame.components.find(
          (component) => component.id === scanComponent.id
        );
        if (!frameComponent) {
          throw createJpegEntropyDecodeError(
            "scan-component-not-defined-in-frame",
            { scanIndex: 0, componentId: scanComponent.id }
          );
        }
        const dcDefinition = resolveHuffmanDefinition(
          definitions,
          scan.offset,
          0,
          scanComponent.dcTableId
        );
        const acDefinition = resolveHuffmanDefinition(
          definitions,
          scan.offset,
          1,
          scanComponent.acTableId
        );
        if (!dcDefinition) {
          throw createJpegEntropyDecodeError(
            "required-huffman-table-not-defined",
            {
              scanIndex: 0,
              componentId: scanComponent.id,
              tableClass: 0,
              tableId: scanComponent.dcTableId
            }
          );
        }
        if (!acDefinition) {
          throw createJpegEntropyDecodeError(
            "required-huffman-table-not-defined",
            {
              scanIndex: 0,
              componentId: scanComponent.id,
              tableClass: 1,
              tableId: scanComponent.acTableId
            }
          );
        }
        const getDecoder = (definition) => {
          if (!decoderCache.has(definition)) {
            decoderCache.set(
              definition,
              buildCanonicalHuffmanDecoder(definition)
            );
          }
          return decoderCache.get(definition);
        };
        return {
          ...scanComponent,
          frameComponent,
          dcTable: getDecoder(dcDefinition),
          acTable: getDecoder(acDefinition)
        };
      });

      const isGray = frame.components.length === 1;
      const components = frame.components.map(
        (component, componentIndex) => createBaselineCoefficientBuffer(
          frame,
          component,
          componentIndex,
          isGray
        )
      );
      const componentBuffers = new Map(
        components.map((component) => [component.id, component])
      );
      const frameMcuColumns = isGray
        ? components[0].visibleBlockColumns
        : Math.ceil(frame.width / (JPEG_DCT_BLOCK_SIZE * frame.hMax));
      const frameMcuRows = isGray
        ? components[0].visibleBlockRows
        : Math.ceil(frame.height / (JPEG_DCT_BLOCK_SIZE * frame.vMax));
      const totalMcuCount = multiplySafeInteger(
        frameMcuColumns,
        frameMcuRows,
        "mcu-count-out-of-range"
      );
      const intervals = getBaselineEntropyIntervals(
        bytes,
        structure,
        frame,
        scan,
        totalMcuCount
      );
      const dcCategoryHistogram = new Uint32Array(12);
      const acSymbolHistogram = new Uint32Array(256);
      const dcPredictors = new Map();
      const intervalResults = [];
      let globalMcuIndex = 0;

      const decodeAndStoreBlock = ({
        reader,
        scanComponent,
        component,
        blockX,
        blockY,
        blockIndex,
        mcuIndex
      }) => {
        if (
          blockX < 0 || blockX >= component.codedBlockColumns ||
          blockY < 0 || blockY >= component.codedBlockRows
        ) {
          throw reader.error("coefficient-block-coordinate-out-of-range", {
            componentId: scanComponent.id,
            blockX,
            blockY,
            mcuIndex
          });
        }
        if (component.decodedBlockMask[blockIndex] !== 0) {
          throw reader.error("coefficient-block-decoded-twice", {
            componentId: scanComponent.id,
            blockX,
            blockY,
            mcuIndex
          });
        }
        reader.setContext({
          mcuIndex,
          componentId: scanComponent.id,
          blockX,
          blockY
        });
        const block = decodeBaselineBlock({
          reader,
          dcTable: scanComponent.dcTable,
          acTable: scanComponent.acTable,
          predictor: dcPredictors.get(scanComponent.id) || 0,
          dcCategoryHistogram,
          acSymbolHistogram
        });
        dcPredictors.set(scanComponent.id, block.nextPredictor);
        component.coefficients.set(block.coefficients, blockIndex * 64);
        component.decodedBlockMask[blockIndex] = 1;
        component.decodedBlockCount++;
      };

      for (const interval of intervals) {
        for (const componentId of scan.componentIds) {
          dcPredictors.set(componentId, 0);
        }
        const reader = new JpegEntropyBitReader(
          bytes,
          interval.payloadStart,
          interval.payloadEnd,
          { scanIndex: 0, intervalIndex: interval.index }
        );
        const resolvedById = new Map(
          resolvedScanComponents.map((component) => [component.id, component])
        );
        forEachBaselineBlockInMcuRange({
          frame,
          scan,
          componentsById: componentBuffers,
          frameMcuColumns,
          frameMcuRows,
          firstMcuIndex: globalMcuIndex,
          mcuCount: interval.mcuCount,
          callback(blockContext) {
            decodeAndStoreBlock({
              reader,
              ...blockContext,
              scanComponent: resolvedById.get(blockContext.componentId)
            });
          }
        });
        globalMcuIndex += interval.mcuCount;
        const readerStats = reader.finish();
        intervalResults.push({
          index: interval.index,
          payloadStart: interval.payloadStart,
          payloadEnd: interval.payloadEnd,
          mcuCount: interval.mcuCount,
          isFinal: interval.isFinal,
          markerCode: interval.markerCode,
          ...readerStats
        });
      }

      if (globalMcuIndex !== totalMcuCount) {
        throw createJpegEntropyDecodeError(
          "decoded-mcu-count-mismatch",
          { scanIndex: 0, decodedMcuCount: globalMcuIndex, totalMcuCount }
        );
      }
      for (const component of components) {
        const expectedBlockCount = component.decodedBlockMask.length;
        if (component.decodedBlockCount !== expectedBlockCount) {
          throw createJpegEntropyDecodeError(
            "required-coefficient-block-not-decoded",
            {
              componentId: component.id,
              decodedBlockCount: component.decodedBlockCount,
              expectedBlockCount
            }
          );
        }
        for (let blockIndex = 0; blockIndex < expectedBlockCount; blockIndex++) {
          if (component.decodedBlockMask[blockIndex] === 0) {
            throw createJpegEntropyDecodeError(
              "required-coefficient-block-not-decoded",
              { componentId: component.id, blockIndex }
            );
          }
        }
      }

      const bitsRead = intervalResults.reduce(
        (sum, interval) => sum + interval.bitsRead,
        0
      );
      const stuffedByteCount = intervalResults.reduce(
        (sum, interval) => sum + interval.stuffedByteCount,
        0
      );
      const paddingBitCount = intervalResults.reduce(
        (sum, interval) => sum + interval.paddingBitCount,
        0
      );
      return {
        supported: true,
        reason: null,
        decoded: {
          process: "baseline-huffman-sequential",
          frameMarker: 0xC0,
          width: frame.width,
          height: frame.height,
          precision: frame.precision,
          frameMcuColumns,
          frameMcuRows,
          totalMcuCount,
          components,
          scans: [{
            scanIndex: 0,
            componentIds: scan.componentIds.slice(),
            mcuCount: totalMcuCount,
            intervals: intervalResults,
            dcCategoryHistogram,
            acSymbolHistogram,
            bitsRead,
            stuffedByteCount,
            paddingBitCount
          }]
        }
      };
    }

    class JpegEntropyEncodeError extends Error {
      constructor(code, context = {}) {
        super(code);
        this.name = "JpegEntropyEncodeError";
        this.code = code;
        Object.assign(this, context);
      }
    }

    function createJpegEntropyEncodeError(code, context = {}) {
      return new JpegEntropyEncodeError(code, context);
    }

    function validateBaselineCoefficientModel(decoded, support) {
      if (!decoded || typeof decoded !== "object") {
        throw createJpegEntropyEncodeError("missing-baseline-coefficient-model");
      }
      const { frame, scan } = support;
      if (decoded.process !== "baseline-huffman-sequential") {
        throw createJpegEntropyEncodeError("coefficient-process-mismatch");
      }
      if (
        decoded.width !== frame.width ||
        decoded.height !== frame.height ||
        decoded.precision !== frame.precision
      ) {
        throw createJpegEntropyEncodeError("coefficient-frame-metadata-mismatch");
      }

      const isGray = frame.components.length === 1;
      const expectedFrameMcuColumns = isGray
        ? Math.ceil(frame.width / JPEG_DCT_BLOCK_SIZE)
        : Math.ceil(frame.width / (JPEG_DCT_BLOCK_SIZE * frame.hMax));
      const expectedFrameMcuRows = isGray
        ? Math.ceil(frame.height / JPEG_DCT_BLOCK_SIZE)
        : Math.ceil(frame.height / (JPEG_DCT_BLOCK_SIZE * frame.vMax));
      const expectedTotalMcuCount = expectedFrameMcuColumns * expectedFrameMcuRows;
      if (
        !Number.isSafeInteger(expectedTotalMcuCount) ||
        decoded.frameMcuColumns !== expectedFrameMcuColumns ||
        decoded.frameMcuRows !== expectedFrameMcuRows ||
        decoded.totalMcuCount !== expectedTotalMcuCount
      ) {
        throw createJpegEntropyEncodeError("coefficient-mcu-grid-mismatch");
      }
      if (
        !Array.isArray(decoded.components) ||
        decoded.components.length !== frame.components.length
      ) {
        throw createJpegEntropyEncodeError("coefficient-component-count-mismatch");
      }

      const componentsById = new Map();
      for (const component of decoded.components) {
        if (componentsById.has(component.id)) {
          throw createJpegEntropyEncodeError(
            "duplicate-coefficient-component-id",
            { componentId: component.id }
          );
        }
        componentsById.set(component.id, component);
      }
      for (let componentIndex = 0; componentIndex < frame.components.length; componentIndex++) {
        const frameComponent = frame.components[componentIndex];
        const component = componentsById.get(frameComponent.id);
        if (!component) {
          throw createJpegEntropyEncodeError(
            "coefficient-component-id-mismatch",
            { componentId: frameComponent.id }
          );
        }
        const visibleBlockColumns = Math.ceil(
          frame.width * frameComponent.h /
          (frame.hMax * JPEG_DCT_BLOCK_SIZE)
        );
        const visibleBlockRows = Math.ceil(
          frame.height * frameComponent.v /
          (frame.vMax * JPEG_DCT_BLOCK_SIZE)
        );
        const codedBlockColumns = isGray
          ? visibleBlockColumns
          : expectedFrameMcuColumns * frameComponent.h;
        const codedBlockRows = isGray
          ? visibleBlockRows
          : expectedFrameMcuRows * frameComponent.v;
        const codedBlockCount = codedBlockColumns * codedBlockRows;
        const coefficientCount = codedBlockCount * 64;
        if (
          component.componentIndex !== componentIndex ||
          component.h !== frameComponent.h ||
          component.v !== frameComponent.v ||
          component.quantTableId !== frameComponent.tq ||
          component.visibleBlockColumns !== visibleBlockColumns ||
          component.visibleBlockRows !== visibleBlockRows ||
          component.codedBlockColumns !== codedBlockColumns ||
          component.codedBlockRows !== codedBlockRows
        ) {
          throw createJpegEntropyEncodeError(
            "coefficient-component-metadata-mismatch",
            { componentId: frameComponent.id }
          );
        }
        if (
          !(component.coefficients instanceof Int16Array) ||
          component.coefficients.length !== coefficientCount
        ) {
          throw createJpegEntropyEncodeError(
            "coefficient-buffer-length-mismatch",
            { componentId: frameComponent.id }
          );
        }
        if (
          !(component.decodedBlockMask instanceof Uint8Array) ||
          component.decodedBlockMask.length !== codedBlockCount
        ) {
          throw createJpegEntropyEncodeError(
            "decoded-block-mask-length-mismatch",
            { componentId: frameComponent.id }
          );
        }
        if (component.decodedBlockCount !== codedBlockCount) {
          throw createJpegEntropyEncodeError(
            "decoded-block-count-mismatch",
            { componentId: frameComponent.id }
          );
        }
        for (let blockIndex = 0; blockIndex < codedBlockCount; blockIndex++) {
          if (component.decodedBlockMask[blockIndex] !== 1) {
            throw createJpegEntropyEncodeError(
              "coefficient-block-not-decoded",
              { componentId: frameComponent.id, blockIndex }
            );
          }
        }
      }

      if (!Array.isArray(decoded.scans) || decoded.scans.length !== 1) {
        throw createJpegEntropyEncodeError("coefficient-scan-count-mismatch");
      }
      const decodedScan = decoded.scans[0];
      if (
        !Array.isArray(decodedScan.componentIds) ||
        decodedScan.componentIds.length !== scan.componentIds.length ||
        decodedScan.componentIds.some(
          (id, index) => id !== scan.componentIds[index]
        ) ||
        decodedScan.mcuCount !== expectedTotalMcuCount
      ) {
        throw createJpegEntropyEncodeError("coefficient-scan-metadata-mismatch");
      }
      if (!Array.isArray(decodedScan.intervals)) {
        throw createJpegEntropyEncodeError("coefficient-intervals-missing");
      }
      const intervalMcuTotal = decodedScan.intervals.reduce(
        (sum, interval) => sum + interval.mcuCount,
        0
      );
      if (intervalMcuTotal !== expectedTotalMcuCount) {
        throw createJpegEntropyEncodeError("coefficient-interval-mcu-count-mismatch");
      }

      return {
        frame,
        scan,
        frameMcuColumns: expectedFrameMcuColumns,
        frameMcuRows: expectedFrameMcuRows,
        totalMcuCount: expectedTotalMcuCount,
        components: decoded.components,
        componentsById,
        decodedScan
      };
    }

    function buildCanonicalHuffmanEncoder(definition) {
      try {
        buildCanonicalHuffmanDecoder(definition);
      } catch (error) {
        if (error instanceof JpegEntropyDecodeError) {
          throw createJpegEntropyEncodeError(error.code, {
            tableClass: definition.tableClass,
            tableId: definition.tableId
          });
        }
        throw error;
      }
      const codes = new Int32Array(256);
      const sizes = new Uint8Array(256);
      const assigned = new Uint8Array(256);
      let code = 0;
      let symbolIndex = 0;
      for (let length = 1; length <= 16; length++) {
        const count = definition.codeCounts[length - 1];
        for (let index = 0; index < count; index++) {
          const symbol = definition.symbols[symbolIndex++];
          if (assigned[symbol]) {
            throw createJpegEntropyEncodeError(
              "huffman-symbol-assigned-more-than-once",
              {
                tableClass: definition.tableClass,
                tableId: definition.tableId,
                symbol
              }
            );
          }
          codes[symbol] = code;
          sizes[symbol] = length;
          assigned[symbol] = 1;
          code++;
        }
        code <<= 1;
      }
      if (symbolIndex !== definition.symbols.length) {
        throw createJpegEntropyEncodeError(
          "huffman-symbol-count-mismatch",
          { tableClass: definition.tableClass, tableId: definition.tableId }
        );
      }
      return { definition, codes, sizes, assigned };
    }

    function writeHuffmanSymbol(writer, encoder, symbol, context = {}) {
      if (
        !Number.isInteger(symbol) ||
        symbol < 0 ||
        symbol > 255 ||
        !encoder.assigned[symbol]
      ) {
        throw createJpegEntropyEncodeError(
          "huffman-symbol-not-encodable",
          {
            ...context,
            symbol,
            tableClass: encoder.definition.tableClass,
            tableId: encoder.definition.tableId
          }
        );
      }
      writer.writeBits(encoder.codes[symbol], encoder.sizes[symbol]);
    }

    function getJpegMagnitudeCategory(value) {
      if (!Number.isSafeInteger(value)) {
        throw createJpegEntropyEncodeError(
          "magnitude-value-not-safe-integer",
          { value }
        );
      }
      if (value === 0) return 0;
      return Math.floor(Math.log2(Math.abs(value))) + 1;
    }

    function encodeJpegAdditionalBits(value, size) {
      if (size === 0) {
        if (value !== 0) {
          throw createJpegEntropyEncodeError(
            "nonzero-value-with-zero-category",
            { value, size }
          );
        }
        return 0;
      }
      const category = getJpegMagnitudeCategory(value);
      if (category !== size) {
        throw createJpegEntropyEncodeError(
          "value-category-mismatch",
          { value, size, category }
        );
      }
      return value > 0 ? value : value + ((1 << size) - 1);
    }

    class JpegEntropyBitWriter {
      constructor(context = {}) {
        this.context = { ...context };
        this.bytes = [];
        this.currentByte = 0;
        this.bitsInCurrentByte = 0;
        this.bitsWritten = 0;
        this.dataByteCount = 0;
        this.stuffedByteCount = 0;
        this.paddingBitCount = 0;
      }

      writeBit(bit) {
        if (bit !== 0 && bit !== 1) {
          throw createJpegEntropyEncodeError(
            "invalid-bit-value",
            { ...this.context, bit }
          );
        }
        this.currentByte = (this.currentByte << 1) | bit;
        this.bitsInCurrentByte++;
        this.bitsWritten++;
        if (this.bitsInCurrentByte === BITS_PER_BYTE) {
          this.emitDataByte(this.currentByte);
          this.currentByte = 0;
          this.bitsInCurrentByte = 0;
        }
      }

      writeBits(value, count) {
        if (!Number.isSafeInteger(count) || count < 0 || count > 16) {
          throw createJpegEntropyEncodeError(
            "invalid-bit-count",
            { ...this.context, count }
          );
        }
        if (
          !Number.isSafeInteger(value) ||
          value < 0 ||
          value >= Math.pow(2, count)
        ) {
          throw createJpegEntropyEncodeError(
            "bit-value-out-of-range",
            { ...this.context, value, count }
          );
        }
        for (let bitIndex = count - 1; bitIndex >= 0; bitIndex--) {
          this.writeBit((value >>> bitIndex) & 1);
        }
      }

      emitDataByte(value) {
        this.bytes.push(value);
        this.dataByteCount++;
        if (value === JPEG_MARKER_PREFIX) {
          this.bytes.push(0x00);
          this.stuffedByteCount++;
        }
      }

      finish() {
        while (this.bitsInCurrentByte !== 0) {
          this.writeBit(1);
          this.paddingBitCount++;
        }
        return {
          bytes: Uint8Array.from(this.bytes),
          bitsWritten: this.bitsWritten,
          dataByteCount: this.dataByteCount,
          stuffedByteCount: this.stuffedByteCount,
          paddingBitCount: this.paddingBitCount
        };
      }
    }

    function encodeBaselineDc({
      writer,
      table,
      coefficient,
      predictor,
      context,
      histogram = null
    }) {
      if (coefficient < -1024 || coefficient > 1023) {
        throw createJpegEntropyEncodeError(
          "baseline-dc-coefficient-out-of-range",
          { ...context, coefficient }
        );
      }
      const difference = coefficient - predictor;
      const category = getJpegMagnitudeCategory(difference);
      if (category > 11) {
        throw createJpegEntropyEncodeError(
          "baseline-dc-difference-category-out-of-range",
          { ...context, coefficient, predictor, difference, category }
        );
      }
      writeHuffmanSymbol(writer, table, category, context);
      if (histogram) histogram[category]++;
      if (category > 0) {
        writer.writeBits(
          encodeJpegAdditionalBits(difference, category),
          category
        );
      }
      return { nextPredictor: coefficient, difference, category };
    }

    function encodeBaselineAc({
      writer,
      table,
      coefficients,
      context,
      histogram = null
    }) {
      let zeroRun = 0;
      let emittedEob = false;
      let zrlCount = 0;
      for (let index = 1; index < 64; index++) {
        const coefficient = coefficients[index];
        if (coefficient === 0) {
          zeroRun++;
          continue;
        }
        while (zeroRun >= 16) {
          writeHuffmanSymbol(writer, table, 0xF0, {
            ...context,
            coefficientIndex: index
          });
          if (histogram) histogram[0xF0]++;
          zeroRun -= 16;
          zrlCount++;
        }
        const size = getJpegMagnitudeCategory(coefficient);
        if (size < 1 || size > 10) {
          throw createJpegEntropyEncodeError(
            "baseline-ac-category-out-of-range",
            { ...context, coefficientIndex: index, coefficient, size }
          );
        }
        const symbol = (zeroRun << 4) | size;
        writeHuffmanSymbol(writer, table, symbol, {
          ...context,
          coefficientIndex: index,
          coefficient
        });
        if (histogram) histogram[symbol]++;
        writer.writeBits(
          encodeJpegAdditionalBits(coefficient, size),
          size
        );
        zeroRun = 0;
      }
      if (zeroRun > 0) {
        writeHuffmanSymbol(writer, table, 0x00, context);
        if (histogram) histogram[0]++;
        emittedEob = true;
      }
      return { emittedEob, zrlCount };
    }

    function encodeBaselineBlock({
      writer,
      dcTable,
      acTable,
      coefficients,
      predictor,
      context,
      dcCategoryHistogram = null,
      acSymbolHistogram = null
    }) {
      if (!(coefficients instanceof Int16Array) || coefficients.length !== 64) {
        throw createJpegEntropyEncodeError(
          "invalid-coefficient-block",
          context
        );
      }
      const dc = encodeBaselineDc({
        writer,
        table: dcTable,
        coefficient: coefficients[0],
        predictor,
        context,
        histogram: dcCategoryHistogram
      });
      const ac = encodeBaselineAc({
        writer,
        table: acTable,
        coefficients,
        context,
        histogram: acSymbolHistogram
      });
      return {
        nextPredictor: dc.nextPredictor,
        dcCategory: dc.category,
        dcDifference: dc.difference,
        emittedEob: ac.emittedEob,
        zrlCount: ac.zrlCount
      };
    }

    function concatenateUint8Arrays(chunks) {
      const totalLength = chunks.reduce(
        (sum, chunk) => sum + chunk.length,
        0
      );
      if (!Number.isSafeInteger(totalLength)) {
        throw createJpegEntropyEncodeError("output-length-not-safe");
      }
      let output;
      try {
        output = new Uint8Array(totalLength);
      } catch (error) {
        if (error instanceof RangeError) {
          throw createJpegEntropyEncodeError(
            "output-allocation-failed",
            { totalLength }
          );
        }
        throw error;
      }
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
      return output;
    }

    function rebuildBaselineJpegWithEntropy({
      sourceBytes,
      scan,
      intervals,
      encodedIntervals
    }) {
      if (intervals.length !== encodedIntervals.length) {
        throw createJpegEntropyEncodeError("encoded-interval-count-mismatch");
      }
      const chunks = [sourceBytes.subarray(0, scan.entropyStart)];
      for (let index = 0; index < encodedIntervals.length; index++) {
        const encoded = encodedIntervals[index];
        const sourceInterval = intervals[index];
        chunks.push(encoded.payload);
        if (!sourceInterval.isFinal) {
          if (
            !Number.isInteger(sourceInterval.markerStart) ||
            !Number.isInteger(sourceInterval.markerEnd) ||
            sourceInterval.markerStart < 0 ||
            sourceInterval.markerEnd <= sourceInterval.markerStart ||
            sourceInterval.markerEnd > sourceBytes.length
          ) {
            throw createJpegEntropyEncodeError(
              "restart-marker-token-range-invalid",
              { intervalIndex: index }
            );
          }
          chunks.push(sourceBytes.subarray(
            sourceInterval.markerStart,
            sourceInterval.markerEnd
          ));
        }
      }
      chunks.push(sourceBytes.subarray(scan.endOffset));
      return concatenateUint8Arrays(chunks);
    }

    function encodeBaselineHuffmanCoefficients(
      sourceBytes,
      structure,
      decodedResult
    ) {
      const support = getBaselineCoefficientDecodeSupport(structure);
      if (!support.supported) {
        return { supported: false, reason: support.reason, encoded: null };
      }
      if (decodedResult?.supported === false) {
        return {
          supported: false,
          reason: decodedResult.reason,
          encoded: null
        };
      }

      const model = validateBaselineCoefficientModel(
        decodedResult?.decoded,
        support
      );
      const { frame, scan } = support;
      let definitions;
      try {
        definitions = parseHuffmanDefinitions(sourceBytes, structure);
      } catch (error) {
        if (error instanceof JpegEntropyDecodeError) {
          const { name, message, stack, ...context } = error;
          throw createJpegEntropyEncodeError(error.code, context);
        }
        throw error;
      }
      const encoderCache = new Map();
      const getEncoder = (definition) => {
        if (!encoderCache.has(definition)) {
          encoderCache.set(
            definition,
            buildCanonicalHuffmanEncoder(definition)
          );
        }
        return encoderCache.get(definition);
      };
      const resolvedScanComponents = new Map();
      for (const scanComponent of scan.components) {
        const dcDefinition = resolveHuffmanDefinition(
          definitions,
          scan.offset,
          0,
          scanComponent.dcTableId
        );
        const acDefinition = resolveHuffmanDefinition(
          definitions,
          scan.offset,
          1,
          scanComponent.acTableId
        );
        if (!dcDefinition || !acDefinition) {
          const missingClass = dcDefinition ? 1 : 0;
          throw createJpegEntropyEncodeError(
            "required-huffman-table-not-defined",
            {
              scanIndex: 0,
              componentId: scanComponent.id,
              tableClass: missingClass,
              tableId: missingClass === 0
                ? scanComponent.dcTableId
                : scanComponent.acTableId
            }
          );
        }
        resolvedScanComponents.set(scanComponent.id, {
          ...scanComponent,
          dcTable: getEncoder(dcDefinition),
          acTable: getEncoder(acDefinition)
        });
      }

      let intervals;
      try {
        intervals = getBaselineEntropyIntervals(
          sourceBytes,
          structure,
          frame,
          scan,
          model.totalMcuCount
        );
      } catch (error) {
        if (error instanceof JpegEntropyDecodeError) {
          const { name, message, stack, ...context } = error;
          throw createJpegEntropyEncodeError(error.code, context);
        }
        throw error;
      }
      if (
        intervals.length !== model.decodedScan.intervals.length ||
        intervals.some((interval, index) =>
          interval.mcuCount !== model.decodedScan.intervals[index].mcuCount
        )
      ) {
        throw createJpegEntropyEncodeError(
          "coefficient-restart-interval-mismatch"
        );
      }

      const dcCategoryHistogram = new Uint32Array(12);
      const acSymbolHistogram = new Uint32Array(256);
      const encodedIntervals = [];
      let nextMcuIndex = 0;
      for (let intervalIndex = 0; intervalIndex < intervals.length; intervalIndex++) {
        const interval = intervals[intervalIndex];
        const predictors = new Map(
          scan.componentIds.map((id) => [id, 0])
        );
        const writer = new JpegEntropyBitWriter({ scanIndex: 0, intervalIndex });
        forEachBaselineBlockInMcuRange({
          frame,
          scan,
          componentsById: model.componentsById,
          frameMcuColumns: model.frameMcuColumns,
          frameMcuRows: model.frameMcuRows,
          firstMcuIndex: nextMcuIndex,
          mcuCount: interval.mcuCount,
          createRangeError: createJpegEntropyEncodeError,
          callback(blockContext) {
            const {
              component,
              componentId,
              blockIndex,
              coefficientOffset,
              mcuIndex,
              blockX,
              blockY
            } = blockContext;
            if (component.decodedBlockMask[blockIndex] !== 1) {
              throw createJpegEntropyEncodeError(
                "coefficient-block-not-decoded",
                { componentId, blockIndex, mcuIndex, blockX, blockY }
              );
            }
            const tables = resolvedScanComponents.get(componentId);
            if (!tables) {
              throw createJpegEntropyEncodeError(
                "scan-component-encoder-missing",
                { componentId, mcuIndex, blockX, blockY }
              );
            }
            const coefficients = component.coefficients.subarray(
              coefficientOffset,
              coefficientOffset + 64
            );
            const encodedBlock = encodeBaselineBlock({
              writer,
              dcTable: tables.dcTable,
              acTable: tables.acTable,
              coefficients,
              predictor: predictors.get(componentId) || 0,
              context: { scanIndex: 0, intervalIndex, mcuIndex, componentId, blockX, blockY },
              dcCategoryHistogram,
              acSymbolHistogram
            });
            predictors.set(componentId, encodedBlock.nextPredictor);
          }
        });
        const finished = writer.finish();
        encodedIntervals.push({
          intervalIndex,
          sourceInterval: interval,
          payload: finished.bytes,
          stats: finished
        });
        nextMcuIndex += interval.mcuCount;
      }
      if (nextMcuIndex !== model.totalMcuCount) {
        throw createJpegEntropyEncodeError(
          "encoded-mcu-count-mismatch",
          { encodedMcuCount: nextMcuIndex, totalMcuCount: model.totalMcuCount }
        );
      }

      const outputBytes = rebuildBaselineJpegWithEntropy({
        sourceBytes,
        scan,
        intervals,
        encodedIntervals
      });
      const intervalMetadata = encodedIntervals.map((encoded, index) => ({
        intervalIndex: index,
        mcuCount: intervals[index].mcuCount,
        sourcePayloadLength: intervals[index].payloadEnd - intervals[index].payloadStart,
        encodedPayloadLength: encoded.payload.length,
        sourceMarkerCode: intervals[index].markerCode,
        bitsWritten: encoded.stats.bitsWritten,
        dataByteCount: encoded.stats.dataByteCount,
        stuffedByteCount: encoded.stats.stuffedByteCount,
        paddingBitCount: encoded.stats.paddingBitCount
      }));
      const encodedEntropyByteLength = encodedIntervals.reduce(
        (sum, interval) => sum + interval.payload.length,
        0
      );
      const restartTokenByteLength = intervals.reduce(
        (sum, interval) => sum + (
          interval.isFinal
            ? 0
            : interval.markerEnd - interval.markerStart
        ),
        0
      );
      return {
        supported: true,
        reason: null,
        encoded: {
          bytes: outputBytes,
          metadata: {
            process: "baseline-huffman-sequential",
            originalByteLength: sourceBytes.length,
            outputByteLength: outputBytes.length,
            originalEntropyByteLength: scan.endOffset - scan.entropyStart,
            encodedEntropyByteLength:
              encodedEntropyByteLength + restartTokenByteLength,
            intervalCount: intervals.length,
            totalMcuCount: model.totalMcuCount,
            stuffedByteCount: intervalMetadata.reduce(
              (sum, interval) => sum + interval.stuffedByteCount,
              0
            ),
            paddingBitCount: intervalMetadata.reduce(
              (sum, interval) => sum + interval.paddingBitCount,
              0
            ),
            dcCategoryHistogram,
            acSymbolHistogram,
            intervals: intervalMetadata
          }
        }
      };
    }

    function buildBaselineDcMutationDomain(decoded, structure) {
      const support = getBaselineCoefficientDecodeSupport(structure);
      if (!support.supported) {
        throw createJpegEntropyEncodeError(
          "coefficient-domain-unsupported",
          { reason: support.reason }
        );
      }
      const model = validateBaselineCoefficientModel(decoded, support);
      const intervals = [];
      const candidates = [];
      let firstMcuIndex = 0;

      for (let intervalIndex = 0; intervalIndex < model.decodedScan.intervals.length; intervalIndex++) {
        const sourceInterval = model.decodedScan.intervals[intervalIndex];
        const componentChains = new Map(
          model.scan.componentIds.map((componentId) => [componentId, []])
        );
        forEachBaselineBlockInMcuRange({
          frame: model.frame,
          scan: model.scan,
          componentsById: model.componentsById,
          frameMcuColumns: model.frameMcuColumns,
          frameMcuRows: model.frameMcuRows,
          firstMcuIndex,
          mcuCount: sourceInterval.mcuCount,
          createRangeError: createJpegEntropyEncodeError,
          callback(blockContext) {
            const component = blockContext.component;
            componentChains.get(blockContext.componentId).push({
              mcuIndex: blockContext.mcuIndex,
              blockX: blockContext.blockX,
              blockY: blockContext.blockY,
              blockIndex: blockContext.blockIndex,
              coefficientOffset: blockContext.coefficientOffset,
              isVisible:
                blockContext.blockX < component.visibleBlockColumns &&
                blockContext.blockY < component.visibleBlockRows
            });
          }
        });

        for (const [componentId, chain] of componentChains) {
          const component = model.componentsById.get(componentId);
          let predictor = 0;
          for (let ordinal = 0; ordinal < chain.length; ordinal++) {
            const block = chain[ordinal];
            const dc = component.coefficients[block.coefficientOffset];
            const difference = dc - predictor;
            block.dc = dc;
            block.predictor = predictor;
            block.difference = difference;
            block.category = getJpegMagnitudeCategory(difference);
            predictor = dc;
          }

          let suffixMinimum = Infinity;
          let suffixMaximum = -Infinity;
          let suffixVisibleCount = 0;
          for (let ordinal = chain.length - 1; ordinal >= 0; ordinal--) {
            const block = chain[ordinal];
            suffixMinimum = Math.min(suffixMinimum, block.dc);
            suffixMaximum = Math.max(suffixMaximum, block.dc);
            if (block.isVisible) suffixVisibleCount++;
            block.suffixMinimumDc = suffixMinimum;
            block.suffixMaximumDc = suffixMaximum;
            block.suffixVisibleCount = suffixVisibleCount;
          }

          for (let ordinal = 0; ordinal < chain.length; ordinal++) {
            const block = chain[ordinal];
            const difference = block.difference;
            if (difference === 0) continue;
            const negatedDifference = -difference;
            if (
              getJpegMagnitudeCategory(difference) !==
              getJpegMagnitudeCategory(negatedDifference)
            ) {
              continue;
            }
            const delta = negatedDifference - difference;
            if (
              block.suffixMinimumDc + delta < -1024 ||
              block.suffixMaximumDc + delta > 1023 ||
              block.suffixVisibleCount === 0
            ) {
              continue;
            }
            candidates.push({
              intervalIndex,
              componentId,
              componentKey: `C${componentId}`,
              ordinalInComponentInterval: ordinal,
              mcuIndex: block.mcuIndex,
              blockX: block.blockX,
              blockY: block.blockY,
              blockIndex: block.blockIndex,
              originalDc: block.dc,
              predictor: block.predictor,
              originalDifference: difference,
              negatedDifference,
              category: block.category,
              delta,
              affectedBlockCount: chain.length - ordinal,
              affectedVisibleBlockCount: block.suffixVisibleCount,
              intervalPayloadStart: sourceInterval.payloadStart,
              intervalPayloadEnd: sourceInterval.payloadEnd
            });
          }
        }

        intervals.push({
          intervalIndex,
          firstMcuIndex,
          mcuCount: sourceInterval.mcuCount,
          componentChains
        });
        firstMcuIndex += sourceInterval.mcuCount;
      }
      if (firstMcuIndex !== model.totalMcuCount) {
        throw createJpegEntropyEncodeError(
          "coefficient-domain-mcu-count-mismatch",
          { firstMcuIndex, totalMcuCount: model.totalMcuCount }
        );
      }
      return {
        intervals,
        candidates,
        candidateCount: candidates.length
      };
    }

    function cloneProgressiveCompleteDecodedResult(decodedResult) {
      const decoded = decodedResult.decoded;
      return {
        supported: true,
        reason: null,
        decoded: {
          ...decoded,
          components: decoded.components.map((component) => ({
            ...component,
            coefficients: new Int16Array(component.coefficients),
            dcDecodedBlockMask: new Uint8Array(component.dcDecodedBlockMask),
            firstScanAl: new Int8Array(component.firstScanAl),
            currentScanAl: new Int8Array(component.currentScanAl)
          })),
          scans: decoded.scans.map((scan) => ({
            ...scan,
            intervals: scan.intervals.map((interval) => ({ ...interval })),
            dcCategoryHistogram: scan.dcCategoryHistogram
              ? new Uint32Array(scan.dcCategoryHistogram)
              : null,
            acSymbolHistogram: scan.acSymbolHistogram
              ? new Uint32Array(scan.acSymbolHistogram)
              : null
          })),
          finalCoefficientState: new Map(
            decoded.components.map((component) => [
              component.id,
              new Int8Array(component.currentScanAl)
            ])
          )
        }
      };
    }

    function encodeProgressiveCoefficientMutation({
      sourceBytes,
      structure,
      coefficientContext,
      mutatedResult
    }) {
      return encodeProgressiveHuffmanCoefficients(
        sourceBytes,
        structure,
        mutatedResult,
        coefficientContext.scriptResult,
        coefficientContext.planResult
      );
    }

    function progressiveCoefficientUnchanged(sourceBytes, reason) {
      return {
        bytes: new Uint8Array(sourceBytes),
        changed: false,
        reason,
        metadata: null,
        usedClusters: []
      };
    }

    function mutateProgressiveCoefficient({
      sourceBytes,
      structure,
      coefficientContext,
      selection
    }) {
      if (!coefficientContext?.supported) {
        return progressiveCoefficientUnchanged(
          sourceBytes,
          coefficientContext?.reason || "progressive-context-unavailable"
        );
      }
      if (!selection) {
        return progressiveCoefficientUnchanged(
          sourceBytes,
          "progressive-coefficient-no-selected-candidate"
        );
      }
      try {
        const mutatedResult = cloneProgressiveCompleteDecodedResult(
          coefficientContext.decodedResult
        );
        const selections = Array.isArray(selection.selections)
          ? selection.selections
          : [selection];
        if (
          selections.length === 0 ||
          (selection.selectionCount != null &&
            selection.selectionCount !== selections.length)
        ) {
          throw new JpegProgressiveEncodeError(
            "progressive-coefficient-selection-invalid"
          );
        }
        for (const item of selections) {
          const component = getProgressiveComponentById(
            mutatedResult,
            item.componentId
          );
          if (!component) {
            throw new JpegProgressiveEncodeError(
              "progressive-mutation-component-missing"
            );
          }
          if (item.mode === "dc-difference-sign-inversion") {
            const candidate = coefficientContext.dcDomain.candidates[
              item.modeCandidateRank
            ];
            if (
              !candidate ||
              candidate.componentId !== item.componentId ||
              candidate.chainIndex !== item.chainIndex ||
              candidate.ordinalInComponentInterval !==
                item.ordinalInComponentInterval ||
              item.candidateCount !==
                coefficientContext.totalCandidateCount
            ) {
              throw new JpegProgressiveEncodeError(
                "progressive-coefficient-selection-invalid"
              );
            }
            const chain = coefficientContext.dcDomain.chains[
              candidate.chainIndex
            ];
            for (let ordinal = candidate.ordinalInComponentInterval;
              ordinal < chain.blocks.length;
              ordinal++
            ) {
              const coefficientOffset = chain.blocks[ordinal].coefficientOffset;
              component.coefficients[coefficientOffset] += candidate.deltaFinal;
            }
          } else {
            throw new JpegProgressiveEncodeError(
              "unsupported-progressive-coefficient-mutation-mode"
            );
          }
        }
        let changedCoefficientCount = 0;
        for (const component of mutatedResult.decoded.components) {
          const sourceComponent = getProgressiveComponentById(
            coefficientContext.decodedResult,
            component.id
          );
          for (let index = 0; index < component.coefficients.length; index++) {
            if (component.coefficients[index] !==
              sourceComponent.coefficients[index]
            ) {
              changedCoefficientCount++;
            }
          }
        }
        if (changedCoefficientCount === 0) {
          return progressiveCoefficientUnchanged(
            sourceBytes,
            "progressive-coefficient-mutation-no-op"
          );
        }
        const encodedResult = encodeProgressiveCoefficientMutation({
          sourceBytes,
          structure,
          coefficientContext,
          mutatedResult
        });
        if (!encodedResult.supported) {
          return progressiveCoefficientUnchanged(
            sourceBytes,
            encodedResult.reason || "progressive-encode-unsupported"
          );
        }
        return {
          bytes: encodedResult.encoded.bytes,
          changed: true,
          reason: null,
          metadata: {
            ...summarizeCoefficientSelection(selection),
            selectedCoefficientCount: selections.length,
            changedCoefficientCount,
            sourceByteLength: sourceBytes.length,
            outputByteLength: encodedResult.encoded.bytes.length,
            encodedMetadata: encodedResult.encoded.metadata
          },
          usedClusters: createCoefficientSelectionClusters(selections)
        };
      } catch (error) {
        if (
          error instanceof JpegProgressiveEncodeError ||
          error instanceof JpegProgressiveDecodeError ||
          error instanceof JpegProgressiveScriptError
        ) {
          return progressiveCoefficientUnchanged(
            sourceBytes,
            error.code || error.message
          );
        }
        throw error;
      }
    }

    // ========================================================================
    // 09. PROGRESSIVE COEFFICIENT CODEC
    // ========================================================================
    function analyzeProgressiveHuffmanScript(bytes, structure) {
      const support = getProgressiveCoefficientScriptSupport(structure);
      if (!support.supported) {
        return { supported: false, reason: support.reason, script: null };
      }
      const frame = support.frame;
      const scans = structure.scans
        .filter((scan) => scan.frameMarkerOffset === frame.markerOffset)
        .slice()
        .sort((left, right) => left.offset - right.offset);
      if (scans.length === 0) {
        return { supported: false, reason: "scan-list-empty", script: null };
      }
      const componentTopologies = createProgressiveComponentTopologies(frame);
      const componentTopologyById = new Map(
        componentTopologies.map((component) => [component.id, component])
      );
      const coefficientState = createProgressiveCoefficientState(frame);
      const quantizationSignatures = new Map();
      const huffmanDefinitions = getProgressiveHuffmanDefinitions(structure);
      const quantizationDefinitions = (structure.quantTables || [])
        .slice()
        .sort((left, right) => left.definitionOffset - right.definitionOffset);
      const scanDescriptors = [];

      for (let scanIndex = 0; scanIndex < scans.length; scanIndex++) {
        const scan = scans[scanIndex];
        const scanComponents = resolveProgressiveScanComponents(
          frame,
          scan,
          scanIndex
        );
        validateProgressiveScanSampling(scanComponents, scanIndex);
        const scanType = classifyProgressiveScan(
          scan,
          scanComponents,
          scanIndex
        );
        const coefficientStateBefore = compactProgressiveStateForBand(
          coefficientState,
          scanComponents,
          scan.spectralStart,
          scan.spectralEnd
        );
        const huffmanTables = resolveProgressiveScanTables({
          definitions: huffmanDefinitions,
          scan,
          scanIndex,
          scanType,
          scanComponents
        }).map((item) => ({
          componentId: item.componentId,
          dc: item.dcDefinition ? {
            tableClass: 0,
            tableId: item.dcDefinition.tableId,
            definitionOffset: item.dcDefinition.definitionOffset
          } : null,
          ac: item.acDefinition ? {
            tableClass: 1,
            tableId: item.acDefinition.tableId,
            definitionOffset: item.acDefinition.definitionOffset
          } : null
        }));
        const quantizationTables = validateProgressiveQuantizationContinuity({
          scanIndex,
          scan,
          scanComponents,
          quantizationDefinitions,
          signatureByComponentId: quantizationSignatures
        });
        const mcuCount = getProgressiveScanMcuCount(
          frame,
          scanComponents,
          componentTopologyById
        );
        const restart = getProgressiveRestartTopology({
          bytes,
          structure,
          scan,
          scanIndex,
          scanMcuCount: mcuCount
        });
        applyProgressiveScanToState({
          scanIndex,
          scanType,
          scan,
          scanComponents,
          coefficientState
        });
        const coefficientStateAfter = compactProgressiveStateForBand(
          coefficientState,
          scanComponents,
          scan.spectralStart,
          scan.spectralEnd
        );
        scanDescriptors.push({
          scanIndex,
          scanOffset: scan.offset,
          entropyStart: scan.entropyStart,
          entropyEnd: scan.endOffset,
          scanType,
          componentIds: scanComponents.map((component) => component.id),
          components: scanComponents.map((component) => ({
            id: component.id,
            componentIndex: component.componentIndex,
            dcTableId: component.dcTableId,
            acTableId: component.acTableId
          })),
          isInterleaved: scanComponents.length > 1,
          spectralStart: scan.spectralStart,
          spectralEnd: scan.spectralEnd,
          successiveHigh: scan.successiveHigh,
          successiveLow: scan.successiveLow,
          mcuCount,
          huffmanTables,
          quantizationTables,
          restart,
          coefficientStateBefore,
          coefficientStateAfter
        });
      }

      const frameMcuColumns = Math.ceil(
        frame.width / (JPEG_DCT_BLOCK_SIZE * frame.hMax)
      );
      const frameMcuRows = Math.ceil(
        frame.height / (JPEG_DCT_BLOCK_SIZE * frame.vMax)
      );
      return {
        supported: true,
        reason: null,
        script: {
          process: "progressive-huffman-dct",
          width: frame.width,
          height: frame.height,
          precision: frame.precision,
          frameMcuColumns,
          frameMcuRows,
          components: componentTopologies,
          scans: scanDescriptors,
          scanCount: scanDescriptors.length,
          hasDcRefinement: scanDescriptors.some(
            (scan) => scan.scanType === "dc-refine"
          ),
          hasAcRefinement: scanDescriptors.some(
            (scan) => scan.scanType === "ac-refine"
          ),
          hasRestartIntervals: scanDescriptors.some(
            (scan) => scan.restart.intervalCount > 1
          ),
          finalCoefficientState: cloneCoefficientState(coefficientState),
          progressionSummary: summarizeProgressiveState(coefficientState)
        }
      };
    }

    class JpegProgressiveDecodeError extends Error {
      constructor(code, context = {}) {
        super(code);
        this.name = "JpegProgressiveDecodeError";
        this.code = code;
        Object.assign(this, context);
      }
    }

    function createProgressiveDecodeEventSink() {
      return { scans: [] };
    }

    function getProgressiveTraceInterval(eventSink, scan, intervalIndex) {
      if (!eventSink) return null;
      if (!eventSink.scans[scan.scanIndex]) {
        eventSink.scans[scan.scanIndex] = {
          scanIndex: scan.scanIndex,
          scanType: scan.scanType,
          intervals: []
        };
      }
      const scanTrace = eventSink.scans[scan.scanIndex];
      if (!scanTrace.intervals[intervalIndex]) {
        scanTrace.intervals[intervalIndex] = {
          intervalIndex,
          blocks: []
        };
      }
      return scanTrace.intervals[intervalIndex];
    }

    function createProgressiveInitialCoefficientComponent(topology) {
      const blockCount = multiplySafeInteger(
        topology.codedBlockColumns,
        topology.codedBlockRows,
        "progressive-coefficient-block-count-out-of-range",
        { componentId: topology.id }
      );
      const coefficientCount = multiplySafeInteger(
        blockCount,
        JPEG_DCT_COEFFICIENT_COUNT,
        "progressive-coefficient-array-length-out-of-range",
        { componentId: topology.id }
      );
      try {
        return {
          ...topology,
          coefficients: new Int16Array(coefficientCount),
          dcDecodedBlockMask: new Uint8Array(blockCount),
          firstScanAl: new Int8Array(
            JPEG_DCT_COEFFICIENT_COUNT
          ).fill(-1)
        };
      } catch (error) {
        if (error instanceof RangeError) {
          throw new JpegProgressiveDecodeError(
            "progressive-coefficient-buffer-allocation-failed",
            { componentId: topology.id, coefficientCount }
          );
        }
        throw error;
      }
    }

    function decodeProgressiveDcFirstBlock({
      reader,
      dcTable,
      predictor,
      successiveLow,
      context = {},
      traceBlock = null
    }) {
      const category = decodeHuffmanSymbol(reader, dcTable);
      if (category > 11) {
        throw new JpegProgressiveDecodeError(
          "progressive-dc-category-out-of-range",
          { ...context, category }
        );
      }
      const difference = receiveAndExtend(reader, category);
      if (traceBlock) {
        traceBlock.category = category;
      }
      const reducedValue = predictor + difference;
      const scale = Math.pow(2, successiveLow);
      const coefficient = reducedValue * scale;
      if (coefficient < -1024 || coefficient > 1023) {
        throw new JpegProgressiveDecodeError(
          "progressive-dc-coefficient-out-of-range",
          { ...context, reducedValue, successiveLow, coefficient }
        );
      }
      return {
        coefficient,
        reducedValue,
        nextPredictor: reducedValue,
        difference,
        category
      };
    }

    function decodeProgressiveAcFirstBlock({
      reader,
      acTable,
      coefficients,
      coefficientOffset,
      spectralStart,
      spectralEnd,
      successiveLow,
      acState,
      remainingBlocksInInterval,
      acSymbolHistogram = null,
      context = {},
      traceBlock = null
    }) {
      if (acState.eobRun > 0) {
        acState.eobRun--;
        if (traceBlock) traceBlock.eobContinuation = true;
        return {
          skippedByEobRun: true,
          endedByEobRun: false,
          eobRunLength: 0,
          symbolCount: 0,
          zrlCount: 0,
          introducedCoefficientCount: 0
        };
      }
      let coefficientIndex = spectralStart;
      let symbolCount = 0;
      let zrlCount = 0;
      let introducedCoefficientCount = 0;
      while (coefficientIndex <= spectralEnd) {
        const symbol = decodeHuffmanSymbol(reader, acTable);
        if (acSymbolHistogram) acSymbolHistogram[symbol]++;
        symbolCount++;
        const zeroRun = symbol >>> 4;
        const size = symbol & 0x0F;
        const operation = traceBlock
          ? { symbol, size, zeroRun, coefficientIndex: null, extraBitCount: 0, extraBits: 0 }
          : null;
        if (size === 0) {
          if (zeroRun === 15) {
            coefficientIndex += 16;
            zrlCount++;
            if (coefficientIndex > spectralEnd + 1) {
              throw new JpegProgressiveDecodeError(
                "progressive-ac-zrl-exceeds-band",
                { ...context, coefficientIndex, spectralEnd }
              );
            }
            if (operation) {
              operation.kind = "zrl";
              operation.coefficientIndex = coefficientIndex - 16;
              traceBlock.operations.push(operation);
            }
            continue;
          }
          const appended = zeroRun > 0 ? reader.readBits(zeroRun) : 0;
          const runLength = Math.pow(2, zeroRun) + appended;
          if (runLength > remainingBlocksInInterval) {
            throw new JpegProgressiveDecodeError(
              "progressive-eobrun-exceeds-interval",
              { ...context, runLength, remainingBlocksInInterval }
            );
          }
          acState.eobRun = runLength - 1;
          if (operation) {
            operation.kind = "eobrun";
            operation.coefficientIndex = coefficientIndex;
            operation.length = runLength;
            operation.extraBitCount = zeroRun;
            operation.extraBits = appended;
            traceBlock.operations.push(operation);
          }
          return {
            skippedByEobRun: false,
            endedByEobRun: true,
            eobRunLength: runLength,
            symbolCount,
            zrlCount,
            introducedCoefficientCount
          };
        }
        if (size > 10) {
          throw new JpegProgressiveDecodeError(
            "progressive-ac-category-out-of-range",
            { ...context, size, symbol }
          );
        }
        coefficientIndex += zeroRun;
        if (coefficientIndex > spectralEnd) {
          throw new JpegProgressiveDecodeError(
            "progressive-ac-run-exceeds-band",
            { ...context, coefficientIndex, spectralEnd }
          );
        }
        const targetOffset = coefficientOffset + coefficientIndex;
        if (coefficients[targetOffset] !== 0) {
          throw new JpegProgressiveDecodeError(
            "progressive-ac-first-overwrites-nonzero",
            { ...context, coefficientIndex }
          );
        }
        const reducedValue = receiveAndExtend(reader, size);
        const coefficient = reducedValue * Math.pow(2, successiveLow);
        if (coefficient < -1023 || coefficient > 1023) {
          throw new JpegProgressiveDecodeError(
            "progressive-ac-coefficient-out-of-range",
            {
              ...context,
              coefficientIndex,
              reducedValue,
              successiveLow,
              coefficient
            }
          );
        }
        coefficients[targetOffset] = coefficient;
        if (operation) {
          operation.kind = "coefficient";
          operation.coefficientIndex = coefficientIndex;
          traceBlock.operations.push(operation);
        }
        introducedCoefficientCount++;
        coefficientIndex++;
      }
      return {
        skippedByEobRun: false,
        endedByEobRun: false,
        eobRunLength: 0,
        symbolCount,
        zrlCount,
        introducedCoefficientCount
      };
    }

    function validateProgressiveEobRunAtIntervalEnd(
      acState,
      scanIndex,
      intervalIndex
    ) {
      if (acState.eobRun !== 0) {
        throw new JpegProgressiveDecodeError(
          "progressive-eobrun-crosses-restart-boundary",
          { scanIndex, intervalIndex, eobRun: acState.eobRun }
        );
      }
    }

    function getProgressiveDecoderTable({
      definitions,
      decoderCache,
      scanOffset,
      tableClass,
      tableId,
      scanIndex,
      componentId
    }) {
      const definition = resolveHuffmanDefinition(
        definitions,
        scanOffset,
        tableClass,
        tableId
      );
      if (!definition) {
        throw new JpegProgressiveDecodeError(
          tableClass === 0
            ? "progressive-dc-table-missing"
            : "progressive-ac-table-missing",
          { scanIndex, componentId, tableClass, tableId }
        );
      }
      if (!decoderCache.has(definition)) {
        decoderCache.set(definition, buildCanonicalHuffmanDecoder(definition));
      }
      return decoderCache.get(definition);
    }

    function setProgressiveFirstScanAl(
      component,
      spectralStart,
      spectralEnd,
      successiveLow,
      scanIndex
    ) {
      for (
        let coefficientIndex = spectralStart;
        coefficientIndex <= spectralEnd;
        coefficientIndex++
      ) {
        if (component.firstScanAl[coefficientIndex] >= 0) {
          throw new JpegProgressiveDecodeError(
            "progressive-first-scan-al-set-twice",
            { scanIndex, componentId: component.id, coefficientIndex }
          );
        }
        component.firstScanAl[coefficientIndex] = successiveLow;
      }
    }

    function decodeProgressiveDcFirstScan({
      bytes,
      rawScan,
      scan,
      frame,
      componentsById,
      componentTopologyById,
      huffmanDefinitions,
      decoderCache,
      eventSink = null
    }) {
      const predictors = new Map(
        scan.componentIds.map((componentId) => [componentId, 0])
      );
      const dcCategoryHistogram = new Uint32Array(12);
      const intervalResults = [];
      let nextMcuIndex = 0;
      for (
        let intervalIndex = 0;
        intervalIndex < scan.restart.intervals.length;
        intervalIndex++
      ) {
        const interval = scan.restart.intervals[intervalIndex];
        for (const componentId of scan.componentIds) {
          predictors.set(componentId, 0);
        }
        const reader = new JpegEntropyBitReader(
          bytes,
          interval.payloadStart,
          interval.payloadEnd,
          { scanIndex: scan.scanIndex, intervalIndex }
        );
        const traceInterval = getProgressiveTraceInterval(
          eventSink,
          scan,
          intervalIndex
        );
        forEachProgressiveBlockInMcuRange({
          frame,
          scan: rawScan,
          scanComponents: rawScan.components.map((item) => ({
            ...item,
            componentIndex: frame.components.findIndex(
              (component) => component.id === item.id
            ),
            frameComponent: frame.components.find(
              (component) => component.id === item.id
            )
          })),
          componentTopologyById,
          firstMcuIndex: nextMcuIndex,
          mcuCount: interval.mcuCount,
          callback(block) {
            const traceBlock = traceInterval
              ? {
                  blockOrdinal: traceInterval.blocks.length,
                  mcuIndex: block.mcuIndex,
                  componentId: block.componentId,
                  blockIndex: block.blockIndex
                }
              : null;
            if (traceBlock) traceInterval.blocks.push(traceBlock);
            const component = componentsById.get(block.componentId);
            if (component.dcDecodedBlockMask[block.blockIndex] !== 0) {
              throw new JpegProgressiveDecodeError(
                "progressive-dc-block-decoded-twice",
                {
                  scanIndex: scan.scanIndex,
                  intervalIndex,
                  componentId: block.componentId,
                  blockIndex: block.blockIndex
                }
              );
            }
            const scanComponent = rawScan.components.find(
              (item) => item.id === block.componentId
            );
            const dcTable = getProgressiveDecoderTable({
              definitions: huffmanDefinitions,
              decoderCache,
              scanOffset: scan.scanOffset,
              tableClass: 0,
              tableId: scanComponent.dcTableId,
              scanIndex: scan.scanIndex,
              componentId: block.componentId
            });
            reader.setContext({
              scanIndex: scan.scanIndex,
              intervalIndex,
              mcuIndex: block.mcuIndex,
              componentId: block.componentId,
              blockX: block.blockX,
              blockY: block.blockY
            });
            const result = decodeProgressiveDcFirstBlock({
              reader,
              dcTable,
              predictor: predictors.get(block.componentId),
              successiveLow: scan.successiveLow,
              context: {
                scanIndex: scan.scanIndex,
                intervalIndex,
                mcuIndex: block.mcuIndex,
                componentId: block.componentId,
                blockIndex: block.blockIndex
              },
              traceBlock
            });
            predictors.set(block.componentId, result.nextPredictor);
            component.coefficients[
              block.blockIndex * JPEG_DCT_COEFFICIENT_COUNT
            ] = result.coefficient;
            component.dcDecodedBlockMask[block.blockIndex] = 1;
            dcCategoryHistogram[result.category]++;
          }
        });
        nextMcuIndex += interval.mcuCount;
        intervalResults.push({
          intervalIndex,
          mcuCount: interval.mcuCount,
          markerCode: interval.markerCode,
          markerToken: interval.markerToken,
          ...reader.finish()
        });
      }
      if (nextMcuIndex !== scan.mcuCount) {
        throw new JpegProgressiveDecodeError(
          "progressive-decoded-mcu-count-mismatch",
          { scanIndex: scan.scanIndex, nextMcuIndex, mcuCount: scan.mcuCount }
        );
      }
      for (const componentId of scan.componentIds) {
        setProgressiveFirstScanAl(
          componentsById.get(componentId),
          JPEG_DC_COEFFICIENT_INDEX,
          JPEG_DC_COEFFICIENT_INDEX,
          scan.successiveLow,
          scan.scanIndex
        );
      }
      return { intervalResults, dcCategoryHistogram };
    }

    function decodeProgressiveAcFirstScan({
      bytes,
      rawScan,
      scan,
      frame,
      componentsById,
      componentTopologyById,
      huffmanDefinitions,
      decoderCache,
      eventSink = null
    }) {
      if (scan.componentIds.length !== 1 || rawScan.components.length !== 1) {
        throw new JpegProgressiveDecodeError(
          "progressive-ac-first-not-single-component",
          { scanIndex: scan.scanIndex }
        );
      }
      const componentId = scan.componentIds[0];
      const component = componentsById.get(componentId);
      const scanComponent = rawScan.components[0];
      const acTable = getProgressiveDecoderTable({
        definitions: huffmanDefinitions,
        decoderCache,
        scanOffset: scan.scanOffset,
        tableClass: 1,
        tableId: scanComponent.acTableId,
        scanIndex: scan.scanIndex,
        componentId
      });
      const acSymbolHistogram = new Uint32Array(256);
      const intervalResults = [];
      let nextMcuIndex = 0;
      let zrlCount = 0;
      let eobRunSymbolCount = 0;
      let eobRunCoveredBlockCount = 0;
      let introducedCoefficientCount = 0;
      for (
        let intervalIndex = 0;
        intervalIndex < scan.restart.intervals.length;
        intervalIndex++
      ) {
        const interval = scan.restart.intervals[intervalIndex];
        const acState = { eobRun: 0 };
        const reader = new JpegEntropyBitReader(
          bytes,
          interval.payloadStart,
          interval.payloadEnd,
          { scanIndex: scan.scanIndex, intervalIndex }
        );
        const traceInterval = getProgressiveTraceInterval(
          eventSink,
          scan,
          intervalIndex
        );
        let blockOffsetInInterval = 0;
        forEachProgressiveBlockInMcuRange({
          frame,
          scan: rawScan,
          scanComponents: [{
            ...scanComponent,
            componentIndex: component.componentIndex,
            frameComponent: frame.components[component.componentIndex]
          }],
          componentTopologyById,
          firstMcuIndex: nextMcuIndex,
          mcuCount: interval.mcuCount,
          callback(block) {
            const traceBlock = traceInterval
              ? {
                  blockOrdinal: traceInterval.blocks.length,
                  mcuIndex: block.mcuIndex,
                  componentId,
                  blockIndex: block.blockIndex,
                  operations: []
                }
              : null;
            if (traceBlock) traceInterval.blocks.push(traceBlock);
            reader.setContext({
              scanIndex: scan.scanIndex,
              intervalIndex,
              mcuIndex: block.mcuIndex,
              componentId,
              blockX: block.blockX,
              blockY: block.blockY
            });
            const result = decodeProgressiveAcFirstBlock({
              reader,
              acTable,
              coefficients: component.coefficients,
              coefficientOffset:
                block.blockIndex * JPEG_DCT_COEFFICIENT_COUNT,
              spectralStart: scan.spectralStart,
              spectralEnd: scan.spectralEnd,
              successiveLow: scan.successiveLow,
              acState,
              remainingBlocksInInterval:
                interval.mcuCount - blockOffsetInInterval,
              acSymbolHistogram,
              context: {
                scanIndex: scan.scanIndex,
                intervalIndex,
                mcuIndex: block.mcuIndex,
                componentId,
                blockIndex: block.blockIndex
              },
              traceBlock
            });
            zrlCount += result.zrlCount;
            if (result.endedByEobRun) {
              eobRunSymbolCount++;
              eobRunCoveredBlockCount += result.eobRunLength;
            }
            introducedCoefficientCount += result.introducedCoefficientCount;
            blockOffsetInInterval++;
          }
        });
        validateProgressiveEobRunAtIntervalEnd(
          acState,
          scan.scanIndex,
          intervalIndex
        );
        nextMcuIndex += interval.mcuCount;
        intervalResults.push({
          intervalIndex,
          mcuCount: interval.mcuCount,
          markerCode: interval.markerCode,
          markerToken: interval.markerToken,
          ...reader.finish()
        });
      }
      if (nextMcuIndex !== scan.mcuCount) {
        throw new JpegProgressiveDecodeError(
          "progressive-decoded-mcu-count-mismatch",
          { scanIndex: scan.scanIndex, nextMcuIndex, mcuCount: scan.mcuCount }
        );
      }
      setProgressiveFirstScanAl(
        component,
        scan.spectralStart,
        scan.spectralEnd,
        scan.successiveLow,
        scan.scanIndex
      );
      return {
        intervalResults,
        acSymbolHistogram,
        zrlCount,
        eobRunSymbolCount,
        eobRunCoveredBlockCount,
        introducedCoefficientCount
      };
    }

    function createProgressiveScriptHash(script) {
      const text = JSON.stringify({
        process: script.process,
        width: script.width,
        height: script.height,
        precision: script.precision,
        scans: script.scans.map((scan) => ({
          scanIndex: scan.scanIndex,
          scanOffset: scan.scanOffset,
          scanType: scan.scanType,
          componentIds: scan.componentIds,
          spectralStart: scan.spectralStart,
          spectralEnd: scan.spectralEnd,
          successiveHigh: scan.successiveHigh,
          successiveLow: scan.successiveLow,
          mcuCount: scan.mcuCount,
          restart: scan.restart.intervals.map((interval) => ({
            mcuCount: interval.mcuCount,
            markerCode: interval.markerCode
          }))
        }))
      });
      let hash = 2166136261;
      for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
      return hash.toString(16).padStart(8, "0");
    }

    function summarizeProgressiveDecodedScan(scan, status, details = null) {
      const intervalResults = details?.intervalResults || [];
      return {
        scanIndex: scan.scanIndex,
        scanType: scan.scanType,
        status,
        componentIds: scan.componentIds.slice(),
        spectralStart: scan.spectralStart,
        spectralEnd: scan.spectralEnd,
        successiveLow: scan.successiveLow,
        mcuCount: scan.mcuCount,
        intervalCount: scan.restart.intervalCount,
        bitsRead: intervalResults.reduce((sum, item) => sum + item.bitsRead, 0),
        dataBytesRead: intervalResults.reduce(
          (sum, item) => sum + item.dataBytesRead,
          0
        ),
        stuffedByteCount: intervalResults.reduce(
          (sum, item) => sum + item.stuffedByteCount,
          0
        ),
        paddingBitCount: intervalResults.reduce(
          (sum, item) => sum + item.paddingBitCount,
          0
        ),
        dcCategoryHistogram: details?.dcCategoryHistogram || null,
        acSymbolHistogram: details?.acSymbolHistogram || null,
        zrlCount: details?.zrlCount || 0,
        eobRunSymbolCount: details?.eobRunSymbolCount || 0,
        eobRunCoveredBlockCount: details?.eobRunCoveredBlockCount || 0,
        introducedCoefficientCount: details?.introducedCoefficientCount || 0,
        intervals: intervalResults
      };
    }

    function decodeProgressiveHuffmanInitialCoefficients(
      bytes,
      structure,
      scriptResult = null,
      options = {}
    ) {
      const analysis = scriptResult ||
        analyzeProgressiveHuffmanScript(bytes, structure);
      if (!analysis.supported) {
        return { supported: false, reason: analysis.reason, decoded: null };
      }
      const frame = structure.frames[0];
      const rawScans = structure.scans
        .filter((scan) => scan.frameMarkerOffset === frame.markerOffset)
        .slice()
        .sort((left, right) => left.offset - right.offset);
      if (rawScans.length !== analysis.script.scans.length) {
        throw new JpegProgressiveDecodeError(
          "progressive-script-scan-count-mismatch"
        );
      }
      const components = analysis.script.components.map(
        createProgressiveInitialCoefficientComponent
      );
      const componentsById = new Map(
        components.map((component) => [component.id, component])
      );
      const componentTopologyById = new Map(
        analysis.script.components.map((component) => [component.id, component])
      );
      const huffmanDefinitions = parseHuffmanDefinitions(bytes, structure);
      const decoderCache = new Map();
      const decodedScanDescriptors = [];
      let decodedInitialScanCount = 0;
      let skippedRefinementScanCount = 0;

      for (const scan of analysis.script.scans) {
        const rawScan = rawScans[scan.scanIndex];
        if (!rawScan || rawScan.offset !== scan.scanOffset) {
          throw new JpegProgressiveDecodeError(
            "progressive-script-scan-offset-mismatch",
            { scanIndex: scan.scanIndex }
          );
        }
        let details = null;
        let status = null;
        switch (scan.scanType) {
          case "dc-first":
            details = decodeProgressiveDcFirstScan({
              bytes,
              rawScan,
              scan,
              frame,
              componentsById,
              componentTopologyById,
              huffmanDefinitions,
              decoderCache,
              eventSink: options.eventSink || null
            });
            status = "decoded";
            decodedInitialScanCount++;
            break;
          case "ac-first":
            details = decodeProgressiveAcFirstScan({
              bytes,
              rawScan,
              scan,
              frame,
              componentsById,
              componentTopologyById,
              huffmanDefinitions,
              decoderCache,
              eventSink: options.eventSink || null
            });
            status = "decoded";
            decodedInitialScanCount++;
            break;
          case "dc-refine":
          case "ac-refine":
            status = "skipped-refinement";
            skippedRefinementScanCount++;
            break;
          default:
            throw new JpegProgressiveDecodeError(
              "unknown-progressive-scan-type",
              { scanIndex: scan.scanIndex, scanType: scan.scanType }
            );
        }
        decodedScanDescriptors.push(
          summarizeProgressiveDecodedScan(scan, status, details)
        );
      }
      return {
        supported: true,
        reason: null,
        decoded: {
          process: "progressive-huffman-initial-scans",
          width: analysis.script.width,
          height: analysis.script.height,
          precision: analysis.script.precision,
          frameMcuColumns: analysis.script.frameMcuColumns,
          frameMcuRows: analysis.script.frameMcuRows,
          components,
          scans: decodedScanDescriptors,
          decodedInitialScanCount,
          skippedRefinementScanCount,
          refinementApplied: false,
          scriptHash: createProgressiveScriptHash(analysis.script)
        }
      };
    }

    function recoverProgressiveDcFirstCoefficientFromFinal(
      coefficient,
      successiveLow
    ) {
      if (coefficient === 0) return 0;
      const scale = Math.pow(2, successiveLow);
      if (coefficient > 0) {
        return Math.floor(coefficient / scale) * scale;
      }
      return -Math.ceil(Math.abs(coefficient) / scale) * scale;
    }

    function cloneProgressiveInitialCoefficientModel(initialDecoded) {
      return {
        ...initialDecoded,
        components: initialDecoded.components.map((component) => ({
          ...component,
          coefficients: new Int16Array(component.coefficients),
          dcDecodedBlockMask: new Uint8Array(component.dcDecodedBlockMask),
          firstScanAl: new Int8Array(component.firstScanAl),
          currentScanAl: new Int8Array(component.firstScanAl)
        })),
        scans: initialDecoded.scans.map((scan) => ({
          ...scan,
          intervals: scan.intervals.map((interval) => ({ ...interval })),
          dcCategoryHistogram: scan.dcCategoryHistogram
            ? new Uint32Array(scan.dcCategoryHistogram)
            : null,
          acSymbolHistogram: scan.acSymbolHistogram
            ? new Uint32Array(scan.acSymbolHistogram)
            : null
        }))
      };
    }

    function decodeProgressiveDcRefinementBlock({
      reader,
      coefficients,
      coefficientOffset,
      successiveHigh,
      successiveLow,
      context = {},
      traceBlock = null
    }) {
      const coefficient = coefficients[coefficientOffset];
      const p1 = Math.pow(2, successiveLow);
      if ((coefficient & p1) !== 0) {
        throw new JpegProgressiveDecodeError(
          "progressive-dc-refinement-bit-already-set",
          { ...context, coefficient, successiveHigh, successiveLow }
        );
      }
      const bit = reader.readBit();
      if (traceBlock) traceBlock.refinementBit = bit;
      const nextCoefficient = bit === 1 ? coefficient | p1 : coefficient;
      if (nextCoefficient < -1024 || nextCoefficient > 1023) {
        throw new JpegProgressiveDecodeError(
          "progressive-dc-refinement-out-of-range",
          { ...context, coefficient, bit, nextCoefficient }
        );
      }
      coefficients[coefficientOffset] = nextCoefficient;
      return {
        bit,
        changed: nextCoefficient !== coefficient,
        previousCoefficient: coefficient,
        nextCoefficient
      };
    }

    function applyProgressiveAcCorrectionBit({
      reader,
      coefficients,
      coefficientOffset,
      coefficientIndex,
      successiveLow,
      context = {},
      traceCorrectionIndices = null
    }) {
      const targetOffset = coefficientOffset + coefficientIndex;
      const coefficient = coefficients[targetOffset];
      if (coefficient === 0) {
        throw new JpegProgressiveDecodeError(
          "progressive-ac-correction-target-is-zero",
          { ...context, coefficientIndex }
        );
      }
      const p1 = Math.pow(2, successiveLow);
      if ((Math.abs(coefficient) & p1) !== 0) {
        throw new JpegProgressiveDecodeError(
          "progressive-ac-refinement-bit-already-set",
          { ...context, coefficientIndex, coefficient, successiveLow }
        );
      }
      const bit = reader.readBit();
      if (traceCorrectionIndices) {
        traceCorrectionIndices.push(coefficientIndex);
      }
      let nextCoefficient = coefficient;
      if (bit === 1) {
        nextCoefficient = coefficient > 0
          ? coefficient + p1
          : coefficient - p1;
      }
      if (nextCoefficient < -1023 || nextCoefficient > 1023) {
        throw new JpegProgressiveDecodeError(
          "progressive-ac-refinement-out-of-range",
          { ...context, coefficientIndex, coefficient, bit, nextCoefficient }
        );
      }
      coefficients[targetOffset] = nextCoefficient;
      return { bit, changed: nextCoefficient !== coefficient };
    }

    function decodeProgressiveAcRefinementBlock({
      reader,
      acTable,
      coefficients,
      coefficientOffset,
      spectralStart,
      spectralEnd,
      successiveLow,
      acState,
      remainingBlocksInInterval,
      acSymbolHistogram = null,
      context = {},
      traceBlock = null
    }) {
      const p1 = Math.pow(2, successiveLow);
      let coefficientIndex = spectralStart;
      let symbolCount = 0;
      let correctionBitCount = 0;
      let correctionOneCount = 0;
      let introducedCoefficientCount = 0;
      let zrlCount = 0;
      let eobRunSymbolCount = 0;
      let eobRunCoveredBlockCount = 0;
      let activeEobOperation = null;
      if (traceBlock && acState.eobRun > 0) {
        traceBlock.eobContinuation = true;
        traceBlock.continuationCorrectionIndices = [];
      }

      if (acState.eobRun === 0) {
        while (coefficientIndex <= spectralEnd) {
          const symbol = decodeHuffmanSymbol(reader, acTable);
          if (acSymbolHistogram) acSymbolHistogram[symbol]++;
          symbolCount++;
          let zeroRun = symbol >>> 4;
          const size = symbol & 0x0F;
          let newCoefficient = 0;
          const operation = traceBlock
            ? {
                symbol,
                size,
                zeroRun,
                kind: null,
                coefficientIndex: null,
                extraBitCount: 0,
                extraBits: 0,
                correctionIndices: []
              }
            : null;
          if (size !== 0) {
            if (size !== 1) {
              throw new JpegProgressiveDecodeError(
                "progressive-ac-refinement-size-not-one",
                { ...context, symbol, size }
              );
            }
            newCoefficient = reader.readBit() === 1 ? p1 : -p1;
            if (operation) operation.kind = "new";
          } else if (zeroRun !== 15) {
            let runLength = Math.pow(2, zeroRun);
            const extraBits = zeroRun > 0 ? reader.readBits(zeroRun) : 0;
            runLength += extraBits;
            if (runLength > remainingBlocksInInterval) {
              throw new JpegProgressiveDecodeError(
                "progressive-refinement-eobrun-exceeds-interval",
                { ...context, runLength, remainingBlocksInInterval }
              );
            }
            acState.eobRun = runLength;
            eobRunSymbolCount++;
            eobRunCoveredBlockCount += runLength;
            if (operation) {
              operation.kind = "eobrun";
              operation.coefficientIndex = coefficientIndex;
              operation.length = runLength;
              operation.extraBitCount = zeroRun;
              operation.extraBits = extraBits;
              traceBlock.operations.push(operation);
              activeEobOperation = operation;
            }
            break;
          } else {
            zrlCount++;
            if (operation) operation.kind = "zrl";
          }

          let zeroTargetFound = false;
          while (coefficientIndex <= spectralEnd) {
            const value = coefficients[coefficientOffset + coefficientIndex];
            if (value !== 0) {
              const correction = applyProgressiveAcCorrectionBit({
                reader,
                coefficients,
                coefficientOffset,
                coefficientIndex,
                successiveLow,
                context,
                traceCorrectionIndices: operation?.correctionIndices || null
              });
              correctionBitCount++;
              if (correction.bit === 1) correctionOneCount++;
            } else {
              zeroRun--;
              if (zeroRun < 0) {
                zeroTargetFound = true;
                break;
              }
            }
            coefficientIndex++;
          }
          if (!zeroTargetFound) {
            throw new JpegProgressiveDecodeError(
              "progressive-ac-refinement-run-exceeds-band",
              { ...context, coefficientIndex, spectralEnd }
            );
          }
          if (size === 1) {
            const targetOffset = coefficientOffset + coefficientIndex;
            if (coefficients[targetOffset] !== 0) {
              throw new JpegProgressiveDecodeError(
                "progressive-ac-refinement-new-coefficient-overwrites-nonzero",
                { ...context, coefficientIndex }
              );
            }
            coefficients[targetOffset] = newCoefficient;
            introducedCoefficientCount++;
            if (operation) operation.coefficientIndex = coefficientIndex;
          }
          if (operation) traceBlock.operations.push(operation);
          coefficientIndex++;
        }
      }

      if (acState.eobRun > 0) {
        while (coefficientIndex <= spectralEnd) {
          if (coefficients[coefficientOffset + coefficientIndex] !== 0) {
            const correction = applyProgressiveAcCorrectionBit({
              reader,
              coefficients,
              coefficientOffset,
              coefficientIndex,
              successiveLow,
              context,
              traceCorrectionIndices: activeEobOperation
                ? activeEobOperation.correctionIndices
                : traceBlock?.continuationCorrectionIndices || null
            });
            correctionBitCount++;
            if (correction.bit === 1) correctionOneCount++;
          }
          coefficientIndex++;
        }
        acState.eobRun--;
      }
      return {
        symbolCount,
        correctionBitCount,
        correctionOneCount,
        introducedCoefficientCount,
        zrlCount,
        eobRunSymbolCount,
        eobRunCoveredBlockCount
      };
    }

    function validateAndAdvanceProgressivePrecision({
      component,
      spectralStart,
      spectralEnd,
      successiveHigh,
      successiveLow,
      scanIndex,
      update = false
    }) {
      for (let index = spectralStart; index <= spectralEnd; index++) {
        if (component.currentScanAl[index] !== successiveHigh) {
          throw new JpegProgressiveDecodeError(
            "progressive-refinement-history-mismatch",
            {
              scanIndex,
              componentId: component.id,
              coefficientIndex: index,
              expectedAh: component.currentScanAl[index],
              actualAh: successiveHigh
            }
          );
        }
      }
      if (update) {
        component.currentScanAl.fill(
          successiveLow,
          spectralStart,
          spectralEnd + 1
        );
      }
    }

    function getRawProgressiveScanComponents(frame, rawScan) {
      return rawScan.components.map((item) => ({
        ...item,
        componentIndex: frame.components.findIndex(
          (component) => component.id === item.id
        ),
        frameComponent: frame.components.find(
          (component) => component.id === item.id
        )
      }));
    }

    function decodeProgressiveDcRefinementScan({
      bytes,
      rawScan,
      scan,
      frame,
      componentsById,
      componentTopologyById,
      eventSink = null
    }) {
      for (const componentId of scan.componentIds) {
        const component = componentsById.get(componentId);
        validateAndAdvanceProgressivePrecision({
          component,
          spectralStart: 0,
          spectralEnd: 0,
          successiveHigh: scan.successiveHigh,
          successiveLow: scan.successiveLow,
          scanIndex: scan.scanIndex
        });
      }
      let nextMcuIndex = 0;
      let rawRefinementBitCount = 0;
      let changedCoefficientCount = 0;
      const intervalResults = [];
      const scanComponents = getRawProgressiveScanComponents(frame, rawScan);
      for (let intervalIndex = 0; intervalIndex < scan.restart.intervals.length; intervalIndex++) {
        const interval = scan.restart.intervals[intervalIndex];
        const reader = new JpegEntropyBitReader(
          bytes,
          interval.payloadStart,
          interval.payloadEnd,
          { scanIndex: scan.scanIndex, intervalIndex }
        );
        const traceInterval = getProgressiveTraceInterval(
          eventSink,
          scan,
          intervalIndex
        );
        forEachProgressiveBlockInMcuRange({
          frame,
          scan: rawScan,
          scanComponents,
          componentTopologyById,
          firstMcuIndex: nextMcuIndex,
          mcuCount: interval.mcuCount,
          callback(block) {
            const traceBlock = traceInterval
              ? {
                  blockOrdinal: traceInterval.blocks.length,
                  mcuIndex: block.mcuIndex,
                  componentId: block.componentId,
                  blockIndex: block.blockIndex
                }
              : null;
            if (traceBlock) traceInterval.blocks.push(traceBlock);
            const component = componentsById.get(block.componentId);
            if (component.dcDecodedBlockMask[block.blockIndex] !== 1) {
              throw new JpegProgressiveDecodeError(
                "progressive-dc-refinement-before-first-scan",
                { scanIndex: scan.scanIndex, componentId: block.componentId, blockIndex: block.blockIndex }
              );
            }
            const result = decodeProgressiveDcRefinementBlock({
              reader,
              coefficients: component.coefficients,
              coefficientOffset: block.blockIndex * JPEG_DCT_COEFFICIENT_COUNT,
              successiveHigh: scan.successiveHigh,
              successiveLow: scan.successiveLow,
              context: { scanIndex: scan.scanIndex, intervalIndex, componentId: block.componentId, blockIndex: block.blockIndex },
              traceBlock
            });
            rawRefinementBitCount++;
            if (result.changed) changedCoefficientCount++;
          }
        });
        nextMcuIndex += interval.mcuCount;
        intervalResults.push({ intervalIndex, mcuCount: interval.mcuCount, markerCode: interval.markerCode, markerToken: interval.markerToken, ...reader.finish() });
      }
      if (nextMcuIndex !== scan.mcuCount) {
        throw new JpegProgressiveDecodeError("progressive-decoded-mcu-count-mismatch", { scanIndex: scan.scanIndex });
      }
      for (const componentId of scan.componentIds) {
        validateAndAdvanceProgressivePrecision({
          component: componentsById.get(componentId),
          spectralStart: 0,
          spectralEnd: 0,
          successiveHigh: scan.successiveHigh,
          successiveLow: scan.successiveLow,
          scanIndex: scan.scanIndex,
          update: true
        });
      }
      return { intervalResults, rawRefinementBitCount, changedCoefficientCount };
    }

    function decodeProgressiveAcRefinementScan({
      bytes,
      rawScan,
      scan,
      frame,
      componentsById,
      componentTopologyById,
      huffmanDefinitions,
      decoderCache,
      eventSink = null
    }) {
      if (scan.componentIds.length !== 1 || rawScan.components.length !== 1) {
        throw new JpegProgressiveDecodeError("progressive-ac-refinement-not-single-component", { scanIndex: scan.scanIndex });
      }
      const componentId = scan.componentIds[0];
      const component = componentsById.get(componentId);
      validateAndAdvanceProgressivePrecision({ component, spectralStart: scan.spectralStart, spectralEnd: scan.spectralEnd, successiveHigh: scan.successiveHigh, successiveLow: scan.successiveLow, scanIndex: scan.scanIndex });
      const acTable = getProgressiveDecoderTable({ definitions: huffmanDefinitions, decoderCache, scanOffset: scan.scanOffset, tableClass: 1, tableId: rawScan.components[0].acTableId, scanIndex: scan.scanIndex, componentId });
      const acSymbolHistogram = new Uint32Array(256);
      const totals = { correctionBitCount: 0, correctionOneCount: 0, introducedCoefficientCount: 0, zrlCount: 0, eobRunSymbolCount: 0, eobRunCoveredBlockCount: 0 };
      const intervalResults = [];
      let nextMcuIndex = 0;
      const scanComponents = getRawProgressiveScanComponents(frame, rawScan);
      for (let intervalIndex = 0; intervalIndex < scan.restart.intervals.length; intervalIndex++) {
        const interval = scan.restart.intervals[intervalIndex];
        const acState = { eobRun: 0 };
        const reader = new JpegEntropyBitReader(bytes, interval.payloadStart, interval.payloadEnd, { scanIndex: scan.scanIndex, intervalIndex });
        const traceInterval = getProgressiveTraceInterval(
          eventSink,
          scan,
          intervalIndex
        );
        let blockOffset = 0;
        forEachProgressiveBlockInMcuRange({
          frame, scan: rawScan, scanComponents, componentTopologyById,
          firstMcuIndex: nextMcuIndex, mcuCount: interval.mcuCount,
          callback(block) {
            const traceBlock = traceInterval
              ? {
                  blockOrdinal: traceInterval.blocks.length,
                  mcuIndex: block.mcuIndex,
                  componentId,
                  blockIndex: block.blockIndex,
                  operations: []
                }
              : null;
            if (traceBlock) traceInterval.blocks.push(traceBlock);
            const result = decodeProgressiveAcRefinementBlock({
              reader, acTable, coefficients: component.coefficients,
              coefficientOffset: block.blockIndex * JPEG_DCT_COEFFICIENT_COUNT,
              spectralStart: scan.spectralStart, spectralEnd: scan.spectralEnd,
              successiveLow: scan.successiveLow, acState,
              remainingBlocksInInterval: interval.mcuCount - blockOffset,
              acSymbolHistogram,
              context: { scanIndex: scan.scanIndex, intervalIndex, componentId, blockIndex: block.blockIndex },
              traceBlock
            });
            for (const key of Object.keys(totals)) totals[key] += result[key];
            blockOffset++;
          }
        });
        if (acState.eobRun !== 0) {
          throw new JpegProgressiveDecodeError("progressive-refinement-eobrun-crosses-restart-boundary", { scanIndex: scan.scanIndex, intervalIndex, eobRun: acState.eobRun });
        }
        nextMcuIndex += interval.mcuCount;
        intervalResults.push({ intervalIndex, mcuCount: interval.mcuCount, markerCode: interval.markerCode, markerToken: interval.markerToken, ...reader.finish() });
      }
      if (nextMcuIndex !== scan.mcuCount) throw new JpegProgressiveDecodeError("progressive-decoded-mcu-count-mismatch", { scanIndex: scan.scanIndex });
      validateAndAdvanceProgressivePrecision({ component, spectralStart: scan.spectralStart, spectralEnd: scan.spectralEnd, successiveHigh: scan.successiveHigh, successiveLow: scan.successiveLow, scanIndex: scan.scanIndex, update: true });
      return { intervalResults, acSymbolHistogram, ...totals };
    }

    function summarizeProgressiveRefinementScan(scan, details) {
      const intervals = details.intervalResults;
      return {
        scanIndex: scan.scanIndex,
        scanType: scan.scanType,
        status: "decoded-refinement",
        componentIds: scan.componentIds.slice(),
        spectralStart: scan.spectralStart,
        spectralEnd: scan.spectralEnd,
        successiveHigh: scan.successiveHigh,
        successiveLow: scan.successiveLow,
        mcuCount: scan.mcuCount,
        intervalCount: scan.restart.intervalCount,
        bitsRead: intervals.reduce((sum, item) => sum + item.bitsRead, 0),
        dataBytesRead: intervals.reduce((sum, item) => sum + item.dataBytesRead, 0),
        stuffedByteCount: intervals.reduce((sum, item) => sum + item.stuffedByteCount, 0),
        paddingBitCount: intervals.reduce((sum, item) => sum + item.paddingBitCount, 0),
        rawRefinementBitCount: details.rawRefinementBitCount || 0,
        correctionBitCount: details.correctionBitCount || 0,
        correctionOneCount: details.correctionOneCount || 0,
        introducedCoefficientCount: details.introducedCoefficientCount || 0,
        zrlCount: details.zrlCount || 0,
        eobRunSymbolCount: details.eobRunSymbolCount || 0,
        eobRunCoveredBlockCount: details.eobRunCoveredBlockCount || 0,
        acSymbolHistogram: details.acSymbolHistogram || null,
        intervals
      };
    }

    function decodeProgressiveHuffmanCoefficients(
      bytes,
      structure,
      scriptResult = null,
      initialResult = null,
      options = {}
    ) {
      const analysis = scriptResult || analyzeProgressiveHuffmanScript(bytes, structure);
      if (!analysis.supported) return { supported: false, reason: analysis.reason, decoded: null };
      const initial = initialResult || decodeProgressiveHuffmanInitialCoefficients(
        bytes,
        structure,
        analysis,
        { eventSink: options.eventSink || null }
      );
      if (!initial.supported) return initial;
      const model = cloneProgressiveInitialCoefficientModel(initial.decoded);
      const componentsById = new Map(model.components.map((component) => [component.id, component]));
      const componentTopologyById = new Map(analysis.script.components.map((component) => [component.id, component]));
      const frame = structure.frames[0];
      const rawScans = structure.scans.filter((scan) => scan.frameMarkerOffset === frame.markerOffset).slice().sort((a, b) => a.offset - b.offset);
      const huffmanDefinitions = parseHuffmanDefinitions(bytes, structure);
      const decoderCache = new Map();
      const completedScans = model.scans.map((scan) => ({ ...scan }));
      let dcRefinementScanCount = 0;
      let acRefinementScanCount = 0;
      for (const scan of analysis.script.scans) {
        if (scan.scanType !== "dc-refine" && scan.scanType !== "ac-refine") continue;
        const rawScan = rawScans[scan.scanIndex];
        const details = scan.scanType === "dc-refine"
          ? decodeProgressiveDcRefinementScan({ bytes, rawScan, scan, frame, componentsById, componentTopologyById, eventSink: options.eventSink || null })
          : decodeProgressiveAcRefinementScan({ bytes, rawScan, scan, frame, componentsById, componentTopologyById, huffmanDefinitions, decoderCache, eventSink: options.eventSink || null });
        if (scan.scanType === "dc-refine") dcRefinementScanCount++;
        else acRefinementScanCount++;
        completedScans[scan.scanIndex] = summarizeProgressiveRefinementScan(scan, details);
      }
      return {
        supported: true,
        reason: null,
        decoded: {
          ...model,
          process: "progressive-huffman-complete",
          refinementApplied: true,
          dcRefinementScanCount,
          acRefinementScanCount,
          scans: completedScans,
          finalCoefficientState: new Map(model.components.map((component) => [component.id, new Int8Array(component.currentScanAl)]))
        }
      };
    }

    function truncateProgressiveDcToAl(coefficient, successiveLow) {
      const scale = Math.pow(2, successiveLow);
      return Math.floor(coefficient / scale) * scale;
    }

    function truncateProgressiveAcToAl(coefficient, successiveLow) {
      if (coefficient === 0) return 0;
      const scale = Math.pow(2, successiveLow);
      const magnitude = Math.floor(Math.abs(coefficient) / scale) * scale;
      if (magnitude === 0) return 0;
      return coefficient < 0 ? -magnitude : magnitude;
    }

    class JpegProgressiveEncodeError extends Error {
      constructor(code, context = {}) {
        super(code);
        this.name = "JpegProgressiveEncodeError";
        this.code = code;
        Object.assign(this, context);
      }
    }

    function validateProgressiveEncodingTrace(analysis, eventSink) {
      if (!eventSink || !Array.isArray(eventSink.scans)) {
        throw new JpegProgressiveEncodeError("progressive-encoding-plan-missing");
      }
      const scans = analysis.script.scans.map((scan) => {
        const trace = eventSink.scans[scan.scanIndex];
        if (!trace || trace.scanType !== scan.scanType) {
          throw new JpegProgressiveEncodeError(
            "progressive-encoding-plan-scan-missing",
            { scanIndex: scan.scanIndex }
          );
        }
        if (trace.intervals.length !== scan.restart.intervalCount) {
          throw new JpegProgressiveEncodeError(
            "progressive-encoding-plan-interval-count-mismatch",
            { scanIndex: scan.scanIndex }
          );
        }
        let eobRunEventCount = 0;
        for (const interval of trace.intervals) {
          if (!interval) {
            throw new JpegProgressiveEncodeError(
              "progressive-encoding-plan-interval-missing",
              { scanIndex: scan.scanIndex }
            );
          }
          for (let blockIndex = 0; blockIndex < interval.blocks.length; blockIndex++) {
            const block = interval.blocks[blockIndex];
            for (const operation of block.operations || []) {
              if (operation.kind !== "eobrun") continue;
              eobRunEventCount++;
              if (
                operation.length < 1 ||
                operation.extraBitCount < 0 ||
                operation.extraBitCount > 14 ||
                operation.extraBits < 0 ||
                operation.extraBits >= Math.pow(2, operation.extraBitCount) ||
                operation.symbol !== operation.extraBitCount << 4 ||
                operation.length !==
                  Math.pow(2, operation.extraBitCount) + operation.extraBits ||
                operation.coefficientIndex < scan.spectralStart ||
                operation.coefficientIndex > scan.spectralEnd ||
                blockIndex + operation.length > interval.blocks.length
              ) {
                throw new JpegProgressiveEncodeError(
                  "progressive-encoding-plan-invalid-eobrun",
                  { scanIndex: scan.scanIndex, intervalIndex: interval.intervalIndex }
                );
              }
              for (let offset = 1; offset < operation.length; offset++) {
                if (!interval.blocks[blockIndex + offset]?.eobContinuation) {
                  throw new JpegProgressiveEncodeError(
                    "progressive-encoding-plan-invalid-eobrun",
                    { scanIndex: scan.scanIndex, intervalIndex: interval.intervalIndex }
                  );
                }
              }
            }
          }
        }
        return {
          scanIndex: scan.scanIndex,
          scanType: scan.scanType,
          intervals: trace.intervals.map((interval) => ({
            intervalIndex: interval.intervalIndex,
            blocks: interval.blocks.map((block) => ({
              ...block,
              operations: (block.operations || []).map((operation) => ({
                ...operation,
                correctionIndices: operation.correctionIndices
                  ? operation.correctionIndices.slice()
                  : undefined
              })),
              continuationCorrectionIndices:
                block.continuationCorrectionIndices?.slice()
            }))
          })),
          eobRunEventCount
        };
      });
      return scans;
    }

    function captureProgressiveHuffmanEncodingPlan(
      bytes,
      structure,
      scriptResult = null
    ) {
      const analysis = scriptResult ||
        analyzeProgressiveHuffmanScript(bytes, structure);
      if (!analysis.supported) {
        return { supported: false, reason: analysis.reason, plan: null };
      }
      const eventSink = createProgressiveDecodeEventSink();
      const decoded = decodeProgressiveHuffmanCoefficients(
        bytes,
        structure,
        analysis,
        null,
        { eventSink }
      );
      const scans = validateProgressiveEncodingTrace(analysis, eventSink);
      return {
        supported: true,
        reason: null,
        decoded,
        plan: {
          process: "progressive-huffman-source-plan",
          scriptHash: createProgressiveScriptHash(analysis.script),
          sourceByteLength: bytes.length,
          sourceSha256: null,
          scans
        }
      };
    }

    function validateProgressiveCoefficientModel({ decoded, script }) {
      if (!decoded || decoded.process !== "progressive-huffman-complete") {
        throw new JpegProgressiveEncodeError(
          "progressive-coefficient-model-process-mismatch"
        );
      }
      if (
        decoded.width !== script.width ||
        decoded.height !== script.height ||
        decoded.precision !== script.precision
      ) {
        throw new JpegProgressiveEncodeError(
          "progressive-coefficient-model-frame-mismatch"
        );
      }
      if (decoded.components.length !== script.components.length) {
        throw new JpegProgressiveEncodeError(
          "progressive-coefficient-model-component-count-mismatch"
        );
      }
      const componentsById = new Map();
      for (const component of decoded.components) {
        if (componentsById.has(component.id)) {
          throw new JpegProgressiveEncodeError(
            "progressive-coefficient-model-duplicate-component",
            { componentId: component.id }
          );
        }
        componentsById.set(component.id, component);
      }
      for (const topology of script.components) {
        const component = componentsById.get(topology.id);
        if (!component) {
          throw new JpegProgressiveEncodeError(
            "progressive-coefficient-model-component-missing",
            { componentId: topology.id }
          );
        }
        for (const key of [
          "componentIndex", "h", "v", "quantTableId",
          "visibleBlockColumns", "visibleBlockRows",
          "codedBlockColumns", "codedBlockRows"
        ]) {
          if (component[key] !== topology[key]) {
            throw new JpegProgressiveEncodeError(
              "progressive-coefficient-model-grid-mismatch",
              { componentId: topology.id, key }
            );
          }
        }
        const coefficientCount =
          topology.codedBlockColumns * topology.codedBlockRows *
          JPEG_DCT_COEFFICIENT_COUNT;
        if (
          !(component.coefficients instanceof Int16Array) ||
          component.coefficients.length !== coefficientCount ||
          !(component.currentScanAl instanceof Int8Array) ||
          component.currentScanAl.length !== JPEG_DCT_COEFFICIENT_COUNT
        ) {
          throw new JpegProgressiveEncodeError(
            "progressive-coefficient-model-buffer-mismatch",
            { componentId: topology.id }
          );
        }
        for (let offset = 0; offset < component.coefficients.length; offset++) {
          const coefficientIndex = offset % JPEG_DCT_COEFFICIENT_COUNT;
          const value = component.coefficients[offset];
          const minimum = coefficientIndex === 0 ? -1024 : -1023;
          if (value < minimum || value > 1023) {
            throw new JpegProgressiveEncodeError(
              "progressive-coefficient-out-of-range",
              { componentId: topology.id, coefficientIndex, value }
            );
          }
        }
        const finalState = script.finalCoefficientState.get(topology.id);
        if (
          !finalState ||
          finalState.some((value, index) =>
            value !== component.currentScanAl[index]
          )
        ) {
          throw new JpegProgressiveEncodeError(
            "progressive-coefficient-precision-state-mismatch",
            { componentId: topology.id }
          );
        }
      }
      return { decoded, componentsById };
    }

    function createProgressiveEncoderState(finalDecoded) {
      const components = finalDecoded.components.map((component) => ({
        ...component,
        coefficients: new Int16Array(component.coefficients.length),
        currentScanAl: new Int8Array(JPEG_DCT_COEFFICIENT_COUNT).fill(-1)
      }));
      return {
        components,
        componentsById: new Map(
          components.map((component) => [component.id, component])
        )
      };
    }

    function reduceProgressiveDcForFirstScan(coefficient, successiveLow) {
      return Math.floor(coefficient / Math.pow(2, successiveLow));
    }

    function reduceProgressiveAcForFirstScan(coefficient, successiveLow) {
      if (coefficient === 0) return 0;
      const magnitude = Math.floor(
        Math.abs(coefficient) / Math.pow(2, successiveLow)
      );
      return coefficient < 0 ? -magnitude : magnitude;
    }

    function getProgressiveAcRefinementRole({
      currentCoefficient,
      finalCoefficient,
      successiveLow
    }) {
      const p1 = Math.pow(2, successiveLow);
      if (
        currentCoefficient !== 0 &&
        finalCoefficient !== 0 &&
        Math.sign(currentCoefficient) !== Math.sign(finalCoefficient)
      ) {
        throw new JpegProgressiveEncodeError(
          "progressive-coefficient-sign-changed"
        );
      }
      if (currentCoefficient !== 0) {
        return {
          role: "correction",
          bit: (Math.abs(finalCoefficient) & p1) !== 0 ? 1 : 0
        };
      }
      if ((Math.abs(finalCoefficient) & p1) !== 0) {
        return { role: "new", signBit: finalCoefficient > 0 ? 1 : 0 };
      }
      return { role: "zero" };
    }

    function getProgressiveHuffmanEncoder({
      definitions,
      cache,
      scan,
      tableClass,
      tableId,
      componentId
    }) {
      const definition = resolveHuffmanDefinition(
        definitions,
        scan.scanOffset,
        tableClass,
        tableId
      );
      if (!definition) {
        throw new JpegProgressiveEncodeError(
          "progressive-encode-table-missing",
          { scanIndex: scan.scanIndex, componentId, tableClass, tableId }
        );
      }
      if (!cache.has(definition)) {
        cache.set(definition, buildCanonicalHuffmanEncoder(definition));
      }
      return cache.get(definition);
    }

    function writeProgressiveCorrectionBit(
      writer,
      stateComponent,
      finalComponent,
      blockIndex,
      coefficientIndex,
      successiveLow
    ) {
      const offset = blockIndex * JPEG_DCT_COEFFICIENT_COUNT + coefficientIndex;
      const role = getProgressiveAcRefinementRole({
        currentCoefficient: stateComponent.coefficients[offset],
        finalCoefficient: finalComponent.coefficients[offset],
        successiveLow
      });
      if (role.role !== "correction") {
        throw new JpegProgressiveEncodeError(
          "progressive-encoding-plan-incompatible",
          { componentId: stateComponent.id, blockIndex, coefficientIndex }
        );
      }
      writer.writeBit(role.bit);
      if (role.bit === 1) {
        const p1 = Math.pow(2, successiveLow);
        stateComponent.coefficients[offset] +=
          stateComponent.coefficients[offset] > 0 ? p1 : -p1;
      }
      return role.bit;
    }

    function encodeProgressiveScanFromPlan({
      sourceBytes,
      structure,
      analysis,
      scan,
      rawScan,
      scanPlan,
      finalComponentsById,
      encoderState,
      huffmanDefinitions,
      encoderCache
    }) {
      const encodedIntervals = [];
      const dcCategoryHistogram = new Uint32Array(12);
      const acSymbolHistogram = new Uint32Array(256);
      let rawRefinementBitCount = 0;
      let correctionBitCount = 0;
      let newCoefficientCount = 0;
      let zrlCount = 0;
      let eobRunEventCount = 0;
      for (let intervalIndex = 0; intervalIndex < scanPlan.intervals.length; intervalIndex++) {
        const intervalPlan = scanPlan.intervals[intervalIndex];
        const sourceInterval = scan.restart.intervals[intervalIndex];
        if (
          !sourceInterval ||
          intervalPlan.blocks.length !== sourceInterval.mcuCount *
            (scan.isInterleaved
              ? scan.componentIds.reduce((sum, componentId) => {
                  const topology = analysis.script.components.find(
                    (component) => component.id === componentId
                  );
                  return sum + topology.h * topology.v;
                }, 0)
              : 1)
        ) {
          throw new JpegProgressiveEncodeError(
            "progressive-eobrun-plan-not-consumed",
            { scanIndex: scan.scanIndex, intervalIndex }
          );
        }
        const writer = new JpegEntropyBitWriter({
          scanIndex: scan.scanIndex,
          intervalIndex
        });
        const predictors = new Map(scan.componentIds.map((id) => [id, 0]));
        for (const blockPlan of intervalPlan.blocks) {
          const stateComponent = encoderState.componentsById.get(
            blockPlan.componentId
          );
          const finalComponent = finalComponentsById.get(blockPlan.componentId);
          if (!stateComponent || !finalComponent) {
            throw new JpegProgressiveEncodeError(
              "progressive-encoding-plan-component-missing",
              { scanIndex: scan.scanIndex, componentId: blockPlan.componentId }
            );
          }
          const coefficientOffset =
            blockPlan.blockIndex * JPEG_DCT_COEFFICIENT_COUNT;
          const rawComponent = rawScan.components.find(
            (component) => component.id === blockPlan.componentId
          );
          if (scan.scanType === "dc-first") {
            const finalCoefficient = finalComponent.coefficients[coefficientOffset];
            const reduced = reduceProgressiveDcForFirstScan(
              finalCoefficient,
              scan.successiveLow
            );
            const difference = reduced - predictors.get(blockPlan.componentId);
            const category = getJpegMagnitudeCategory(difference);
            if (category !== blockPlan.category || category > 11) {
              throw new JpegProgressiveEncodeError(
                "progressive-coefficient-category-changed",
                { scanIndex: scan.scanIndex, componentId: blockPlan.componentId, blockIndex: blockPlan.blockIndex, category, plannedCategory: blockPlan.category }
              );
            }
            const table = getProgressiveHuffmanEncoder({
              definitions: huffmanDefinitions,
              cache: encoderCache,
              scan,
              tableClass: 0,
              tableId: rawComponent.dcTableId,
              componentId: blockPlan.componentId
            });
            writeHuffmanSymbol(writer, table, category, blockPlan);
            dcCategoryHistogram[category]++;
            if (category > 0) {
              writer.writeBits(
                encodeJpegAdditionalBits(difference, category),
                category
              );
            }
            predictors.set(blockPlan.componentId, reduced);
            stateComponent.coefficients[coefficientOffset] =
              reduced * Math.pow(2, scan.successiveLow);
          } else if (scan.scanType === "dc-refine") {
            const bit = (
              finalComponent.coefficients[coefficientOffset] &
              Math.pow(2, scan.successiveLow)
            ) !== 0 ? 1 : 0;
            writer.writeBit(bit);
            rawRefinementBitCount++;
            if (bit === 1) {
              stateComponent.coefficients[coefficientOffset] |=
                Math.pow(2, scan.successiveLow);
            }
          } else if (scan.scanType === "ac-first") {
            const table = getProgressiveHuffmanEncoder({
              definitions: huffmanDefinitions,
              cache: encoderCache,
              scan,
              tableClass: 1,
              tableId: rawComponent.acTableId,
              componentId: blockPlan.componentId
            });
            for (const operation of blockPlan.operations) {
              writeHuffmanSymbol(writer, table, operation.symbol, operation);
              acSymbolHistogram[operation.symbol]++;
              if (operation.kind === "coefficient") {
                const finalCoefficient = finalComponent.coefficients[
                  coefficientOffset + operation.coefficientIndex
                ];
                const reduced = reduceProgressiveAcForFirstScan(
                  finalCoefficient,
                  scan.successiveLow
                );
                const category = getJpegMagnitudeCategory(reduced);
                if (category !== operation.size || category < 1 || category > 10) {
                  throw new JpegProgressiveEncodeError(
                    "progressive-coefficient-category-changed",
                    { scanIndex: scan.scanIndex, componentId: blockPlan.componentId, blockIndex: blockPlan.blockIndex, coefficientIndex: operation.coefficientIndex }
                  );
                }
                writer.writeBits(
                  encodeJpegAdditionalBits(reduced, category),
                  category
                );
                stateComponent.coefficients[
                  coefficientOffset + operation.coefficientIndex
                ] = reduced * Math.pow(2, scan.successiveLow);
              } else if (operation.kind === "eobrun") {
                if (operation.extraBitCount > 0) {
                  writer.writeBits(operation.extraBits, operation.extraBitCount);
                }
                eobRunEventCount++;
              } else if (operation.kind === "zrl") {
                zrlCount++;
              } else {
                throw new JpegProgressiveEncodeError(
                  "progressive-encoding-plan-incompatible",
                  { scanIndex: scan.scanIndex }
                );
              }
            }
          } else if (scan.scanType === "ac-refine") {
            const table = getProgressiveHuffmanEncoder({
              definitions: huffmanDefinitions,
              cache: encoderCache,
              scan,
              tableClass: 1,
              tableId: rawComponent.acTableId,
              componentId: blockPlan.componentId
            });
            for (const operation of blockPlan.operations) {
              writeHuffmanSymbol(writer, table, operation.symbol, operation);
              acSymbolHistogram[operation.symbol]++;
              if (operation.kind === "eobrun") {
                if (operation.extraBitCount > 0) {
                  writer.writeBits(operation.extraBits, operation.extraBitCount);
                }
                eobRunEventCount++;
              } else if (operation.kind === "new") {
                const offset = coefficientOffset + operation.coefficientIndex;
                const role = getProgressiveAcRefinementRole({
                  currentCoefficient: stateComponent.coefficients[offset],
                  finalCoefficient: finalComponent.coefficients[offset],
                  successiveLow: scan.successiveLow
                });
                if (role.role !== "new") {
                  throw new JpegProgressiveEncodeError(
                    "progressive-encoding-plan-incompatible",
                    { scanIndex: scan.scanIndex, componentId: blockPlan.componentId, blockIndex: blockPlan.blockIndex, coefficientIndex: operation.coefficientIndex }
                  );
                }
                writer.writeBit(role.signBit);
                stateComponent.coefficients[offset] = role.signBit === 1
                  ? Math.pow(2, scan.successiveLow)
                  : -Math.pow(2, scan.successiveLow);
                newCoefficientCount++;
              } else if (operation.kind === "zrl") {
                zrlCount++;
              }
              for (const coefficientIndex of operation.correctionIndices || []) {
                writeProgressiveCorrectionBit(
                  writer,
                  stateComponent,
                  finalComponent,
                  blockPlan.blockIndex,
                  coefficientIndex,
                  scan.successiveLow
                );
                correctionBitCount++;
              }
            }
            for (const coefficientIndex of blockPlan.continuationCorrectionIndices || []) {
              writeProgressiveCorrectionBit(
                writer,
                stateComponent,
                finalComponent,
                blockPlan.blockIndex,
                coefficientIndex,
                scan.successiveLow
              );
              correctionBitCount++;
            }
          }
        }
        const finished = writer.finish();
        encodedIntervals.push({
          intervalIndex,
          bytes: finished.bytes,
          markerCode: sourceInterval.markerCode,
          markerToken: sourceInterval.markerToken,
          sourcePayloadLength:
            sourceInterval.payloadEnd - sourceInterval.payloadStart,
          ...finished
        });
      }
      for (const componentId of scan.componentIds) {
        const stateComponent = encoderState.componentsById.get(componentId);
        stateComponent.currentScanAl.fill(
          scan.successiveLow,
          scan.spectralStart,
          scan.spectralEnd + 1
        );
      }
      for (const blockPlan of scanPlan.intervals.flatMap((item) => item.blocks)) {
        const stateComponent = encoderState.componentsById.get(blockPlan.componentId);
        const finalComponent = finalComponentsById.get(blockPlan.componentId);
        const offset = blockPlan.blockIndex * JPEG_DCT_COEFFICIENT_COUNT;
        for (let index = scan.spectralStart; index <= scan.spectralEnd; index++) {
          const expected = index === 0
            ? truncateProgressiveDcToAl(
                finalComponent.coefficients[offset + index],
                scan.successiveLow
              )
            : truncateProgressiveAcToAl(
                finalComponent.coefficients[offset + index],
                scan.successiveLow
              );
          if (stateComponent.coefficients[offset + index] !== expected) {
            throw new JpegProgressiveEncodeError(
              scanPlan.eobRunEventCount > 0 && index > 0
                ? "progressive-eobrun-plan-skips-nonzero"
                : "progressive-encoding-plan-incompatible",
              { scanIndex: scan.scanIndex, componentId: blockPlan.componentId, blockIndex: blockPlan.blockIndex, coefficientIndex: index }
            );
          }
        }
      }
      const chunks = [];
      for (let index = 0; index < encodedIntervals.length; index++) {
        chunks.push(encodedIntervals[index].bytes);
        const sourceInterval = scan.restart.intervals[index];
        if (sourceInterval.markerStart != null) {
          chunks.push(sourceBytes.subarray(
            sourceInterval.markerStart,
            sourceInterval.markerEnd
          ));
        }
      }
      const entropyWithRestartMarkers = concatenateUint8Arrays(chunks);
      return {
        scanIndex: scan.scanIndex,
        scanType: scan.scanType,
        componentIds: scan.componentIds.slice(),
        spectralStart: scan.spectralStart,
        spectralEnd: scan.spectralEnd,
        successiveHigh: scan.successiveHigh,
        successiveLow: scan.successiveLow,
        intervalCount: encodedIntervals.length,
        sourceEntropyLength: scan.entropyEnd - scan.entropyStart,
        encodedEntropyLength: entropyWithRestartMarkers.length,
        bitsWritten: encodedIntervals.reduce((sum, item) => sum + item.bitsWritten, 0),
        dataByteCount: encodedIntervals.reduce((sum, item) => sum + item.dataByteCount, 0),
        stuffedByteCount: encodedIntervals.reduce((sum, item) => sum + item.stuffedByteCount, 0),
        paddingBitCount: encodedIntervals.reduce((sum, item) => sum + item.paddingBitCount, 0),
        dcCategoryHistogram,
        acSymbolHistogram,
        rawRefinementBitCount,
        correctionBitCount,
        newCoefficientCount,
        zrlCount,
        eobRunEventCount,
        encodedIntervals,
        entropyWithRestartMarkers
      };
    }

    function rebuildProgressiveJpegWithEntropy({
      sourceBytes,
      script,
      encodedScans
    }) {
      if (script.scans.length !== encodedScans.length) {
        throw new JpegProgressiveEncodeError(
          "progressive-encoded-scan-count-mismatch"
        );
      }
      const chunks = [];
      let sourceCursor = 0;
      for (let scanIndex = 0; scanIndex < script.scans.length; scanIndex++) {
        const scan = script.scans[scanIndex];
        chunks.push(sourceBytes.subarray(sourceCursor, scan.entropyStart));
        chunks.push(encodedScans[scanIndex].entropyWithRestartMarkers);
        sourceCursor = scan.entropyEnd;
      }
      chunks.push(sourceBytes.subarray(sourceCursor));
      return concatenateUint8Arrays(chunks);
    }

    function encodeProgressiveHuffmanCoefficients(
      sourceBytes,
      structure,
      decodedResult,
      scriptResult = null,
      planResult = null
    ) {
      const analysis = scriptResult ||
        analyzeProgressiveHuffmanScript(sourceBytes, structure);
      if (!analysis.supported) {
        return { supported: false, reason: analysis.reason, encoded: null };
      }
      const plan = planResult || captureProgressiveHuffmanEncodingPlan(
        sourceBytes,
        structure,
        analysis
      );
      if (!plan.supported) {
        return { supported: false, reason: plan.reason, encoded: null };
      }
      if (
        plan.plan.scriptHash !== createProgressiveScriptHash(analysis.script) ||
        plan.plan.sourceByteLength !== sourceBytes.length ||
        plan.plan.scans.length !== analysis.script.scans.length
      ) {
        throw new JpegProgressiveEncodeError(
          "progressive-encoding-plan-incompatible"
        );
      }
      const model = validateProgressiveCoefficientModel({
        decoded: decodedResult?.decoded,
        script: analysis.script
      });
      const encoderState = createProgressiveEncoderState(model.decoded);
      const frame = structure.frames[0];
      const rawScans = structure.scans
        .filter((scan) => scan.frameMarkerOffset === frame.markerOffset)
        .slice()
        .sort((left, right) => left.offset - right.offset);
      const huffmanDefinitions = parseHuffmanDefinitions(sourceBytes, structure);
      const encoderCache = new Map();
      const encodedScans = [];
      for (const scan of analysis.script.scans) {
        encodedScans.push(encodeProgressiveScanFromPlan({
          sourceBytes,
          structure,
          analysis,
          scan,
          rawScan: rawScans[scan.scanIndex],
          scanPlan: plan.plan.scans[scan.scanIndex],
          finalComponentsById: model.componentsById,
          encoderState,
          huffmanDefinitions,
          encoderCache
        }));
      }
      for (const finalComponent of model.decoded.components) {
        const stateComponent = encoderState.componentsById.get(finalComponent.id);
        if (
          stateComponent.coefficients.some((value, index) =>
            value !== finalComponent.coefficients[index]
          )
        ) {
          throw new JpegProgressiveEncodeError(
            "progressive-encoder-final-state-mismatch",
            { componentId: finalComponent.id }
          );
        }
      }
      const outputBytes = rebuildProgressiveJpegWithEntropy({
        sourceBytes,
        script: analysis.script,
        encodedScans
      });
      return {
        supported: true,
        reason: null,
        encoded: {
          bytes: outputBytes,
          metadata: {
            process: "progressive-huffman-structure-preserving",
            sourceByteLength: sourceBytes.length,
            outputByteLength: outputBytes.length,
            scanCount: encodedScans.length,
            intervalCount: encodedScans.reduce((sum, scan) => sum + scan.intervalCount, 0),
            bitsWritten: encodedScans.reduce((sum, scan) => sum + scan.bitsWritten, 0),
            stuffedByteCount: encodedScans.reduce((sum, scan) => sum + scan.stuffedByteCount, 0),
            paddingBitCount: encodedScans.reduce((sum, scan) => sum + scan.paddingBitCount, 0),
            eobRunEventCount: encodedScans.reduce((sum, scan) => sum + scan.eobRunEventCount, 0),
            sourcePlanHash: plan.plan.scriptHash,
            scriptHash: createProgressiveScriptHash(analysis.script),
            encodedScans
          }
        }
      };
    }

    function createUnsupportedCoefficientContext(reason, error = null) {
      return {
        supported: false,
        reason,
        decodedResult: null,
        dcDomain: null,
        acDomain: null,
        totalCandidateCount: 0,
        componentDomains: new Map(),
        candidates: [],
        error
      };
    }

    function createUnsupportedProgressiveCoefficientContext(
      reason,
      error = null
    ) {
      return {
        supported: false,
        reason,
        process: "progressive-huffman-dct",
        scriptResult: null,
        decodedResult: null,
        planResult: null,
        topology: null,
        dcDomain: null,
        acDomain: null,
        totalCandidateCount: 0,
        componentDomains: new Map(),
        sourceByteLength: 0,
        error
      };
    }

    function getProgressiveComponentById(decodedResult, componentId) {
      return decodedResult?.decoded?.components.find(
        (component) => component.id === componentId
      ) || null;
    }

    function buildProgressiveDcMutationDomain({
      scriptResult,
      decodedResult,
      planResult
    }) {
      const candidates = [];
      const chains = [];
      for (const scan of scriptResult.script.scans) {
        if (scan.scanType !== "dc-first") continue;
        const scanPlan = planResult.plan.scans[scan.scanIndex];
        for (const intervalPlan of scanPlan.intervals) {
          const sourceInterval = scan.restart.intervals[
            intervalPlan.intervalIndex
          ];
          const componentBlocks = new Map(
            scan.componentIds.map((componentId) => [componentId, []])
          );
          for (const traceBlock of intervalPlan.blocks) {
            const component = getProgressiveComponentById(
              decodedResult,
              traceBlock.componentId
            );
            const topology = scriptResult.script.components.find(
              (item) => item.id === traceBlock.componentId
            );
            if (!component || !topology) {
              throw new JpegProgressiveEncodeError(
                "progressive-dc-domain-component-missing",
                { componentId: traceBlock.componentId }
              );
            }
            const blockX = traceBlock.blockIndex % topology.codedBlockColumns;
            const blockY = Math.floor(
              traceBlock.blockIndex / topology.codedBlockColumns
            );
            componentBlocks.get(traceBlock.componentId).push({
              mcuIndex: traceBlock.mcuIndex,
              blockIndex: traceBlock.blockIndex,
              blockX,
              blockY,
              coefficientOffset:
                traceBlock.blockIndex * JPEG_DCT_COEFFICIENT_COUNT,
              isVisible:
                blockX < topology.visibleBlockColumns &&
                blockY < topology.visibleBlockRows
            });
          }
          for (const [componentId, blocks] of componentBlocks) {
            if (!blocks.length) continue;
            const component = getProgressiveComponentById(
              decodedResult,
              componentId
            );
            const scale = Math.pow(2, scan.successiveLow);
            let predictorReduced = 0;
            for (const block of blocks) {
              const finalDc = component.coefficients[block.coefficientOffset];
              const firstDc = recoverProgressiveDcFirstCoefficientFromFinal(
                finalDc,
                scan.successiveLow
              );
              const reducedDc = firstDc / scale;
              block.finalDc = finalDc;
              block.firstDc = firstDc;
              block.reducedDc = reducedDc;
              block.predictorReduced = predictorReduced;
              block.differenceReduced = reducedDc - predictorReduced;
              predictorReduced = reducedDc;
            }
            let suffixMinimum = Infinity;
            let suffixMaximum = -Infinity;
            let suffixVisibleCount = 0;
            for (let index = blocks.length - 1; index >= 0; index--) {
              const block = blocks[index];
              suffixMinimum = Math.min(suffixMinimum, block.finalDc);
              suffixMaximum = Math.max(suffixMaximum, block.finalDc);
              if (block.isVisible) suffixVisibleCount++;
              block.suffixMinimum = suffixMinimum;
              block.suffixMaximum = suffixMaximum;
              block.suffixVisibleCount = suffixVisibleCount;
            }
            const chainIndex = chains.length;
            chains.push({
              scanIndex: scan.scanIndex,
              intervalIndex: intervalPlan.intervalIndex,
              componentId,
              successiveLow: scan.successiveLow,
              scale,
              blocks
            });
            for (let ordinal = 0; ordinal < blocks.length; ordinal++) {
              const block = blocks[ordinal];
              const difference = block.differenceReduced;
              if (difference === 0) continue;
              const deltaReduced = -2 * difference;
              const deltaFinal = deltaReduced * scale;
              if (
                block.suffixMinimum + deltaFinal < -1024 ||
                block.suffixMaximum + deltaFinal > 1023 ||
                block.suffixVisibleCount === 0
              ) {
                continue;
              }
              candidates.push({
                mode: "dc-difference-sign-inversion",
                process: "progressive-huffman-dct",
                scanIndex: scan.scanIndex,
                intervalIndex: intervalPlan.intervalIndex,
                chainIndex,
                ordinalInComponentInterval: ordinal,
                componentId,
                componentKey: `C${componentId}`,
                mcuIndex: block.mcuIndex,
                blockIndex: block.blockIndex,
                blockX: block.blockX,
                blockY: block.blockY,
                originalDc: block.finalDc,
                originalDifference: difference,
                negatedDifference: -difference,
                category: getJpegMagnitudeCategory(difference),
                successiveLow: scan.successiveLow,
                deltaReduced,
                deltaFinal,
                affectedBlockCount: blocks.length - ordinal,
                affectedVisibleBlockCount: block.suffixVisibleCount,
                intervalPayloadStart: sourceInterval.payloadStart,
                intervalPayloadEnd: sourceInterval.payloadEnd
              });
            }
          }
        }
      }
      return { chains, candidates, candidateCount: candidates.length };
    }

    function createProgressiveCoefficientContext(bytes, structure) {
      try {
        if (!structure.jfif) {
          structure.jfif = parseJfifDescriptor(bytes, structure);
        }
        const scriptResult = analyzeProgressiveHuffmanScript(bytes, structure);
        if (!scriptResult.supported) {
          return createUnsupportedProgressiveCoefficientContext(
            scriptResult.reason
          );
        }
        const planResult = captureProgressiveHuffmanEncodingPlan(
          bytes,
          structure,
          scriptResult
        );
        if (!planResult.supported || !planResult.decoded?.supported) {
          return createUnsupportedProgressiveCoefficientContext(
            planResult.reason || planResult.decoded?.reason ||
              "progressive-plan-unavailable"
          );
        }
        const decodedResult = planResult.decoded;
        const dcDomain = buildProgressiveDcMutationDomain({
          scriptResult,
          decodedResult,
          planResult
        });
        const totalCandidateCount = dcDomain.candidateCount;
        if (!Number.isSafeInteger(totalCandidateCount)) {
          throw new JpegProgressiveEncodeError(
            "progressive-candidate-count-not-safe"
          );
        }
        return {
          supported: true,
          reason: null,
          process: "progressive-huffman-dct",
          scriptResult,
          decodedResult,
          planResult,
          topology: scriptResult.script.components,
          dcDomain,
          acDomain: null,
          totalCandidateCount,
          componentDomains: new Map(),
          sourceByteLength: bytes.length
        };
      } catch (error) {
        return createUnsupportedProgressiveCoefficientContext(
          error.code || "progressive-coefficient-context-error",
          error
        );
      }
    }

    function buildCanonicalHuffmanDecoder(definition) {
      const minCode = new Int32Array(17);
      const maxCode = new Int32Array(17);
      const valuePointer = new Int32Array(17);
      minCode.fill(-1);
      maxCode.fill(-1);
      valuePointer.fill(-1);

      let code = 0;
      let symbolIndex = 0;
      for (let length = 1; length <= 16; length++) {
        const count = definition.codeCounts[length - 1];
        if (code + count > (1 << length)) {
          throw createJpegEntropyDecodeError(
            "huffman-table-oversubscribed",
            {
              tableClass: definition.tableClass,
              tableId: definition.tableId,
              codeLength: length
            }
          );
        }
        if (count > 0) {
          minCode[length] = code;
          maxCode[length] = code + count - 1;
          valuePointer[length] = symbolIndex;
          if (maxCode[length] === (1 << length) - 1) {
            throw createJpegEntropyDecodeError(
              "huffman-all-ones-code-assigned",
              {
                tableClass: definition.tableClass,
                tableId: definition.tableId,
                codeLength: length
              }
            );
          }
          symbolIndex += count;
          code += count;
        }
        code <<= 1;
      }
      if (symbolIndex !== definition.symbols.length) {
        throw createJpegEntropyDecodeError(
          "huffman-symbol-count-mismatch",
          {
            tableClass: definition.tableClass,
            tableId: definition.tableId
          }
        );
      }
      return { ...definition, minCode, maxCode, valuePointer };
    }

    function decodeHuffmanSymbol(reader, table) {
      let code = 0;
      for (let length = 1; length <= 16; length++) {
        code = (code << 1) | reader.readBit();
        const maximum = table.maxCode[length];
        if (maximum >= 0 && code <= maximum) {
          const index = table.valuePointer[length] +
            code - table.minCode[length];
          if (index < 0 || index >= table.symbols.length) {
            throw reader.error("huffman-symbol-index-out-of-range", {
              tableClass: table.tableClass,
              tableId: table.tableId
            });
          }
          return table.symbols[index];
        }
      }
      throw reader.error("huffman-code-not-found", {
        tableClass: table.tableClass,
        tableId: table.tableId
      });
    }

    // ========================================================================
    // 10. CANDIDATE DOMAINS AND SELECTORS
    // ========================================================================
    function createBaselineCoefficientContext(bytes, structure) {
      if (!structure.jfif) {
        structure.jfif = parseJfifDescriptor(bytes, structure);
      }
      const decodedResult = decodeBaselineHuffmanCoefficients(bytes, structure);
      if (!decodedResult.supported) {
        return {
          supported: false,
          reason: decodedResult.reason,
          decodedResult: null,
          dcDomain: null,
          acDomain: null,
          totalCandidateCount: 0,
          componentDomains: new Map(),
          candidates: []
        };
      }
      const dcDomain = buildBaselineDcMutationDomain(
        decodedResult.decoded,
        structure
      );
      const totalCandidateCount = dcDomain.candidateCount;
      if (!Number.isSafeInteger(totalCandidateCount)) {
        throw createJpegEntropyEncodeError(
          "coefficient-candidate-count-not-safe"
        );
      }
      const frame = structure.frames[0];
      const componentDomains = new Map();
      for (let componentIndex = 0; componentIndex < frame.components.length; componentIndex++) {
        const component = frame.components[componentIndex];
        const dcCandidateIndices = [];
        for (let index = 0; index < dcDomain.candidates.length; index++) {
          if (dcDomain.candidates[index].componentId === component.id) {
            dcCandidateIndices.push(index);
          }
        }
        const dcCandidateCount = dcCandidateIndices.length;
        const componentCandidateCount = dcCandidateCount;
        if (!Number.isSafeInteger(componentCandidateCount)) {
          throw createJpegEntropyEncodeError(
            "component-candidate-count-not-safe",
            { componentId: component.id }
          );
        }
        if (componentCandidateCount === 0) continue;
        componentDomains.set(component.id, {
          componentId: component.id,
          componentIndex,
          componentKey: `C${component.id}`,
          semanticRole: structure.jfif.componentRolesById?.get(component.id) || null,
          dcCandidateIndices,
          dcCandidateCount,
          totalCandidateCount: componentCandidateCount
        });
      }
      return {
        supported: true,
        reason: null,
        decodedResult,
        dcDomain,
        acDomain: null,
        totalCandidateCount,
        componentDomains,
        candidates: dcDomain.candidates
      };
    }

    function selectDcCoefficientVariantCandidates(
      seed,
      baselineCoefficientContext,
      progressiveCoefficientContext,
      strength
    ) {
      const coefficientContext = baselineCoefficientContext?.supported
        ? baselineCoefficientContext
        : progressiveCoefficientContext?.supported
          ? progressiveCoefficientContext
          : null;
      const dcCount = coefficientContext?.dcDomain?.candidateCount || 0;
      const totalCount = dcCount;
      if (dcCount <= 0) return null;
      const normalizedStrength = Math.max(1, Math.round(Number(strength) || 1));
      const selectionCount = Math.min(
        dcCount,
        normalizedStrength
      );
      const random = createPcg32Stream(
        seed,
        coefficientContext === progressiveCoefficientContext
          ? `dct-progressive-dc-difference-sign-inversion:${dcCount}`
          : ["dct-dc-difference-sign-inversion", dcCount].join(":")
      );
      const ranks = new Set();
      for (let rankCeiling = dcCount - selectionCount;
        rankCeiling < dcCount;
        rankCeiling++
      ) {
        const drawnRank = Math.floor(random() * (rankCeiling + 1));
        ranks.add(ranks.has(drawnRank) ? rankCeiling : drawnRank);
      }
      const selections = [...ranks].map((rank) => ({
        ...coefficientContext.dcDomain.candidates[rank],
        mode: "dc-difference-sign-inversion",
        candidateRank: rank,
        candidateCount: totalCount,
        modeCandidateRank: rank,
        modeCandidateCount: dcCount
      }));
      const primary = selections[0];
      return {
        ...primary,
        mode: "dc-difference-sign-inversion",
        process: coefficientContext === progressiveCoefficientContext
          ? "progressive-huffman-dct"
          : null,
        selectionCount: selections.length,
        dcCandidateCount: dcCount,
        strength: normalizedStrength,
        selectionDensity: selections.length / dcCount,
        selections
      };
    }

    function summarizeCoefficientSelection(selection) {
      if (!selection) return null;
      const { selections, ...summary } = selection;
      return {
        ...summary,
        selectionCount: Array.isArray(selections)
          ? selections.length
          : Number(selection.selectionCount) || 1
      };
    }

    function createCoefficientSelectionClusters(selections) {
      const clusters = new Map();
      for (const item of selections || []) {
        const start = Number(item?.intervalPayloadStart);
        const end = Number(item?.intervalPayloadEnd);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
          continue;
        }
        const key = `${start}:${end}`;
        if (!clusters.has(key)) {
          clusters.set(key, {
            start,
            length: end - start,
            coordinateSpace: "byte-offset"
          });
        }
      }
      return [...clusters.values()];
    }

    function mutateBaselineCoefficientSet({
      sourceBytes,
      structure,
      coefficientContext,
      selection
    }) {
      const selections = selection?.selections;
      if (
        !coefficientContext?.supported ||
        !Array.isArray(selections) ||
        selections.length === 0 ||
        selection.selectionCount !== selections.length
      ) {
        throw createJpegEntropyEncodeError("coefficient-selection-invalid");
      }
      const sourceDecoded = coefficientContext.decodedResult.decoded;
      const mutatedComponents = sourceDecoded.components.map((component) => ({
        ...component,
        coefficients: new Int16Array(component.coefficients)
      }));
      const mutatedById = new Map(mutatedComponents.map((component) => [
        component.id,
        component
      ]));

      for (const item of selections) {
        const component = mutatedById.get(item.componentId);
        if (!component) {
          throw createJpegEntropyEncodeError(
            "coefficient-selection-domain-missing"
          );
        }
        if (item.mode === "dc-difference-sign-inversion") {
          const candidate = coefficientContext.dcDomain.candidates[
            item.modeCandidateRank
          ];
          if (
            !candidate ||
            item.candidateCount !== coefficientContext.totalCandidateCount ||
            item.candidateRank !== item.modeCandidateRank ||
            candidate.componentId !== item.componentId ||
            candidate.intervalIndex !== item.intervalIndex ||
            candidate.ordinalInComponentInterval !==
              item.ordinalInComponentInterval ||
            candidate.originalDifference !== item.originalDifference ||
            candidate.negatedDifference !== item.negatedDifference
          ) {
            throw createJpegEntropyEncodeError(
              "coefficient-selection-invalid"
            );
          }
          const interval = coefficientContext.dcDomain.intervals[
            candidate.intervalIndex
          ];
          const chain = interval?.componentChains.get(candidate.componentId);
          if (!chain) {
            throw createJpegEntropyEncodeError(
              "coefficient-selection-domain-missing"
            );
          }
          for (let ordinal = candidate.ordinalInComponentInterval;
            ordinal < chain.length;
            ordinal++
          ) {
            const coefficientOffset = chain[ordinal].coefficientOffset;
            component.coefficients[coefficientOffset] += candidate.delta;
          }
          continue;
        }
        throw createJpegEntropyEncodeError(
          "unsupported-coefficient-mutation-mode",
          { mode: item.mode }
        );
      }

      let changedCoefficientCount = 0;
      for (const component of mutatedComponents) {
        const sourceComponent = sourceDecoded.components.find(
          (candidate) => candidate.id === component.id
        );
        for (let index = 0; index < component.coefficients.length; index++) {
          const coefficient = component.coefficients[index];
          if (coefficient < -1024 || coefficient > 1023) {
            throw createJpegEntropyEncodeError(
              "dc-mutation-out-of-range",
              { componentId: component.id, coefficientIndex: index, coefficient }
            );
          }
          if (coefficient !== sourceComponent.coefficients[index]) {
            changedCoefficientCount++;
          }
        }
      }
      if (changedCoefficientCount === 0) {
        return {
          bytes: new Uint8Array(sourceBytes),
          changed: false,
          reason: "coefficient-mutation-no-op",
          metadata: null,
          usedClusters: []
        };
      }
      const encodedResult = encodeBaselineHuffmanCoefficients(
        sourceBytes,
        structure,
        {
          supported: true,
          reason: null,
          decoded: { ...sourceDecoded, components: mutatedComponents }
        }
      );
      if (!encodedResult.supported) {
        return {
          bytes: new Uint8Array(sourceBytes),
          changed: false,
          reason: encodedResult.reason || "coefficient-encode-unsupported",
          metadata: null,
          usedClusters: []
        };
      }
      return {
        bytes: encodedResult.encoded.bytes,
        changed: true,
        reason: null,
        metadata: {
          ...summarizeCoefficientSelection(selection),
          selectedCoefficientCount: selections.length,
          changedCoefficientCount,
          sourceByteLength: sourceBytes.length,
          outputByteLength: encodedResult.encoded.bytes.length,
          encodedMetadata: encodedResult.encoded.metadata
        },
        usedClusters: createCoefficientSelectionClusters(selections)
      };
    }

    function mutateBaselineCoefficient({
      sourceBytes,
      structure,
      coefficientContext,
      selection
    }) {
      const unchanged = (reason) => ({
        bytes: new Uint8Array(sourceBytes),
        changed: false,
        reason,
        metadata: null,
        usedClusters: []
      });
      if (!coefficientContext?.supported) {
        return unchanged(
          coefficientContext?.reason || "coefficient-context-unavailable"
        );
      }
      if (!selection) return unchanged("coefficient-no-selected-candidate");
      if (!Array.isArray(selection.selections)) {
        throw createJpegEntropyEncodeError("coefficient-selection-invalid");
      }
      return mutateBaselineCoefficientSet({
        sourceBytes,
        structure,
        coefficientContext,
        selection
      });
    }

    function getProgressiveDctFrame(structure) {
      if (!structure || structure.frames?.length !== 1) return null;
      const frame = structure.frames[0];
      if (
        frame.marker !== JPEG_SOF2_MARKER ||
        frame.processClass !== "dct"
      ) {
        return null;
      }
      return frame;
    }

    function getProgressivePrefixCandidates(structure) {
      if (!structure) return [];
      if (Array.isArray(structure.progressivePrefixCandidatesCache)) {
        return structure.progressivePrefixCandidatesCache.map(
          (candidate) => ({ ...candidate })
        );
      }

      const frame = getProgressiveDctFrame(structure);
      if (!frame) return [];
      const scans = (structure.scans || [])
        .filter((scan) => scan.frameMarkerOffset === frame.markerOffset)
        .sort((left, right) => left.offset - right.offset);
      if (scans.length < 2) return [];

      const requiredComponentIds = new Set(
        frame.components.map((component) => component.id)
      );
      const dcCoveredComponentIds = new Set();
      const candidates = [];

      for (let scanIndex = 0; scanIndex < scans.length; scanIndex++) {
        const scan = scans[scanIndex];
        if (
          scan.spectralStart === 0 &&
          scan.spectralEnd === 0 &&
          scan.successiveHigh === 0
        ) {
          for (const componentId of scan.componentIds) {
            if (requiredComponentIds.has(componentId)) {
              dcCoveredComponentIds.add(componentId);
            }
          }
        }

        const allDcComponentsCovered = [...requiredComponentIds].every(
          (componentId) => dcCoveredComponentIds.has(componentId)
        );
        const isFinalScan = scanIndex === scans.length - 1;
        if (!allDcComponentsCovered || isFinalScan) continue;

        const cutoffOffset = scan.endOffset;
        if (
          !Number.isInteger(cutoffOffset) ||
          cutoffOffset <= 2 ||
          cutoffOffset + 2 >= structure.byteLength
        ) {
          continue;
        }
        candidates.push({
          frameMarkerOffset: frame.markerOffset,
          scanIndex,
          retainedScanCount: scanIndex + 1,
          totalScanCount: scans.length,
          omittedScanCount: scans.length - (scanIndex + 1),
          cutoffOffset
        });
      }

      structure.progressivePrefixCandidatesCache = candidates;
      return candidates.map((candidate) => ({ ...candidate }));
    }

    function selectProgressivePrefixCandidate(seed, structure) {
      const candidates = getProgressivePrefixCandidates(structure);
      if (!candidates.length) return null;
      const frame = getProgressiveDctFrame(structure);
      const random = createPcg32Stream(
        seed,
        ["progressive-prefix", frame.markerOffset, candidates.length].join(":")
      );
      return {
        ...selectUniformItem(candidates, random),
        candidateCount: candidates.length
      };
    }

    function mutateProgressivePrefix(bytes, structure, selection) {
      if (!selection) {
        return {
          bytes: new Uint8Array(bytes),
          changed: false,
          reason: "progressive-no-selected-prefix",
          metadata: null,
          usedClusters: []
        };
      }
      const candidate = getProgressivePrefixCandidates(structure).find(
        (item) =>
          item.frameMarkerOffset === selection.frameMarkerOffset &&
          item.scanIndex === selection.scanIndex &&
          item.cutoffOffset === selection.cutoffOffset
      );
      if (!candidate) {
        return {
          bytes: new Uint8Array(bytes),
          changed: false,
          reason: "progressive-prefix-not-valid-for-source",
          metadata: null,
          usedClusters: []
        };
      }

      const cutoff = candidate.cutoffOffset;
      const output = new Uint8Array(cutoff + 2);
      output.set(bytes.subarray(0, cutoff), 0);
      output[cutoff] = JPEG_MARKER_PREFIX;
      output[cutoff + 1] = JPEG_EOI_MARKER;
      const usedClusters = (structure.scanRanges || [])
        .filter((range) => range.start >= cutoff)
        .map((range) => ({
          start: range.start,
          length: range.end - range.start,
          coordinateSpace: "byte-offset"
        }));
      return {
        bytes: output,
        changed: true,
        reason: null,
        metadata: {
          ...candidate,
          candidateCount: selection.candidateCount,
          originalByteLength: bytes.length,
          outputByteLength: output.length,
          removedByteCount: bytes.length - output.length
        },
        usedClusters
      };
    }

    const JPEG_HUFFMAN_DCT_FRAME_MARKERS = new Set([0xC0, 0xC1, 0xC2]);

    function getSingleHuffmanDctFrame(structure) {
      if (!structure || structure.frames?.length !== 1) return null;
      const frame = structure.frames[0];
      if (
        !JPEG_HUFFMAN_DCT_FRAME_MARKERS.has(frame.marker) ||
        frame.processClass !== "dct" ||
        frame.width <= 0 ||
        frame.height <= 0
      ) {
        return null;
      }
      return frame;
    }

    function cloneRestartCandidate(candidate) {
      return {
        ...candidate,
        completeIntervals: candidate.completeIntervals.map(
          (interval) => ({ ...interval })
        )
      };
    }

    function getRestartMutationCandidates(structure) {
      if (!structure) return [];
      if (Array.isArray(structure.restartMutationCandidatesCache)) {
        return structure.restartMutationCandidatesCache.map(cloneRestartCandidate);
      }
      const frame = getSingleHuffmanDctFrame(structure);
      if (!frame) return [];
      const candidates = [];

      for (let scanIndex = 0; scanIndex < structure.scans.length; scanIndex++) {
        const scan = structure.scans[scanIndex];
        if (scan.frameMarkerOffset !== frame.markerOffset) continue;
        const dri = resolveDriForScan(scan, structure.driDefinitions || []);
        if (!dri.enabled) continue;
        const scanMcuCount = getScanMcuCount(frame, scan);
        if (!Number.isSafeInteger(scanMcuCount) || scanMcuCount <= 0) continue;
        const restartMarkers = scan.restartMarkers || [];
        if (!hasValidRestartSequence(restartMarkers)) continue;
        const expectedMarkerCount = Math.floor(
          (scanMcuCount - 1) / dri.intervalMcuCount
        );
        if (restartMarkers.length !== expectedMarkerCount) continue;
        const intervals = buildRestartIntervals(
          scan,
          restartMarkers,
          dri.intervalMcuCount,
          scanMcuCount
        );
        const completeIntervals = intervals.filter(
          (interval) => !interval.isFinal && interval.payloadLength > 0
        );
        if (completeIntervals.length < 2) continue;
        const pairCount =
          (completeIntervals.length * (completeIntervals.length - 1)) / 2;
        if (!Number.isSafeInteger(pairCount)) continue;
        candidates.push({
          scanIndex,
          scanOffset: scan.offset,
          intervalMcuCount: dri.intervalMcuCount,
          scanMcuCount,
          restartMarkerCount: restartMarkers.length,
          completeIntervals,
          pairCount
        });
      }

      structure.restartMutationCandidatesCache = candidates;
      return candidates.map(cloneRestartCandidate);
    }

    function unrankIntervalPair(intervalCount, rank) {
      let remaining = rank;
      for (let first = 0; first < intervalCount - 1; first++) {
        const rowCount = intervalCount - first - 1;
        if (remaining < rowCount) {
          return [first, first + 1 + remaining];
        }
        remaining -= rowCount;
      }
      return null;
    }

    function selectRestartIntervalSwap(seed, structure) {
      const candidates = getRestartMutationCandidates(structure);
      const totalPairCount = candidates.reduce(
        (sum, candidate) => sum + candidate.pairCount,
        0
      );
      if (!Number.isSafeInteger(totalPairCount) || totalPairCount <= 0) {
        return null;
      }
      const random = createPcg32Stream(
        seed,
        ["restart-interval-swap", totalPairCount].join(":")
      );
      let pairRank = Math.floor(random() * totalPairCount);
      let selectedScan = null;
      for (const candidate of candidates) {
        if (pairRank < candidate.pairCount) {
          selectedScan = candidate;
          break;
        }
        pairRank -= candidate.pairCount;
      }
      if (!selectedScan) return null;
      const pair = unrankIntervalPair(
        selectedScan.completeIntervals.length,
        pairRank
      );
      if (!pair) return null;
      const first = selectedScan.completeIntervals[pair[0]];
      const second = selectedScan.completeIntervals[pair[1]];
      return {
        scanIndex: selectedScan.scanIndex,
        scanOffset: selectedScan.scanOffset,
        intervalMcuCount: selectedScan.intervalMcuCount,
        firstIntervalIndex: first.index,
        secondIntervalIndex: second.index,
        firstPayloadStart: first.payloadStart,
        firstPayloadEnd: first.payloadEnd,
        secondPayloadStart: second.payloadStart,
        secondPayloadEnd: second.payloadEnd,
        pairCount: totalPairCount
      };
    }

    function mutateRestartIntervals(bytes, structure, selection) {
      if (!selection) {
        return {
          bytes: new Uint8Array(bytes),
          changed: false,
          reason: "restart-no-selected-pair",
          metadata: null,
          usedClusters: []
        };
      }
      const scanCandidate = getRestartMutationCandidates(structure).find(
        (candidate) =>
          candidate.scanIndex === selection.scanIndex &&
          candidate.scanOffset === selection.scanOffset
      );
      const firstInterval = scanCandidate?.completeIntervals.find(
        (interval) => interval.index === selection.firstIntervalIndex
      );
      const secondInterval = scanCandidate?.completeIntervals.find(
        (interval) => interval.index === selection.secondIntervalIndex
      );
      const selectionMatches =
        firstInterval?.payloadStart === selection.firstPayloadStart &&
        firstInterval?.payloadEnd === selection.firstPayloadEnd &&
        secondInterval?.payloadStart === selection.secondPayloadStart &&
        secondInterval?.payloadEnd === selection.secondPayloadEnd;
      if (!selectionMatches) {
        return {
          bytes: new Uint8Array(bytes),
          changed: false,
          reason: "restart-selection-invalid",
          metadata: null,
          usedClusters: []
        };
      }

      const first = {
        start: selection.firstPayloadStart,
        end: selection.firstPayloadEnd
      };
      const second = {
        start: selection.secondPayloadStart,
        end: selection.secondPayloadEnd
      };
      if (
        first.start < 0 ||
        first.end <= first.start ||
        second.start < first.end ||
        second.end <= second.start ||
        second.end > bytes.length
      ) {
        return {
          bytes: new Uint8Array(bytes),
          changed: false,
          reason: "restart-selection-invalid",
          metadata: null,
          usedClusters: []
        };
      }

      const firstPayload = bytes.subarray(first.start, first.end);
      const middle = bytes.subarray(first.end, second.start);
      const secondPayload = bytes.subarray(second.start, second.end);
      const output = new Uint8Array(bytes.length);
      let cursor = 0;
      output.set(bytes.subarray(0, first.start), cursor);
      cursor += first.start;
      output.set(secondPayload, cursor);
      cursor += secondPayload.length;
      output.set(middle, cursor);
      cursor += middle.length;
      output.set(firstPayload, cursor);
      cursor += firstPayload.length;
      output.set(bytes.subarray(second.end), cursor);
      return {
        bytes: output,
        changed: true,
        reason: null,
        metadata: {
          ...selection,
          firstPayloadLength: firstPayload.length,
          secondPayloadLength: secondPayload.length,
          outputByteLength: output.length
        },
        usedClusters: [
          {
            start: first.start,
            length: first.end - first.start,
            coordinateSpace: "byte-offset"
          },
          {
            start: second.start,
            length: second.end - second.start,
            coordinateSpace: "byte-offset"
          }
        ]
      };
    }

    function getSingleComponentScanCandidates(bytes, structure) {
      if (!bytes || !structure) return [];
      const frame = getSingleHuffmanDctFrame(structure);
      if (!frame || frame.components.length < 2) return [];
      const candidates = [];
      for (let scanIndex = 0; scanIndex < structure.scans.length; scanIndex++) {
        const scan = structure.scans[scanIndex];
        if (
          scan.frameMarkerOffset !== frame.markerOffset ||
          scan.componentIds.length !== 1
        ) {
          continue;
        }
        const componentId = scan.componentIds[0];
        const componentIndex = frame.components.findIndex(
          (component) => component.id === componentId
        );
        if (componentIndex < 0) continue;
        const mutableIndices = collectMutableIndices(
          bytes,
          [{ start: scan.entropyStart, end: scan.endOffset }],
          "full"
        );
        if (!mutableIndices.length) continue;
        candidates.push({
          frameMarkerOffset: frame.markerOffset,
          scanIndex,
          scanOffset: scan.offset,
          entropyStart: scan.entropyStart,
          entropyEnd: scan.endOffset,
          componentId,
          componentIndex,
          componentKey: `C${componentId}`,
          spectralStart: scan.spectralStart,
          spectralEnd: scan.spectralEnd,
          successiveHigh: scan.successiveHigh,
          successiveLow: scan.successiveLow,
          mutableByteCount: mutableIndices.length
        });
      }
      return candidates;
    }

    function selectComponentScanCandidate(seed, bytes, structure) {
      const candidates = getSingleComponentScanCandidates(bytes, structure);
      if (!candidates.length) return null;
      const random = createPcg32Stream(
        seed,
        ["component-scan", candidates.length].join(":")
      );
      const candidateIndex = Math.floor(random() * candidates.length);
      return {
        ...candidates[candidateIndex],
        componentVariantMode: "single-component-scan-bit-flip",
        candidateIndex,
        candidateCount: candidates.length
      };
    }

    function selectComponentVariantCandidate({
      seed,
      sourceBytes,
      structure
    }) {
      return selectComponentScanCandidate(seed, sourceBytes, structure);
    }

    function groupByteOffsetsIntoClusters(offsets) {
      const sorted = [...new Set(offsets)]
        .filter(Number.isSafeInteger)
        .sort((left, right) => left - right);
      const clusters = [];
      for (const offset of sorted) {
        const previous = clusters[clusters.length - 1];
        if (previous && previous.start + previous.length === offset) {
          previous.length++;
        } else {
          clusters.push({
            start: offset,
            length: 1,
            coordinateSpace: "byte-offset"
          });
        }
      }
      return clusters;
    }

    function mutateSingleComponentScan(
      bytes,
      structure,
      selection,
      mutationRate,
      seed
    ) {
      if (!selection) {
        return {
          bytes: new Uint8Array(bytes),
          changed: false,
          reason: "component-no-selected-scan",
          metadata: null,
          usedClusters: []
        };
      }
      const candidate = getSingleComponentScanCandidates(bytes, structure).find(
        (item) =>
          item.frameMarkerOffset === selection.frameMarkerOffset &&
          item.scanIndex === selection.scanIndex &&
          item.scanOffset === selection.scanOffset &&
          item.componentId === selection.componentId
      );
      if (!candidate) {
        return {
          bytes: new Uint8Array(bytes),
          changed: false,
          reason: "component-selection-invalid",
          metadata: null,
          usedClusters: []
        };
      }
      const mutableIndices = collectMutableIndices(
        bytes,
        [{ start: candidate.entropyStart, end: candidate.entropyEnd }],
        "full"
      );
      if (!mutableIndices.length) {
        return {
          bytes: new Uint8Array(bytes),
          changed: false,
          reason: "component-scan-has-no-mutable-bytes",
          metadata: null,
          usedClusters: []
        };
      }
      const requestedChangeCount = Math.min(
        mutableIndices.length,
        Math.max(1, Math.round(mutableIndices.length * mutationRate))
      );
      const random = createPcg32Stream(
        seed,
        ["component-bit-flip", candidate.scanOffset, candidate.componentId]
          .join(":")
      );
      const selectedIndices = selectUniformUniqueItems(
        mutableIndices,
        requestedChangeCount,
        random
      );
      const output = new Uint8Array(bytes);
      const changedOffsets = [];
      const bitFlipHistogram = Array(BITS_PER_BYTE).fill(0);
      for (const byteOffset of selectedIndices) {
        const result = flipOneSafeEntropyBit(output[byteOffset], random);
        if (!result.changed) continue;
        output[byteOffset] = result.value;
        changedOffsets.push(byteOffset);
        bitFlipHistogram[result.bit]++;
      }
      if (!changedOffsets.length) {
        return {
          bytes: output,
          changed: false,
          reason: "component-no-safe-bit-change",
          metadata: null,
          usedClusters: []
        };
      }
      return {
        bytes: output,
        changed: true,
        reason: null,
        metadata: {
          ...candidate,
          requestedChangeCount,
          changedBytes: changedOffsets.length,
          bitFlipCount: changedOffsets.length,
          bitFlipHistogram
        },
        usedClusters: groupByteOffsetsIntoClusters(changedOffsets)
      };
    }

    function mutateComponentVariant({
      sourceBytes,
      structure,
      selection,
      mutationRate,
      seed
    }) {
      if (!selection) {
        return {
          bytes: new Uint8Array(sourceBytes),
          changed: false,
          reason: "component-no-selected-candidate",
          metadata: null,
          usedClusters: []
        };
      }
      if (selection.error) {
        return {
          bytes: new Uint8Array(sourceBytes),
          changed: false,
          reason: selection.error,
          metadata: null,
          usedClusters: []
        };
      }
      if (
        selection.componentVariantMode !==
          "single-component-scan-bit-flip"
      ) {
        return {
          bytes: new Uint8Array(sourceBytes),
          changed: false,
          reason: "component-selection-invalid",
          metadata: null,
          usedClusters: []
        };
      }
      return mutateSingleComponentScan(
        sourceBytes,
        structure,
        selection,
        mutationRate,
        seed
      );
    }

    const REFERENCE_ENTROPY_LENGTH = 238055;
    const REFERENCE_GRID_SIZE = 48;
    const REFERENCE_WINDOW_COARSE = 96;
    const REFERENCE_WINDOW_FINE = 12;
    const FIELD_NORMALIZATION_SPREAD = 2.5;

    function deriveByteFieldParams(entropyLength) {
      const length = Math.max(1, entropyLength);
      const scaleRatio = length / REFERENCE_ENTROPY_LENGTH;
      const windowCoarse = Math.max(
        24,
        Math.round(REFERENCE_WINDOW_COARSE * scaleRatio)
      );
      const windowFine = Math.max(
        4,
        Math.round(REFERENCE_WINDOW_FINE * scaleRatio)
      );
      const gridSize = Math.max(
        24,
        Math.min(
          96,
          Math.round(REFERENCE_GRID_SIZE * Math.sqrt(scaleRatio))
        )
      );
      return { gridSize, windowCoarse, windowFine };
    }

    function computeLocalVarianceSampler(bytes, indices, windowSize) {
      const length = indices.length;
      const radius = Math.max(1, Math.round(windowSize));
      const prefixSum = new Float64Array(length + 1);
      const prefixSquareSum = new Float64Array(length + 1);
      for (let index = 0; index < length; index++) {
        const value = bytes[indices[index]] / 255;
        prefixSum[index + 1] = prefixSum[index] + value;
        prefixSquareSum[index + 1] = prefixSquareSum[index] + value * value;
      }
      return (center) => {
        const from = Math.max(0, Math.floor(center) - radius);
        const to = Math.min(length, Math.floor(center) + radius);
        const count = to - from;
        if (count <= 1) return 0;
        const sum = prefixSum[to] - prefixSum[from];
        const squareSum = prefixSquareSum[to] - prefixSquareSum[from];
        const mean = sum / count;
        return Math.max(0, squareSum / count - mean * mean);
      };
    }

    function buildByteVarianceGrid(bytes, mutableIndices, gridSize, windowSize) {
      const length = mutableIndices.length;
      if (length === 0) {
        return {
          size: gridSize,
          values: new Float32Array(gridSize * gridSize)
        };
      }

      const localVariance = computeLocalVarianceSampler(
        bytes,
        mutableIndices,
        windowSize
      );

      const cellCount = gridSize * gridSize;
      const raw = new Float32Array(cellCount);
      let sum = 0;
      let sumSquare = 0;
      for (let cell = 0; cell < cellCount; cell++) {
        const center = Math.min(
          length - 1,
          Math.floor((cell + 0.5) / cellCount * length)
        );
        const variance = localVariance(center);
        raw[cell] = variance;
        sum += variance;
        sumSquare += variance * variance;
      }

      const mean = sum / cellCount;
      const variance = Math.max(
        1e-9,
        sumSquare / cellCount - mean * mean
      );
      const spread = Math.sqrt(variance) * FIELD_NORMALIZATION_SPREAD;
      const values = new Float32Array(cellCount);
      for (let cell = 0; cell < cellCount; cell++) {
        const z = spread > 0 ? (raw[cell] - mean) / spread : 0;
        values[cell] = clamp01(0.5 + z * 0.5);
      }

      return { size: gridSize, values };
    }

    // JPEG stores DQT entries in zigzag order. These indices map that stream
    // back to the natural 8x8 DCT coefficient layout.
    const JPEG_ZIGZAG_TO_NATURAL = [
      0, 1, 8, 16, 9, 2, 3, 10,
      17, 24, 32, 25, 18, 11, 4, 5,
      12, 19, 26, 33, 40, 48, 41, 34,
      27, 20, 13, 6, 7, 14, 21, 28,
      35, 42, 49, 56, 57, 50, 43, 36,
      29, 22, 15, 23, 30, 37, 44, 51,
      58, 59, 52, 45, 38, 31, 39, 46,
      53, 60, 61, 54, 47, 55, 62, 63
    ];
    const JPEG_DCT_BASIS = Array.from({ length: 8 }, (_, frequency) => {
      const scale = frequency === 0 ? Math.sqrt(1 / 8) : Math.sqrt(2 / 8);
      return Float64Array.from({ length: 8 }, (_, position) =>
        scale * Math.cos(((position * 2 + 1) * frequency * Math.PI) / 16)
      );
    });

    function readJpegQuantizationTables(bytes, structure) {
      const tables = new Map();
      for (const segment of structure.dqtSegments) {
        let position = segment.payloadStart;
        while (position < segment.payloadEnd) {
          const descriptor = bytes[position++];
          const precision = descriptor >>> 4;
          const tableId = descriptor & 0x0F;
          if (precision !== 0 && precision !== 1) break;
          const step = precision === 0 ? 1 : 2;
          if (position + 64 * step > segment.payloadEnd) break;
          const values = new Float32Array(64);
          for (let zigzag = 0; zigzag < 64; zigzag++) {
            const value = step === 1
              ? bytes[position]
              : (bytes[position] << 8) | bytes[position + 1];
            values[JPEG_ZIGZAG_TO_NATURAL[zigzag]] = Math.max(1, value);
            position += step;
          }
          tables.set(tableId, values);
        }
      }
      return tables;
    }

    function getPrimaryJpegQuantizationTable(bytes, structure) {
      const tables = readJpegQuantizationTables(bytes, structure);
      if (tables.size === 0) return null;
      const frame = structure.sofSegments[0];
      const tableId = frame && frame.payloadStart + 8 < frame.payloadEnd
        ? bytes[frame.payloadStart + 8]
        : tables.keys().next().value;
      const values = tables.get(tableId) || tables.values().next().value;
      return values ? { tableId, values } : null;
    }

    function normalizeSpectralEnergyField(raw) {
      const transformed = new Float32Array(raw.length);
      let sum = 0;
      let sumSquare = 0;
      for (let index = 0; index < raw.length; index++) {
        const value = Math.log1p(Math.max(0, raw[index]));
        transformed[index] = value;
        sum += value;
        sumSquare += value * value;
      }
      const mean = sum / Math.max(1, raw.length);
      const variance = Math.max(
        1e-9,
        sumSquare / Math.max(1, raw.length) - mean * mean
      );
      const spread = Math.sqrt(variance) * FIELD_NORMALIZATION_SPREAD;
      const normalized = new Float32Array(raw.length);
      for (let index = 0; index < raw.length; index++) {
        normalized[index] = clamp01(
          0.5 + ((transformed[index] - mean) / spread) * 0.5
        );
      }
      return normalized;
    }

    function normalizeSignedSpectralField(raw) {
      let sum = 0;
      let sumSquare = 0;
      for (const value of raw) {
        sum += value;
        sumSquare += value * value;
      }
      const mean = sum / Math.max(1, raw.length);
      const variance = Math.max(
        1e-9,
        sumSquare / Math.max(1, raw.length) - mean * mean
      );
      const spread = Math.sqrt(variance) * FIELD_NORMALIZATION_SPREAD;
      const normalized = new Float32Array(raw.length);
      for (let index = 0; index < raw.length; index++) {
        normalized[index] = Math.max(
          -1,
          Math.min(1, (raw[index] - mean) / spread)
        );
      }
      return normalized;
    }

    // Re-run JPEG's 8x8 DCT and quantization over the cached analysis luminance
    // with the source file's DQT. This models the compression process without
    // pretending to recover the original entropy-coded coefficients.
    function buildJpegSpectralField(bytes, structure, analysis) {
      const quantization = getPrimaryJpegQuantizationTable(bytes, structure);
      if (!quantization || !analysis?.luminance?.length) return null;
      const blockSize = 8;
      const columns = Math.max(1, Math.ceil(analysis.width / blockSize));
      const rows = Math.max(1, Math.ceil(analysis.height / blockSize));
      const blockCount = columns * rows;
      const coarseRaw = new Float32Array(blockCount);
      const fineRaw = new Float32Array(blockCount);
      const residual = new Float32Array(blockCount);
      const directionXRaw = new Float32Array(blockCount);
      const directionYRaw = new Float32Array(blockCount);
      const maximumFrequency = Math.hypot(7, 7);
      let totalCoarseEnergy = 0;
      let totalFineEnergy = 0;

      for (let blockY = 0; blockY < rows; blockY++) {
        for (let blockX = 0; blockX < columns; blockX++) {
          const blockIndex = blockY * columns + blockX;
          let coarseEnergy = 0;
          let fineEnergy = 0;
          let residualSum = 0;
          for (let verticalFrequency = 0; verticalFrequency < 8; verticalFrequency++) {
            for (let horizontalFrequency = 0; horizontalFrequency < 8; horizontalFrequency++) {
              let coefficient = 0;
              for (let y = 0; y < 8; y++) {
                const sourceY = Math.min(analysis.height - 1, blockY * blockSize + y);
                const verticalBasis = JPEG_DCT_BASIS[verticalFrequency][y];
                for (let x = 0; x < 8; x++) {
                  const sourceX = Math.min(analysis.width - 1, blockX * blockSize + x);
                  const luminance = analysis.luminance[sourceY * analysis.width + sourceX] * 255 - 128;
                  coefficient += luminance *
                    JPEG_DCT_BASIS[horizontalFrequency][x] * verticalBasis;
                }
              }
              const coefficientIndex = verticalFrequency * 8 + horizontalFrequency;
              const quantizationStep = quantization.values[coefficientIndex];
              const quantized = Math.round(coefficient / quantizationStep);
              const frequency = Math.hypot(horizontalFrequency, verticalFrequency) /
                maximumFrequency;
              const energy = Math.abs(quantized);
              coarseEnergy += energy * (1 - frequency);
              fineEnergy += energy * frequency;
              residualSum += Math.abs(
                coefficient - quantized * quantizationStep
              ) / quantizationStep;
              if (horizontalFrequency === 1 && verticalFrequency === 0) {
                directionXRaw[blockIndex] = quantized;
              }
              if (horizontalFrequency === 0 && verticalFrequency === 1) {
                directionYRaw[blockIndex] = quantized;
              }
            }
          }
          coarseRaw[blockIndex] = coarseEnergy;
          fineRaw[blockIndex] = fineEnergy;
          residual[blockIndex] = clamp01((residualSum / 64) * 2);
          totalCoarseEnergy += coarseEnergy;
          totalFineEnergy += fineEnergy;
        }
      }

      const totalEnergy = totalCoarseEnergy + totalFineEnergy;
      if (totalEnergy <= Number.EPSILON) return null;
      return {
        columns,
        rows,
        blockSize,
        tableId: quantization.tableId,
        coarse: normalizeSpectralEnergyField(coarseRaw),
        fine: normalizeSpectralEnergyField(fineRaw),
        residual,
        directionX: normalizeSignedSpectralField(directionXRaw),
        directionY: normalizeSignedSpectralField(directionYRaw),
        coarseWeight: totalCoarseEnergy / totalEnergy,
        fineWeight: totalFineEnergy / totalEnergy
      };
    }

    async function buildJpegSpectralFieldFromBlob(blob) {
      if (!(blob instanceof Blob)) return null;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      validateJpeg(bytes);
      const structure = analyzeJpegStructure(bytes);
      const image = await decodeImageBlob(blob);
      const analysis = analyzeSourceImage(image);
      return buildJpegSpectralField(bytes, structure, analysis);
    }

    const DEBUG_MCU = false;
    const mcuConfig = {
      minClusterLength: 4,
      repeatDistance: { min: 4, max: 92 },
      neighborDistance: { min: 8, max: 184 },
      offsetDistance: { min: 2, max: 46 },
      xorAmount: { min: 1, max: 254 },
      replaceDrift: 72,
      overlapLimit: 0.6,
      maskHardness: 0.55,
      maxInternalRetries: 3
    };

    function deriveMcuMutationLimits(structure, budget) {
      const entropyBytes = Math.max(1, structure.entropyBytes);
      const targetByteCount = Math.max(
        mcuConfig.minClusterLength,
        Math.min(entropyBytes, Math.round(budget))
      );
      const maximumClustersByBudget = Math.max(
        1,
        Math.floor(targetByteCount / mcuConfig.minClusterLength)
      );
      const blockCount = Math.max(
        1,
        Math.floor(Number(structure.blockCount) || 1)
      );
      const requestedClusters = Math.max(
        1,
        Math.min(
          blockCount,
          maximumClustersByBudget,
          Math.round(Math.sqrt(targetByteCount))
        )
      );
      const maxClusterLength = Math.max(
        mcuConfig.minClusterLength,
        Math.min(
          entropyBytes,
          Math.ceil(targetByteCount / requestedClusters)
        )
      );
      return {
        targetByteCount,
        requestedClusters,
        maxClusterLength,
        entropyBytes
      };
    }

    function sanitizeEntropyByte(value) {
      const next = Math.max(0, Math.min(255, value | 0));
      return next === 0xFF ? 0xFE : next;
    }

    function getSafeEntropyBitMasks(value) {
      const masks = [];
      for (let bit = 0; bit < BITS_PER_BYTE; bit++) {
        const mask = 1 << bit;
        if ((value ^ mask) === 0xFF) continue;
        masks.push(mask);
      }
      return masks;
    }

    function flipOneSafeEntropyBit(value, random) {
      const masks = getSafeEntropyBitMasks(value);
      const mask = selectUniformItem(masks, random);
      if (mask === null) {
        return { changed: false, value, bit: null };
      }
      return {
        changed: true,
        value: value ^ mask,
        bit: Math.log2(mask)
      };
    }

    function isSafeMutableByte(bytes, index) {
      if (index < 0 || index >= bytes.length) return false;
      if (bytes[index] === 0xFF) return false;
      return index === 0 || bytes[index - 1] !== 0xFF;
    }

    function isSafeReadableByte(bytes, index, range) {
      return index >= range.start && index < range.end && isSafeMutableByte(bytes, index);
    }

    function findSafeClusterStart(bytes, range, clusterLength, random, maxAttempts = 32) {
      const available = range.end - range.start - clusterLength;
      if (available < 0) return -1;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const start = range.start + Math.floor(random() * (available + 1));
        let safe = true;
        for (let offset = 0; offset < clusterLength; offset++) {
          if (!isSafeMutableByte(bytes, start + offset)) {
            safe = false;
            break;
          }
        }
        if (safe) return start;
      }
      return -1;
    }

    function overlapRatio(startA, lengthA, startB, lengthB) {
      const overlap = Math.max(0,
        Math.min(startA + lengthA, startB + lengthB) - Math.max(startA, startB)
      );
      return overlap / Math.max(1, Math.min(lengthA, lengthB));
    }

    function mutateMcuFragments(
      bytes,
      seed,
      budget,
      structure,
      retryLevel = 0
    ) {
      const out = new Uint8Array(bytes);
      const usedClusters = [];
      const random = createPcg32Stream(seed, `mcu-fragment:${retryLevel}`);
      const usableRanges = structure.scanRanges.filter((range) =>
        range.end - range.start >= mcuConfig.minClusterLength + 8
      );
      if (!usableRanges.length) {
        return {
          bytes: out,
          usedClusters,
          changedBytes: 0,
          reason: "mcu-no-usable-scan-range"
        };
      }
      const mutationLimits = deriveMcuMutationLimits(structure, budget);
      const requestedClusters = mutationLimits.requestedClusters;
      const effectiveMaxLength = mutationLimits.maxClusterLength;
      let appliedClusters = 0;

      for (let cluster = 0; cluster < requestedClusters; cluster++) {
        const clusterLength = mcuConfig.minClusterLength + Math.floor(
          random() * Math.max(1, effectiveMaxLength - mcuConfig.minClusterLength + 1)
        );
        let range = null;
        let clusterStart = -1;
        for (let placement = 0; placement < 24; placement++) {
          const candidateRange = usableRanges[Math.floor(random() * usableRanges.length)];
          const candidateStart = findSafeClusterStart(bytes, candidateRange, clusterLength, random);
          if (candidateStart < 0) continue;
          const excessiveOverlap = usedClusters.some((used) =>
            overlapRatio(candidateStart, clusterLength, used.start, used.length) > mcuConfig.overlapLimit
          );
          if (!excessiveOverlap) {
            range = candidateRange;
            clusterStart = candidateStart;
            break;
          }
        }
        if (!range || clusterStart < 0) continue;

        const mode = selectUniformItem([
          "repeat",
          "neighbor-copy",
          "xor-cluster",
          "offset-copy",
          "local-replace"
        ], random);

        if (mode === "repeat") {
          const repeatDistance = mcuConfig.repeatDistance.min + Math.floor(
            random() * (
              mcuConfig.repeatDistance.max - mcuConfig.repeatDistance.min + 1
            )
          );
          for (let i = 0; i < clusterLength; i++) {
            const target = clusterStart + i;
            const source = target - repeatDistance;
            if (isSafeMutableByte(bytes, target) && isSafeReadableByte(bytes, source, range)) {
              out[target] = sanitizeEntropyByte(out[source]);
            }
          }
        } else if (mode === "neighbor-copy") {
          const direction = random() < 0.5 ? -1 : 1;
          const distance = mcuConfig.neighborDistance.min + Math.floor(
            random() * (
              mcuConfig.neighborDistance.max - mcuConfig.neighborDistance.min + 1
            )
          );
          const sourceStart = clusterStart + direction * distance;
          for (let i = 0; i < clusterLength; i++) {
            const target = clusterStart + i;
            const source = sourceStart + i;
            if (isSafeMutableByte(bytes, target) && isSafeReadableByte(bytes, source, range)) {
              out[target] = sanitizeEntropyByte(out[source]);
            }
          }
        } else if (mode === "xor-cluster") {
          const xorBase = mcuConfig.xorAmount.min + Math.floor(
            random() * (
              mcuConfig.xorAmount.max - mcuConfig.xorAmount.min + 1
            )
          );
          for (let i = 0; i < clusterLength; i++) {
            const target = clusterStart + i;
            if (!isSafeMutableByte(bytes, target)) continue;
            const neighbor = isSafeReadableByte(bytes, target - 1, range)
              ? bytes[target - 1]
              : bytes[target];
            const modulation = Math.floor(
              Math.abs(bytes[target] - neighbor) / 255 * 15
            );
            out[target] = sanitizeEntropyByte(out[target] ^ (xorBase + modulation));
          }
        } else if (mode === "offset-copy") {
          const sourceOffsetMagnitude = mcuConfig.offsetDistance.min + Math.floor(
            random() * (
              mcuConfig.offsetDistance.max - mcuConfig.offsetDistance.min + 1
            )
          );
          const sourceOffset = (random() < 0.5 ? -1 : 1) * sourceOffsetMagnitude;
          const snapshot = out.slice(clusterStart, clusterStart + clusterLength);
          for (let i = 0; i < clusterLength; i++) {
            const target = clusterStart + i;
            if (!isSafeMutableByte(bytes, target)) continue;
            const localSource = Math.max(0, Math.min(snapshot.length - 1, i + sourceOffset));
            out[target] = sanitizeEntropyByte(snapshot[localSource]);
          }
        } else {
          const baseValue = 1 + Math.floor(random() * 254);
          for (let i = 0; i < clusterLength; i++) {
            const target = clusterStart + i;
            if (!isSafeMutableByte(bytes, target)) continue;
            const source = clusterStart + (i + 1) % clusterLength;
            const sourceValue = isSafeReadableByte(bytes, source, range)
              ? bytes[source]
              : bytes[target];
            const drift = Math.round(
              (sourceValue / 255 - 0.5) * mcuConfig.replaceDrift
            );
            out[target] = sanitizeEntropyByte(baseValue + drift);
          }
        }
        usedClusters.push({
          start: clusterStart,
          length: clusterLength,
          coordinateSpace: "byte-offset"
        });
        appliedClusters++;
      }

      const changedBytes = countChangedBytes(bytes, out);
      if (DEBUG_MCU) console.debug("MCU Fragment", {
        requestedClusters,
        appliedClusters,
        changedBytes,
        retryLevel,
        mutationLimits
      });
      return {
        bytes: out,
        usedClusters,
        changedBytes,
        reason: changedBytes > 0 ? null : "mcu-no-byte-change"
      };
    }

    function mutateDqt(bytes, seed, budget, structure) {
      const out = new Uint8Array(bytes);
      const rand = createPcg32Stream(seed, "dqt-mutation");
      for (const segment of structure.dqtSegments) {
        let pos = segment.payloadStart;
        while (pos < segment.payloadEnd) {
          const precision = out[pos] >>> 4;
          const step = precision === 0 ? 1 : 2;
          const tableStart = pos + 1;
          const count = Math.min(64, Math.floor((segment.payloadEnd - tableStart) / step));
          const density = budget / Math.max(1, structure.entropyBytes);
          const changes = Math.max(1, Math.min(count, Math.round(count * Math.sqrt(density))));
          const selected = new Set();
          for (let change = 0; change < changes; change++) {
            const available = [];
            for (let coefficient = 0; coefficient < count; coefficient++) {
              if (!selected.has(coefficient)) available.push(coefficient);
            }
            const coefficient = selectUniformItem(available, rand);
            if (!Number.isInteger(coefficient)) break;
            selected.add(coefficient);
            const index = tableStart + coefficient * step;
            const bit = Math.floor(rand() * step * BITS_PER_BYTE);
            const byteOffset = Math.floor(bit / BITS_PER_BYTE);
            const bitInByte = bit % BITS_PER_BYTE;
            out[index + byteOffset] ^= 1 << bitInByte;
          }
          pos = tableStart + count * step;
        }
      }
      return out;
    }

    function mutateDht(bytes, seed, structure, strength) {
      const out = new Uint8Array(bytes);
      const rand = createPcg32Stream(seed, "dht-mutation");
      for (const segment of structure.dhtSegments) {
        let pos = segment.payloadStart;
        while (pos + 17 <= segment.payloadEnd) {
          let symbolCount = 0;
          for (let i = 1; i <= 16; i++) symbolCount += out[pos + i];
          const symbolsStart = pos + 17;
          const available = Math.min(symbolCount, segment.payloadEnd - symbolsStart);
          const swaps = Math.max(1, Math.min(available - 1, Math.ceil(strength)));
          const usedPositions = new Set();
          for (let i = 0; i < swaps && available > 1; i++) {
            const unused = [];
            for (let offset = 0; offset < available; offset++) {
              const candidate = symbolsStart + offset;
              if (!usedPositions.has(candidate)) unused.push(candidate);
            }
            const eligible = unused.filter((candidate) =>
              unused.some((other) => out[other] !== out[candidate])
            );
            const a = selectUniformItem(eligible, rand);
            if (!Number.isInteger(a)) break;
            const different = unused.filter((candidate) =>
              candidate !== a && out[candidate] !== out[a]
            );
            const b = selectUniformItem(different, rand);
            if (!Number.isInteger(b)) break;
            [out[a], out[b]] = [out[b], out[a]];
            usedPositions.add(a);
            usedPositions.add(b);
          }
          pos = symbolsStart + available;
        }
      }
      return out;
    }

    function isSamplingLegalForEveryScan(sampling, scans) {
      const samplingById = new Map(sampling.map((component) => [
        component.id,
        component
      ]));
      if (sampling.some((component) =>
        component.h < 1 || component.h > 4 ||
        component.v < 1 || component.v > 4
      )) {
        return false;
      }
      for (const scan of scans) {
        const scanSampling = scan.componentIds.map((id) => samplingById.get(id));
        if (scanSampling.some((component) => !component)) return false;
        if (scanSampling.length > 1) {
          const blocksPerMcu = scanSampling.reduce(
            (sum, component) => sum + component.h * component.v,
            0
          );
          if (blocksPerMcu > 10) return false;
        }
      }
      return true;
    }

    function createScanBlockConsumptionSignature(frame, scans, sampling) {
      if (!frame || !Array.isArray(scans) || scans.length === 0) return null;
      const samplingById = new Map(sampling.map((component) => [
        component.id,
        component
      ]));
      const hMax = Math.max(
        1,
        ...sampling.map((component) => component.h)
      );
      const vMax = Math.max(
        1,
        ...sampling.map((component) => component.v)
      );
      const signature = [];

      for (const scan of scans) {
        const scanSampling = scan.componentIds.map((id) => samplingById.get(id));
        if (scanSampling.some((component) => !component)) return null;
        if (scanSampling.length > 1) {
          const mcuColumns = Math.ceil(
            frame.width / (JPEG_DCT_BLOCK_SIZE * hMax)
          );
          const mcuRows = Math.ceil(
            frame.height / (JPEG_DCT_BLOCK_SIZE * vMax)
          );
          const mcuCount = mcuColumns * mcuRows;
          const blocksPerMcu = scanSampling.reduce(
            (sum, component) => sum + component.h * component.v,
            0
          );
          signature.push(mcuCount * blocksPerMcu);
          if (
            scan.dri?.enabled ||
            (scan.restartMarkers?.length || 0) > 0
          ) {
            signature.push(mcuCount);
          }
          continue;
        }

        const component = scanSampling[0];
        const blockColumns = Math.ceil(
          frame.width * component.h /
          (hMax * JPEG_DCT_BLOCK_SIZE)
        );
        const blockRows = Math.ceil(
          frame.height * component.v /
          (vMax * JPEG_DCT_BLOCK_SIZE)
        );
        const blockCount = blockColumns * blockRows;
        signature.push(blockCount);
      }
      return signature;
    }

    function hasMatchingScanBlockConsumption(
      frame,
      scans,
      sampling,
      referenceSignature
    ) {
      const candidateSignature = createScanBlockConsumptionSignature(
        frame,
        scans,
        sampling
      );
      return Boolean(
        referenceSignature &&
        candidateSignature &&
        candidateSignature.length === referenceSignature.length &&
        candidateSignature.every(
          (value, index) => value === referenceSignature[index]
        )
      );
    }

    function enumerateLegalSamplingCandidates(frame, scans) {
      // DCT scans can contain at most four components. Enumerate every sampling
      // combination allowed by the JPEG bounds and per-scan MCU block limit.
      // Because SOF is edited without re-encoding entropy data, retain only
      // layouts that consume the same total block count per scan. Scans with
      // restart markers additionally retain their original MCU count.
      if (
        !frame?.components?.length ||
        frame.components.length > 4 ||
        !Array.isArray(scans) ||
        scans.length === 0
      ) {
        return [];
      }
      const original = frame.components.map((component) => ({
        id: component.id,
        h: component.h,
        v: component.v
      }));
      const referenceSignature = createScanBlockConsumptionSignature(
        frame,
        scans,
        original
      );
      if (!referenceSignature) return [];
      const originalById = new Map(original.map((component) => [
        component.id,
        component
      ]));
      const optionsByComponent = original.map((component) => {
        const options = [];
        for (let h = 1; h <= 4; h++) {
          for (let v = 1; v <= 4; v++) {
            options.push({ id: component.id, h, v });
          }
        }
        return options;
      });
      if (optionsByComponent.some((options) => options.length === 0)) return [];

      const candidates = [];
      const current = new Array(original.length);
      const visit = (componentIndex) => {
        if (componentIndex === optionsByComponent.length) {
          const differs = current.some((component) => {
            const source = originalById.get(component.id);
            return component.h !== source.h || component.v !== source.v;
          });
          if (
            !differs ||
            !isSamplingLegalForEveryScan(current, scans) ||
            !hasMatchingScanBlockConsumption(
              frame,
              scans,
              current,
              referenceSignature
            )
          ) {
            return;
          }
          candidates.push(current.map((component) => ({ ...component })));
          return;
        }
        for (const option of optionsByComponent[componentIndex]) {
          current[componentIndex] = option;
          visit(componentIndex + 1);
        }
      };
      visit(0);
      return candidates;
    }

    function isQuantTablePrecisionCompatible(frame, table) {
      if (!frame || !table) return false;
      return frame.precision > 8 || table.precision === 0;
    }

    function getEligibleQuantTableIds(component, frame, scans, quantTables) {
      const componentScans = scans.filter(
        (scan) => scan.componentIds.includes(component.id)
      );
      if (componentScans.length === 0) return [];
      const firstScanOffset = Math.min(...componentScans.map((scan) => scan.offset));
      const lastScanEndOffset = Math.max(...componentScans.map((scan) => scan.endOffset));
      const eligible = [];
      for (let id = 0; id <= 3; id++) {
        const definitions = quantTables
          .filter((table) => table.id === id && table.definitionOffset < firstScanOffset)
          .sort((left, right) => left.definitionOffset - right.definitionOffset);
        const effective = definitions[definitions.length - 1];
        if (!effective || !isQuantTablePrecisionCompatible(frame, effective)) continue;
        const redefinedDuringComponent = quantTables.some((table) =>
          table.id === id &&
          table.definitionOffset >= firstScanOffset &&
          table.definitionOffset < lastScanEndOffset
        );
        if (!redefinedDuringComponent) eligible.push(id);
      }
      return eligible;
    }

    function enumerateValidTqiRoutingPermutations(frame, scans, quantTables) {
      if (frame?.processClass !== "dct") return [];
      const optionsByComponent = frame.components.map((component) => {
        const eligibleIds = getEligibleQuantTableIds(
          component,
          frame,
          scans,
          quantTables
        );
        const alternatives = eligibleIds.filter(
          (tableId) => tableId !== component.tq
        );
        const targetIds = alternatives.length
          ? alternatives
          : eligibleIds.includes(component.tq) ? [component.tq] : [];
        return targetIds.map((tableId) => ({
          componentId: component.id,
          from: component.tq,
          to: tableId,
          tqOffset: component.tqOffset
        }));
      });
      if (optionsByComponent.some((options) => options.length === 0)) return [];

      const permutations = [];
      const current = new Array(optionsByComponent.length);
      const visit = (componentIndex) => {
        if (componentIndex === optionsByComponent.length) {
          if (current.some((assignment) => assignment.from !== assignment.to)) {
            permutations.push(current.map((assignment) => ({ ...assignment })));
          }
          return;
        }
        for (const option of optionsByComponent[componentIndex]) {
          current[componentIndex] = option;
          visit(componentIndex + 1);
        }
      };
      visit(0);
      return permutations;
    }

    function getSofMutationCandidates(structure) {
      const frame = structure?.frames?.find(
        (candidate) => candidate.processClass === "dct"
      );
      if (!frame) return [];
      const frameComponentIds = new Set(
        frame.components.map((component) => component.id)
      );
      const scans = (structure.scans || []).filter((scan) =>
        scan.frameMarkerOffset === frame.markerOffset &&
        scan.componentIds.every((id) => frameComponentIds.has(id))
      );
      const sampling = enumerateLegalSamplingCandidates(frame, scans)
        .map((candidate) => ({ type: "sampling", frame, scans, candidate }));
      const quantRouting = enumerateValidTqiRoutingPermutations(
        frame,
        scans,
        structure.quantTables || []
      ).map((candidate) => ({
        type: "quant-routing-permutation",
        frame,
        scans,
        candidate
      }));
      return [...sampling, ...quantRouting];
    }

    function getDqtMutationCandidates(structure) {
      return (structure?.quantTables || []).map((table) => ({
        definitionOffset: table.definitionOffset,
        precision: table.precision,
        tableId: table.id
      }));
    }

    function getDhtMutationCandidates(structure) {
      const candidates = [];
      for (const table of structure?.huffmanTables || []) {
        let first = -1;
        let second = -1;
        for (let left = 0; left < table.symbols.length - 1 && second < 0; left++) {
          for (let right = left + 1; right < table.symbols.length; right++) {
            if (table.symbols[left] !== table.symbols[right]) {
              first = table.symbolsStart + left;
              second = table.symbolsStart + right;
              break;
            }
          }
        }
        if (first >= 0 && second >= 0) {
          candidates.push({
            tableClass: table.tableClass,
            tableId: table.id,
            first,
            second
          });
        }
      }
      return candidates;
    }

    function getStableHuffmanTableIdsForScan(scan, tableClass, huffmanTables) {
      const eligible = [];
      for (let id = 0; id <= 3; id++) {
        const definitions = huffmanTables
          .filter((table) =>
            table.tableClass === tableClass &&
            table.id === id &&
            table.definitionOffset < scan.offset
          )
          .sort((left, right) => left.definitionOffset - right.definitionOffset);
        const effective = definitions[definitions.length - 1];
        if (!effective) continue;
        const redefinedDuringScan = huffmanTables.some((table) =>
          table.tableClass === tableClass &&
          table.id === id &&
          table.definitionOffset >= scan.offset &&
          table.definitionOffset < scan.endOffset
        );
        if (!redefinedDuringScan) eligible.push(id);
      }
      return eligible;
    }

    function getSosMutationCandidates(structure) {
      const candidates = [];
      const huffmanTables = structure?.huffmanTables || [];
      for (const scan of structure?.scans || []) {
        const frame = structure.frames?.find(
          (candidate) => candidate.markerOffset === scan.frameMarkerOffset
        );
        if (frame?.processClass !== "dct") continue;
        const usesDcTable = scan.spectralStart === 0;
        const usesAcTable = scan.spectralEnd > 0;
        const dcIds = usesDcTable
          ? getStableHuffmanTableIdsForScan(scan, 0, huffmanTables)
          : [];
        const acIds = usesAcTable
          ? getStableHuffmanTableIdsForScan(scan, 1, huffmanTables)
          : [];
        for (const component of scan.components) {
          const currentDc = component.tableSelector >>> 4;
          const currentAc = component.tableSelector & 0x0F;
          for (const tableId of dcIds) {
            if (tableId === currentDc) continue;
            candidates.push({
              tableClass: 0,
              componentId: component.id,
              selectorOffset: component.selectorOffset,
              from: currentDc,
              to: tableId
            });
          }
          for (const tableId of acIds) {
            if (tableId === currentAc) continue;
            candidates.push({
              tableClass: 1,
              componentId: component.id,
              selectorOffset: component.selectorOffset,
              from: currentAc,
              to: tableId
            });
          }
        }
      }
      return candidates;
    }

    function canMutateMcu(structure) {
      if (!structure?.mutableIndices?.length) return false;
      return (structure.scanRanges || []).some((range) =>
        range.end - range.start >= mcuConfig.minClusterLength + 8
      );
    }

    function getEligibleLayerNames(
      structure,
      sourceBytes = currentBytes,
      coefficientContext = sourceBaselineCoefficientContext,
      progressiveCoefficientContext = sourceProgressiveCoefficientContext
    ) {
      if (!structure) return [];
      if (
        sourceBytes &&
        Array.isArray(structure.eligibleLayerNamesCache)
      ) {
        const cached = structure.eligibleLayerNamesCache.slice();
        const componentEligible =
          getSingleComponentScanCandidates(sourceBytes, structure).length > 0;
        if (componentEligible) cached.push("component");
        if (
          (coefficientContext?.supported &&
            coefficientContext.dcDomain?.candidateCount > 0) ||
          (progressiveCoefficientContext?.supported &&
            progressiveCoefficientContext.dcDomain?.candidateCount > 0)
        ) {
          cached.push("coefficient");
        }
        return cached;
      }
      const eligibility = {
        entropy: structure.mutableIndices?.length > 0,
        mcu: canMutateMcu(structure),
        dqt: getDqtMutationCandidates(structure).length > 0,
        dht: getDhtMutationCandidates(structure).length > 0,
        sof: getSofMutationCandidates(structure).length > 0,
        sos: getSosMutationCandidates(structure).length > 0,
        progressive: getProgressivePrefixCandidates(structure).length > 0,
        restart: getRestartMutationCandidates(structure).length > 0,
      };
      const eligible = layerNames.filter(
        (name) =>
          name !== "component" &&
          name !== "coefficient" &&
          eligibility[name] === true
      );
      if (sourceBytes) structure.eligibleLayerNamesCache = eligible.slice();
      const componentEligible = Boolean(sourceBytes) &&
        getSingleComponentScanCandidates(sourceBytes, structure).length > 0;
      if (componentEligible) eligible.push("component");
      if (
        (coefficientContext?.supported &&
          coefficientContext.dcDomain?.candidateCount > 0) ||
        (progressiveCoefficientContext?.supported &&
          progressiveCoefficientContext.dcDomain?.candidateCount > 0)
      ) {
        eligible.push("coefficient");
      }
      return eligible.slice();
    }

    function mutateSof(bytes, seed, structure) {
      const out = new Uint8Array(bytes);
      const candidates = getSofMutationCandidates(structure);
      const random = createPcg32Stream(seed, "sof-structure");
      const selected = selectUniformItem(candidates, random);
      if (!selected) {
        return {
          bytes: out,
          changed: false,
          reason: "sof-no-compatible-sampling-or-quant-route"
        };
      }
      if (selected.type === "sampling") {
        const candidateById = new Map(selected.candidate.map((component) => [
          component.id,
          component
        ]));
        for (const component of selected.frame.components) {
          const sampling = candidateById.get(component.id);
          out[component.samplingOffset] = (sampling.h << 4) | sampling.v;
        }
        return {
          bytes: out,
          changed: true,
          mode: "sampling",
          reason: "sof-compatible-sampling"
        };
      }

      if (selected.type === "quant-routing-permutation") {
        for (const assignment of selected.candidate) {
          out[assignment.tqOffset] = assignment.to;
        }
        return {
          bytes: out,
          changed: true,
          mode: "quant-routing-permutation",
          reason: "sof-valid-quant-routing-permutation"
        };
      }

      return {
        bytes: out,
        changed: false,
        reason: "sof-unknown-candidate-type"
      };
    }

    function mutateSos(bytes, seed, structure, strength) {
      const out = new Uint8Array(bytes);
      const rand = createPcg32Stream(seed, "sos-mutation");
      const candidates = getSosMutationCandidates(structure);
      const groups = new Map();
      for (const candidate of candidates) {
        const key = `${candidate.selectorOffset}:${candidate.tableClass}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(candidate);
      }
      const candidateGroups = [...groups.values()];
      for (let index = candidateGroups.length - 1; index > 0; index--) {
        const pick = Math.floor(rand() * (index + 1));
        [candidateGroups[index], candidateGroups[pick]] = [
          candidateGroups[pick],
          candidateGroups[index]
        ];
      }
      const changeCount = Math.max(
        candidateGroups.length > 0 ? 1 : 0,
        Math.min(
          candidateGroups.length,
          Math.ceil(
            candidateGroups.length * normalizeLayerStrength("sos", strength)
          )
        )
      );
      for (const group of candidateGroups.slice(0, changeCount)) {
        const candidate = group[Math.floor(rand() * group.length)];
        const current = out[candidate.selectorOffset];
        out[candidate.selectorOffset] = candidate.tableClass === 0
          ? (candidate.to << 4) | (current & 0x0F)
          : (current & 0xF0) | candidate.to;
      }
      return out;
    }

    function countChangedBytes(before, after) {
      const sharedLength = Math.min(before.length, after.length);
      let changed = Math.abs(before.length - after.length);
      for (let i = 0; i < sharedLength; i++) {
        if (before[i] !== after[i]) changed++;
      }
      return changed;
    }

    function decodeImageBlob(blob) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(blob);
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("グリッチ素材をデコードできませんでした"));
        };
        image.src = url;
      });
    }

    function canvasToJpegBlob(canvas) {
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("合成画像をJPEGへ変換できませんでした"));
        }, "image/jpeg", 1);
      });
    }

    function getReusableCanvas(key, width, height, contextOptions = undefined) {
      let entry = reusableCanvases.get(key);
      if (!entry) {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", contextOptions);
        if (!context) throw new Error(`2D canvas is unavailable: ${key}`);
        entry = { canvas, context };
        reusableCanvases.set(key, entry);
      }

      if (entry.canvas.width !== width || entry.canvas.height !== height) {
        entry.canvas.width = width;
        entry.canvas.height = height;
      }
      entry.context.setTransform(1, 0, 0, 1, 0, 0);
      entry.context.globalAlpha = 1;
      entry.context.globalCompositeOperation = "source-over";
      entry.context.filter = "none";
      entry.context.imageSmoothingEnabled = true;
      entry.context.clearRect(0, 0, width, height);
      return entry;
    }

    function mixSeed(seed, label, imageFingerprint = 0) {
      // FNV-1a gives semantic labels stable, non-arbitrary numeric identities.
      let hash = (2166136261 ^ (seed >>> 0) ^ (imageFingerprint >>> 0)) >>> 0;
      for (let i = 0; i < label.length; i++) {
        hash ^= label.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
      return hash;
    }

    function analyzeSourceImage(image, {
      captureOriginalImageData = false
    } = {}) {
      const scale = Math.min(1, 360 / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(32, Math.round(image.naturalWidth * scale));
      const height = Math.max(32, Math.round(image.naturalHeight * scale));
      const { context } = getReusableCanvas(
        "source-analysis",
        width,
        height,
        { willReadFrequently: true }
      );
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      const count = width * height;
      const luminance = new Float32Array(count);
      const saturation = new Float32Array(count);
      const saliency = new Float32Array(count);
      const edge = new Float32Array(count);
      const texture = new Float32Array(count);
      let meanRed = 0;
      let meanGreen = 0;
      let meanBlue = 0;
      let fingerprint = 2166136261;

      for (let i = 0, pixel = 0; i < pixels.length; i += 4, pixel++) {
        const red = pixels[i];
        const green = pixels[i + 1];
        const blue = pixels[i + 2];
        const maximum = Math.max(red, green, blue);
        const minimum = Math.min(red, green, blue);
        luminance[pixel] = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
        saturation[pixel] = maximum === 0 ? 0 : (maximum - minimum) / maximum;
        meanRed += red;
        meanGreen += green;
        meanBlue += blue;
        fingerprint ^= red;
        fingerprint = Math.imul(fingerprint, 16777619) >>> 0;
        fingerprint ^= green << 8 | blue;
        fingerprint = Math.imul(fingerprint, 16777619) >>> 0;
      }
      meanRed /= count;
      meanGreen /= count;
      meanBlue /= count;

      let maxEdge = 0;
      let maxTexture = 0;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const index = y * width + x;
          const topLeft = luminance[index - width - 1];
          const top = luminance[index - width];
          const topRight = luminance[index - width + 1];
          const left = luminance[index - 1];
          const right = luminance[index + 1];
          const bottomLeft = luminance[index + width - 1];
          const bottom = luminance[index + width];
          const bottomRight = luminance[index + width + 1];
          const gradientX = -topLeft - 2 * left - bottomLeft + topRight + 2 * right + bottomRight;
          const gradientY = -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
          edge[index] = Math.hypot(gradientX, gradientY);
          texture[index] = (
            Math.abs(luminance[index] - top) + Math.abs(luminance[index] - bottom) +
            Math.abs(luminance[index] - left) + Math.abs(luminance[index] - right)
          ) * 0.25;
          maxEdge = Math.max(maxEdge, edge[index]);
          maxTexture = Math.max(maxTexture, texture[index]);
        }
      }

      let meanLuminance = 0;
      let meanSaturation = 0;
      let meanEdge = 0;
      let meanTexture = 0;
      let meanSaliency = 0;
      let squareLuminance = 0;
      let squareSaturation = 0;
      let squareEdge = 0;
      let squareTexture = 0;
      let squareSaliency = 0;
      let meanCentered = 0;
      let squareCentered = 0;
      const inverseMaxEdge = 1 / Math.max(0.0001, maxEdge);
      const inverseMaxTexture = 1 / Math.max(0.0001, maxTexture);
      for (let i = 0, pixel = 0; i < pixels.length; i += 4, pixel++) {
        edge[pixel] *= inverseMaxEdge;
        texture[pixel] *= inverseMaxTexture;
        saliency[pixel] = Math.min(1, Math.hypot(
          pixels[i] - meanRed,
          pixels[i + 1] - meanGreen,
          pixels[i + 2] - meanBlue
        ) / 300);
        const centered = 1 - Math.abs(luminance[pixel] - 0.5) * 2;
        meanLuminance += luminance[pixel];
        meanSaturation += saturation[pixel];
        meanEdge += edge[pixel];
        meanTexture += texture[pixel];
        meanSaliency += saliency[pixel];
        meanCentered += centered;
        squareLuminance += luminance[pixel] * luminance[pixel];
        squareSaturation += saturation[pixel] * saturation[pixel];
        squareEdge += edge[pixel] * edge[pixel];
        squareTexture += texture[pixel] * texture[pixel];
        squareSaliency += saliency[pixel] * saliency[pixel];
        squareCentered += centered * centered;
      }

      const channelVariance = {
        luminance: Math.max(
          Number.EPSILON,
          squareLuminance / count - Math.pow(meanLuminance / count, 2)
        ),
        saturation: Math.max(
          Number.EPSILON,
          squareSaturation / count - Math.pow(meanSaturation / count, 2)
        ),
        edge: Math.max(
          Number.EPSILON,
          squareEdge / count - Math.pow(meanEdge / count, 2)
        ),
        texture: Math.max(
          Number.EPSILON,
          squareTexture / count - Math.pow(meanTexture / count, 2)
        ),
        saliency: Math.max(
          Number.EPSILON,
          squareSaliency / count - Math.pow(meanSaliency / count, 2)
        ),
        centered: Math.max(
          Number.EPSILON,
          squareCentered / count - Math.pow(meanCentered / count, 2)
        )
      };
      const analysis = {
        width, height, luminance, saturation, saliency, edge, texture, fingerprint,
        channelVariance,
        stats: {
          luminance: meanLuminance / count,
          saturation: meanSaturation / count,
          edge: meanEdge / count,
          texture: meanTexture / count,
          saliency: meanSaliency / count
        }
      };
      if (captureOriginalImageData) {
        analysis.originalImageData = { width, height, data: pixels };
      }
      return analysis;
    }

    // ========================================================================
    // 11. JPEG MUTATION KERNELS
    // ========================================================================
    function generateGlitch(bytes, options) {
      const { layers, seed, changeBudget, structure } = options;
      let output = new Uint8Array(bytes);
      let clusterCount = 0;
      let mcuClusters = [];
      let entropyClusters = [];
      let entropyMode = options.mode ?? "organic";
      let bitFlipCount = 0;
      let bitFlipHistogram = Array(BITS_PER_BYTE).fill(0);
      let progressiveMetadata = null;
      let progressiveClusters = [];
      let restartMetadata = null;
      let restartClusters = [];
      let componentMetadata = null;
      let componentClusters = [];
      let coefficientMetadata = null;
      let coefficientClusters = [];
      const noOpLayers = [];

      if (layers.coefficient?.enabled) {
        const coefficientSelection =
          options.recipe?.variantSelections?.coefficient;
        const coefficientProcess = coefficientSelection?.process ||
          options.coefficientContext?.decodedResult?.decoded?.process || null;
        let coefficientResult;
        try {
          coefficientResult = coefficientProcess === "progressive-huffman-dct"
            ? mutateProgressiveCoefficient({
                sourceBytes: bytes,
                structure,
                coefficientContext: options.progressiveCoefficientContext,
                selection: coefficientSelection
              })
            : mutateBaselineCoefficient({
                sourceBytes: bytes,
                structure,
                coefficientContext: options.coefficientContext,
                selection: coefficientSelection
              });
        } catch (error) {
          const failedSelections = Array.isArray(
            coefficientSelection?.selections
          )
            ? coefficientSelection.selections
            : coefficientSelection ? [coefficientSelection] : [];
          error.coefficientClusters = createCoefficientSelectionClusters(
            failedSelections
          );
          throw error;
        }
        output = coefficientResult.bytes;
        coefficientMetadata = coefficientResult.metadata;
        coefficientClusters = coefficientResult.usedClusters;
        if (!coefficientResult.changed) {
          noOpLayers.push({
            name: "coefficient",
            reason: coefficientResult.reason
          });
        }
      }
      if (layers.dqt.enabled) {
        output = mutateDqt(
          output,
          seed,
          changeBudget * layers.dqt.strength,
          structure
        );
      }
      if (layers.mcu.enabled) {
        const mcuBudget = Math.max(1, Math.round(changeBudget * layers.mcu.strength));
        const mcuResult = mutateMcuFragments(
          output,
          mixSeed(seed, "mcu-fragment"),
          mcuBudget,
          structure,
          options.mcuRetryLevel || 0
        );
        output = mcuResult.bytes;
        mcuClusters = mcuResult.usedClusters;
        if (mcuResult.changedBytes === 0) {
          noOpLayers.push({
            name: "mcu",
            reason: mcuResult.reason || "mcu-no-byte-change"
          });
        }
      }
      if (layers.dht.enabled) {
        output = mutateDht(
          output,
          seed,
          structure,
          layers.dht.strength
        );
      }
      if (layers.sof.enabled) {
        const sofResult = mutateSof(
          output,
          seed,
          structure
        );
        output = sofResult.bytes;
        if (!sofResult.changed) {
          noOpLayers.push({ name: "sof", reason: sofResult.reason });
        }
      }
      if (layers.sos.enabled) {
        output = mutateSos(
          output,
          seed,
          structure,
          layers.sos.strength
        );
      }
      if (layers.entropy.enabled) {
        const entropyBudget = Math.max(1, Math.round(changeBudget * layers.entropy.strength));
        const baseClusterBudget = Math.max(
          structure.scanCount,
          Math.round(Math.sqrt(entropyBudget))
        );
        const clusterBudget = Math.max(
          structure.scanCount,
          Math.round(baseClusterBudget * mutationRangeConfig.entropy.clusterCountScale)
        );
        const maxClusterLength = Math.max(
          1,
          Math.ceil(
            Math.ceil(entropyBudget / baseClusterBudget) *
            mutationRangeConfig.entropy.clusterLengthScale
          )
        );
        const organic = organicGlitchJpeg(output, {
          ...options,
          changeBudget: entropyBudget,
          maxClusters: clusterBudget,
          minClusterLength: 1,
          maxClusterLength,
          baseDensity: Math.min(
            1,
            entropyBudget / Math.max(1, clusterBudget * maxClusterLength)
          ),
          maxStrength: Math.max(1, Math.round(255 * Math.sqrt(entropyBudget / structure.entropyBytes)))
        });
        output = organic.bytes;
        clusterCount = organic.clusterCount;
        entropyClusters = organic.usedClusters;
        entropyMode = organic.entropyMode;
        bitFlipCount = organic.bitFlipCount;
        bitFlipHistogram = organic.bitFlipHistogram;
        if (organic.changedBytes === 0) {
          noOpLayers.push({
            name: "entropy",
            reason: organic.reason || "entropy-no-mutation-candidate"
          });
        }
      }
      if (layers.component?.enabled) {
        const componentResult = mutateComponentVariant({
          sourceBytes: output,
          structure,
          selection: options.recipe?.variantSelections?.component,
          mutationRate: options.mutationRate,
          seed: options.seed
        });
        output = componentResult.bytes;
        componentMetadata = componentResult.metadata;
        componentClusters = componentResult.usedClusters;
        if (!componentResult.changed) {
          noOpLayers.push({
            name: "component",
            reason: componentResult.reason
          });
        }
      }
      if (layers.restart?.enabled) {
        const restartResult = mutateRestartIntervals(
          output,
          structure,
          options.recipe?.variantSelections?.restart
        );
        output = restartResult.bytes;
        restartMetadata = restartResult.metadata;
        restartClusters = restartResult.usedClusters;
        if (!restartResult.changed) {
          noOpLayers.push({ name: "restart", reason: restartResult.reason });
        }
      }
      if (layers.progressive?.enabled) {
        const progressiveResult = mutateProgressivePrefix(
          output,
          structure,
          options.recipe?.variantSelections?.progressive
        );
        output = progressiveResult.bytes;
        progressiveMetadata = progressiveResult.metadata;
        progressiveClusters = progressiveResult.usedClusters;
        if (!progressiveResult.changed) {
          noOpLayers.push({
            name: "progressive",
            reason: progressiveResult.reason
          });
        }
      }

      const mutationTraces = layerNames
        .filter((family) => layers[family]?.enabled)
        .map((family) => ({
          family,
          clusters: family === "entropy"
            ? entropyClusters
            : family === "mcu"
              ? mcuClusters
              : family === "progressive"
                ? progressiveClusters
                : family === "restart"
                  ? restartClusters
                  : family === "component"
                    ? componentClusters
                    : family === "coefficient" ? coefficientClusters : []
        }));

      return {
        bytes: output,
        changedBytes: countChangedBytes(bytes, output),
        clusterCount,
        mcuClusters,
        entropyClusters,
        entropyMode,
        bitFlipCount,
        bitFlipHistogram,
        progressiveMetadata,
        progressiveClusters,
        restartMetadata,
        restartClusters,
        componentMetadata,
        componentClusters,
        coefficientMetadata,
        coefficientClusters,
        noOpLayers,
        mutationTraces
      };
    }

    function organicGlitchJpeg(bytes, options = {}) {
      const {
        seed = 12345,
        changeBudget = 1,
        structure = { blockCount: 1 },
        mode = "organic",
        region = "full",
        threshold = 0.5,
        maxClusters = 24,
        minClusterLength = 3,
        maxClusterLength = 64,
        baseDensity = 0.18,
        maxStrength = 90
      } = options;

      const out = new Uint8Array(bytes);
      const ranges = structure.scanRanges;
      const indices = collectMutableIndices(out, ranges, region);
      const rand = createPcg32Stream(seed, "entropy-organic");
      const length = indices.length;
      if (length === 0) throw new Error("変更可能な圧縮データがありません");

      const sampleStep = Math.max(1, Math.floor(length / Math.sqrt(structure.blockCount)));
      const varianceWindow = Math.max(2, Math.round(sampleStep * 0.5));
      const sampleLocalVariance = computeLocalVarianceSampler(
        out,
        indices,
        varianceWindow
      );
      let sampleCount = 0;
      let varianceSum = 0;
      let varianceSquareSum = 0;
      for (let relative = 0; relative < length; relative += sampleStep) {
        sampleCount++;
        const value = sampleLocalVariance(relative);
        varianceSum += value;
        varianceSquareSum += value * value;
      }
      const varianceMean = varianceSum / Math.max(1, sampleCount);
      const varianceSpread = Math.sqrt(Math.max(
        Number.EPSILON,
        varianceSquareSum / Math.max(1, sampleCount) -
          varianceMean * varianceMean
      )) * FIELD_NORMALIZATION_SPREAD;
      const varianceAt = (relative) => {
        const value = sampleLocalVariance(relative);
        const standardized = (value - varianceMean) /
          Math.max(Number.EPSILON, varianceSpread);
        return clamp01(0.5 + standardized * 0.5);
      };
      const selectOrganicMode = (variance) => variance < 1 / 3
        ? "xor"
        : variance < 2 / 3 ? "add" : "replace";
      const candidates = [];
      let previousVariance = varianceAt(0);
      let currentVariance = varianceAt(sampleStep);

      for (let relative = sampleStep; relative < length - sampleStep; relative += sampleStep) {
        const nextVariance = varianceAt(relative + sampleStep);
        if (
          currentVariance > threshold &&
          currentVariance > previousVariance &&
          currentVariance >= nextVariance
        ) {
          candidates.push({
            position: relative,
            score: currentVariance
          });
        }
        previousVariance = currentVariance;
        currentVariance = nextVariance;
      }

      candidates.sort((a, b) => b.score - a.score);
      const clusterLimit = Math.max(1, Math.min(maxClusters, changeBudget));
      const clusters = candidates.slice(0, clusterLimit);
      if (clusters.length === 0) {
        return {
          bytes: out,
          changedBytes: 0,
          clusterCount: 0,
          usedClusters: [],
          entropyMode: mode,
          bitFlipCount: 0,
          bitFlipHistogram: Array(BITS_PER_BYTE).fill(0),
          reason: "entropy-no-variance-peak"
        };
      }

      const changed = new Set();
      let bitFlipCount = 0;
      const bitFlipHistogram = Array(BITS_PER_BYTE).fill(0);
      const flipBitAtIndex = (index) => {
        if (changed.has(index) || !isSafeMutableByte(out, index)) return false;
        const result = flipOneSafeEntropyBit(out[index], rand);
        if (!result.changed) return false;
        out[index] = result.value;
        changed.add(index);
        bitFlipCount++;
        bitFlipHistogram[result.bit]++;
        return true;
      };
      candidateLoop: for (const candidate of clusters) {
        const normalized = Math.max(0.08, Math.min(1,
          (candidate.score - threshold) / Math.max(0.0001, 1 - threshold)
        ));
        const clusterLength = Math.max(minClusterLength, Math.floor(
          minClusterLength + normalized * (maxClusterLength - minClusterLength)
        ));
        const density = Math.min(1, baseDensity);
        const strength = Math.max(1, Math.floor(maxStrength * normalized));
        const start = candidate.position - Math.floor(clusterLength / 2);
        const clusterMode = mode !== "organic"
          ? mode
          : selectOrganicMode(candidate.score);

        for (let i = 0; i < clusterLength; i++) {
          const relative = start + i;
          if (relative < 0 || relative >= length) continue;

          const t = clusterLength <= 1 ? 0.5 : i / (clusterLength - 1);
          const envelope = Math.sin(Math.PI * t);
          const localVariance = varianceAt(relative);
          const texture = 0.35 + localVariance * 0.65;
          if (rand() > density * envelope * texture) continue;

          const index = indices[relative];
          const amount = Math.max(1, Math.floor(strength * envelope * texture));
          if (clusterMode === "bit-flip") {
            if (flipBitAtIndex(index) && changed.size >= changeBudget) {
              break candidateLoop;
            }
            continue;
          }
          let next = out[index];
          if (clusterMode === "add") next = (next + amount) & 0xFF;
          else if (clusterMode === "replace") next = Math.floor(localVariance * 254);
          else next ^= amount;

          if (next === 0xFF) next = 0xFE;
          if (next !== out[index]) {
            out[index] = next;
            changed.add(index);
            if (changed.size >= changeBudget) break candidateLoop;
          }
        }
      }

      // Treat the structure-derived budget as a target, expanding outward from
      // the strongest JPEG byte-variance peaks when the first pass undershoots it.
      const targetChanges = Math.min(length, Math.max(1, Math.round(changeBudget)));
      const fillSeed = mixSeed(seed, "entropy-budget-fill");
      for (let fill = 0; changed.size < targetChanges && fill < length; fill++) {
        const clusterIndex = fill % Math.max(1, clusters.length);
        const expansionStep = Math.floor(
          fill / Math.max(1, clusters.length)
        );
        const radius = Math.floor(expansionStep / 2) + 1;
        const center = clusters[clusterIndex]?.position ?? (fillSeed % length);
        const initialDirection = (fillSeed >>> clusterIndex) & 1 ? 1 : -1;
        const direction = expansionStep % 2 === 0
          ? initialDirection
          : -initialDirection;
        const relative = (center + direction * radius + length) % length;
        const index = indices[relative];
        if (changed.has(index)) continue;
        const localVariance = varianceAt(relative);
        const amount = Math.max(
          1,
          Math.round(maxStrength * Math.max(Number.EPSILON, localVariance))
        );
        const fillMode = mode !== "organic"
          ? mode
          : selectOrganicMode(localVariance);
        if (fillMode === "bit-flip") {
          flipBitAtIndex(index);
          continue;
        }
        let next = out[index];
        if (fillMode === "add") next = (next + amount) & 0xFF;
        else if (fillMode === "replace") next = Math.floor(localVariance * 254);
        else next ^= amount;
        if (next === 0xFF) next = 0xFE;
        if (next === out[index]) next = next === 0xFE ? 0xFD : next + 1;
        out[index] = next;
        changed.add(index);
      }

      const mutablePositions = [];
      const mutableIndices = structure.mutableIndices || [];
      for (const absolutePosition of changed) {
        const mutablePosition = absoluteToMutableIndex(mutableIndices, absolutePosition);
        if (mutableIndices[mutablePosition] === absolutePosition) {
          mutablePositions.push(mutablePosition);
        }
      }
      return {
        bytes: out,
        changedBytes: changed.size,
        clusterCount: clusters.length,
        usedClusters: groupMutablePositionsIntoClusters(mutablePositions),
        entropyMode: mode,
        bitFlipCount,
        bitFlipHistogram,
        reason: null
      };
    }

    // ========================================================================
    // 12. RECIPE AND ELIGIBILITY
    // ========================================================================
    function createGlitchRecipe(
      seed,
      settings,
      analysis,
      structure = null,
      sourceBytes = null,
      coefficientContext = sourceBaselineCoefficientContext,
      progressiveCoefficientContext =
        sourceProgressiveCoefficientContext,
      variantExploration = null
    ) {
      const random = createPcg32Stream(
        seed,
        "glitch-recipe",
        analysis?.fingerprint || 0
      );
      const prefixStableRecipe = variantExploration?.connected === true;
      const stats = analysis?.stats || {};
      const detail = clamp01(((stats.edge || 0) + (stats.texture || 0)) * 0.5);
      const saliency = clamp01(stats.saliency || 0);
      const saturation = clamp01(stats.saturation || 0);
      const layerScale = {
        entropy: lerp(1.08, 1.38, detail),
        mcu: lerp(1.1, 1.48, stats.edge || 0),
        dqt: lerp(1.04, 1.29, 1 - detail),
        dht: lerp(0.92, 1.17, saliency),
        sof: lerp(0.92, 1.17, saturation),
        sos: lerp(0.92, 1.17, detail)
      };
      const recipe = {};
      for (const name of layerNames) {
        const setting = settings[name];
        if (name === "component") {
          recipe[name] = setting?.enabled ? 1 : 0;
          continue;
        }
        if (name === "coefficient") {
          recipe[name] = setting?.enabled
            ? Math.max(
                variantDefinitions.coefficient.strengthRange.min,
                Math.min(
                  variantDefinitions.coefficient.strengthRange.max,
                  Number(setting.strength) ||
                    variantDefinitions.coefficient.strengthRange.min
                )
              )
            : 0;
          continue;
        }
        if (variantDefinitions[name].transitionStateMode === "fixed") {
          recipe[name] = setting?.enabled ? 1 : 0;
          continue;
        }
        const layerRandom = prefixStableRecipe
          ? createPcg32Stream(
              seed,
              `variant-slot-parameters:${name}`,
              analysis?.fingerprint || 0
            )
          : random;
        recipe[name] = setting?.enabled
          ? Math.max(0.1, Math.min(mutationRangeConfig.maxLayerStrength,
            setting.strength * layerScale[name] *
            lerp(0.92, 1.08, layerRandom())
          ))
          : 0;
      }
      const coefficientSelection = settings.coefficient?.enabled
        ? selectDcCoefficientVariantCandidates(
            seed,
            coefficientContext,
            progressiveCoefficientContext,
            settings.coefficient.strength
          )
        : null;
      return {
        ...recipe,
        variantSelections: {
          progressive: settings.progressive?.enabled
            ? selectProgressivePrefixCandidate(seed, structure)
            : null,
          restart: settings.restart?.enabled
            ? selectRestartIntervalSwap(seed, structure)
            : null,
          component: settings.component?.enabled
            ? selectComponentVariantCandidate({
                seed,
                sourceBytes,
                structure
              })
            : null,
          coefficient: coefficientSelection
        },
        coefficientMode: coefficientSelection?.mode || null
      };
    }

    function createTransitionPlaybackTimeline(seed, frameCount, currentFailureState = null) {
      const random = createPcg32Stream(seed, "transition-playback");
      const sosFailureInfluence = getFailureInfluence(currentFailureState, {
        family: "sos",
        stage: "transition-state"
      });
      const holds = Array.from({ length: frameCount }, () => {
        const roll = random();
        let holdMs;
        if (roll < 0.5) {
          holdMs = lerp(
            transitionPlaybackConfig.burstHoldMin,
            transitionPlaybackConfig.burstHoldMax,
            random()
          );
        } else if (roll < 0.85) {
          holdMs = lerp(
            transitionPlaybackConfig.normalHoldMin,
            transitionPlaybackConfig.normalHoldMax,
            random()
          );
        } else {
          holdMs = lerp(
            transitionPlaybackConfig.pauseHoldMin,
            transitionPlaybackConfig.pauseHoldMax,
            random()
          );
        }
        const holdBias = roll < 0.5
          ? 1 - sosFailureInfluence
          : roll < 0.85 ? 1 : 1 + sosFailureInfluence;
        return holdMs * holdBias;
      });
      const targetDuration = transitionPlaybackConfig.totalDuration;
      const totalDuration = holds.reduce((sum, hold) => sum + hold, 0);
      const durationScale = targetDuration / Math.max(1, totalDuration);
      const normalizedHolds = holds.map((holdMs) =>
        Math.max(20, Math.round(holdMs * durationScale))
      );
      const lastIndex = normalizedHolds.length - 1;
      if (lastIndex >= 0) {
        normalizedHolds[lastIndex] = Math.min(
          normalizedHolds[lastIndex], transitionPlaybackConfig.lastStateMaxHold
        );
      }
      const nonFinalTotal = normalizedHolds
        .slice(0, lastIndex)
        .reduce((sum, hold) => sum + hold, 0);
      const nonFinalTarget = Math.max(
        20 * Math.max(0, lastIndex),
        targetDuration - (normalizedHolds[lastIndex] || 0)
      );
      const nonFinalScale = nonFinalTarget / Math.max(1, nonFinalTotal);
      const timeline = normalizedHolds.map((holdMs, index) => {
        const playbackIndex = sosFailureInfluence > 0 &&
          index > 1 && index < lastIndex && random() < sosFailureInfluence
          ? index - 1
          : index;
        return {
          index: playbackIndex,
          holdMs: index === lastIndex
            ? holdMs
            : Math.max(20, Math.round(holdMs * nonFinalScale))
        };
      });
      if (timeline.length > 1) {
        const roundedTarget = Math.round(targetDuration);
        const roundedTotal = timeline.reduce((sum, point) => sum + point.holdMs, 0);
        let correction = roundedTarget - roundedTotal;
        for (let index = 0; index < timeline.length - 1 && correction !== 0; index++) {
          const adjustment = correction > 0
            ? correction
            : Math.max(correction, 20 - timeline[index].holdMs);
          timeline[index].holdMs += adjustment;
          correction -= adjustment;
        }
      }
      return timeline;
    }

    function createRegistryTransitionPlaybackTimeline(
      states,
      registryGeneration
    ) {
      const stateIndexByTechnique = new Map();
      for (let index = 0; index < states.length; index++) {
        const state = states[index];
        if (!state?.isFinal && state.activeVariantNames?.length === 1) {
          stateIndexByTechnique.set(state.activeVariantNames[0], index);
        }
      }
      const recordByName = new Map(
        (registryGeneration?.techniques || []).map((entry) => [
          entry.name,
          entry
        ])
      );
      const selectedNames = registryGeneration?.selectedTechniqueNames || [];
      if (selectedNames.length === 0) return [];
      const totalDuration = Math.max(
        0,
        Math.round(transitionPlaybackConfig.totalDuration)
      );
      const equalHold = Math.floor(
        totalDuration / selectedNames.length
      );
      let remainder = totalDuration - equalHold * selectedNames.length;
      return selectedNames.map((name) => {
        const holdMs = equalHold + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        const entry = recordByName.get(name);
        const stateIndex = stateIndexByTechnique.get(name);
        const success = entry?.status === "success" &&
          Number.isInteger(stateIndex);
        const strength = Number(entry?.parameters?.strength);
        const meterValue = Number.isFinite(strength)
          ? normalizeLayerStrength(name, strength)
          : 0;
        return {
          index: success ? stateIndex : null,
          holdMs,
          techniqueName: name,
          techniqueStatus: success ? "success" : "reject",
          techniqueStrength: Number.isFinite(strength) ? strength : null,
          techniqueMeterValue: meterValue,
          rejectReason: success
            ? null
            : entry?.rejectReason || "transition-state-unavailable"
        };
      });
    }

    async function createDecodedVariant(bytes, name, options, isolatedLayers) {
      const attempts = options.disableMutationRetries
        ? 1
        : name === "mcu" ? mcuConfig.maxInternalRetries : 1;
      let lastError = null;
      let lastVariant = null;
      for (let retryLevel = 0; retryLevel < attempts; retryLevel++) {
        if (options.shouldContinue && !options.shouldContinue()) {
          throw createGenerationCancelledError();
        }
        let variant = null;
        let failureCode = "mutation-failed";
        const variantSeed = mixSeed(
          options.seed,
          `glitch:${name}`,
          options.analysis?.fingerprint ?? 0
        );
        const familyStrength = isolatedLayers[name]?.strength || 1;
        const eventBudget = name === "entropy" || name === "mcu"
          ? Math.max(1, Math.round(options.changeBudget * familyStrength))
          : options.changeBudget;
        try {
          variant = generateGlitch(bytes, {
            ...options,
            seed: variantSeed,
            layers: isolatedLayers,
            mcuRetryLevel: retryLevel
          });
          lastVariant = variant;
          const noOp = variant.noOpLayers?.find((item) => item.name === name);
          if (variant.changedBytes === 0 && noOp) {
            return {
              variant,
              image: null,
              variantSeed,
              skipped: true,
              reason: noOp.reason
            };
          }
          if (variant.changedBytes === 0) {
            failureCode = "no-changed-bytes";
            throw new Error(`${name}で変更可能なバイトがありません`);
          }
          failureCode = "decode-failed";
          const image = await decodeImageBlob(new Blob([variant.bytes], { type: "image/jpeg" }));
          if (options.shouldContinue && !options.shouldContinue()) {
            throw createGenerationCancelledError();
          }
          recordMutationEvent({
            family: name,
            stage: options.stage || "final-frame",
            buildKey: options.buildKey,
            frameAttempt: options.frameAttempt,
            attempt: retryLevel + 1,
            retryLevel,
            seed: variantSeed,
            changeBudget: eventBudget,
            initialChangeBudget: options.initialChangeBudget,
            clusters: getVariantMutationClusters(name, variant),
            region: options.region,
            byteLength: variant.bytes.length
          }, options);
          return { variant, image, variantSeed };
        } catch (error) {
          if (isGenerationCancellation(error)) throw error;
          const clusters = getVariantMutationClusters(name, variant);
          // DifferenceData is derived here while variant.bytes is still
          // available. The failed JPEG itself is not retained after this catch.
          const failureEvent = dispatchFailureEvent({
            family: name,
            stage: options.stage || "final-frame",
            buildKey: options.buildKey,
            frameAttempt: options.frameAttempt,
            attempt: retryLevel + 1,
            retryLevel,
            seed: variantSeed,
            changeBudget: eventBudget,
            initialChangeBudget: options.initialChangeBudget,
            clusters,
            region: options.region,
            byteLength: variant?.bytes?.length ?? null,
            reason: error.message,
            code: failureCode,
            error
          }, options);
          recordFailureDifferenceEvent(
            failureEvent,
            variant?.bytes || null,
            options
          );
          lastError = error;
        }
      }
      const finalError = lastError || new Error(`${name} Variantを生成できませんでした`);
      finalError.mcuClusters = lastVariant?.mcuClusters || [];
      finalError.entropyClusters = lastVariant?.entropyClusters || [];
      finalError.progressiveClusters = lastVariant?.progressiveClusters || [];
      finalError.restartClusters = lastVariant?.restartClusters || [];
      finalError.componentClusters = lastVariant?.componentClusters || [];
      finalError.coefficientClusters = lastVariant?.coefficientClusters || [];
      throw finalError;
    }

    // ========================================================================
    // 13. FAILURE STATE
    // ========================================================================
    function createFrameMutationEventLog() {
      return {
        nextSequence: 0,
        nextBuildIndex: 0,
        nextStateIndex: 0,
        events: [],
        builds: [],
        buildStateMap: new Map(),
        failureDifferenceEvents: []
      };
    }

    function formatFrameEventKey(prefix, index) {
      return `${prefix}-${String(index).padStart(3, "0")}`;
    }

    function createMutationBuild(eventLog, {
      frameAttempt,
      stage,
      progress = null
    }) {
      const buildKey = formatFrameEventKey(
        "build",
        eventLog.nextBuildIndex++
      );
      const build = {
        buildKey,
        result: "pending",
        stateKey: null,
        frameAttempt: Math.max(1, Math.floor(Number(frameAttempt) || 1)),
        stage: stage === "transition-state"
          ? "transition-state"
          : "final-frame",
        progress: Number.isFinite(progress) ? clamp01(progress) : null
      };
      eventLog.builds.push(build);
      return build;
    }

    function findMutationBuild(eventLog, buildKey) {
      return eventLog?.builds?.find((build) =>
        build.buildKey === buildKey
      ) || null;
    }

    function commitMutationBuild(eventLog, buildKey, stateKey) {
      const build = findMutationBuild(eventLog, buildKey);
      if (!build) return false;
      build.result = "committed";
      build.stateKey = stateKey;
      eventLog.buildStateMap.set(buildKey, stateKey);
      return true;
    }

    function discardMutationBuild(eventLog, buildKey) {
      const build = findMutationBuild(eventLog, buildKey);
      if (!build) return false;
      build.result = "discarded";
      build.stateKey = null;
      eventLog.buildStateMap.delete(buildKey);
      return true;
    }

    function discardMutationBuildsForFrameAttempt(eventLog, frameAttempt) {
      const normalizedAttempt = Math.max(
        1,
        Math.floor(Number(frameAttempt) || 1)
      );
      for (const build of eventLog.builds) {
        if (build.frameAttempt === normalizedAttempt) {
          discardMutationBuild(eventLog, build.buildKey);
        }
      }
    }

    function createTransitionStateKey(eventLog) {
      return formatFrameEventKey("state", eventLog.nextStateIndex++);
    }

    function assignTransitionStateKey(eventLog, state, buildKey = null) {
      const stateKey = createTransitionStateKey(eventLog);
      state.stateKey = stateKey;
      if (buildKey) commitMutationBuild(eventLog, buildKey, stateKey);
      return state;
    }

    function normalizeMutationEventClusters(clusters) {
      return (clusters || []).flatMap((cluster) => {
        const start = Number(cluster?.start);
        const length = Number(cluster?.length);
        const coordinateSpace = cluster?.coordinateSpace;
        if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0) {
          return [];
        }
        if (coordinateSpace !== "mutable-index" &&
            coordinateSpace !== "byte-offset") {
          return [];
        }
        return [{
          start: Math.max(0, Math.floor(start)),
          length: Math.max(1, Math.ceil(length)),
          coordinateSpace
        }];
      });
    }

    function getVariantMutationClusters(name, variant) {
      if (name === "entropy") return variant?.entropyClusters || [];
      if (name === "mcu") return variant?.mcuClusters || [];
      if (name === "progressive") return variant?.progressiveClusters || [];
      if (name === "restart") return variant?.restartClusters || [];
      if (name === "component") return variant?.componentClusters || [];
      if (name === "coefficient") return variant?.coefficientClusters || [];
      return [];
    }

    function createJpegDifferenceData(
      referenceBytes,
      targetBytes,
      { maxStoredDifferences = MAX_STORED_JPEG_DIFFERENCES } = {}
    ) {
      const reference = referenceBytes || new Uint8Array(0);
      const target = targetBytes || new Uint8Array(0);
      const referenceLength = reference.length;
      const targetLength = target.length;
      const comparedLength = Math.max(referenceLength, targetLength);
      const storageLimit = Math.max(
        0,
        Math.floor(Number(maxStoredDifferences) || 0)
      );
      let changedCount = 0;
      let absoluteDeltaSum = 0;
      let squaredDeltaSum = 0;
      let maxAbsoluteDelta = 0;
      let firstChangedOffset = null;
      let lastChangedOffset = null;

      for (let offset = 0; offset < comparedLength; offset++) {
        const referenceValue = offset < referenceLength ? reference[offset] : 0;
        const targetValue = offset < targetLength ? target[offset] : 0;
        const delta = targetValue - referenceValue;
        if (delta === 0) continue;
        const absoluteDelta = Math.abs(delta);
        changedCount++;
        absoluteDeltaSum += absoluteDelta;
        squaredDeltaSum += delta * delta;
        maxAbsoluteDelta = Math.max(maxAbsoluteDelta, absoluteDelta);
        if (firstChangedOffset === null) firstChangedOffset = offset;
        lastChangedOffset = offset;
      }

      const storedCount = Math.min(changedCount, storageLimit);
      const truncated = changedCount > storedCount;
      const changedOffsets = new Uint32Array(storedCount);
      const referenceValues = new Uint8Array(storedCount);
      const targetValues = new Uint8Array(storedCount);
      const deltas = new Int16Array(storedCount);

      if (storedCount > 0) {
        let changedIndex = 0;
        let storedIndex = 0;
        let selectedChangeIndex = 0;
        for (
          let offset = 0;
          offset < comparedLength && storedIndex < storedCount;
          offset++
        ) {
          const referenceValue = offset < referenceLength ? reference[offset] : 0;
          const targetValue = offset < targetLength ? target[offset] : 0;
          const delta = targetValue - referenceValue;
          if (delta === 0) continue;
          if (changedIndex === selectedChangeIndex) {
            changedOffsets[storedIndex] = offset;
            referenceValues[storedIndex] = referenceValue;
            targetValues[storedIndex] = targetValue;
            deltas[storedIndex] = delta;
            storedIndex++;
            if (storedIndex < storedCount) {
              selectedChangeIndex = storedCount === 1
                ? 0
                : Math.floor(
                    storedIndex * (changedCount - 1) /
                    (storedCount - 1)
                  );
            }
          }
          changedIndex++;
        }
      }

      return Object.freeze({
        comparisonMode: "full-byte-stream",
        lengthAlignment: "zero-pad-tail",
        referenceLength,
        targetLength,
        comparedLength,
        changedCount,
        unchangedCount: comparedLength - changedCount,
        storedCount,
        truncated,
        samplingMode: truncated
          ? "uniform-changed-index"
          : "all-changed-bytes",
        changedOffsets,
        referenceValues,
        targetValues,
        deltas,
        maxAbsoluteDelta,
        meanAbsoluteDelta: comparedLength > 0
          ? absoluteDeltaSum / comparedLength
          : 0,
        rmsDelta: comparedLength > 0
          ? Math.sqrt(squaredDeltaSum / comparedLength)
          : 0,
        firstChangedOffset,
        lastChangedOffset
      });
    }

    function createFailureDifferenceEvent(
      failureEvent,
      referenceBytes,
      targetBytes
    ) {
      if (!failureEvent || !targetBytes) return null;
      return Object.freeze({
        sequence: failureEvent.sequence,
        buildKey: failureEvent.buildKey,
        family: failureEvent.family,
        stage: failureEvent.stage,
        frameAttempt: failureEvent.frameAttempt,
        attempt: failureEvent.attempt,
        retryLevel: failureEvent.retryLevel,
        differenceData: createJpegDifferenceData(
          referenceBytes,
          targetBytes
        )
      });
    }

    function recordFailureDifferenceEvent(
      failureEvent,
      targetBytes,
      context = {}
    ) {
      const eventLog = context.mutationEventLog;
      if (!eventLog || !failureEvent || !targetBytes) return null;
      const entry = createFailureDifferenceEvent(
        failureEvent,
        context.differenceReferenceBytes,
        targetBytes
      );
      if (!entry) return null;
      eventLog.failureDifferenceEvents.push(entry);
      return entry;
    }

    function createProcessDifferenceDataEntries(referenceBytes, states) {
      return states.map((state) => Object.freeze({
        stateKey: state.stateKey,
        differenceData: createJpegDifferenceData(
          referenceBytes,
          state.bytes
        )
      }));
    }

    function createTimelineAudioAnchors(timeline, states) {
      const totalDurationMs = timeline.reduce(
        (sum, point) => sum + Math.max(0, Number(point.holdMs) || 0),
        0
      );
      let elapsedMs = 0;
      return timeline.map((point, timelineIndex) => {
        const durationMs = Math.max(0, Number(point.holdMs) || 0);
        const startMs = elapsedMs;
        const endMs = startMs + durationMs;
        elapsedMs = endMs;
        return Object.freeze({
          occurrenceIndex: timelineIndex,
          timelineIndex,
          stateIndex: point.index,
          stateKey: Number.isInteger(point.index)
            ? states[point.index]?.stateKey || null
            : null,
          startMs,
          endMs,
          durationMs,
          startProgress: totalDurationMs > 0
            ? startMs / totalDurationMs
            : 0,
          endProgress: totalDurationMs > 0
            ? endMs / totalDurationMs
            : 1
        });
      });
    }

    function calculatePcmStatistics(samples) {
      let nonZeroSampleCount = 0;
      let peak = 0;
      let squaredSum = 0;
      for (let index = 0; index < samples.length; index++) {
        const sample = samples[index];
        if (!Number.isFinite(sample)) {
          throw new RangeError("PCM sample must be finite");
        }
        if (sample !== 0) nonZeroSampleCount++;
        peak = Math.max(peak, Math.abs(sample));
        squaredSum += sample * sample;
      }
      return {
        nonZeroSampleCount,
        peak,
        rms: samples.length > 0
          ? Math.sqrt(squaredSum / samples.length)
          : 0
      };
    }

    function applyLinearPcmEdgeFade(samples, requestedFadeSamples) {
      const fadeCount = Math.min(
        Math.max(0, Math.floor(Number(requestedFadeSamples) || 0)),
        Math.floor(samples.length / 2)
      );
      if (fadeCount <= 0) return fadeCount;
      for (let index = 0; index < fadeCount; index++) {
        const gain = fadeCount <= 1 ? 0 : index / (fadeCount - 1);
        samples[index] *= gain;
        const endIndex = samples.length - 1 - index;
        samples[endIndex] *= gain;
      }
      samples[0] = 0;
      samples[samples.length - 1] = 0;
      return fadeCount;
    }

    function createPcmDataFromJpegDifference(
      differenceData,
      sampleCount,
      {
        edgeFadeSamples = 0,
        targetPeak = JPEG_PCM_TARGET_PEAK,
        sampleRate = null
      } = {}
    ) {
      const normalizedSampleCount = Math.floor(Number(sampleCount));
      if (!Number.isFinite(normalizedSampleCount) || normalizedSampleCount <= 0) {
        throw new RangeError("PCM sampleCount must be greater than zero");
      }
      const normalizedTargetPeak = Number(targetPeak);
      if (!Number.isFinite(normalizedTargetPeak) ||
          normalizedTargetPeak < 0 || normalizedTargetPeak > 1) {
        throw new RangeError("PCM targetPeak must be within 0..1");
      }
      const sourceStoredCount = Math.max(
        0,
        Math.floor(Number(differenceData?.storedCount) || 0)
      );
      const changedOffsets = differenceData?.changedOffsets;
      const deltas = differenceData?.deltas;
      if (!changedOffsets || !deltas ||
          changedOffsets.length < sourceStoredCount ||
          deltas.length < sourceStoredCount) {
        throw new RangeError("DifferenceData sparse arrays are incomplete");
      }

      const samples = new Float32Array(normalizedSampleCount);
      const fadeCount = Math.min(
        Math.max(0, Math.floor(Number(edgeFadeSamples) || 0)),
        Math.floor(normalizedSampleCount / 2)
      );
      const sourceChangedCount = Math.max(
        0,
        Math.floor(Number(differenceData?.changedCount) || 0)
      );
      const createResult = ({
        occupiedSampleCount,
        collisionCount,
        dcOffsetBeforeRemoval,
        peakBeforeNormalization,
        normalizationGain,
        peakAfterNormalization
      }) => {
        const statistics = calculatePcmStatistics(samples);
        return Object.freeze({
          encoding: "float32-mono",
          sourceType: "jpeg-difference",
          sampleCount: normalizedSampleCount,
          sampleRate: Number.isFinite(Number(sampleRate))
            ? Number(sampleRate)
            : null,
          durationMs: Number.isFinite(Number(sampleRate)) && sampleRate > 0
            ? normalizedSampleCount / Number(sampleRate) * 1000
            : null,
          samples,
          mappingMode: "jpeg-offset-to-pcm-index",
          collisionMode: "signed-average",
          dcRemoval: true,
          normalizationMode: "peak",
          targetPeak: normalizedTargetPeak,
          edgeFadeSamples: fadeCount,
          sourceComparedLength: Math.max(
            0,
            Math.floor(Number(differenceData?.comparedLength) || 0)
          ),
          sourceChangedCount,
          sourceStoredCount,
          sourceTruncated: Boolean(differenceData?.truncated),
          sourceSamplingMode: differenceData?.samplingMode ||
            "all-changed-bytes",
          occupiedSampleCount,
          nonZeroSampleCount: statistics.nonZeroSampleCount,
          collisionCount,
          dcOffsetBeforeRemoval,
          peakBeforeNormalization,
          normalizationGain,
          peakAfterNormalization,
          finalPeak: statistics.peak,
          rms: statistics.rms,
          silent: statistics.nonZeroSampleCount === 0
        });
      };

      if (sourceChangedCount === 0 || sourceStoredCount === 0) {
        return createResult({
          occupiedSampleCount: 0,
          collisionCount: 0,
          dcOffsetBeforeRemoval: 0,
          peakBeforeNormalization: 0,
          normalizationGain: 1,
          peakAfterNormalization: 0
        });
      }

      const sums = new Float64Array(normalizedSampleCount);
      const counts = new Uint32Array(normalizedSampleCount);
      const comparedLength = Math.max(
        0,
        Math.floor(Number(differenceData?.comparedLength) || 0)
      );
      const hasSafeRange = fadeCount > 0 &&
        fadeCount <= normalizedSampleCount - fadeCount - 1;
      const minimumIndex = hasSafeRange ? fadeCount : 0;
      const maximumIndex = hasSafeRange
        ? normalizedSampleCount - fadeCount - 1
        : normalizedSampleCount - 1;
      let occupiedSampleCount = 0;
      let collisionCount = 0;

      for (let sourceIndex = 0; sourceIndex < sourceStoredCount; sourceIndex++) {
        const normalizedOffset = comparedLength > 1
          ? Math.min(1, changedOffsets[sourceIndex] / (comparedLength - 1))
          : 0;
        const targetIndex = minimumIndex + Math.round(
          normalizedOffset * (maximumIndex - minimumIndex)
        );
        if (counts[targetIndex] === 0) occupiedSampleCount++;
        else collisionCount++;
        sums[targetIndex] += deltas[sourceIndex] / 255;
        counts[targetIndex]++;
      }

      const workingSamples = new Float64Array(normalizedSampleCount);
      let sampleSum = 0;
      for (let index = 0; index < normalizedSampleCount; index++) {
        const sample = counts[index] > 0 ? sums[index] / counts[index] : 0;
        if (!Number.isFinite(sample)) {
          throw new RangeError("Mapped PCM sample must be finite");
        }
        workingSamples[index] = sample;
        sampleSum += sample;
      }
      const dcOffsetBeforeRemoval = sampleSum / normalizedSampleCount;
      let peakBeforeNormalization = 0;
      for (let index = 0; index < normalizedSampleCount; index++) {
        workingSamples[index] -= dcOffsetBeforeRemoval;
        peakBeforeNormalization = Math.max(
          peakBeforeNormalization,
          Math.abs(workingSamples[index])
        );
      }
      const normalizationGain = peakBeforeNormalization > 0
        ? normalizedTargetPeak / peakBeforeNormalization
        : 1;
      let peakAfterNormalization = 0;
      for (let index = 0; index < normalizedSampleCount; index++) {
        workingSamples[index] *= normalizationGain;
        peakAfterNormalization = Math.max(
          peakAfterNormalization,
          Math.abs(workingSamples[index])
        );
      }
      applyLinearPcmEdgeFade(workingSamples, fadeCount);
      for (let index = 0; index < normalizedSampleCount; index++) {
        if (!Number.isFinite(workingSamples[index])) {
          throw new RangeError("Final PCM sample must be finite");
        }
        samples[index] = workingSamples[index];
      }

      return createResult({
        occupiedSampleCount,
        collisionCount,
        dcOffsetBeforeRemoval,
        peakBeforeNormalization,
        normalizationGain,
        peakAfterNormalization
      });
    }

    function createProcessPcmDataEntries(
      processDifferenceEntries,
      timelineAudioAnchors = []
    ) {
      const durationByStateKey = new Map();
      for (const anchor of timelineAudioAnchors) {
        if (!anchor?.stateKey || durationByStateKey.has(anchor.stateKey)) {
          continue;
        }
        durationByStateKey.set(anchor.stateKey, anchor.durationMs);
      }
      return processDifferenceEntries.map((entry) => {
        const durationMs = durationByStateKey.get(entry.stateKey);
        const sampleCount = Number.isFinite(durationMs) && durationMs > 0
          ? Math.max(
              1,
              Math.round(
                PROCESS_PCM_SAMPLE_RATE * durationMs / 1000
              )
            )
          : PROCESS_PCM_SAMPLE_COUNT;
        return Object.freeze({
          stateKey: entry.stateKey,
          pcmData: createPcmDataFromJpegDifference(
            entry.differenceData,
            sampleCount,
            {
              sampleRate: PROCESS_PCM_SAMPLE_RATE
            }
          )
        });
      });
    }

    function createFailureEventIntegerValues(failureEvent) {
      const integer = (value, scale = 1) => {
        const numericValue = Number(value);
        return Number.isFinite(numericValue)
          ? Math.round(numericValue * scale)
          : 0;
      };
      return Object.freeze([
        failureEventFamilyIds[failureEvent?.family] ??
          failureEventFamilyIds.composite,
        failureEventStageIds[failureEvent?.stage] ??
          failureEventStageIds["final-frame"],
        failureEventCodeIds[failureEvent?.code] ??
          failureEventCodeIds["generation-failed"],
        integer(failureEvent?.retryLevel),
        integer(failureEvent?.attempt),
        integer(failureEvent?.sequence),
        integer(failureEvent?.changeBudget, 1000)
      ]);
    }

    function createFailureEventPcm(
      failureEvent,
      sampleCount = FAILURE_PCM_SAMPLE_COUNT
    ) {
      const normalizedSampleCount = Math.floor(Number(sampleCount));
      if (!Number.isFinite(normalizedSampleCount) || normalizedSampleCount <= 0) {
        throw new RangeError("PCM sampleCount must be greater than zero");
      }
      const integerValues = createFailureEventIntegerValues(failureEvent);
      const sourceBytes = new Uint8Array(integerValues.length * 2);
      for (let index = 0; index < integerValues.length; index++) {
        const unsignedWord = (
          (integerValues[index] % 0x10000) + 0x10000
        ) % 0x10000;
        sourceBytes[index * 2] = unsignedWord >>> 8;
        sourceBytes[index * 2 + 1] = unsignedWord & 0xFF;
      }

      const workingSamples = new Float64Array(normalizedSampleCount);
      let sampleSum = 0;
      for (let index = 0; index < normalizedSampleCount; index++) {
        const byteValue = sourceBytes[index % sourceBytes.length];
        const signedValue = byteValue >= 0x80
          ? byteValue - 0x100
          : byteValue;
        const sample = signedValue / 0x80;
        workingSamples[index] = sample;
        sampleSum += sample;
      }

      const dcOffsetBeforeRemoval = sampleSum / normalizedSampleCount;
      let peakBeforeNormalization = 0;
      for (let index = 0; index < normalizedSampleCount; index++) {
        workingSamples[index] -= dcOffsetBeforeRemoval;
        peakBeforeNormalization = Math.max(
          peakBeforeNormalization,
          Math.abs(workingSamples[index])
        );
      }
      const normalizationGain = peakBeforeNormalization > 0
        ? JPEG_PCM_TARGET_PEAK / peakBeforeNormalization
        : 1;
      const samples = new Float32Array(normalizedSampleCount);
      for (let index = 0; index < normalizedSampleCount; index++) {
        samples[index] = workingSamples[index] * normalizationGain;
      }
      const statistics = calculatePcmStatistics(samples);
      return Object.freeze({
        encoding: "float32-mono",
        sourceType: "failure-event",
        sampleCount: normalizedSampleCount,
        samples,
        mappingMode: "failure-event-int16-byte-cycle",
        dcRemoval: true,
        normalizationMode: "peak",
        targetPeak: JPEG_PCM_TARGET_PEAK,
        edgeFadeSamples: 0,
        sourceIntegerCount: integerValues.length,
        sourceByteCount: sourceBytes.length,
        dcOffsetBeforeRemoval,
        peakBeforeNormalization,
        normalizationGain,
        finalPeak: statistics.peak,
        rms: statistics.rms,
        nonZeroSampleCount: statistics.nonZeroSampleCount,
        silent: statistics.nonZeroSampleCount === 0
      });
    }

    function createFailurePcmEvents(failureEvents) {
      return (failureEvents || []).map((failureEvent) => Object.freeze({
        sequence: failureEvent.sequence,
        buildKey: failureEvent.buildKey,
        family: failureEvent.family,
        stage: failureEvent.stage,
        frameAttempt: failureEvent.frameAttempt,
        attempt: failureEvent.attempt,
        retryLevel: failureEvent.retryLevel,
        pcmData: createFailureEventPcm(failureEvent)
      }));
    }

    function selectUniformFailureAudioEvents(events, maximumCount) {
      const outputCount = Math.min(events.length, maximumCount);
      if (outputCount === events.length) return events.slice();
      return Array.from({ length: outputCount }, (_, outputIndex) => {
        const selectedIndex = outputCount === 1
          ? 0
          : Math.floor(
              outputIndex * (events.length - 1) / (outputCount - 1)
            );
        return events[selectedIndex];
      });
    }

    function findTimelineAnchorAtTime(anchors, scheduledMs) {
      if (!Number.isFinite(scheduledMs)) return null;
      return anchors.find((anchor, index) =>
        scheduledMs >= anchor.startMs &&
        (scheduledMs < anchor.endMs ||
          (index === anchors.length - 1 && scheduledMs <= anchor.endMs))
      ) || null;
    }

    function createFailureAudioEventPlan({
      failurePcmEvents = [],
      mutationEvents = [],
      mutationBuilds = [],
      mutationBuildStateMap = [],
      timelineAudioAnchors = [],
      registryGeneration = null
    } = {}) {
      const failures = mutationEvents
        .filter((event) => event?.kind === "failure")
        .slice()
        .sort((left, right) =>
          (Number(left.sequence) || 0) - (Number(right.sequence) || 0)
        );
      const selectedFailures = selectUniformFailureAudioEvents(
        failures,
        MAX_FAILURE_AUDIO_EVENTS_PER_TRANSITION
      );
      const eventSequenceCounts = new Map();
      for (const failure of failures) {
        const sequence = Math.max(0, Number(failure.sequence) || 0);
        eventSequenceCounts.set(
          sequence,
          (eventSequenceCounts.get(sequence) || 0) + 1
        );
      }
      const pcmSequenceEntries = new Map();
      for (let index = 0; index < failurePcmEvents.length; index++) {
        const pcmEvent = failurePcmEvents[index];
        const sequence = Math.max(0, Number(pcmEvent?.sequence) || 0);
        const entries = pcmSequenceEntries.get(sequence) || [];
        entries.push({ pcmEvent, index });
        pcmSequenceEntries.set(sequence, entries);
      }
      const buildsByKey = new Map(
        mutationBuilds.map((build) => [build.buildKey, build])
      );
      const stateByBuildKey = new Map(
        mutationBuildStateMap.map((entry) => [entry.buildKey, entry.stateKey])
      );
      const firstAnchorByStateKey = new Map();
      for (const anchor of timelineAudioAnchors) {
        if (anchor?.stateKey && !firstAnchorByStateKey.has(anchor.stateKey)) {
          firstAnchorByStateKey.set(anchor.stateKey, anchor);
        }
      }
      const totalDurationMs = timelineAudioAnchors.reduce(
        (maximum, anchor) => Math.max(maximum, Number(anchor?.endMs) || 0),
        0
      );
      const hasTimeline = timelineAudioAnchors.length > 0 &&
        totalDurationMs > 0;
      const selectedTechniqueNames =
        registryGeneration?.selectedTechniqueNames || [];

      const workingEvents = selectedFailures.map((failure) => {
        const failureSequence = Math.max(0, Number(failure.sequence) || 0);
        const pcmMatches = pcmSequenceEntries.get(failureSequence) || [];
        const pcmMatch = pcmMatches.length === 1 &&
          eventSequenceCounts.get(failureSequence) === 1
          ? pcmMatches[0]
          : null;
        const pcmData = pcmMatch?.pcmEvent?.pcmData;
        const hasAudiblePcm = Boolean(
          pcmData && !pcmData.silent && pcmData.samples?.length > 0
        );
        const build = failure.buildKey
          ? buildsByKey.get(failure.buildKey)
          : null;
        const mappedStateKey = failure.buildKey
          ? stateByBuildKey.get(failure.buildKey) || null
          : null;
        const mappingIsCommitted = Boolean(
          build && build.result === "committed" &&
          build.stateKey === mappedStateKey
        );
        const mappedAnchor = mappingIsCommitted
          ? firstAnchorByStateKey.get(mappedStateKey) || null
          : null;
        const mapped = Boolean(mappedAnchor);
        let scheduledMs = null;
        let offsetWithinStateMs = null;
        if (mapped) {
          const attemptValue = Math.max(0, Number(failure.attempt) || 0);
          const retryValue = Math.max(0, Number(failure.retryLevel) || 0);
          const placementUnit = (
            failureSequence * 17 + attemptValue * 7 + retryValue * 13
          ) % 1000;
          const placementRatio = 0.15 + (placementUnit / 999) * 0.70;
          offsetWithinStateMs = mappedAnchor.durationMs * placementRatio;
          scheduledMs = mappedAnchor.startMs + offsetWithinStateMs;
        }
        return {
          failureSequence,
          buildKey: failure.buildKey || null,
          stateKey: mapped ? mappedStateKey : null,
          family: failure.family || "composite",
          stage: failure.stage || "final-frame",
          frameAttempt: Math.max(1, Number(failure.frameAttempt) || 1),
          attempt: Math.max(1, Number(failure.attempt) || 1),
          retryLevel: Math.max(0, Number(failure.retryLevel) || 0),
          placementMode: mapped
            ? "mapped-state-deterministic-offset"
            : "unmapped-sequence-distribution",
          targetOccurrenceIndex: mapped
            ? mappedAnchor.occurrenceIndex
            : null,
          targetTimelineIndex: mapped ? mappedAnchor.timelineIndex : null,
          stateStartMs: mapped ? mappedAnchor.startMs : null,
          stateEndMs: mapped ? mappedAnchor.endMs : null,
          offsetWithinStateMs,
          scheduledMs,
          scheduledProgress: null,
          pcmEventIndex: pcmMatch?.index ?? null,
          audible: hasTimeline && hasAudiblePcm,
          spacingAdjusted: false,
          mapped
        };
      });

      if (hasTimeline && selectedTechniqueNames.length > 0) {
        for (const event of workingEvents) {
          const slotIndex = selectedTechniqueNames.indexOf(event.family);
          if (slotIndex < 0) continue;
          const scheduledMs = totalDurationMs *
            slotIndex / selectedTechniqueNames.length;
          const anchor = findTimelineAnchorAtTime(
            timelineAudioAnchors,
            scheduledMs
          );
          if (!anchor) continue;
          event.placementMode = "registry-technique-slot";
          event.stateKey = anchor.stateKey || null;
          event.targetOccurrenceIndex = anchor.occurrenceIndex;
          event.targetTimelineIndex = anchor.timelineIndex;
          event.stateStartMs = anchor.startMs;
          event.stateEndMs = anchor.endMs;
          event.offsetWithinStateMs = scheduledMs - anchor.startMs;
          event.scheduledMs = scheduledMs;
        }
      }

      const unmapped = workingEvents.filter(
        (event) => !Number.isFinite(event.scheduledMs)
      );
      const minimumTimeMs = Math.min(10, totalDurationMs);
      const maximumTimeMs = Math.min(
        totalDurationMs,
        Math.max(minimumTimeMs, totalDurationMs - 10)
      );
      for (let index = 0; index < unmapped.length; index++) {
        const event = unmapped[index];
        if (!hasTimeline) {
          event.audible = false;
          continue;
        }
        const fallbackProgress = (index + 1) / (unmapped.length + 1);
        const scheduledMs = Math.max(
          minimumTimeMs,
          Math.min(maximumTimeMs, totalDurationMs * fallbackProgress)
        );
        const anchor = findTimelineAnchorAtTime(
          timelineAudioAnchors,
          scheduledMs
        );
        if (!anchor) {
          event.audible = false;
          continue;
        }
        event.stateKey = anchor.stateKey || null;
        event.targetOccurrenceIndex = anchor.occurrenceIndex;
        event.targetTimelineIndex = anchor.timelineIndex;
        event.stateStartMs = anchor.startMs;
        event.stateEndMs = anchor.endMs;
        event.offsetWithinStateMs = scheduledMs - anchor.startMs;
        event.scheduledMs = scheduledMs;
      }

      workingEvents.sort((left, right) => {
        const leftTime = Number.isFinite(left.scheduledMs)
          ? left.scheduledMs
          : Infinity;
        const rightTime = Number.isFinite(right.scheduledMs)
          ? right.scheduledMs
          : Infinity;
        return leftTime - rightTime ||
          left.failureSequence - right.failureSequence;
      });
      let previousScheduledMs = -Infinity;
      for (const event of workingEvents) {
        if (!Number.isFinite(event.scheduledMs) || !hasTimeline) {
          event.audible = false;
          continue;
        }
        const spacedMs = Math.min(
          maximumTimeMs,
          Math.max(
            event.scheduledMs,
            previousScheduledMs + FAILURE_SOUND_MIN_SPACING_MS
          )
        );
        event.spacingAdjusted = spacedMs !== event.scheduledMs;
        event.scheduledMs = spacedMs;
        event.scheduledProgress = spacedMs / totalDurationMs;
        previousScheduledMs = spacedMs;
        const finalAnchor = findTimelineAnchorAtTime(
          timelineAudioAnchors,
          spacedMs
        );
        if (!Number.isFinite(spacedMs) || !finalAnchor) {
          event.audible = false;
          continue;
        }
        event.stateKey = finalAnchor.stateKey || null;
        event.targetOccurrenceIndex = finalAnchor.occurrenceIndex;
        event.targetTimelineIndex = finalAnchor.timelineIndex;
        event.stateStartMs = finalAnchor.startMs;
        event.stateEndMs = finalAnchor.endMs;
        event.offsetWithinStateMs = spacedMs - finalAnchor.startMs;
      }
      workingEvents.sort((left, right) => {
        const leftTime = Number.isFinite(left.scheduledMs)
          ? left.scheduledMs
          : Infinity;
        const rightTime = Number.isFinite(right.scheduledMs)
          ? right.scheduledMs
          : Infinity;
        return leftTime - rightTime ||
          left.failureSequence - right.failureSequence;
      });

      const events = workingEvents.map(({ mapped, ...event }) => event);
      const audibleCandidateCount = failures.filter((failure) => {
        const sequence = Math.max(0, Number(failure.sequence) || 0);
        const matches = pcmSequenceEntries.get(sequence) || [];
        const pcmData = matches.length === 1 ? matches[0].pcmEvent.pcmData : null;
        return eventSequenceCounts.get(sequence) === 1 &&
          pcmData && !pcmData.silent && pcmData.samples?.length > 0;
      }).length;
      return {
        events,
        summary: {
          sourceCount: failures.length,
          audibleCandidateCount,
          storedCount: events.length,
          truncated: failures.length > events.length,
          samplingMode: failures.length > events.length
            ? "uniform-failure-index"
            : "all-failures"
        }
      };
    }

    function recordMutationEvent(event, context = {}) {
      const eventLog = context.mutationEventLog;
      if (!eventLog) return null;
      const normalized = {
        sequence: eventLog.nextSequence++,
        kind: "mutation",
        result: "decoded",
        family: layerNames.includes(event?.family)
          ? event.family
          : "composite",
        stage: event?.stage === "transition-state"
          ? "transition-state"
          : "final-frame",
        buildKey: event?.buildKey || context.buildKey || null,
        stateKey: null,
        frameAttempt: Math.max(
          1,
          Math.floor(Number(event?.frameAttempt) || 1)
        ),
        attempt: Math.max(1, Math.floor(Number(event?.attempt) || 1)),
        retryLevel: Math.max(
          0,
          Math.floor(Number(event?.retryLevel) || 0)
        ),
        seed: Number.isFinite(event?.seed) ? event.seed : 0,
        changeBudget: Math.max(0, Number(event?.changeBudget) || 0),
        initialChangeBudget: Math.max(
          0,
          Number(event?.initialChangeBudget) || 0
        ),
        clusters: normalizeMutationEventClusters(event?.clusters),
        region: event?.region || "full",
        byteLength: Number.isFinite(event?.byteLength)
          ? Math.max(0, Math.floor(event.byteLength))
          : null,
        code: null
      };
      eventLog.events.push(normalized);
      return normalized;
    }

    function snapshotMutationBuilds(eventLog) {
      return eventLog.builds.map((build) => ({ ...build }));
    }

    function snapshotMutationBuildStateMap(eventLog) {
      return [...eventLog.buildStateMap].map(([buildKey, stateKey]) => ({
        buildKey,
        stateKey
      }));
    }

    function createFailureState(structure) {
      const mutableByteCount = Math.max(
        0,
        Math.floor(Number(structure?.mutableIndices?.length) || 0)
      );
      const scanBinCount = getFailureScanBinCount(mutableByteCount);
      return {
        scanResidue: new Float32Array(scanBinCount),
        scanBinCount,
        mutableByteCount,
        stats: {
          scanSum: 0,
          scanMean: 0,
          scanMax: 0
        },
        pressures: {
          dqt: 0,
          dht: 0,
          sof: 0,
          sos: 0,
          global: 0
        }
      };
    }

    function createGenerationCancelledError(message = "generation cancelled") {
      const error = new Error(message);
      error.name = "AbortError";
      error.code = "GENERATION_CANCELLED";
      return error;
    }

    function isGenerationCancellation(error) {
      return error?.name === "AbortError" || error?.code === "GENERATION_CANCELLED";
    }

    function groupMutablePositionsIntoClusters(positions) {
      const sorted = [...new Set(positions)]
        .filter((position) => Number.isFinite(position) && position >= 0)
        .map((position) => Math.floor(position))
        .sort((a, b) => a - b);
      const clusters = [];
      for (const position of sorted) {
        const previous = clusters[clusters.length - 1];
        if (previous && previous.start + previous.length === position) {
          previous.length++;
        } else {
          clusters.push({
            start: position,
            length: 1,
            coordinateSpace: "mutable-index"
          });
        }
      }
      return clusters;
    }

    function projectMutableRangeToBins(
      fromMutableIndex,
      toMutableIndex,
      mutableByteCount,
      binCount
    ) {
      if (mutableByteCount <= 0 || binCount <= 0) return null;
      const from = Math.max(0, Math.min(
        mutableByteCount,
        Math.floor(Number(fromMutableIndex) || 0)
      ));
      const to = Math.max(from, Math.min(
        mutableByteCount,
        Math.ceil(Number(toMutableIndex) || 0)
      ));
      if (to <= from) return null;
      const fromBin = Math.min(
        binCount - 1,
        Math.floor((from / mutableByteCount) * binCount)
      );
      const toBin = Math.max(
        fromBin + 1,
        Math.min(binCount, Math.ceil((to / mutableByteCount) * binCount))
      );
      return { fromBin, toBin };
    }

    function projectFailureClusterToBins(cluster, structure, state) {
      if (!cluster || !structure || !state) return null;
      let fromMutableIndex;
      let toMutableIndex;
      if (cluster.coordinateSpace === "mutable-index") {
        fromMutableIndex = Math.floor(cluster.start);
        toMutableIndex = Math.ceil(cluster.start + cluster.length);
      } else if (cluster.coordinateSpace === "byte-offset") {
        fromMutableIndex = absoluteToMutableIndex(
          structure.mutableIndices,
          cluster.start
        );
        toMutableIndex = absoluteToMutableIndex(
          structure.mutableIndices,
          cluster.start + cluster.length
        );
      } else {
        return null;
      }
      return projectMutableRangeToBins(
        fromMutableIndex,
        toMutableIndex,
        state.mutableByteCount,
        state.scanBinCount
      );
    }

    function mergeFailureBinRanges(ranges) {
      const sorted = ranges
        .filter(Boolean)
        .sort((a, b) => a.fromBin - b.fromBin || a.toBin - b.toBin);
      const merged = [];
      for (const range of sorted) {
        const previous = merged[merged.length - 1];
        if (previous && range.fromBin <= previous.toBin) {
          previous.toBin = Math.max(previous.toBin, range.toBin);
        } else {
          merged.push({ ...range });
        }
      }
      return merged;
    }

    function projectFailureRegionToBins(region, state) {
      if (!state) return null;
      const mutableRange = regionToRange(region, state.mutableByteCount);
      return projectMutableRangeToBins(
        mutableRange.from,
        mutableRange.to,
        state.mutableByteCount,
        state.scanBinCount
      );
    }

    function getFailureWeight(structure, changeBudget) {
      const entropyBytes = Math.max(1, Number(structure?.entropyBytes) || 1);
      const budget = Math.max(0, Number(changeBudget) || 0);
      const budgetLoad = clamp01(
        Math.log1p(budget) / Math.log1p(entropyBytes)
      );
      return 0.08 * budgetLoad;
    }

    function saturatingAdd(current, weight) {
      const safeCurrent = Number.isFinite(current) ? clamp01(current) : 0;
      const safeWeight = Number.isFinite(weight) ? clamp01(weight) : 0;
      return clamp01(safeCurrent + (1 - safeCurrent) * safeWeight);
    }

    function addFailureToScanRange(state, range, weight) {
      if (!state?.scanResidue || !range || weight <= 0) return;
      const from = Math.max(0, Math.floor(range.fromBin));
      const to = Math.min(state.scanBinCount, Math.ceil(range.toBin));
      let scanSum = Number.isFinite(state.stats.scanSum)
        ? state.stats.scanSum
        : 0;
      let scanMax = Number.isFinite(state.stats.scanMax)
        ? clamp01(state.stats.scanMax)
        : 0;
      for (let index = from; index < to; index++) {
        const previous = Number.isFinite(state.scanResidue[index])
          ? clamp01(state.scanResidue[index])
          : 0;
        state.scanResidue[index] = saturatingAdd(previous, weight);
        const next = state.scanResidue[index];
        scanSum += next - previous;
        scanMax = Math.max(scanMax, next);
      }
      state.stats.scanSum = Math.max(0, Math.min(state.scanBinCount, scanSum));
      state.stats.scanMean = state.scanBinCount > 0
        ? clamp01(state.stats.scanSum / state.scanBinCount)
        : 0;
      state.stats.scanMax = scanMax;
    }

    function addFailurePressure(state, family, weight) {
      if (!state?.pressures || !(family in state.pressures)) return;
      state.pressures[family] = saturatingAdd(state.pressures[family], weight);
    }

    function applyFailureEventToState(state, structure, event) {
      if (!state || !structure || !event) return;
      const weight = getFailureWeight(structure, event.changeBudget);
      const structuralFamilies = new Set(["dqt", "dht", "sof", "sos"]);
      if (structuralFamilies.has(event.family)) {
        addFailurePressure(state, event.family, weight);
        return;
      }

      const clusterRanges = mergeFailureBinRanges(
        (event.clusters || []).map((cluster) =>
          projectFailureClusterToBins(cluster, structure, state)
        )
      );
      if (clusterRanges.length > 0) {
        for (const range of clusterRanges) {
          addFailureToScanRange(state, range, weight);
        }
        return;
      }

      if (event.family === "composite") {
        addFailurePressure(state, "global", weight);
        return;
      }

      const regionRange = projectFailureRegionToBins(event.region || "full", state);
      addFailureToScanRange(state, regionRange, weight);
    }

    function recordFailureEvent(event, context = {}) {
      const error = event?.error;
      const allowedFamilies = new Set([...layerNames, "composite"]);
      const eventLog = context.mutationEventLog;
      const clusters = normalizeMutationEventClusters(event?.clusters);
      const normalized = {
        sequence: eventLog ? eventLog.nextSequence++ : null,
        kind: "failure",
        result: "rejected",
        family: allowedFamilies.has(event?.family) ? event.family : "composite",
        stage: event?.stage === "transition-state" ? "transition-state" : "final-frame",
        buildKey: event?.buildKey || context.buildKey || null,
        stateKey: null,
        frameAttempt: Math.max(
          1,
          Math.floor(Number(event?.frameAttempt) || 1)
        ),
        attempt: Math.max(1, Math.floor(Number(event?.attempt) || 1)),
        retryLevel: Math.max(0, Math.floor(Number(event?.retryLevel) || 0)),
        seed: Number.isFinite(event?.seed) ? event.seed : 0,
        changeBudget: Math.max(0, Number(event?.changeBudget) || 0),
        initialChangeBudget: Math.max(
          0,
          Number(event?.initialChangeBudget ?? context.initialChangeBudget) || 0
        ),
        clusters,
        region: event?.region || "full",
        byteLength: Number.isFinite(event?.byteLength)
          ? Math.max(0, Math.floor(event.byteLength))
          : null,
        reason: String(event?.reason || error?.message || "unknown failure"),
        code: String(event?.code || error?.code || "generation-failed")
      };

      const events = context.failureEvents || currentFailureEvents;
      events.push(normalized);
      if (eventLog) eventLog.events.push(normalized);
      context.latestReason = normalized.reason;
      if (event?.applyResidue !== false) {
        applyFailureEventToState(
          context.failureState ?? failureState,
          context.structure ?? sourceStructure,
          normalized
        );
      }
      return normalized;
    }

    function dispatchFailureEvent(event, options = {}) {
      const error = event?.error;
      if (options.shouldContinue && !options.shouldContinue()) return null;
      if (error?.isMutationNoOp || event?.code === "MUTATION_NO_OP") return null;
      if (isGenerationCancellation(error) || event?.code === "GENERATION_CANCELLED") {
        return null;
      }
      if (error && typeof error === "object") {
        if (recordedFailureEventsByError.has(error)) {
          return recordedFailureEventsByError.get(error);
        }
        if (error.failureEventRecorded) return error.failureEvent || null;
      }
      const contextualEvent = {
        ...event,
        buildKey: event?.buildKey || options.buildKey || null,
        frameAttempt: event?.frameAttempt || options.frameAttempt || 1
      };
      const normalized = options.onFailureEvent
        ? options.onFailureEvent(contextualEvent)
        : recordFailureEvent(contextualEvent, {
          failureEvents: options.failureEvents || currentFailureEvents,
          failureState: options.failureState ?? failureState,
          structure: options.structure ?? sourceStructure,
          initialChangeBudget: options.initialChangeBudget,
          mutationEventLog: options.mutationEventLog,
          buildKey: options.buildKey
        });
      if (normalized && error && typeof error === "object") {
        recordedFailureEventsByError.set(error, normalized);
        error.failureEventRecorded = true;
        error.failureEvent = normalized;
      }
      return normalized;
    }

    function decayFailureState(state, rate = 0.965) {
      if (!state?.scanResidue) return;
      const decayRate = clamp01(Number.isFinite(rate) ? rate : 0.965);
      let scanSum = 0;
      let scanMax = 0;
      for (let index = 0; index < state.scanResidue.length; index++) {
        const current = Number.isFinite(state.scanResidue[index])
          ? clamp01(state.scanResidue[index])
          : 0;
        state.scanResidue[index] = clamp01(current * decayRate);
        const next = state.scanResidue[index];
        scanSum += next;
        scanMax = Math.max(scanMax, next);
      }
      state.stats.scanSum = Math.max(0, Math.min(state.scanBinCount, scanSum));
      state.stats.scanMean = state.scanBinCount > 0
        ? clamp01(state.stats.scanSum / state.scanBinCount)
        : 0;
      state.stats.scanMax = scanMax;
      for (const family of Object.keys(state.pressures)) {
        const current = Number.isFinite(state.pressures[family])
          ? clamp01(state.pressures[family])
          : 0;
        state.pressures[family] = clamp01(current * decayRate);
      }
    }

    function getFailureInfluence(
      currentFailureState,
      { family, stage = "final-frame", localResidue } = {}
    ) {
      if (!currentFailureState) return 0;
      if (family === "scan") {
        const residue = localResidue ?? currentFailureState.stats?.scanMean ?? 0;
        return Number.isFinite(residue) ? clamp01(residue) : 0;
      }

      const pressureCaps = {
        dqt: 0.08,
        dht: 0.08,
        sof: 0.08,
        sos: 0.08,
        global: 0.04
      };
      if (!(family in pressureCaps)) return 0;
      if (family === "sos" && stage !== "transition-state") return 0;
      if ((family === "dqt" || family === "dht" || family === "sof") &&
          stage !== "final-frame") return 0;
      const pressure = currentFailureState.pressures?.[family];
      return clamp01(Number.isFinite(pressure) ? pressure : 0) * pressureCaps[family];
    }

    function findJpegSegments(bytes) {
      const segments = [];
      let pos = 2;
      while (pos < bytes.length) {
        while (pos < bytes.length && bytes[pos] !== 0xFF) pos++;
        if (pos >= bytes.length) break;
        while (pos < bytes.length && bytes[pos] === 0xFF) pos++;
        if (pos >= bytes.length) break;
        const marker = bytes[pos++];
        if (marker === 0xD9) break;
        if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
        if (pos + 1 >= bytes.length) break;
        const length = (bytes[pos] << 8) | bytes[pos + 1];
        if (length < 2 || pos + length > bytes.length) break;
        const markerOffset = pos - 1;
        const payloadStart = pos + 2;
        const payloadEnd = pos + length;
        const segment = {
          marker,
          markerOffset,
          segmentLength: length,
          payloadStart,
          payloadEnd,
          scanDataStart: null,
          scanDataEnd: null
        };
        segments.push(segment);
        pos = payloadEnd;

        if (marker === 0xDA) {
          segment.scanDataStart = payloadEnd;
          while (pos < bytes.length - 1) {
            if (bytes[pos] !== 0xFF) {
              pos++;
              continue;
            }
            let next = pos + 1;
            while (next < bytes.length && bytes[next] === 0xFF) next++;
            const code = bytes[next];
            if (code === 0x00 || (code >= 0xD0 && code <= 0xD7)) {
              pos = next + 1;
              continue;
            }
            break;
          }
          segment.scanDataEnd = pos;
        }
      }
      return segments;
    }

    const JPEG_FRAME_MARKERS = new Set([
      0xC0, 0xC1, 0xC2, 0xC3,
      0xC5, 0xC6, 0xC7,
      0xC9, 0xCA, 0xCB,
      0xCD, 0xCE, 0xCF
    ]);
    const JPEG_SOF0_MARKER = 0xC0;
    const JPEG_SOF2_MARKER = 0xC2;
    const JPEG_APP0_MARKER = 0xE0;
    const JFIF_IDENTIFIER = Object.freeze([0x4A, 0x46, 0x49, 0x46, 0x00]);
    const JPEG_DRI_MARKER = 0xDD;
    const JPEG_RST_FIRST_MARKER = 0xD0;
    const JPEG_RST_LAST_MARKER = 0xD7;
    const JPEG_RESTART_MARKER_COUNT =
      JPEG_RST_LAST_MARKER - JPEG_RST_FIRST_MARKER + 1;
    const JPEG_DCT_BLOCK_SIZE = 8;
    const JPEG_DCT_COEFFICIENT_COUNT =
      JPEG_DCT_BLOCK_SIZE * JPEG_DCT_BLOCK_SIZE;
    const JPEG_DC_COEFFICIENT_INDEX = 0;
    const JPEG_FIRST_AC_COEFFICIENT_INDEX = 1;
    const JPEG_LAST_AC_COEFFICIENT_INDEX =
      JPEG_DCT_COEFFICIENT_COUNT - 1;
    const JPEG_PROGRESSIVE_MAX_SUCCESSIVE_APPROXIMATION = 13;
    const JPEG_MARKER_PREFIX = 0xFF;
    const JPEG_EOI_MARKER = 0xD9;
    const JPEG_LOSSLESS_FRAME_MARKERS = new Set([0xC3, 0xC7, 0xCB, 0xCF]);

    function parseJpegFrame(bytes, segment) {
      if (!segment || segment.payloadStart + 6 > segment.payloadEnd) return null;
      const precision = bytes[segment.payloadStart];
      const height = (bytes[segment.payloadStart + 1] << 8) |
        bytes[segment.payloadStart + 2];
      const width = (bytes[segment.payloadStart + 3] << 8) |
        bytes[segment.payloadStart + 4];
      const componentCount = bytes[segment.payloadStart + 5];
      const componentsEnd = segment.payloadStart + 6 + componentCount * 3;
      if (componentCount < 1 || componentsEnd > segment.payloadEnd) return null;
      const components = Array.from({ length: componentCount }, (_, index) => {
        const componentOffset = segment.payloadStart + 6 + index * 3;
        const sampling = bytes[componentOffset + 1];
        return {
          id: bytes[componentOffset],
          h: sampling >>> 4,
          v: sampling & 0x0F,
          tq: bytes[componentOffset + 2],
          samplingOffset: componentOffset + 1,
          tqOffset: componentOffset + 2
        };
      });
      const hMax = Math.max(1, ...components.map((component) => component.h));
      const vMax = Math.max(1, ...components.map((component) => component.v));
      return {
        marker: segment.marker,
        markerOffset: segment.markerOffset,
        processClass: JPEG_LOSSLESS_FRAME_MARKERS.has(segment.marker)
          ? "lossless"
          : "dct",
        precision,
        width,
        height,
        components,
        hMax,
        vMax,
        segment
      };
    }

    function parseJpegScan(bytes, segment) {
      if (!segment || segment.payloadStart >= segment.payloadEnd) return null;
      const componentCount = bytes[segment.payloadStart];
      const componentsEnd = segment.payloadStart + 1 + componentCount * 2;
      if (componentCount < 1 || componentsEnd + 3 > segment.payloadEnd) return null;
      const components = Array.from({ length: componentCount }, (_, index) => {
        const componentOffset = segment.payloadStart + 1 + index * 2;
        return {
          id: bytes[componentOffset],
          tableSelector: bytes[componentOffset + 1],
          dcTableId: bytes[componentOffset + 1] >>> 4,
          acTableId: bytes[componentOffset + 1] & 0x0F,
          selectorOffset: componentOffset + 1
        };
      });
      const successiveApproximation = bytes[componentsEnd + 2];
      return {
        offset: segment.markerOffset,
        headerEnd: segment.payloadEnd,
        entropyStart: segment.scanDataStart ?? segment.payloadEnd,
        endOffset: segment.scanDataEnd ?? segment.payloadEnd,
        componentIds: components.map((component) => component.id),
        components,
        spectralStart: bytes[componentsEnd],
        spectralEnd: bytes[componentsEnd + 1],
        successiveApproximation,
        successiveHigh: successiveApproximation >>> 4,
        successiveLow: successiveApproximation & 0x0F,
        segment
      };
    }

    function parseJfifDescriptor(bytes, structure) {
      const firstSegmentAfterSoi = (structure?.segments || []).find(
        (segment) => segment.markerOffset >= 2
      );
      if (
        !firstSegmentAfterSoi ||
        firstSegmentAfterSoi.marker !== JPEG_APP0_MARKER
      ) {
        return {
          present: false,
          conformingPlacement: false,
          identifierMatches: false,
          componentRolesById: null
        };
      }
      const payloadStart = firstSegmentAfterSoi.payloadStart;
      const identifierMatches =
        payloadStart + JFIF_IDENTIFIER.length <= firstSegmentAfterSoi.payloadEnd &&
        JFIF_IDENTIFIER.every(
          (value, index) => bytes[payloadStart + index] === value
        );
      if (!identifierMatches) {
        return {
          present: false,
          conformingPlacement: true,
          identifierMatches: false,
          componentRolesById: null
        };
      }
      const frame = structure.frames?.length === 1
        ? structure.frames[0]
        : null;
      const ids = frame?.components?.map((component) => component.id) || [];
      const isThreeComponentJfif =
        ids.length === 3 && ids[0] === 1 && ids[1] === 2 && ids[2] === 3;
      return {
        present: true,
        conformingPlacement: true,
        identifierMatches: true,
        versionMajor: bytes[payloadStart + 5],
        versionMinor: bytes[payloadStart + 6],
        componentRolesById: isThreeComponentJfif
          ? new Map([[1, "Y"], [2, "Cb"], [3, "Cr"]])
          : null
      };
    }

    function parseJpegQuantTableTimeline(bytes, segments) {
      const definitions = [];
      for (const segment of segments) {
        if (segment.marker !== 0xDB) continue;
        let position = segment.payloadStart;
        while (position < segment.payloadEnd) {
          const definitionOffset = position;
          const descriptor = bytes[position++];
          const precision = descriptor >>> 4;
          const id = descriptor & 0x0F;
          if ((precision !== 0 && precision !== 1) || id > 3) break;
          const byteLength = 64 * (precision === 0 ? 1 : 2);
          if (position + byteLength > segment.payloadEnd) break;
          const tableEnd = position + byteLength;
          const values = [];
          for (let index = 0; index < JPEG_DCT_COEFFICIENT_COUNT; index++) {
            if (precision === 0) {
              values.push(bytes[position + index]);
            } else {
              const valueOffset = position + index * 2;
              values.push(
                (bytes[valueOffset] << 8) |
                bytes[valueOffset + 1]
              );
            }
          }
          definitions.push({
            id,
            precision,
            definitionOffset,
            values,
            tableEnd,
            segmentEnd: segment.payloadEnd
          });
          position = tableEnd;
        }
      }
      return definitions;
    }

    function parseJpegHuffmanTableTimeline(bytes, segments) {
      const definitions = [];
      for (const segment of segments) {
        if (segment.marker !== 0xC4) continue;
        let position = segment.payloadStart;
        while (position + 17 <= segment.payloadEnd) {
          const definitionOffset = position;
          const descriptor = bytes[position++];
          const tableClass = descriptor >>> 4;
          const id = descriptor & 0x0F;
          if (tableClass > 1 || id > 3) break;
          const counts = Array.from(
            bytes.slice(position, position + 16)
          );
          const symbolCount = counts.reduce((sum, count) => sum + count, 0);
          const symbolsStart = position + 16;
          const tableEnd = symbolsStart + symbolCount;
          if (tableEnd > segment.payloadEnd) break;
          definitions.push({
            tableClass,
            id,
            definitionOffset,
            counts,
            symbolsStart,
            symbols: Array.from(bytes.slice(symbolsStart, tableEnd)),
            tableEnd,
            segmentEnd: segment.payloadEnd
          });
          position = tableEnd;
        }
      }
      return definitions;
    }

    function parseDriDefinition(bytes, segment) {
      if (
        segment.marker !== JPEG_DRI_MARKER ||
        segment.segmentLength !== 4 ||
        segment.payloadEnd - segment.payloadStart !== 2
      ) {
        return null;
      }
      const intervalMcuCount =
        (bytes[segment.payloadStart] << 8) |
        bytes[segment.payloadStart + 1];
      return {
        definitionOffset: segment.markerOffset,
        intervalMcuCount,
        enabled: intervalMcuCount > 0
      };
    }

    function resolveDriForScan(scan, driDefinitions) {
      let intervalMcuCount = 0;
      let definitionOffset = null;
      for (const definition of driDefinitions) {
        if (definition.definitionOffset >= scan.offset) break;
        intervalMcuCount = definition.intervalMcuCount;
        definitionOffset = definition.definitionOffset;
      }
      return {
        intervalMcuCount,
        definitionOffset,
        enabled: intervalMcuCount > 0
      };
    }

    function getScanMcuCount(frame, scan) {
      if (!frame || frame.width <= 0 || frame.height <= 0) return null;
      if (scan.componentIds.length > 1) {
        return (
          Math.ceil(frame.width / (JPEG_DCT_BLOCK_SIZE * frame.hMax)) *
          Math.ceil(frame.height / (JPEG_DCT_BLOCK_SIZE * frame.vMax))
        );
      }
      const component = frame.components.find(
        (item) => item.id === scan.componentIds[0]
      );
      if (!component) return null;
      const componentWidth = Math.ceil(
        frame.width * component.h / frame.hMax
      );
      const componentHeight = Math.ceil(
        frame.height * component.v / frame.vMax
      );
      return (
        Math.ceil(componentWidth / JPEG_DCT_BLOCK_SIZE) *
        Math.ceil(componentHeight / JPEG_DCT_BLOCK_SIZE)
      );
    }

    function parseRestartMarkersInScan(bytes, scan) {
      const markers = [];
      let offset = scan.entropyStart;
      while (offset < scan.endOffset) {
        if (bytes[offset] !== JPEG_MARKER_PREFIX) {
          offset++;
          continue;
        }
        const markerStart = offset;
        let codeOffset = offset + 1;
        while (
          codeOffset < scan.endOffset &&
          bytes[codeOffset] === JPEG_MARKER_PREFIX
        ) {
          codeOffset++;
        }
        if (codeOffset >= scan.endOffset) break;
        const code = bytes[codeOffset];
        if (code === 0x00) {
          offset = codeOffset + 1;
          continue;
        }
        if (
          code >= JPEG_RST_FIRST_MARKER &&
          code <= JPEG_RST_LAST_MARKER
        ) {
          markers.push({
            markerStart,
            codeOffset,
            markerEnd: codeOffset + 1,
            code
          });
          offset = codeOffset + 1;
          continue;
        }
        break;
      }
      return markers;
    }

    function hasValidRestartSequence(markers) {
      for (let index = 0; index < markers.length; index++) {
        const expectedCode = JPEG_RST_FIRST_MARKER +
          (index % JPEG_RESTART_MARKER_COUNT);
        if (markers[index].code !== expectedCode) return false;
      }
      return true;
    }

    function buildRestartIntervals(
      scan,
      restartMarkers,
      intervalMcuCount,
      scanMcuCount
    ) {
      const intervals = [];
      let payloadStart = scan.entropyStart;
      for (let index = 0; index < restartMarkers.length; index++) {
        const marker = restartMarkers[index];
        intervals.push({
          index,
          payloadStart,
          payloadEnd: marker.markerStart,
          payloadLength: marker.markerStart - payloadStart,
          markerStart: marker.markerStart,
          markerEnd: marker.markerEnd,
          markerCode: marker.code,
          mcuCount: intervalMcuCount,
          isFinal: false
        });
        payloadStart = marker.markerEnd;
      }
      const completeMcuCount = restartMarkers.length * intervalMcuCount;
      intervals.push({
        index: restartMarkers.length,
        payloadStart,
        payloadEnd: scan.endOffset,
        payloadLength: scan.endOffset - payloadStart,
        markerStart: null,
        markerEnd: null,
        markerCode: null,
        mcuCount: scanMcuCount - completeMcuCount,
        isFinal: true
      });
      return intervals;
    }

    // ========================================================================
    // 14. COMPOSITE AND MASK
    // ========================================================================
    function getTechniqueCompositeParameters(name, options) {
      const recorded = options.registryGeneration?.techniques?.find(
        (entry) => entry.name === name
      )?.parameters;
      const coverage = Number(recorded?.maskCoverage);
      const fallbackCoverage = Number(options.maskCoverage);
      return {
        maskCoverage: Math.max(
          0.1,
          Math.min(
            2,
            Number.isFinite(coverage)
              ? coverage
              : Number.isFinite(fallbackCoverage) ? fallbackCoverage : 1
          )
        ),
        opacity: 1
      };
    }

    function resolveCompositeLayerPlan(layers, recipe, preferredNames = null) {
      const enabledNames = new Set(layerNames.filter(
        (name) => layers[name]?.enabled
      ));
      const preferred = Array.isArray(preferredNames)
        ? preferredNames.filter((name, index, names) =>
            enabledNames.has(name) && names.indexOf(name) === index
          )
        : [];
      let active = [
        ...preferred,
        ...compositeLayerNames.filter(
          (name) => enabledNames.has(name) && !preferred.includes(name)
        )
      ];
      const skippedLayers = [];
      const occupiedExclusiveGroups = new Map();
      const conflictingNames = new Set();
      for (const name of active) {
        const group = variantDefinitions[name].exclusiveGroup;
        if (!group) continue;
        if (occupiedExclusiveGroups.has(group)) {
          conflictingNames.add(name);
          conflictingNames.add(occupiedExclusiveGroups.get(group));
        } else {
          occupiedExclusiveGroups.set(group, name);
        }
      }
      if (conflictingNames.size > 0) {
        for (const name of conflictingNames) {
          skippedLayers.push(
            `${name.toUpperCase()}:exclusive-variant-conflict:coefficient-base`
          );
        }
        active = active.filter((name) => !conflictingNames.has(name));
      }
      return { active, skippedLayers, conflictingNames };
    }

    function createVariantDifferenceMask(
      width,
      height,
      sourceImage,
      variantImage,
      diagnostics = null
    ) {
      if (!sourceImage || !variantImage) return null;
      const maskWidth = Math.max(1, Math.round(width));
      const maskHeight = Math.max(1, Math.round(height));
      const { canvas: mask, context: maskContext } = getReusableCanvas(
        "composite-difference-mask",
        maskWidth,
        maskHeight,
        { willReadFrequently: true }
      );
      let changedPixelCount = 0;
      let differenceSum = 0;
      let maximumChannelDifferenceSum = 0;
      for (let tileY = 0;
        tileY < maskHeight;
        tileY += COMPOSITE_MASK_COMPARISON_TILE_SIZE
      ) {
        const tileHeight = Math.min(
          COMPOSITE_MASK_COMPARISON_TILE_SIZE,
          maskHeight - tileY
        );
        for (let tileX = 0;
          tileX < maskWidth;
          tileX += COMPOSITE_MASK_COMPARISON_TILE_SIZE
        ) {
          const tileWidth = Math.min(
            COMPOSITE_MASK_COMPARISON_TILE_SIZE,
            maskWidth - tileX
          );
          const { context: sourceContext } = getReusableCanvas(
            "composite-difference-source-tile",
            tileWidth,
            tileHeight,
            { willReadFrequently: true }
          );
          sourceContext.drawImage(
            sourceImage,
            tileX,
            tileY,
            tileWidth,
            tileHeight,
            0,
            0,
            tileWidth,
            tileHeight
          );
          const sourcePixels = sourceContext.getImageData(
            0,
            0,
            tileWidth,
            tileHeight
          ).data;
          const { context: variantContext } = getReusableCanvas(
            "composite-difference-variant-tile",
            tileWidth,
            tileHeight,
            { willReadFrequently: true }
          );
          variantContext.drawImage(
            variantImage,
            tileX,
            tileY,
            tileWidth,
            tileHeight,
            0,
            0,
            tileWidth,
            tileHeight
          );
          const variantPixels = variantContext.getImageData(
            0,
            0,
            tileWidth,
            tileHeight
          ).data;
          const maskData = maskContext.createImageData(tileWidth, tileHeight);
          for (let offset = 0;
            offset < sourcePixels.length;
            offset += 4
          ) {
            const redDifference = Math.abs(
              sourcePixels[offset] - variantPixels[offset]
            );
            const greenDifference = Math.abs(
              sourcePixels[offset + 1] - variantPixels[offset + 1]
            );
            const blueDifference = Math.abs(
              sourcePixels[offset + 2] - variantPixels[offset + 2]
            );
            const averageDifference = (
              redDifference + greenDifference + blueDifference
            ) / 3;
            const maximumChannelDifference = Math.max(
              redDifference,
              greenDifference,
              blueDifference
            );
            differenceSum += averageDifference;
            maximumChannelDifferenceSum += maximumChannelDifference;
            if (maximumChannelDifference > 0) changedPixelCount++;
            maskData.data[offset] = 255;
            maskData.data[offset + 1] = 255;
            maskData.data[offset + 2] = 255;
            maskData.data[offset + 3] = maximumChannelDifference;
          }
          maskContext.putImageData(maskData, tileX, tileY);
        }
      }
      if (diagnostics && typeof diagnostics === "object") {
        Object.assign(diagnostics, {
          maskMode: "direct-pixel-difference",
          layerName: null,
          analysisLayerName: null,
          coverageApplied: false,
          featureWeights: [],
          threshold: null,
          feather: 0,
          thresholdTransitionWidth: 0,
          contrast: null,
          maskGamma: 1,
          sourceWeight: 1,
          organicWeight: 0,
          blur: 0,
          spectralFieldEnabled: false,
          differenceMaskEnabled: true,
          differenceWidth: maskWidth,
          differenceHeight: maskHeight,
          differenceResolution: "source",
          differenceTileSize: COMPOSITE_MASK_COMPARISON_TILE_SIZE,
          differenceMetric: "maximum-rgb-channel",
          differenceScale: 255,
          changedPixelRatio: changedPixelCount /
            Math.max(1, maskWidth * maskHeight),
          meanAbsolutePixelDifference: differenceSum /
            Math.max(1, maskWidth * maskHeight) / 255,
          meanMaximumChannelDifference: maximumChannelDifferenceSum /
            Math.max(1, maskWidth * maskHeight) / 255,
          effectiveAlpha: maximumChannelDifferenceSum /
            Math.max(1, maskWidth * maskHeight) / 255
        });
      }
      return mask;
    }

    function createCompositeMask(
      name,
      width,
      height,
      options,
      sourceImage = null,
      variantImage = null,
      diagnostics = null
    ) {
      const maskProfile = getRecipeVariantMaskProfile(name, options.recipe);
      if (maskProfile === "none") return null;
      if (diagnostics && typeof diagnostics === "object") {
        Object.assign(diagnostics, {
          technique: name,
          configuredMaskProfile: maskProfile,
          requestedCoverage: getTechniqueCompositeParameters(name, options)
            .maskCoverage
        });
      }
      return createVariantDifferenceMask(
        width,
        height,
        sourceImage,
        variantImage,
        diagnostics
      );
    }

    function createVariantMutationMetadata(decoded) {
      return {
        changedBytes: decoded.variant?.changedBytes || 0,
        sourceResolution: decoded.sourceResolution || null,
        mutationTraces: decoded.variant?.mutationTraces || [],
        progressiveMetadata: decoded.variant?.progressiveMetadata || null,
        restartMetadata: decoded.variant?.restartMetadata || null,
        componentMetadata: decoded.variant?.componentMetadata || null,
        coefficientMetadata: decoded.variant?.coefficientMetadata || null
      };
    }

    function drawBaseCompositeVariant({
      name,
      image,
      width,
      height,
      options,
      outputContext
    }) {
      outputContext.drawImage(image, 0, 0, width, height);
      return {
        ...getTechniqueCompositeParameters(name, options),
        compositeMode: "base-full-frame",
        maskAlphaRole: "none"
      };
    }

    function drawMaskedCompositeVariant({
      name,
      decoded,
      original,
      width,
      height,
      options,
      outputContext
    }) {
      const { image } = decoded;
      const { canvas: layer, context: layerContext } = getReusableCanvas(
        "composite-layer",
        width,
        height
      );
      layerContext.drawImage(image, 0, 0, width, height);
      layerContext.globalCompositeOperation = "destination-in";
      const diagnostics = {
        ...(options.preparedMaskDiagnostics?.get(name) || {})
      };
      const mask = options.preparedMasks?.has(name)
        ? options.preparedMasks.get(name)
        : createCompositeMask(
            name,
            image.naturalWidth || width,
            image.naturalHeight || height,
            options,
            decoded.sourceImage || original,
            image,
            diagnostics
          );
      if (mask) {
        layerContext.imageSmoothingEnabled = false;
        layerContext.drawImage(mask, 0, 0, width, height);
      }
      const parameters = getTechniqueCompositeParameters(name, options);
      outputContext.save();
      outputContext.globalAlpha = parameters.opacity;
      outputContext.drawImage(layer, 0, 0);
      outputContext.restore();
      return {
        ...parameters,
        ...diagnostics,
        compositeMode: "ordered-source-over",
        maskAlphaRole: "layer-clip"
      };
    }

    async function compositeGlitchLayers(bytes, original, options) {
      const width = original.naturalWidth;
      const height = original.naturalHeight;
      if (!original.naturalWidth || !original.naturalHeight) {
        throw new Error("元画像のサイズを取得できません");
      }
      const analysis = options.analysis;
      if (!analysis) throw new Error("composite-analysis-required");

      const { canvas: output, context: outputContext } = getReusableCanvas(
        "composite-output",
        width,
        height
      );

      const layerPlan = resolveCompositeLayerPlan(
        options.layers,
        options.recipe,
        options.registryGeneration?.selectedTechniqueNames
      );
      const active = layerPlan.active;
      const skippedLayers = layerPlan.skippedLayers.slice();
      const mutationMetadata = {};
      let compositedLayers = 0;
      const compositeOrder = [];

      if (active.length === 0) {
        return {
          blob: await canvasToJpegBlob(output),
          compositedLayers: 0,
          skippedLayers,
          mutationMetadata,
          compositeOrder
        };
      }

      for (let layerIndex = 0; layerIndex < active.length; layerIndex++) {
        if (options.shouldContinue && !options.shouldContinue()) {
          throw createGenerationCancelledError();
        }
        const name = active[layerIndex];
        let decodedVariant = null;
        const isolatedLayers = Object.fromEntries(layerNames.map((key) => [key, {
          enabled: key === name,
          strength: options.recipe?.[key] ?? options.layers[key].strength
        }]));

        try {
          const decoded = options.preparedVariants?.get(name) ||
            await createDecodedVariant(bytes, name, options, isolatedLayers);
          const { image } = decoded;
          decodedVariant = decoded.variant;
          if (decoded.skipped) {
            skippedLayers.push(name.toUpperCase());
            continue;
          }
          mutationMetadata[name] = createVariantMutationMetadata(decoded);
          if (compositedLayers === 0) {
            mutationMetadata[name].composite = drawBaseCompositeVariant({
              name,
              image,
              width,
              height,
              options,
              outputContext
            });
            compositedLayers++;
            compositeOrder.push(name);
            continue;
          }
          mutationMetadata[name].composite = drawMaskedCompositeVariant({
            name,
            decoded,
            original,
            width,
            height,
            options,
            outputContext
          });
          compositedLayers++;
          compositeOrder.push(name);
        } catch (error) {
          if (isGenerationCancellation(error)) throw error;
          skippedLayers.push(name.toUpperCase());
          const clusters = name === "entropy"
            ? decodedVariant?.entropyClusters || error.entropyClusters || []
            : name === "mcu"
              ? decodedVariant?.mcuClusters || error.mcuClusters || []
              : name === "progressive"
                ? decodedVariant?.progressiveClusters ||
                  error.progressiveClusters || []
                : name === "restart"
                  ? decodedVariant?.restartClusters || error.restartClusters || []
                  : name === "component"
                    ? decodedVariant?.componentClusters ||
                      error.componentClusters || []
                    : name === "coefficient"
                      ? decodedVariant?.coefficientClusters ||
                        error.coefficientClusters || []
                    : [];
          dispatchFailureEvent({
            family: name,
            stage: options.stage || "final-frame",
            buildKey: options.buildKey,
            frameAttempt: options.frameAttempt,
            attempt: options.frameAttempt || 1,
            retryLevel: options.mcuRetryLevel || 0,
            seed: options.seed,
            changeBudget: options.changeBudget,
            initialChangeBudget: options.initialChangeBudget,
            clusters,
            region: options.region,
            byteLength: decodedVariant?.bytes?.length ?? null,
            reason: error.message,
            code: "layer-composite-failed",
            error
          }, options);
        }
      }

      return {
        blob: await canvasToJpegBlob(output),
        compositedLayers,
        skippedLayers,
        mutationMetadata,
        compositeOrder
      };
    }

    async function createPreparedCompositeState({
      sourceBytes,
      sourceImage,
      recipe,
      activeNames,
      progress,
      options,
      preparedVariants = null,
      isFinal = false,
      finalResult = null
    }) {
      const stateRecipe = createJpegTransitionStateRecipe({
        recipe,
        plan: createJpegTransitionPlan(recipe),
        progress
      });
      for (const name of layerNames) {
        if (!activeNames.includes(name)) stateRecipe[name] = 0;
      }
      const layers = createLayerSettingsForRecipe(stateRecipe, activeNames);
      const result = finalResult || await compositeGlitchLayers(
        sourceBytes,
        sourceImage,
        {
          ...options,
          recipe: stateRecipe,
          layers,
          temporalPhase: progress,
          changeBudget: Math.max(
            1,
            Math.round(options.changeBudget * Math.max(progress, 0.01))
          ),
          mutationRate: Math.max(
            1,
            Math.round(options.changeBudget * Math.max(progress, 0.01))
          ) / Math.max(1, options.structure.entropyBytes),
          preparedVariants
        }
      );
      const blob = result.blob;
      const image = await decodeImageBlob(blob);
      if (options.shouldContinue && !options.shouldContinue()) {
        throw createGenerationCancelledError(
          "prepared composite state cancelled"
        );
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const url = URL.createObjectURL(blob);
      return {
        state: createPreparedStateFromBlob({
          blob,
          bytes,
          image,
          url,
          progress,
          activeVariantNames: activeNames.slice(),
          mutationMetadata: {
            compositedLayers: result.compositedLayers,
            skippedLayers: result.skippedLayers,
            variants: result.mutationMetadata
          },
          isFinal
        }),
        result
      };
    }

    async function prepareProgressivePrefixLineage({
      sourceBytes,
      recipe,
      options,
      mutationEventLog,
      frameAttempt
    }) {
      const selected = recipe.variantSelections?.progressive;
      if (!selected) return [];
      const candidates = getProgressivePrefixCandidates(options.structure)
        .filter((candidate) => candidate.scanIndex <= selected.scanIndex)
        .sort((left, right) => left.scanIndex - right.scanIndex);
      if (candidates.length < 2) return [];
      const states = [];
      for (const candidate of candidates.slice(0, -1)) {
        const progress = candidate.retainedScanCount /
          Math.max(1, selected.retainedScanCount);
        const build = createMutationBuild(mutationEventLog, {
          frameAttempt,
          stage: "transition-state",
          progress
        });
        const lineageRecipe = {
          ...recipe,
          variantSelections: {
            ...recipe.variantSelections,
            progressive: {
              ...candidate,
              candidateCount: selected.candidateCount
            }
          }
        };
        const isolatedLayers = createIsolatedLayerSettings(
          options.layers,
          "progressive",
          lineageRecipe
        );
        try {
          const decoded = await createDecodedVariant(
            sourceBytes,
            "progressive",
            {
              ...options,
              recipe: lineageRecipe,
              buildKey: build.buildKey,
              frameAttempt
            },
            isolatedLayers
          );
          if (decoded.skipped) {
            discardMutationBuild(mutationEventLog, build.buildKey);
            continue;
          }
          const blob = new Blob([decoded.variant.bytes], { type: "image/jpeg" });
          const url = URL.createObjectURL(blob);
          const state = createPreparedStateFromBlob({
            blob,
            bytes: decoded.variant.bytes,
            image: decoded.image,
            url,
            progress,
            activeVariantNames: ["progressive"],
            mutationMetadata: decoded.variant.progressiveMetadata,
            isFinal: false
          });
          states.push(assignTransitionStateKey(
            mutationEventLog,
            state,
            build.buildKey
          ));
        } catch (error) {
          if (isGenerationCancellation(error)) throw error;
          discardMutationBuild(mutationEventLog, build.buildKey);
          // A missing lineage point degrades to source/final atomic playback.
        }
      }
      return states;
    }

    async function prepareJpegTransitionStates({
      sourceBytes,
      sourceImage,
      sourceBlob,
      sourceUrl,
      sourceEndpointBytes,
      recipe,
      transitionPlan,
      finalResult,
      finalBlob,
      finalBytes,
      finalImage,
      finalUrl,
      preparedVariants,
      jpegEventCount,
      options,
      mutationEventLog,
      frameAttempt,
      finalBuildKey
    }) {
      const states = [];
      if (sourceBlob && sourceUrl) {
        states.push(assignTransitionStateKey(
          mutationEventLog,
          createPreparedStateFromBlob({
            blob: sourceBlob,
            bytes: sourceEndpointBytes || sourceBytes,
            image: sourceImage,
            url: sourceUrl,
            progress: 0,
            activeVariantNames: [],
            mutationMetadata: { endpoint: "source" },
            ownsUrl: false
          })
        ));
      }

      const registryTransitionNames = options.registryVariantRoute
        ? (options.registryGeneration?.selectedTechniqueNames || [])
            .filter((name) =>
              transitionPlan.activeNames.includes(name) &&
              preparedVariants?.has(name)
            )
        : null;

      if (
        options.registryVariantRoute
      ) {
        for (let index = 0; index < registryTransitionNames.length; index++) {
          const name = registryTransitionNames[index];
          const prepared = preparedVariants.get(name);
          const progress = (index + 1) /
            Math.max(1, registryTransitionNames.length + 1);
          const build = createMutationBuild(mutationEventLog, {
            frameAttempt,
            stage: "transition-state",
            progress
          });
          if (options.shouldContinue && !options.shouldContinue()) {
            throw createGenerationCancelledError(
              "registry technique state cancelled"
            );
          }
          const blob = new Blob(
            [prepared.variant.bytes],
            { type: "image/jpeg" }
          );
          const url = URL.createObjectURL(blob);
          const state = createPreparedStateFromBlob({
            blob,
            bytes: prepared.variant.bytes,
            image: prepared.image,
            url,
            progress,
            activeVariantNames: [name],
            mutationMetadata: {
              technique: name,
              variantSeed: prepared.variantSeed,
              sourceResolution: prepared.sourceResolution || null,
              changedBytes: prepared.variant.changedBytes || 0,
              mutationTraces: prepared.variant.mutationTraces || [],
              progressiveMetadata:
                prepared.variant.progressiveMetadata || null,
              restartMetadata: prepared.variant.restartMetadata || null,
              componentMetadata: prepared.variant.componentMetadata || null,
              coefficientMetadata:
                prepared.variant.coefficientMetadata || null
            },
            isFinal: false
          });
          states.push(assignTransitionStateKey(
            mutationEventLog,
            state,
            build.buildKey
          ));
        }
      } else if (
        transitionPlan.isAtomicOnly &&
        transitionPlan.activeNames.length === 1 &&
        transitionPlan.activeNames[0] === "progressive" &&
        !options.registryVariantRoute
      ) {
        states.push(...await prepareProgressivePrefixLineage({
          sourceBytes,
          recipe,
          options,
          mutationEventLog,
          frameAttempt
        }));
      } else if (transitionPlan.isAtomicOnly) {
        const orderedStatic = compositeLayerNames.filter((name) =>
          transitionPlan.activeNames.includes(name)
        );
        for (let count = 1; count < orderedStatic.length; count++) {
          const prefixNames = orderedStatic.slice(0, count);
          const progress = count / orderedStatic.length;
          const build = createMutationBuild(mutationEventLog, {
            frameAttempt,
            stage: "transition-state",
            progress
          });
          try {
            const prepared = await createPreparedCompositeState({
              sourceBytes,
              sourceImage,
              recipe,
              activeNames: prefixNames,
              progress,
              options: {
                ...options,
                buildKey: build.buildKey,
                frameAttempt
              },
              preparedVariants
            });
            states.push(assignTransitionStateKey(
              mutationEventLog,
              prepared.state,
              build.buildKey
            ));
          } catch (error) {
            if (isGenerationCancellation(error)) throw error;
            discardMutationBuild(mutationEventLog, build.buildKey);
          }
        }
      } else {
        const stateCount = deriveJpegTransitionStateCount({
          eventCount: Math.max(
            transitionPlan.scaledNames.length,
            jpegEventCount || 0
          ),
          activeScaledCount: transitionPlan.scaledNames.length
        });
        for (let index = 1; index < stateCount - 1; index++) {
          const progress = index / (stateCount - 1);
          const build = createMutationBuild(mutationEventLog, {
            frameAttempt,
            stage: "transition-state",
            progress
          });
          try {
            const prepared = await createPreparedCompositeState({
              sourceBytes,
              sourceImage,
              recipe,
              activeNames: transitionPlan.activeNames,
              progress,
              options: {
                ...options,
                buildKey: build.buildKey,
                frameAttempt
              },
              preparedVariants
            });
            states.push(assignTransitionStateKey(
              mutationEventLog,
              prepared.state,
              build.buildKey
            ));
          } catch (error) {
            if (isGenerationCancellation(error)) throw error;
            discardMutationBuild(mutationEventLog, build.buildKey);
          }
        }
      }

      const finalState = createPreparedStateFromBlob({
        blob: finalBlob,
        bytes: finalBytes,
        image: finalImage,
        url: finalUrl,
        progress: 1,
        activeVariantNames: registryTransitionNames
          ? registryTransitionNames.slice()
          : transitionPlan.activeNames.slice(),
        mutationMetadata: {
          compositedLayers: finalResult.compositedLayers,
          skippedLayers: finalResult.skippedLayers,
          variants: finalResult.mutationMetadata
        },
        isFinal: true
      });
      states.push(assignTransitionStateKey(
        mutationEventLog,
        finalState,
        finalBuildKey
      ));
      if (
        options.registryVariantRoute &&
        (
          location.hostname === "localhost" ||
          location.hostname === "127.0.0.1" ||
          location.protocol === "file:"
        )
      ) {
        states.forEach((state, stateIndex) => {
          const stateType = state.isFinal
            ? "final"
            : state.activeVariantNames.length === 1
              ? "technique"
              : "source";
          console.debug("Registry transition state", {
            stateIndex,
            stateType,
            techniqueName: stateType === "technique"
              ? state.activeVariantNames[0]
              : null,
            url: state.url,
            bytesLength: state.bytes?.length || 0,
            objectIdentity: state.mutationMetadata?.variantSeed || state.url,
            mutationMetadata: state.mutationMetadata
          });
        });
      }
      return states;
    }

    // ========================================================================
    // 15. JPEG TRANSITION
    // ========================================================================
    function createJpegTransitionPlan(recipe) {
      const activeNames = getActiveRecipeVariantNames(recipe);
      const staticBaseNames = [];
      const staticLayerNames = [];
      const scaledNames = [];
      for (const name of activeNames) {
        const mode = getRecipeVariantTransitionMode(name, recipe);
        if (mode === "direct") {
          staticLayerNames.push(name);
        } else if (mode === "fixed") {
          staticLayerNames.push(name);
        } else {
          scaledNames.push(name);
        }
      }
      const sortByCompositeOrder = (left, right) =>
        compositeLayerNames.indexOf(left) - compositeLayerNames.indexOf(right);
      staticBaseNames.sort(sortByCompositeOrder);
      staticLayerNames.sort(sortByCompositeOrder);
      scaledNames.sort(sortByCompositeOrder);
      return {
        activeNames,
        staticBaseNames,
        staticLayerNames,
        scaledNames,
        hasStatic: staticBaseNames.length + staticLayerNames.length > 0,
        hasScaled: scaledNames.length > 0,
        isAtomicOnly: scaledNames.length === 0
      };
    }

    function createIsolatedLayerSettings(layerSettings, name, recipe = null) {
      return Object.fromEntries(layerNames.map((key) => [key, {
        enabled: key === name,
        strength: key === name
          ? (recipe?.[key] ?? layerSettings[key]?.strength ?? 1)
          : (layerSettings[key]?.strength ?? 1)
      }]));
    }

    function createLayerSettingsForRecipe(recipe, names = null) {
      const enabled = names ? new Set(names) : null;
      return Object.fromEntries(layerNames.map((name) => [name, {
        enabled: enabled ? enabled.has(name) : recipe[name] > 0,
        strength: Math.max(0.1, recipe[name] || 0.1)
      }]));
    }

    function createIndependentTechniqueRecipe({
      name,
      seed,
      parameters,
      sourceBytes,
      analysis,
      structure,
      coefficientContext,
      progressiveCoefficientContext,
      layers
    }) {
      const recipe = createGlitchRecipe(
        seed,
        layers,
        analysis,
        structure,
        sourceBytes,
        coefficientContext,
        progressiveCoefficientContext,
        null
      );
      recipe[name] = parameters.strength;
      return recipe;
    }

    function addTechniqueRecipeParameters(name, parameters, recipe) {
      const variantSelection = recipe.variantSelections?.[name] || null;
      return {
        ...parameters,
        variantSelection: name === "coefficient"
          ? summarizeCoefficientSelection(variantSelection)
          : variantSelection,
        coefficientMode: name === "coefficient"
          ? recipe.coefficientMode
          : null
      };
    }

    function getResolutionSourcesForTechnique(name, options) {
      return (options.resolutionVariants || []).filter((source) => {
        if (name === "progressive") {
          return source.progressiveCoefficientContext?.supported === true;
        }
        if (name !== "coefficient") return true;
        return source.baselineCoefficientContext?.supported === true ||
          source.progressiveCoefficientContext?.supported === true;
      });
    }

    function selectTechniqueResolutionSource(name, sourceBytes, options, seed) {
      const eligible = getResolutionSourcesForTechnique(name, options);
      if (eligible.length === 0) {
        return options.resolutionVariants?.find(
          (source) => source.bytes === sourceBytes
        ) || options.resolutionVariants?.at(-1) || null;
      }
      const selectionSeed = mixSeed(
        seed,
        `technique-resolution:${name}`,
        options.analysis?.fingerprint || 0
      );
      return eligible[selectionSeed % eligible.length];
    }

    function summarizeResolutionSource(source) {
      if (!source) return null;
      return {
        id: source.id,
        width: source.width,
        height: source.height,
        scale: source.scale
      };
    }

    function createTechniqueGenerationOptions(options, source) {
      if (!source) return options;
      return {
        ...options,
        structure: source.structure,
        analysis: source.analysis,
        coefficientContext: source.baselineCoefficientContext,
        progressiveCoefficientContext:
          source.progressiveCoefficientContext,
        failureState: source.failureState,
        byteVarianceCoarse: source.byteVarianceCoarse,
        byteVarianceFine: source.byteVarianceFine,
        jpegSpectralField: source.jpegSpectralField,
        differenceReferenceBytes: source.bytes,
        onFailureEvent: (event) => recordFailureEvent(event, {
          failureEvents: options.failureEvents || currentFailureEvents,
          failureState: source.failureState,
          structure: source.structure,
          initialChangeBudget: options.initialChangeBudget,
          mutationEventLog: options.mutationEventLog,
          buildKey: options.buildKey
        })
      };
    }

    function resolveTechniqueResolutionContext({
      name,
      sourceBytes,
      options,
      seed
    }) {
      const source = selectTechniqueResolutionSource(
        name,
        sourceBytes,
        options,
        seed
      );
      return {
        source,
        sourceBytes: source?.bytes || sourceBytes,
        options: createTechniqueGenerationOptions(options, source),
        metadata: summarizeResolutionSource(source)
      };
    }

    async function generateRegistryVariantBatch({
      sourceBytes,
      recipe,
      plan,
      options,
      generationRecord
    }) {
      const successfulVariants = new Map();
      const recordByName = new Map(
        generationRecord.techniques.map((entry) => [entry.name, entry])
      );
      for (const name of plan.activeNames) {
        const entry = recordByName.get(name);
        const parameters = entry?.parameters || {};
        const resolutionContext = resolveTechniqueResolutionContext({
          name,
          sourceBytes,
          options,
          seed: generationRecord.seed
        });
        const techniqueSourceBytes = resolutionContext.sourceBytes;
        const techniqueOptions = resolutionContext.options;
        const mutationRate = Number.isFinite(Number(parameters.mutationRate))
          ? Number(parameters.mutationRate)
          : 0;
        const changeBudget = mutationRate > 0
          ? Math.max(1, Math.round(
              techniqueOptions.structure.entropyBytes * mutationRate
            ))
          : 1;
        const isolatedLayers = createIsolatedLayerSettings(
          options.layers,
          name,
          recipe
        );
        isolatedLayers[name].strength = parameters.strength;
        const techniqueSeed = mixSeed(
          generationRecord.seed,
          `registry-technique:${name}`,
          techniqueOptions.analysis?.fingerprint || 0
        );
        const techniqueRecipe = createIndependentTechniqueRecipe({
          name,
          seed: techniqueSeed,
          parameters,
          sourceBytes: techniqueSourceBytes,
          analysis: techniqueOptions.analysis,
          structure: techniqueOptions.structure,
          coefficientContext: techniqueOptions.coefficientContext,
          progressiveCoefficientContext:
            techniqueOptions.progressiveCoefficientContext,
          layers: isolatedLayers
        });
        entry.parameters = addTechniqueRecipeParameters(
          name,
          {
            ...parameters,
            changeBudget,
            sourceResolution: resolutionContext.metadata
          },
          techniqueRecipe
        );
        try {
          const prepared = await createDecodedVariant(
            techniqueSourceBytes,
            name,
            {
              ...techniqueOptions,
              seed: techniqueSeed,
              mutationRate,
              changeBudget,
              mode: parameters.mode || options.mode,
              region: parameters.region || options.region,
              recipe: techniqueRecipe,
              disableMutationRetries: true
            },
            isolatedLayers
          );
          if (prepared.skipped) {
            entry.status = "reject";
            entry.rejectReason = prepared.reason || "mutation-no-op";
            const failureEvent = dispatchFailureEvent({
              family: name,
              stage: options.stage || "final-frame",
              buildKey: options.buildKey,
              frameAttempt: options.frameAttempt,
              attempt: 1,
              retryLevel: 0,
              seed: prepared.variantSeed || techniqueSeed,
              changeBudget,
              initialChangeBudget: options.initialChangeBudget,
              clusters: getVariantMutationClusters(
                name,
                prepared.variant
              ),
              region: options.region,
              byteLength: prepared.variant?.bytes?.length ?? null,
              reason: entry.rejectReason,
              code: "no-changed-bytes"
            }, techniqueOptions);
            recordFailureDifferenceEvent(
              failureEvent,
              prepared.variant?.bytes || null,
              techniqueOptions
            );
            continue;
          }
          prepared.techniqueRecipe = techniqueRecipe;
          prepared.sourceResolution = entry.parameters.sourceResolution;
          prepared.sourceImage = resolutionContext.source?.image || null;
          successfulVariants.set(name, prepared);
          entry.status = "success";
          entry.rejectReason = null;
        } catch (error) {
          if (isGenerationCancellation(error)) throw error;
          entry.status = "reject";
          entry.rejectReason = error?.message || "mutation-failed";
        }
      }
      generationRecord.successfulVariantCount = successfulVariants.size;
      latestRegistryGenerationRecord = JSON.parse(JSON.stringify(
        generationRecord
      ));
      console.info("JPEG glitch registry generation", latestRegistryGenerationRecord);
      return successfulVariants;
    }

    function createSuccessfulRegistryRecipe(
      recipe,
      successfulVariants,
      generationRecord
    ) {
      const successfulNames = new Set(successfulVariants.keys());
      const resolvedRecipe = {
        ...recipe,
        ...Object.fromEntries(layerNames.map((name) => [
          name,
          successfulNames.has(name) ? recipe[name] : 0
        ])),
        variantSelections: {
          ...recipe.variantSelections,
          ...Object.fromEntries([...successfulNames].map((name) => [
            name,
            successfulVariants.get(name)?.techniqueRecipe
              ?.variantSelections?.[name] || null
          ]))
        },
        coefficientMode: successfulNames.has("coefficient")
          ? successfulVariants.get("coefficient")?.techniqueRecipe
            ?.coefficientMode || null
          : null
      };
      for (const name of successfulNames) {
        resolvedRecipe[name] = generationRecord.techniques.find(
          (entry) => entry.name === name
        )?.parameters?.strength ?? resolvedRecipe[name];
      }
      return resolvedRecipe;
    }

    function createSuccessfulLayerSettings(layerSettings, successfulVariants) {
      const successfulNames = new Set(successfulVariants.keys());
      return Object.fromEntries(layerNames.map((name) => [name, {
        ...layerSettings[name],
        enabled: successfulNames.has(name)
      }]));
    }

    function scaleExistingTransitionStrength(strength, progress) {
      return strength * clamp01(progress);
    }

    function createJpegTransitionStateRecipe({ recipe, plan, progress }) {
      const stateRecipe = {
        ...recipe,
        variantSelections: recipe.variantSelections
      };
      const staticNames = new Set([
        ...plan.staticBaseNames,
        ...plan.staticLayerNames
      ]);
      for (const name of plan.activeNames) {
        stateRecipe[name] = staticNames.has(name)
          ? recipe[name]
          : scaleExistingTransitionStrength(recipe[name], progress);
      }
      return stateRecipe;
    }

    function deriveJpegTransitionStateCount({
      eventCount,
      activeScaledCount
    }) {
      if (eventCount <= 0 || activeScaledCount <= 0) return 0;
      const derived = 2 + Math.ceil(Math.log2(eventCount + 1));
      return Math.max(
        2,
        Math.min(transitionPlaybackConfig.maxPreparedStateCount, derived)
      );
    }

    function countPreparedVariantEvents(preparedVariants) {
      let count = 0;
      for (const prepared of preparedVariants?.values?.() || []) {
        const traces = prepared?.variant?.mutationTraces || [];
        count += traces.reduce(
          (sum, trace) => sum + Math.max(1, trace.clusters?.length || 0),
          0
        );
      }
      return count;
    }

    function countCompositeMutationEvents(mutationMetadata, names) {
      return names.reduce((total, name) => {
        const metadata = mutationMetadata?.[name];
        if (!metadata) return total;
        const clusterCount = (metadata.mutationTraces || []).reduce(
          (sum, trace) => sum + (trace.clusters?.length || 0),
          0
        );
        return total + Math.max(
          clusterCount,
          metadata.changedBytes || 0,
          1
        );
      }, 0);
    }

    function createPreparedStateFromBlob({
      blob,
      bytes = null,
      image = null,
      url = null,
      progress,
      activeVariantNames,
      mutationMetadata = null,
      isFinal = false,
      ownsUrl = true
    }) {
      return {
        blob,
        bytes,
        image,
        url,
        progress,
        activeVariantNames,
        mutationMetadata,
        isFinal,
        ownsUrl,
        stateKey: null
      };
    }

    function releasePreparedFramePackage(
      prepared,
      { preserveFinalUrl = false } = {}
    ) {
      if (!prepared || prepared.resourcesReleased) return;
      releaseProcessAudioBufferCache(prepared);
      releaseFailureAudioBufferCache(prepared);
      const released = new Set();
      for (const state of prepared.states || []) {
        if (!state?.url || state.ownsUrl === false) continue;
        if (preserveFinalUrl && state.url === prepared.finalUrl) continue;
        if (!released.has(state.url)) URL.revokeObjectURL(state.url);
        released.add(state.url);
        state.url = null;
      }
      if (!preserveFinalUrl && prepared.finalUrl &&
          !released.has(prepared.finalUrl)) {
        URL.revokeObjectURL(prepared.finalUrl);
        prepared.finalUrl = null;
      }
      if (!preserveFinalUrl) {
        prepared.timelineAudioAnchors = null;
        prepared.processPcmDataByStateKey = null;
        prepared.failurePcmEvents = null;
        prepared.failureAudioEvents = null;
      }
      prepared.resourcesReleased = !preserveFinalUrl;
    }

    const PCG32_MULTIPLIER = 6364136223846793005n;
    const UINT64_MASK = 0xffffffffffffffffn;
    const UINT32_SCALE = 4294967296;

    function pcg32(seed, sequence = 1) {
      let state = 0n;
      const increment =
        ((BigInt(sequence >>> 0) << 1n) | 1n) & UINT64_MASK;

      function nextUint32() {
        const oldState = state;
        state =
          (oldState * PCG32_MULTIPLIER + increment) & UINT64_MASK;
        const xorshifted = Number(
          ((oldState >> 18n) ^ oldState) >> 27n
        ) >>> 0;
        const rotation = Number(oldState >> 59n) & 31;
        return (
          (xorshifted >>> rotation) |
          (xorshifted << ((-rotation) & 31))
        ) >>> 0;
      }

      nextUint32();
      state = (state + BigInt(seed >>> 0)) & UINT64_MASK;
      nextUint32();

      return function random() {
        return nextUint32() / UINT32_SCALE;
      };
    }

    function createPcg32Stream(seed, label, imageFingerprint = 0) {
      return pcg32(
        mixSeed(seed, label, imageFingerprint) >>> 0,
        mixSeed(seed, `${label}-stream`, imageFingerprint) >>> 0
      );
    }

    function findJpegScanDataRanges(bytes) {
      const ranges = [];
      let pos = 2;

      while (pos < bytes.length) {
        while (pos < bytes.length && bytes[pos] !== 0xFF) pos++;
        if (pos >= bytes.length) break;
        while (pos < bytes.length && bytes[pos] === 0xFF) pos++;
        if (pos >= bytes.length) break;

        const marker = bytes[pos++];
        if (marker === 0xD9) break;
        if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
        if (pos + 1 >= bytes.length) throw new Error("切り詰められたJPEGセグメントです");

        const segmentLength = (bytes[pos] << 8) | bytes[pos + 1];
        if (segmentLength < 2 || pos + segmentLength > bytes.length) {
          throw new Error("不正なJPEGセグメント長です");
        }

        if (marker !== 0xDA) {
          pos += segmentLength;
          continue;
        }

        const start = pos + segmentLength;
        let end = start;
        while (end < bytes.length - 1) {
          if (bytes[end] !== 0xFF) {
            end++;
            continue;
          }
          let next = end + 1;
          while (next < bytes.length && bytes[next] === 0xFF) next++;
          const code = bytes[next];
          if (code === 0x00) {
            end = next + 1;
            continue;
          }
          if (code >= 0xD0 && code <= 0xD7) {
            end = next + 1;
            continue;
          }
          break;
        }
        if (end > start) ranges.push({ start, end });
        pos = end;
      }

      return ranges;
    }

    function collectMutableIndices(bytes, ranges, region) {
      const indices = [];
      for (const { start, end } of ranges) {
        for (let i = start; i < end; i++) {
          if (bytes[i] === 0xFF || (i > start && bytes[i - 1] === 0xFF)) continue;
          indices.push(i);
        }
      }

      const length = indices.length;
      const { from, to } = regionToRange(region, length);
      return indices.slice(from, to);
    }

    function regionToRange(region, length) {
      if (region === "first") return { from: 0, to: Math.floor(length * 0.5) };
      if (region === "second") return { from: Math.floor(length * 0.5), to: length };
      if (region === "middle") {
        return {
          from: Math.floor(length * 0.25),
          to: Math.floor(length * 0.75)
        };
      }
      return { from: 0, to: length };
    }

    function absoluteToMutableIndex(mutableIndices, absolutePosition) {
      let low = 0;
      let high = mutableIndices.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (mutableIndices[middle] < absolutePosition) low = middle + 1;
        else high = middle;
      }
      return low;
    }

    function getFailureScanBinCount(mutableByteCount) {
      const count = Math.max(0, Math.floor(Number(mutableByteCount) || 0));
      const target = count <= 250000 ? 2048 : count <= 1000000 ? 4096 : 8192;
      if (count >= target) return target;
      let binCount = 512;
      while (binCount < count && binCount < target) binCount *= 2;
      return Math.min(target, binCount);
    }

    // ========================================================================
    // 16. FRAME PREPARATION AND PRESENTATION
    // ========================================================================
    async function prepareFramePackage({
      config = runtimeConfig,
      temporalPhase = 0,
      frameNumber = null
    } = {}) {
      if (!currentBytes || !sourceImage || isGenerating) return null;
      const frameConfig = cloneRuntimeConfig(config);
      const framePreparationRunId = ++preparationRunId;
      const sourceContext = captureSourceContext();
      const sourceToken = createSourceToken(sourceContext);
      const frameContext = createFramePreparationContext({
        sourceContext,
        config: frameConfig,
        frameNumber,
        generationRunId,
        preparationRunId: framePreparationRunId
      });
      const frameSource = frameContext.source.source;
      const frameSourceBytes = frameContext.source.bytes;
      const frameSourceImage = frameContext.source.image;
      const frameEndpointBlob = displayedFrameBlob || frameSource.blob;
      const frameEndpointUrl = glitchedUrl || sourceObjectUrl;
      const frameEndpointBytes = displayedFrameBytes || frameSourceBytes;
      const frameAnalysis = frameContext.source.analysis;
      const frameStructure = frameContext.source.structure;
      const frameCoefficientContext =
        frameContext.source.baselineCoefficientContext;
      const frameProgressiveCoefficientContext =
        frameContext.source.progressiveCoefficientContext;
      const frameFailureState = frameContext.source.failureState;
      const frameVarianceCoarse = frameContext.source.byteVarianceCoarse;
      const frameVarianceFine = frameContext.source.byteVarianceFine;
      const frameSpectralField = frameContext.source.jpegSpectralField;
      const frameFailureEvents = [];
      const mutationEventLog = createFrameMutationEventLog();
      const shouldContinue = () => (
        framePreparationRunId === preparationRunId &&
        isSourceTokenCurrent(sourceToken)
      );
      isGenerating = true;
      requestRuntimeOverlayRender();

      const mutationRate = frameConfig.mutationRate;
      const mode = frameConfig.mode;
      const region = frameConfig.region;
      const seed = frameConfig.seed;
      const layerSettings = getLayerSettings(frameConfig);
      const initialChangeBudget = Math.max(
        1,
        Math.round(frameStructure.entropyBytes * mutationRate)
      );
      const activeLayerCount = Object.values(layerSettings)
        .filter((layer) => layer.enabled).length;
      const configuredVariantExploration =
        variantExplorationMetadataByConfig.get(frameConfig);
      const frameVariantExploration = configuredVariantExploration
        ? JSON.parse(JSON.stringify(configuredVariantExploration))
        : {
            enabled: true,
            connected: false,
            source: "manual-config",
            requestedCount: activeLayerCount,
            resolvedCount: activeLayerCount,
            minimum: 1,
            maximum: layerNames.length,
            fallbackUsed: false,
            attemptedCount: 0,
            successfulCount: 0,
            compositedCount: 0,
            slots: layerNames.filter(
              (name) => layerSettings[name].enabled
            ).map((family, slot) => ({
              slot,
              family,
              priority: null,
              variantSeed: mixSeed(
                seed,
                `variant-slot:${family}`,
                frameAnalysis.fingerprint
              ) >>> 0,
              eligible: true,
              strategy: family === "entropy" ? mode : null
            }))
          };
      const configuredRegistryGeneration =
        registryGenerationMetadataByConfig.get(frameConfig);
      const frameRegistryGeneration = configuredRegistryGeneration
        ? JSON.parse(JSON.stringify(configuredRegistryGeneration))
        : {
            seed,
            requestedVariantCount: activeLayerCount,
            selectedTechniqueNames: layerNames.filter(
              (name) => layerSettings[name].enabled
            ),
            techniques: layerNames.filter(
              (name) => layerSettings[name].enabled
            ).map((name) => ({
              name,
              parameters: {
                mutationRate,
                strength: layerSettings[name].strength,
                mode: name === "entropy" ? mode : null,
                region
              },
              status: "pending",
              rejectReason: null
            })),
            successfulVariantCount: 0
          };
      const seedAttemptsPerBudget = 1;
      const maxRetries = 1;
      const failureContext = {
        failureEvents: frameFailureEvents,
        failureState: frameFailureState,
        structure: frameStructure,
        initialChangeBudget,
        shouldContinue,
        mutationEventLog,
        differenceReferenceBytes: frameEndpointBytes
      };
      const onFailureEvent = (event) => recordFailureEvent(
        event,
        failureContext
      );
      let lastError = null;
      try {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          const frameAttempt = attempt + 1;
          const frameBuild = createMutationBuild(mutationEventLog, {
            frameAttempt,
            stage: "final-frame",
            progress: 1
          });
          const seedAttempt = attempt % seedAttemptsPerBudget;
          const changeBudget = initialChangeBudget;
          const adjustedRate = changeBudget /
            Math.max(1, frameStructure.entropyBytes);
          const effectiveSeed = mixSeed(
            seed,
            `decode-attempt:${seedAttempt}`,
            frameAnalysis.fingerprint
          );
          let recipe = createGlitchRecipe(
            effectiveSeed,
            layerSettings,
            frameAnalysis,
            frameStructure,
            frameSourceBytes,
            frameCoefficientContext,
            frameProgressiveCoefficientContext,
            frameVariantExploration
          );
          let transitionPlan = createJpegTransitionPlan(recipe);
          let generationOptions = normalizeGenerationOptions({
            seed: effectiveSeed,
            mutationRate: adjustedRate,
            changeBudget,
            structure: frameStructure,
            analysis: frameAnalysis,
            temporalPhase,
            mode,
            region,
            layers: layerSettings,
            recipe,
            stage: "final-frame",
            frameAttempt,
            buildKey: frameBuild.buildKey,
            mutationEventLog,
            differenceReferenceBytes: frameEndpointBytes,
            initialChangeBudget,
            failureEvents: frameFailureEvents,
            failureState: frameFailureState,
            shouldContinue,
            byteVarianceCoarse: frameVarianceCoarse,
            byteVarianceFine: frameVarianceFine,
            jpegSpectralField: frameSpectralField,
            coefficientContext: frameCoefficientContext,
            progressiveCoefficientContext:
              frameProgressiveCoefficientContext,
            onFailureEvent,
            maskCoverage: frameConfig.maskCoverage,
            maskOpacity: frameConfig.maskOpacity
          }, frameContext.source);
          let states = [];
          let finalUrl = null;
          try {
            const preparedVariants = await generateRegistryVariantBatch({
              sourceBytes: frameSourceBytes,
              recipe,
              plan: transitionPlan,
              options: generationOptions,
              generationRecord: frameRegistryGeneration
            });
            const successfulNames = new Set(preparedVariants.keys());
            if (successfulNames.size === 0) {
              const error = new Error("all-selected-techniques-rejected");
              error.isMutationNoOp = true;
              error.code = "ALL_VARIANTS_REJECTED";
              throw error;
            }
            recipe = createSuccessfulRegistryRecipe(
              recipe,
              preparedVariants,
              frameRegistryGeneration
            );
            transitionPlan = createJpegTransitionPlan(recipe);
            const successfulLayerSettings = createSuccessfulLayerSettings(
              layerSettings,
              preparedVariants
            );
            generationOptions = {
              ...generationOptions,
              recipe,
              layers: successfulLayerSettings,
              registryVariantRoute: true,
              registryGeneration: frameRegistryGeneration
            };
            const finalResult = await compositeGlitchLayers(
              frameSourceBytes,
              frameSourceImage,
              { ...generationOptions, preparedVariants }
            );
            const finalBlob = finalResult.blob;
            const finalImage = await decodeImageBlob(finalBlob);
            const finalBytes = new Uint8Array(await finalBlob.arrayBuffer());
            const jpegEventCount = countCompositeMutationEvents(
              finalResult.mutationMetadata,
              transitionPlan.scaledNames
            );
            if (!shouldContinue()) {
              throw createGenerationCancelledError(
                "frame preparation cancelled"
              );
            }
            finalUrl = URL.createObjectURL(finalBlob);
            states = await prepareJpegTransitionStates({
              sourceBytes: frameSourceBytes,
              sourceImage: frameSourceImage,
              sourceBlob: frameEndpointBlob,
              sourceUrl: frameEndpointUrl,
              sourceEndpointBytes: frameEndpointBytes,
              recipe,
              transitionPlan,
              finalResult,
              finalBlob,
              finalBytes,
              finalImage,
              finalUrl,
              preparedVariants,
              jpegEventCount,
              mutationEventLog,
              frameAttempt,
              finalBuildKey: frameBuild.buildKey,
              options: {
                ...generationOptions,
                stage: "transition-state"
              }
            });
            if (!shouldContinue()) {
              throw createGenerationCancelledError(
                "frame preparation cancelled"
              );
            }
            const timeline = generationOptions.registryVariantRoute
              ? createRegistryTransitionPlaybackTimeline(
                  states,
                  frameRegistryGeneration
                )
              : createTransitionPlaybackTimeline(
                  effectiveSeed,
                  states.length,
                  frameFailureState
                );
            const processDifferenceDataByStateKey =
              createProcessDifferenceDataEntries(
                frameEndpointBytes,
                states
              );
            const timelineAudioAnchors = createTimelineAudioAnchors(
              timeline,
              states
            );
            const processPcmDataByStateKey = createProcessPcmDataEntries(
              processDifferenceDataByStateKey,
              timelineAudioAnchors
            );
            const failurePcmEvents = createFailurePcmEvents(
              frameFailureEvents
            );
            const mutationEvents = mutationEventLog.events.slice();
            const attemptedFamilies = new Set(
              frameRegistryGeneration.selectedTechniqueNames
            );
            const successfulFamilies = new Set(
              Object.keys(finalResult.mutationMetadata || {})
            );
            const variantExploration = {
              ...frameVariantExploration,
              attemptedCount: attemptedFamilies.size,
              successfulCount: successfulFamilies.size,
              compositedCount: finalResult.compositedLayers,
              transitionFailureCount: frameFailureEvents.filter(
                (event) => event.stage === "transition-state"
              ).length,
              slots: frameVariantExploration.slots.map((slot) => {
                const registryEntry = frameRegistryGeneration.techniques.find(
                  (entry) => entry.name === slot.family
                );
                const familyFailures = frameFailureEvents.filter(
                  (event) => event.family === slot.family &&
                    event.stage === "final-frame"
                );
                const strategy = slot.family === "entropy"
                  ? mode
                  : slot.family === "component"
                    ? recipe.variantSelections.component?.mode || null
                    : slot.family === "coefficient"
                      ? recipe.coefficientMode
                      : slot.family;
                return {
                  ...slot,
                  strategy,
                  sourceResolution:
                    preparedVariants.get(slot.family)?.sourceResolution ||
                    registryEntry?.parameters?.sourceResolution || null,
                  mutationSettings: {
                    configuredStrength:
                      registryEntry?.parameters?.strength ?? null,
                    recipeStrength: recipe[slot.family] ?? null,
                    mutationRate:
                      registryEntry?.parameters?.mutationRate ?? null,
                    changeBudget:
                      registryEntry?.parameters?.changeBudget ??
                      Math.max(1, Math.round(
                        frameStructure.entropyBytes *
                        (registryEntry?.parameters?.mutationRate || 0)
                      )),
                    region: registryEntry?.parameters?.region ?? null
                  },
                  attempted: attemptedFamilies.has(slot.family),
                  successful: successfulFamilies.has(slot.family),
                  composited: Boolean(
                    finalResult.mutationMetadata?.[slot.family]
                  ),
                  failureBehavior: {
                    count: familyFailures.length,
                    codes: familyFailures.map((event) => event.code),
                    retryLevels: familyFailures.map(
                      (event) => event.retryLevel
                    )
                  }
                };
              })
            };
            const mutationBuilds = snapshotMutationBuilds(mutationEventLog);
            const mutationBuildStateMap =
              snapshotMutationBuildStateMap(mutationEventLog);
            const failureAudioPlan = createFailureAudioEventPlan({
              failurePcmEvents,
              mutationEvents,
              mutationBuilds,
              mutationBuildStateMap,
              timelineAudioAnchors,
              registryGeneration: frameRegistryGeneration
            });
            if (!shouldContinue()) {
              throw createGenerationCancelledError(
                "frame difference preparation cancelled"
              );
            }
            const packageValue = {
              sourceToken: frameSource,
              sourceBytesToken: frameSourceBytes,
              preparationRunId: framePreparationRunId,
              frameNumber,
              config: frameConfig,
              seed,
              effectiveSeed,
              recipe,
              transitionPlan,
              states,
              finalBlob,
              finalUrl,
              finalBytes,
              finalImage,
              timeline,
              failureEvents: frameFailureEvents,
              mutationEvents,
              mutationBuilds,
              mutationBuildStateMap,
              timelineAudioAnchors,
              processPcmDataByStateKey,
              failurePcmEvents,
              failureAudioEvents: failureAudioPlan.events,
              variantExploration,
              registryGeneration: JSON.parse(JSON.stringify(
                frameRegistryGeneration
              )),
              compositedLayers: finalResult.compositedLayers,
              skippedLayers: finalResult.skippedLayers,
              spectralFieldPromise:
                buildJpegSpectralFieldFromBlob(finalBlob).catch((error) => {
                  console.warn("JPEG spectral feedback unavailable:", error);
                  return null;
                }),
              preparationMetadata: {
                staticVariantCount:
                  transitionPlan.staticBaseNames.length +
                  transitionPlan.staticLayerNames.length,
                scaledVariantCount: transitionPlan.scaledNames.length,
                jpegEventCount: Math.max(
                  jpegEventCount,
                  countPreparedVariantEvents(preparedVariants)
                ),
                decodedStateCount: states.length
              },
              resourcesReleased: false
            };
            return packageValue;
          } catch (error) {
            discardMutationBuildsForFrameAttempt(
              mutationEventLog,
              frameAttempt
            );
            if (states.length) {
              releasePreparedFramePackage({ states, finalUrl });
            } else if (finalUrl) {
              URL.revokeObjectURL(finalUrl);
            }
            if (isGenerationCancellation(error)) return null;
            lastError = error;
            if (error.isMutationNoOp) break;
            dispatchFailureEvent({
              family: "composite",
              stage: "final-frame",
              buildKey: frameBuild.buildKey,
              frameAttempt,
              attempt: frameAttempt,
              retryLevel: seedAttempt,
              seed: effectiveSeed,
              changeBudget,
              initialChangeBudget,
              clusters: [],
              region,
              byteLength: null,
              reason: error.message,
              code: "frame-attempt-failed",
              error
            }, failureContext);
          }
        }
        if (lastError && !lastError.isMutationNoOp) {
          console.error(lastError);
        }
        return null;
      } finally {
        isGenerating = false;
        requestRuntimeOverlayRender();
      }
    }

    async function presentPreparedFrame(prepared, { runId = autoRunId } = {}) {
      if (
        !prepared ||
        prepared.sourceToken !== currentSource ||
        prepared.sourceBytesToken !== currentBytes ||
        runId !== autoRunId
      ) {
        releasePreparedFramePackage(prepared);
        return false;
      }
      const transitionId = ++transitionRunId;
      const previousUrl = glitchedUrl;
      const promotedFinalUrl = prepared.finalUrl;
      runtimeConfig = cloneRuntimeConfig(prepared.config);
      currentFailureEvents = prepared.failureEvents;
      runtimeVariantExploration = prepared.variantExploration
        ? JSON.parse(JSON.stringify(prepared.variantExploration))
        : null;
      resetRuntimeTechniqueMeters(prepared.registryGeneration);
      requestRuntimeOverlayRender();
      setRuntimePhase("transition");
      activeTransitionResources = prepared.states.filter(
        (state) => state.ownsUrl !== false && !state.isFinal
      );
      stopAllProcessSounds({ releaseCache: true });
      stopAllFailureSounds({
        releaseCache: true,
        reason: "new-transition"
      });
      createProcessAudioBufferCache(prepared);
      createFailureAudioBufferCache(prepared, transitionId, runId);
      const atomicProcessSchedule =
        createAtomicDirectProcessSchedule(prepared);
      let atomicProcessStarted = false;
      try {
        for (let index = 0; index < prepared.timeline.length; index++) {
          if (!await waitForPlaybackResume(transitionId)) return false;
          if (transitionId !== transitionRunId || runId !== autoRunId) {
            return false;
          }
          const point = prepared.timeline[index];
          const state = Number.isInteger(point.index)
            ? prepared.states[point.index]
            : null;
          const isRejectSlot = point.techniqueStatus === "reject";
          if (!state && !isRejectSlot) return false;
          if (state) {
            if (!state.url) return false;
            backgroundImg.src = state.url;
            await backgroundImg.decode();
            if (transitionId !== transitionRunId || runId !== autoRunId) {
              return false;
            }
          }
          const holdMs = state?.isFinal
            ? Math.min(
                point.holdMs,
                transitionPlaybackConfig.lastStateMaxHold
              )
            : point.holdMs;
          if (isRejectSlot) {
            rejectRuntimeTechniqueMeter(
              point.techniqueName,
              point.techniqueMeterValue
            );
          } else if (point.techniqueName) {
            beginRuntimeTechniqueMeter(
              point.techniqueName,
              point.techniqueMeterValue
            );
          }
          const skipNormalFinalProcessStart = Boolean(
            atomicProcessStarted &&
            atomicProcessSchedule?.finalOccurrenceIndex === index
          );
          if (!skipNormalFinalProcessStart && state) {
            switchProcessSoundState({
              prepared,
              anchor: prepared.timelineAudioAnchors?.[index],
              occurrenceIndex: index,
              timelinePoint: point,
              state
            });
          } else if (isRejectSlot) {
            stopActiveProcessSound();
          }
          scheduleFailureSoundsForOccurrence({
            prepared,
            occurrenceIndex: index,
            transitionId,
            runId,
            durationMs: holdMs
          });
          if (atomicProcessSchedule?.startOccurrenceIndex === index) {
            const anchor = prepared.timelineAudioAnchors[index];
            const beforeStartMilliseconds = Math.max(
              0,
              Math.min(
                holdMs,
                atomicProcessSchedule.startOffsetMilliseconds - anchor.startMs
              )
            );
            if (
              beforeStartMilliseconds > 0 &&
              !await waitForPausableTransitionHold(
                beforeStartMilliseconds,
                transitionId
              )
            ) {
              return false;
            }
            if (!await waitForPlaybackResume(transitionId)) return false;
            if (transitionId !== transitionRunId || runId !== autoRunId) {
              return false;
            }
            atomicProcessStarted = startAtomicDirectProcessSound(
              prepared,
              atomicProcessSchedule
            );
            const afterStartMilliseconds = Math.max(
              0,
              holdMs - beforeStartMilliseconds
            );
            if (
              afterStartMilliseconds > 0 &&
              !await waitForPausableTransitionHold(
                afterStartMilliseconds,
                transitionId
              )
            ) {
              return false;
            }
          } else if (
            !await waitForPausableTransitionHold(holdMs, transitionId)
          ) {
            return false;
          }
          if (!isRejectSlot && point.techniqueName) {
            completeRuntimeTechniqueMeter(
              point.techniqueName,
              point.techniqueMeterValue
            );
          }
        }
        if (!await waitForPlaybackResume(transitionId)) return false;
        if (transitionId !== transitionRunId || runId !== autoRunId) {
          return false;
        }
        stopAllFailureSounds({ reason: "transition-end" });
        stopActiveProcessSound();
        backgroundImg.src = promotedFinalUrl;
        await backgroundImg.decode();
        if (transitionId !== transitionRunId || runId !== autoRunId) {
          return false;
        }
        glitchedUrl = replaceOwnedObjectUrl({
          previousUrl,
          nextUrl: promotedFinalUrl,
          preservedUrls: [sourceObjectUrl]
        });
        displayedFrameBlob = prepared.finalBlob;
        displayedFrameBytes = prepared.finalBytes;
        document.body.classList.add("has-background");
        const finalState = prepared.states.find((state) => state.isFinal);
        if (finalState?.url === promotedFinalUrl) finalState.ownsUrl = false;
        prepared.finalUrl = null;
        releasePreparedFramePackage(prepared);
        activeTransitionResources = [];
        if (previousUrl) playTransitionCompleteBeep();
        setRuntimePhase("hold");
        displayedFramePresentedAt = performance.now();
        displayedFrameHoldMilliseconds = getIntervalMilliseconds(
          prepared.config
        );
        displayedSpectralFieldPromise = prepared.spectralFieldPromise;
        preparedFramePackage = null;
        const activeLayers = prepared.transitionPlan.activeNames
          .map((name) => name.toUpperCase()).join("+") || "NONE";
        const skipped = prepared.skippedLayers.length
          ? ` / skipped ${prepared.skippedLayers.join(",")}`
          : "";
        setStatus(
          `generated (${activeLayers} / ${prepared.compositedLayers} variants${skipped} / frame ${(prepared.frameNumber ?? 0) + 1} / seed ${prepared.seed})`
        );
        return true;
      } finally {
        if (glitchedUrl !== promotedFinalUrl) {
          stopAllProcessSounds({ releaseCache: true });
          stopAllFailureSounds({
            releaseCache: true,
            reason: "transition-cancel"
          });
          releasePreparedFramePackage(prepared);
          if (preparedFramePackage === prepared) preparedFramePackage = null;
        }
      }
    }

    const transitionPlaybackConfig = {
      totalDuration: 750,
      burstHoldMin: 24,
      burstHoldMax: 55,
      normalHoldMin: 55,
      normalHoldMax: 100,
      pauseHoldMin: 100,
      pauseHoldMax: 180,
      lastStateMaxHold: 50,
      maxPreparedStateCount: 10
    };

    const transitionAudioConfig = {
      frequency: 523.251,
      onsetDelay: 0.01,
      attackEnd: 0.015,
      sustainEnd: 0.15,
      duration: 0.155,
      gain: 0.3
    };

    const JPEG_TRANSITION_NOISE_GAIN = 0.055;
    const ATOMIC_PROCESS_SOUND_LEAD_MS = 300;

    // ========================================================================
    // 17. PLAYBACK AND AUDIO
    // ========================================================================
    function createFailurePlaybackPlan({
      audioBufferDurationSeconds,
      audioBufferSampleRate,
      remainingTransitionSeconds = Infinity,
      playbackRate = FAILURE_PLAYBACK_RATE,
      edgeFadeSamples = 0
    } = {}) {
      const normalizedPlaybackRate = Math.max(
        Number.EPSILON,
        Number.isFinite(playbackRate) ? playbackRate : FAILURE_PLAYBACK_RATE
      );
      const normalizedBufferDurationSeconds = Math.max(
        0,
        Number(audioBufferDurationSeconds) || 0
      );
      const normalizedSampleRate = Math.max(
        0,
        Number(audioBufferSampleRate) || 0
      );
      const normalizedEdgeFadeSamples = Math.max(
        0,
        Math.floor(Number(edgeFadeSamples) || 0)
      );
      const normalizedRemainingTransitionSeconds =
        Number.isFinite(remainingTransitionSeconds)
          ? Math.max(0, remainingTransitionSeconds)
          : Infinity;
      const sourceOffsetSeconds = Math.min(
        normalizedBufferDurationSeconds * 0.5,
        normalizedSampleRate > 0
          ? normalizedEdgeFadeSamples / normalizedSampleRate
          : 0
      );
      const playableSourceDurationSeconds = Math.max(
        0,
        normalizedBufferDurationSeconds - sourceOffsetSeconds * 2
      );
      const naturalDurationSeconds =
        playableSourceDurationSeconds / normalizedPlaybackRate;
      const audibleDurationSeconds = Math.min(
        naturalDurationSeconds,
        normalizedRemainingTransitionSeconds
      );
      const sourceDurationSeconds = Math.min(
        playableSourceDurationSeconds,
        audibleDurationSeconds * normalizedPlaybackRate
      );
      return Object.freeze({
        playbackMode: "hard-gated",
        playbackRate: normalizedPlaybackRate,
        requestedDurationMs: null,
        naturalDurationMs: naturalDurationSeconds * 1000,
        audibleDurationMs: audibleDurationSeconds * 1000,
        sourceOffsetSeconds,
        sourceOffsetMs: sourceOffsetSeconds * 1000,
        sourceDurationSeconds,
        sourceDurationMs: sourceDurationSeconds * 1000,
        stopOffsetSeconds: audibleDurationSeconds,
        truncatedByTransitionEnd:
          normalizedRemainingTransitionSeconds <
            naturalDurationSeconds
      });
    }

    function getTransitionAudioContext() {
      if (transitionAudioContext) return transitionAudioContext;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      transitionAudioContext = new AudioContextClass();
      return transitionAudioContext;
    }

    function removeTransitionAudioUnlock() {
      if (!transitionAudioUnlockInstalled) return;
      document.removeEventListener("pointerdown", unlockTransitionAudio, true);
      document.removeEventListener("keydown", unlockTransitionAudio, true);
      document.removeEventListener("touchstart", unlockTransitionAudio, true);
      document.removeEventListener("drop", unlockTransitionAudio, true);
      transitionAudioUnlockInstalled = false;
    }

    function unlockTransitionAudio() {
      const context = getTransitionAudioContext();
      if (!context) return;
      const resume = context.state === "running"
        ? Promise.resolve()
        : context.resume();
      resume.then(() => {
        if (context.state === "running") removeTransitionAudioUnlock();
      }).catch(() => {
        // Browsers may reject resume calls that are not tied to a user gesture.
      });
    }

    function installTransitionAudioUnlock() {
      if (transitionAudioUnlockInstalled) return;
      document.addEventListener("pointerdown", unlockTransitionAudio, true);
      document.addEventListener("keydown", unlockTransitionAudio, true);
      document.addEventListener("touchstart", unlockTransitionAudio, {
        capture: true,
        passive: true
      });
      document.addEventListener("drop", unlockTransitionAudio, true);
      transitionAudioUnlockInstalled = true;
    }

    function createAudioBufferFromPcmData(pcmData, context) {
      const samples = pcmData?.samples;
      if (!context || !samples?.length) return null;
      const sampleRate = Number.isFinite(Number(pcmData.sampleRate)) &&
        Number(pcmData.sampleRate) > 0
        ? Number(pcmData.sampleRate)
        : context.sampleRate;
      const buffer = context.createBuffer(
        1,
        samples.length,
        sampleRate
      );
      if (typeof buffer.copyToChannel === "function") {
        buffer.copyToChannel(samples, 0);
      } else {
        buffer.getChannelData(0).set(samples);
      }
      return buffer;
    }

    function getProcessPcmDataForState(prepared, state) {
      if (!state?.stateKey) return null;
      return prepared?.processPcmDataByStateKey?.find(
        (entry) => entry.stateKey === state.stateKey
      )?.pcmData || null;
    }

    function createAtomicDirectProcessSchedule(prepared) {
      const plan = prepared?.transitionPlan;
      const states = prepared?.states || [];
      const anchors = prepared?.timelineAudioAnchors || [];
      const activeNames = plan?.activeNames || [];
      if (
        !plan?.isAtomicOnly ||
        activeNames.length !== 1 ||
        !activeNames.every((name) =>
          getRecipeVariantTransitionMode(name, prepared?.recipe) === "direct"
        ) ||
        states.length !== 2 ||
        anchors.length !== 2 ||
        states[0]?.mutationMetadata?.endpoint !== "source" ||
        !states[1]?.isFinal
      ) {
        return null;
      }
      const sourcePcmData = getProcessPcmDataForState(prepared, states[0]);
      const finalPcmData = getProcessPcmDataForState(prepared, states[1]);
      if (sourcePcmData?.silent !== true || finalPcmData?.silent !== false) {
        return null;
      }
      const finalOccurrenceIndex = anchors.findIndex(
        (anchor) => anchor.stateKey === states[1].stateKey
      );
      const totalDurationMilliseconds = anchors.at(-1)?.endMs || 0;
      if (finalOccurrenceIndex < 0 || totalDurationMilliseconds <= 0) {
        return null;
      }
      const leadMilliseconds = Math.min(
        ATOMIC_PROCESS_SOUND_LEAD_MS,
        totalDurationMilliseconds
      );
      const startOffsetMilliseconds = Math.max(
        0,
        totalDurationMilliseconds - leadMilliseconds
      );
      const startOccurrenceIndex = anchors.findIndex((anchor, index) =>
        startOffsetMilliseconds >= anchor.startMs &&
        (
          startOffsetMilliseconds < anchor.endMs ||
          (index === anchors.length - 1 &&
            startOffsetMilliseconds === anchor.endMs)
        )
      );
      if (startOccurrenceIndex < 0) return null;
      return Object.freeze({
        finalState: states[1],
        finalStateIndex: 1,
        finalOccurrenceIndex,
        startOccurrenceIndex,
        leadMilliseconds,
        startOffsetMilliseconds,
        totalDurationMilliseconds
      });
    }

    function createProcessAudioBufferCache(prepared) {
      releaseProcessAudioBufferCache();
      const pcmByStateKey = new Map(
        (prepared?.processPcmDataByStateKey || []).map((entry) => [
          entry.stateKey,
          entry.pcmData
        ])
      );
      const cache = {
        prepared,
        pcmByStateKey,
        buffersByStateKey: new Map()
      };
      processAudioBufferCache = cache;
      return cache;
    }

    function releaseProcessAudioBufferCache(prepared = null) {
      const cache = processAudioBufferCache;
      if (!cache || (prepared && cache.prepared !== prepared)) return false;
      cache.buffersByStateKey.clear();
      cache.pcmByStateKey.clear();
      processAudioBufferCache = null;
      return true;
    }

    function getProcessAudioBufferForState(prepared, stateKey, context) {
      const cache = processAudioBufferCache;
      if (!cache || cache.prepared !== prepared) return null;
      if (cache.buffersByStateKey.has(stateKey)) {
        return {
          buffer: cache.buffersByStateKey.get(stateKey),
          pcmData: cache.pcmByStateKey.get(stateKey)
        };
      }
      const pcmData = cache.pcmByStateKey.get(stateKey);
      if (!pcmData) return null;
      if (pcmData.silent || !pcmData.samples?.some((sample) => sample !== 0)) {
        return { buffer: null, pcmData };
      }
      const buffer = createAudioBufferFromPcmData(pcmData, context);
      if (!buffer) return null;
      cache.buffersByStateKey.set(stateKey, buffer);
      return { buffer, pcmData };
    }

    function disconnectAudioRuntime(runtime) {
      for (const node of [runtime.source, runtime.gain]) {
        try {
          node.disconnect();
        } catch {
          // A stopped audio node may already be disconnected.
        }
      }
    }

    function stopAudioRuntimeImmediately(runtime, disconnect) {
      if (!runtime || runtime.ended) return false;
      const context = transitionAudioContext;
      const canSchedule = context && context.state !== "closed";
      const now = canSchedule ? context.currentTime : undefined;
      if (canSchedule) {
        runtime.gain.gain.cancelScheduledValues(now);
        runtime.gain.gain.setValueAtTime(0, now);
      }
      try {
        if (canSchedule) runtime.source.stop(now);
        else runtime.source.stop();
      } catch {
        // The source may have stopped naturally before cancellation.
      }
      disconnect(runtime);
      return true;
    }

    function disconnectProcessSound(sound) {
      if (!sound || sound.ended) return;
      sound.ended = true;
      if (activeProcessSound === sound) activeProcessSound = null;
      disconnectAudioRuntime(sound);
    }

    function stopProcessSound(sound) {
      return stopAudioRuntimeImmediately(sound, disconnectProcessSound);
    }

    function stopActiveProcessSound() {
      return stopProcessSound(activeProcessSound);
    }

    function stopAllProcessSounds({ releaseCache = false } = {}) {
      stopActiveProcessSound();
      if (releaseCache) releaseProcessAudioBufferCache();
    }

    function startProcessSoundForOccurrence({
      prepared,
      stateKey
    }) {
      stopActiveProcessSound();
      const cache = processAudioBufferCache;
      const context = transitionAudioContext;
      if (!cache || cache.prepared !== prepared ||
          !context || context.state !== "running") {
        return false;
      }
      const resolved = getProcessAudioBufferForState(
        prepared,
        stateKey,
        context
      );
      if (!resolved) return false;
      if (!resolved.buffer) return false;

      const source = context.createBufferSource();
      const gain = context.createGain();
      const now = context.currentTime;
      source.buffer = resolved.buffer;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(
        JPEG_TRANSITION_NOISE_GAIN,
        now
      );
      source.connect(gain);
      gain.connect(context.destination);
      const runtime = {
        source,
        gain,
        ended: false
      };
      source.onended = () => disconnectProcessSound(runtime);
      try {
        source.start(now);
      } catch {
        disconnectProcessSound(runtime);
        return false;
      }
      activeProcessSound = runtime;
      return true;
    }

    function startAtomicDirectProcessSound(prepared, schedule) {
      if (!schedule) return false;
      return startProcessSoundForOccurrence({
        prepared,
        stateKey: schedule.finalState.stateKey
      });
    }

    function switchProcessSoundState({
      prepared,
      anchor,
      occurrenceIndex,
      timelinePoint,
      state
    }) {
      const synchronized = Boolean(
        anchor &&
        anchor.occurrenceIndex === occurrenceIndex &&
        anchor.timelineIndex === occurrenceIndex &&
        anchor.stateIndex === timelinePoint?.index &&
        anchor.stateKey === state?.stateKey
      );
      if (!synchronized) {
        stopActiveProcessSound();
        console.warn("Process Sound state synchronization mismatch");
        return false;
      }
      return startProcessSoundForOccurrence({
        prepared,
        stateKey: anchor.stateKey
      });
    }

    function createFailureAudioBufferCache(prepared, transitionId, runId) {
      releaseFailureAudioBufferCache();
      const pcmBySequence = new Map(
        (prepared?.failurePcmEvents || []).map((entry) => [
          entry.sequence,
          entry.pcmData
        ])
      );
      const eventsByOccurrence = new Map();
      for (const event of prepared?.failureAudioEvents || []) {
        if (!event.audible || event.targetOccurrenceIndex === null) continue;
        const events = eventsByOccurrence.get(event.targetOccurrenceIndex) || [];
        events.push(event);
        eventsByOccurrence.set(event.targetOccurrenceIndex, events);
      }
      const cache = {
        prepared,
        transitionId,
        runId,
        plannedTransitionDurationMs:
          prepared?.timelineAudioAnchors?.at(-1)?.endMs || 0,
        pcmBySequence,
        eventsByOccurrence,
        buffersBySequence: new Map(),
        playedSequences: new Set()
      };
      failureAudioBufferCache = cache;
      return cache;
    }

    function releaseFailureAudioBufferCache(prepared = null) {
      const cache = failureAudioBufferCache;
      if (!cache || (prepared && cache.prepared !== prepared)) return false;
      cache.buffersBySequence.clear();
      cache.pcmBySequence.clear();
      cache.eventsByOccurrence.clear();
      cache.playedSequences.clear();
      failureAudioBufferCache = null;
      return true;
    }

    function getFailureAudioBuffer(prepared, failureSequence, context) {
      const cache = failureAudioBufferCache;
      if (!cache || cache.prepared !== prepared) return null;
      if (cache.buffersBySequence.has(failureSequence)) {
        return cache.buffersBySequence.get(failureSequence);
      }
      const pcmData = cache.pcmBySequence.get(failureSequence);
      if (!pcmData || pcmData.silent || !pcmData.samples?.length) return null;
      const buffer = createAudioBufferFromPcmData(pcmData, context);
      if (!buffer) return null;
      cache.buffersBySequence.set(failureSequence, buffer);
      return buffer;
    }

    function disconnectFailureSound(runtime) {
      if (!runtime || runtime.ended) return;
      runtime.ended = true;
      activeFailureSounds.delete(runtime);
      disconnectAudioRuntime(runtime);
    }

    function stopFailureSound(runtime) {
      return stopAudioRuntimeImmediately(runtime, disconnectFailureSound);
    }

    function clearPendingFailureSoundTimers() {
      for (const runtime of [...pendingFailureSoundTimers]) {
        clearTimeout(runtime.timerId);
        pendingFailureSoundTimers.delete(runtime);
        runtime.cancelled = true;
      }
    }

    function stopAllFailureSounds({
      releaseCache = false
    } = {}) {
      clearPendingFailureSoundTimers();
      for (const runtime of [...activeFailureSounds]) {
        stopFailureSound(runtime);
      }
      if (releaseCache) releaseFailureAudioBufferCache();
    }

    function startFailureSoundEvent({
      prepared,
      event,
      transitionId,
      runId
    }) {
      const cache = failureAudioBufferCache;
      const context = transitionAudioContext;
      if (!cache || cache.prepared !== prepared ||
          cache.transitionId !== transitionId || cache.runId !== runId ||
          transitionId !== transitionRunId || runId !== autoRunId ||
          currentSource !== prepared.sourceToken || playbackPaused ||
          runtimePhase !== "transition") {
        return false;
      }
      if (cache.playedSequences.has(event.failureSequence)) return false;
      cache.playedSequences.add(event.failureSequence);
      if (!context || context.state !== "running") return false;
      const audioBuffer = getFailureAudioBuffer(
        prepared,
        event.failureSequence,
        context
      );
      if (!audioBuffer) return false;

      const remainingTransitionSeconds = Math.max(
        0,
        (cache.plannedTransitionDurationMs - event.scheduledMs) / 1000
      );
      const playbackPlan = createFailurePlaybackPlan({
        audioBufferDurationSeconds: audioBuffer.duration,
        audioBufferSampleRate: audioBuffer.sampleRate,
        remainingTransitionSeconds
      });
      if (!(playbackPlan.stopOffsetSeconds > 0)) return false;

      const source = context.createBufferSource();
      const gain = context.createGain();
      const now = context.currentTime;
      source.buffer = audioBuffer;
      source.playbackRate.setValueAtTime(playbackPlan.playbackRate, now);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(FAILURE_SOUND_GAIN, now);
      source.connect(gain);
      gain.connect(context.destination);
      const runtime = {
        source,
        gain,
        ended: false
      };
      source.onended = () => disconnectFailureSound(runtime);
      try {
        source.start(
          now,
          playbackPlan.sourceOffsetSeconds,
          playbackPlan.sourceDurationSeconds
        );
      } catch {
        disconnectFailureSound(runtime);
        return false;
      }
      flashRuntimePhaseFailureMarker();
      activeFailureSounds.add(runtime);
      return true;
    }

    function scheduleFailureSoundsForOccurrence({
      prepared,
      occurrenceIndex,
      transitionId,
      runId,
      durationMs
    }) {
      const cache = failureAudioBufferCache;
      if (!cache || cache.prepared !== prepared ||
          cache.transitionId !== transitionId || cache.runId !== runId) {
        return 0;
      }
      const events = cache.eventsByOccurrence.get(occurrenceIndex) || [];
      if (playbackPaused) return 0;
      for (const event of events) {
        if (transitionAudioContext?.state !== "running") continue;
        const delayMs = Math.max(
          0,
          Math.min(Number(durationMs) || 0, event.offsetWithinStateMs || 0)
        );
        const timerRuntime = {
          timerId: null,
          cancelled: false
        };
        timerRuntime.timerId = setTimeout(() => {
          pendingFailureSoundTimers.delete(timerRuntime);
          if (timerRuntime.cancelled) return;
          startFailureSoundEvent({
            prepared,
            event,
            transitionId,
            runId
          });
        }, delayMs);
        pendingFailureSoundTimers.add(timerRuntime);
      }
      return events.length;
    }

    function playTransitionCompleteBeep() {
      const context = transitionAudioContext;
      if (!context || context.state !== "running") return false;
      const start = context.currentTime;
      const end = start + transitionAudioConfig.duration;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(transitionAudioConfig.frequency, start);
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.setValueAtTime(
        0,
        start + transitionAudioConfig.onsetDelay
      );
      envelope.gain.linearRampToValueAtTime(
        transitionAudioConfig.gain,
        start + transitionAudioConfig.attackEnd
      );
      envelope.gain.setValueAtTime(
        transitionAudioConfig.gain,
        start + transitionAudioConfig.sustainEnd
      );
      envelope.gain.linearRampToValueAtTime(0, end);
      oscillator.connect(envelope);
      envelope.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(end);
      return true;
    }

    // ========================================================================
    // 18. BOOTSTRAP
    // ========================================================================

    void initializeApp();
