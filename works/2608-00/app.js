"use strict";

/* =========================================================
   Finite Cycles

   Three layers, deliberately separated:

   1. TRANSPORT owns absolute musical position, as an anchor pair
      (anchorBeat at anchorAudioTime) rather than an elapsed time. It is
      never moved by editing, so tempo changes, seeks and structural
      edits all happen without the current beat jumping.

   2. SEQUENCE is the applied cycle structure. A track's playing
      position is not stored; it is *derived* from the absolute
      transport beat via resolveTrackPositionAtBeat(), which is what
      makes an edit safe — the same absolute beat is simply re-resolved
      against the new loop.

   3. SCHEDULER expands cycle passes forward in transport BEATS into a
      pendingEvents queue, and commits only events inside a short
      lookahead to WebAudio. Because far-future hits never reach the
      audio graph, any edit can discard the queue and rebuild it from
      the current transport position.

   The sequence text is an explicit-apply editor: typing updates a draft
   only, and nothing is parsed or canonicalized until it is applied.
   ========================================================= */

/* ===== State ===== */

// The tempo range the GUI field, the DSL "bpm" directive and every
// clamp all share, so the three can never disagree about what is valid.
const MIN_TEMPO = 40;
const MAX_TEMPO = 240;
const DEFAULT_TEMPO = 120;

/* ----- Cycle identity -----
   A cycle id is an internal entity identity, not a label: it survives
   every GUI edit, every MOVE, and every DSL apply that can still
   recognise the cycle. It is deliberately global rather than derived
   from the track name, so a track that is deleted and re-created never
   revives the ids of its old cycles, and so cycles can later be moved
   between tracks without renumbering. Ids are never written to the DSL.
*/
let globalCycleIdCounter = 0;

function generateCycleId() {
  globalCycleIdCounter += 1;
  return `cycle-${globalCycleIdCounter}`;
}

// Groups get their own stable, globally unique ids for the same reasons
// cycles do: selection, the Inspector, and reconciliation across a DSL
// apply all need to say "the same group" after an edit.
let globalGroupIdCounter = 0;

function generateGroupId() {
  globalGroupIdCounter += 1;
  return `group-${globalGroupIdCounter}`;
}

// A track is an *instance* (id/name) that plays one of the available
// instruments. Multiple tracks may share an instrument ("hat", "hat2",
// "hat3" all play the hat voice), so track identity and sound source
// are deliberately separate fields.
//
// This is the single source of truth for the initial sequence: the
// initial DSL text is serialized from here, never written out by hand.
function createInitialState() {
  return {
    tempo: DEFAULT_TEMPO,
    isPlaying: false,
    tracks: [
      {
        id: "hat",
        name: "hat",
        instrument: "hat",
        sequence: [{ type: "cycle", id: generateCycleId(), span: rationalFromInteger(4), division: 5, offset: rationalFromInteger(0), hits: [1, 2, 3, 4, 5], hitMode: "explicit", repeat: 1, repeatExplicit: true, pass: false }],
      },
      {
        id: "snare",
        name: "snare",
        instrument: "snare",
        sequence: [{ type: "cycle", id: generateCycleId(), span: rationalFromInteger(5), division: 5, offset: rationalFromInteger(0), hits: [3], hitMode: "explicit", repeat: 1, repeatExplicit: true, pass: false }],
      },
      {
        id: "kick",
        name: "kick",
        instrument: "kick",
        sequence: [{ type: "cycle", id: generateCycleId(), span: rationalFromInteger(4), division: 4, offset: rationalFromInteger(0), hits: [1, 3], hitMode: "explicit", repeat: 1, repeatExplicit: true, pass: false }],
      },
    ],
  };
}

let state = createInitialState();

/* ----- Editor draft state -----
   The textarea is an explicit-apply code editor, not a live settings
   field. `draftText` is whatever is typed (possibly mid-syntax and
   invalid); `appliedText` is the canonical DSL of the state that the
   GUI, timeline and scheduler are actually running.
*/
let editorState = {
  draftText: "",
  appliedText: "",
  isDirty: false,
  lastApplyError: null,
};

// Transient runtime state (not part of the serialized/parsed model).

/* ----- Selection -----
   Selection is a *set*, not a single cycle: PASS, DELETE and MOVE all
   operate on whatever is selected, and a single selection is simply a
   set of one. `anchor` is the cycle a Shift-click ranges from.
*/
let selectionState = {
  items: [], // [{ trackId, cycleId }] — no duplicates
  anchor: null, // { trackId, cycleId } | null
};

/* ----- Clipboard (Phase 1.9F) -----
   Deliberately an internal buffer rather than the OS clipboard. What is
   copied is a piece of STRUCTURE — cycles and groups with their spans,
   offsets, hits and repeats — and the DSL text that would represent it
   is a lossy stand-in: it cannot say which group a run of cycles came
   out of, and pasting it back would have to re-parse and re-reconcile
   ids. Holding the objects sidesteps all of that.

   `items` are deep copies taken at COPY time, so editing (or undoing)
   the originals afterwards cannot reach into what was copied, and one
   copy can be pasted any number of times. Ids in here are stale by
   design; paste mints fresh ones.

   Not part of a history snapshot: undo restores the music, not what the
   user happens to be carrying. */
let clipboardState = {
  items: [],
  sourceTrackId: null, // where a paste lands when nothing is selected
};

/* ----- Undo / Redo history (Phase 1.9A) -----
   Snapshots, not commands. A command log would need an inverse for every
   edit — and "ungroup", "apply this DSL" and "initialize" have awkward
   ones — whereas the whole structure is small, plain JSON (that is why
   a Rational is an object of two integers rather than a class), so
   copying it is both cheaper to reason about and impossible to get
   subtly wrong.

   A snapshot holds STRUCTURE only: tracks, tempo and the selection.
   Deliberately absent are the transport position, play state, scheduler
   queues, timeline zoom/scroll, lane scroll, FOLLOW, the unapplied text
   draft and any parse error. Undo restores what the music IS, never
   where the playhead happens to be: the restored structure is
   re-interpreted against the same absolute beat that is already
   playing, exactly as a live edit is.
*/
const HISTORY_LIMIT = 100;

let undoStack = [];
let redoStack = [];
/* The state as it stands right now — what the NEXT edit will undo back
   to. Keeping it here is what lets one snapshot be taken per COMMIT
   rather than per mutator: every structural edit already funnels through
   afterStructuralMutation(), which pushes this and re-captures. No
   mutator has to remember to do anything. */
let presentSnapshot = null;
// Set while a snapshot is being restored, so the restore's own re-render
// and re-scheduling do not record themselves as new history.
let isRestoringHistory = false;

let lastSelectionMap = []; // [{ trackId, cycleId, start, end }]
let playheadRefs = {}; // trackId -> { segmentEls, hitEls }
let laneRefs = {}; // trackId -> { scrollEl, lane, segments, totalBeats, playhead }
/* ----- Timeline view state -----
   The bottom timeline has its own, independently zoomable scale. The
   track lanes above keep a fixed scale because they are for editing;
   the timeline is for reading a whole common cycle, which may be four
   beats or seven hundred, so it needs to stretch.
*/
let timelineViewState = {
  mode: "common", // "common" | "local"
  pixelsPerBeat: 8,
  minPixelsPerBeat: 0.5,
  maxPixelsPerBeat: 128,
  fitMode: true, // the whole common cycle is kept inside the viewport
  autoFollow: false, // scroll to keep the playhead visible while playing
  commonScrollLeft: 0, // remembered across a trip through the Local view
};

let timelineTrackRefs = {}; // trackId -> { bar, playhead, totalBeats, mode, renderedCycleId }
let timelineGlobalPlayhead = null; // one line spanning the whole Common view
let inspectorRefs = null; // { currentValueEl } for cheap live updates

/* ===== Utilities ===== */

// Track lanes are fixed at this scale so the same beat lines up
// vertically across every track. The bottom timeline no longer shares
// it — see timelineViewState.pixelsPerBeat.
const LANE_PIXELS_PER_BEAT = 64;
const INTEGER_SNAP_THRESHOLD = 0.12;
// Below this many pixels of pointer travel, a hit-dot press is a click
// (select / wait for dblclick); at or beyond it, it is a drag.
const HIT_DRAG_THRESHOLD = 3;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHits(hits) {
  return Array.from(new Set(hits)).sort((a, b) => a - b);
}

/* A ratchet belongs to a base grid hit. Counts of one are deliberately
   omitted from the map: that keeps pre-ratchet cycles identical in shape
   and makes `1*1` naturally canonicalize to `1`. `all*N` stores N once in
   allRatchet so a later span/division/offset edit can give newly-created
   ALL grid positions the same subdivision. */
function ratchetKey(hitValue) {
  return String(hitValue);
}

function ratchetCountForHit(cycle, hitValue) {
  if (cycle.hitMode === "all") {
    const allCount = Number(cycle.allRatchet);
    return Number.isSafeInteger(allCount) && allCount >= 1 ? allCount : 1;
  }
  const count = cycle.ratchets && Number(cycle.ratchets[ratchetKey(hitValue)]);
  return Number.isSafeInteger(count) && count >= 1 ? count : 1;
}

function normalizeCycleRatchets(cycle) {
  if (cycle.hitMode === "all") {
    cycle.ratchets = {};
    const count = Number(cycle.allRatchet);
    cycle.allRatchet = Number.isSafeInteger(count) && count >= 1 ? count : 1;
    return;
  }

  const live = new Set(normalizeHits(cycle.hits).map(ratchetKey));
  const normalized = {};
  Object.entries(cycle.ratchets || {}).forEach(([key, rawCount]) => {
    const count = Number(rawCount);
    if (live.has(key) && Number.isSafeInteger(count) && count > 1) normalized[key] = count;
  });
  cycle.ratchets = normalized;
  cycle.allRatchet = 1;
}

/* ===== Phase shift (Phase 1.9K) =====
   Phase never rewrites cycle.hits. It is evaluated from the cycle repeat
   index at the last possible moment, before ratchets are expanded. */
const PHASE_NONE = Object.freeze({ type: "none" });
const randomPhasePrefixCache = new WeakMap();

function phaseSpecOf(cycle) {
  return cycle && cycle.phase && cycle.phase.type ? cycle.phase : PHASE_NONE;
}

function hasPhaseShift(cycle) {
  return phaseSpecOf(cycle).type !== "none";
}

function phaseDependsOnRepeat(cycle) {
  const type = phaseSpecOf(cycle).type;
  return type !== "none" && type !== "fixed";
}

function phaseRational(value) {
  if (value && Number.isSafeInteger(value.numerator) && Number.isSafeInteger(value.denominator)) {
    return createRational(value.numerator, value.denominator);
  }
  return Number.isSafeInteger(value) ? rationalFromInteger(value) : null;
}

function phaseHold(phase) {
  const hold = Number(phase && phase.hold);
  return Number.isSafeInteger(hold) && hold >= 1 ? hold : 1;
}

function phaseStepIndex(phase, cycleRepeatIndex) {
  return Math.floor(Math.max(0, Math.floor(Number(cycleRepeatIndex) || 0)) / phaseHold(phase));
}

// Source omission has a meaningful runtime form for scalar accumulating
// phases: keep playing until the phase returns to its origin. This helper
// is deliberately separate from serialization; it only answers duration.
function autoRepeatForPhase(division, phase) {
  if (!phase || phase.type !== "accumulate" || phase.values.length !== 1) return 1;
  const step = phaseRational(phase.values[0]);
  if (!step || step.numerator === 0) return 1;
  const denominatorTimesDivision = step.denominator * division;
  const period = denominatorTimesDivision / gcdInteger(Math.abs(step.numerator), denominatorTimesDivision);
  return period * phaseHold(phase);
}

function parsePhaseRational(raw) {
  const text = String(raw).trim();
  const match = /^([+-]?\d+)(?:\/(\d+))?$/.exec(text);
  if (!match) return { ok: false, error: `phase value "${text}" must be a signed integer or fraction` };
  const numerator = Number(match[1]);
  const denominator = match[2] === undefined ? 1 : Number(match[2]);
  if (denominator === 0) return { ok: false, error: "phase denominator must not be 0" };
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    return { ok: false, error: `phase value "${text}" exceeds the supported integer range` };
  }
  const value = createRational(numerator, denominator);
  return value ? { ok: true, value } : { ok: false, error: `invalid phase value "${text}"` };
}

function parsePhaseValueList(raw) {
  const parts = String(raw).split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: "phase sequence requires at least one value" };
  const values = [];
  for (const part of parts) {
    const value = parsePhaseRational(part);
    if (!value.ok) return value;
    values.push(value.value);
  }
  return { ok: true, values };
}

function parsePhaseHold(raw) {
  if (raw === undefined) return { ok: true, value: 1 };
  const hold = Number(raw);
  if (!Number.isSafeInteger(hold) || hold < 1 || hold > MAX_REPEAT) {
    return { ok: false, error: `phase hold must be an integer between 1 and ${MAX_REPEAT}` };
  }
  return { ok: true, value: hold };
}

function parsePhaseSpec(raw) {
  const sourceToken = String(raw === undefined ? "" : raw).trim();
  if (sourceToken === "") return { ok: true, phase: PHASE_NONE, sourceToken: "" };

  let match = /^@([+-]?\d+(?:\/\d+)?)$/.exec(sourceToken);
  if (match) {
    const value = parsePhaseRational(match[1]);
    if (!value.ok) return value;
    return { ok: true, phase: { type: "fixed", value: value.value }, sourceToken };
  }

  match = /^@([<>])([+-]?\d+(?:\/\d+)?)(?:\:(\d+))?$/.exec(sourceToken);
  if (match) {
    const value = parsePhaseRational(match[2]);
    const hold = parsePhaseHold(match[3]);
    if (!value.ok) return value;
    if (!hold.ok) return hold;
    return { ok: true, phase: { type: "accumulate", direction: match[1], values: [value.value], hold: hold.value }, sourceToken };
  }

  match = /^@([<>])\(([^)]*)\)(?:\:(\d+))?$/.exec(sourceToken);
  if (match) {
    const list = parsePhaseValueList(match[2]);
    const hold = parsePhaseHold(match[3]);
    if (!list.ok) return list;
    if (!hold.ok) return hold;
    return { ok: true, phase: { type: "accumulate", direction: match[1], values: list.values, hold: hold.value }, sourceToken };
  }

  match = /^@\?(?:\:(\d+))?$/.exec(sourceToken);
  if (match) {
    const hold = parsePhaseHold(match[1]);
    if (!hold.ok) return hold;
    return { ok: true, phase: { type: "random-all", hold: hold.value }, sourceToken };
  }

  match = /^@\?\(([^)]*)\)(?:\:(\d+))?$/.exec(sourceToken);
  if (match) {
    const list = parsePhaseValueList(match[1]);
    const hold = parsePhaseHold(match[2]);
    if (!list.ok) return list;
    if (!hold.ok) return hold;
    return { ok: true, phase: { type: "random-absolute", values: list.values, hold: hold.value }, sourceToken };
  }

  match = /^@\?([<>])\(([^)]*)\)(?:\:(\d+))?$/.exec(sourceToken);
  if (match) {
    const list = parsePhaseValueList(match[2]);
    const hold = parsePhaseHold(match[3]);
    if (!list.ok) return list;
    if (!hold.ok) return hold;
    return {
      ok: true,
      phase: { type: "random-accumulate", direction: match[1], values: list.values, hold: hold.value },
      sourceToken,
    };
  }

  return { ok: false, error: `invalid phase shift "${sourceToken}"` };
}

function phaseToCanonicalToken(phase) {
  const spec = phase && phase.type ? phase : PHASE_NONE;
  const valueText = (value) => rationalToString(phaseRational(value) || RATIONAL_ZERO);
  const holdText = phaseHold(spec) > 1 ? `:${phaseHold(spec)}` : "";
  if (spec.type === "none") return "";
  if (spec.type === "fixed") return `@${valueText(spec.value)}`;
  if (spec.type === "accumulate") {
    const body = spec.values.length === 1 ? valueText(spec.values[0]) : `(${spec.values.map(valueText).join(",")})`;
    return `@${spec.direction}${body}${holdText}`;
  }
  if (spec.type === "random-all") return `@?${holdText}`;
  if (spec.type === "random-absolute") return `@?(${spec.values.map(valueText).join(",")})${holdText}`;
  if (spec.type === "random-accumulate") return `@?${spec.direction}(${spec.values.map(valueText).join(",")})${holdText}`;
  return "";
}

function serializePhaseToken(cycle) {
  if (!hasPhaseShift(cycle)) return "";
  // TEXT APPLY stores the exact phase token. GUI phase edits replace it
  // with phaseToCanonicalToken(), so both workflows share this serializer.
  return cycle.phaseSourceToken || phaseToCanonicalToken(phaseSpecOf(cycle));
}

function directionMultiplier(direction) {
  return direction === "<" ? -1 : 1;
}

function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function positiveModuloRational(value, integerModulus) {
  const modulus = integerModulus * value.denominator;
  const numerator = ((value.numerator % modulus) + modulus) % modulus;
  return createRational(numerator, value.denominator);
}

function deterministicPhaseChoice(cycle, repeatIndex, count) {
  if (count <= 1) return 0;
  const identity = cycle.id || serializePhaseToken(cycle) || "phase";
  const text = `${identity}|${repeatIndex}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Avalanche adjacent repeat indexes so small divisions do not fall
  // into a visibly linear modulo pattern.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) % count;
}

function accumulatedSequenceShift(values, repeatIndex) {
  if (repeatIndex <= 0 || values.length === 0) return RATIONAL_ZERO;
  const fullCycles = Math.floor(repeatIndex / values.length);
  const remainder = repeatIndex % values.length;
  const rationalValues = values.map(phaseRational);
  const cycleSum = rationalValues.reduce((sum, value) => addRational(sum, value), RATIONAL_ZERO);
  let total = multiplyRational(cycleSum, rationalFromInteger(fullCycles));
  for (let i = 0; i < remainder; i++) total = addRational(total, rationalValues[i]);
  return total;
}

function accumulatedRandomShift(cycle, phase, repeatIndex) {
  const key = phaseToCanonicalToken(phase);
  let cached = randomPhasePrefixCache.get(cycle);
  if (!cached || cached.key !== key) {
    cached = { key, prefix: [RATIONAL_ZERO] };
    randomPhasePrefixCache.set(cycle, cached);
  }
  while (cached.prefix.length <= repeatIndex) {
    const transitionIndex = cached.prefix.length - 1;
    const choice = deterministicPhaseChoice(cycle, transitionIndex, phase.values.length);
    const delta = multiplyRational(rationalFromInteger(directionMultiplier(phase.direction)), phaseRational(phase.values[choice]));
    cached.prefix.push(addRational(cached.prefix[cached.prefix.length - 1], delta));
  }
  return cached.prefix[repeatIndex];
}

function phaseShiftRationalForRepeat(cycle, cycleRepeatIndex = 0) {
  const phase = phaseSpecOf(cycle);
  const repeatIndex = phaseStepIndex(phase, cycleRepeatIndex);
  if (phase.type === "none") return RATIONAL_ZERO;
  if (phase.type === "fixed") return phaseRational(phase.value);
  if (phase.type === "accumulate") {
    return multiplyRational(rationalFromInteger(directionMultiplier(phase.direction)), accumulatedSequenceShift(phase.values, repeatIndex));
  }
  if (phase.type === "random-all") {
    return rationalFromInteger(deterministicPhaseChoice(cycle, repeatIndex, cycle.division));
  }
  if (phase.type === "random-absolute") {
    return phaseRational(phase.values[deterministicPhaseChoice(cycle, repeatIndex, phase.values.length)]);
  }
  if (phase.type === "random-accumulate") {
    return accumulatedRandomShift(cycle, phase, repeatIndex);
  }
  return RATIONAL_ZERO;
}

// Compatibility-facing numeric view for existing UI tests and integrations.
// Resolver internals retain the Rational counterpart below until pixel/audio
// boundaries require a Number.
function phaseShiftForRepeat(cycle, cycleRepeatIndex = 0) {
  return rationalToNumber(phaseShiftRationalForRepeat(cycle, cycleRepeatIndex));
}

// The single phase resolver shared by event expansion and every
// playhead. Keeping the raw division shift as well as beat-space offset
// lets audio wrap divisions while display wraps the cycle's pattern span.
function resolveCyclePhase(cycle, cycleRepeatIndex = 0) {
  const spanBeats = rationalToNumber(cycle.span);
  const phaseShiftRational = phaseShiftRationalForRepeat(cycle, cycleRepeatIndex);
  const divisionWidth = divideRational(cycle.span, rationalFromInteger(cycle.division));
  const phaseBeatRational = multiplyRational(phaseShiftRational, divisionWidth);
  return {
    phaseShift: rationalToNumber(phaseShiftRational),
    phaseShiftRational,
    spanBeats,
    phaseBeat: rationalToNumber(phaseBeatRational),
    phaseBeatRational,
  };
}

function shiftedCyclePlayheadBeat(cycle, offsetInCycleBeats, cycleRepeatIndex = 0) {
  if (!hasPhaseShift(cycle)) return offsetInCycleBeats;
  const phase = resolveCyclePhase(cycle, cycleRepeatIndex);
  // Hit expansion shifts a source division forward by phase. The cursor
  // is drawn over the unshifted pattern, so it needs the inverse mapping
  // to land on that source division when the shifted hit sounds.
  return positiveModulo(offsetInCycleBeats - phase.phaseBeat, phase.spanBeats);
}

/* One source of truth for every sounding/visible event. A base hit H owns
   one division cell; ratchet k/count sits k/count of that cell after H.
   The returned hitPosition is only a drawing coordinate. Editing continues
   to target hitValue, so dragging a ratcheted hit preserves its count. */
function expandCycleHitEvents(cycle, cycleRepeatIndex = 0) {
  const spanBeats = rationalToNumber(cycle.span);
  const divisionWidth = spanBeats / cycle.division;
  const phase = resolveCyclePhase(cycle, cycleRepeatIndex);
  const phaseShift = phase.phaseShift;
  const wrapPhase = hasPhaseShift(cycle);
  const events = [];
  normalizeHits(cycle.hits).forEach((hitValue) => {
    const count = ratchetCountForHit(cycle, hitValue);
    const originalDivision = hitValue - 1;
    // A hit position may sit between grid lines (1.5 -> division 0.5).
    // Preserve that decimal coordinate as a Rational while phase is
    // applied; rationalFromInteger() would incorrectly reject it.
    const originalDivisionRational = rationalFromHitPosition(originalDivision);
    const effectiveDivision = wrapPhase
      ? rationalToNumber(positiveModuloRational(addRational(originalDivisionRational, phase.phaseShiftRational), cycle.division))
      : originalDivision;
    const divisionStart = effectiveDivision * divisionWidth;
    for (let k = 0; k < count; k++) {
      events.push({
        hitValue,
        ratchetIndex: k,
        ratchetCount: count,
        hitPosition: effectiveDivision + 1 + k / count,
        beatOffset: divisionStart + divisionWidth * k / count,
        phaseShift,
      });
    }
  });
  events.sort((a, b) => a.beatOffset - b.beatOffset || a.hitValue - b.hitValue);
  return events;
}

// Phase visuals are the same circular transform the scheduler uses. The
// playhead remains an absolute time cursor; it is the pattern underneath
// it (grid plus hits) that rotates for the active repeat.
function visualDivisionForPhase(cycle, baseDivision, cycleRepeatIndex = 0) {
  if (!hasPhaseShift(cycle)) return baseDivision;
  const phase = resolveCyclePhase(cycle, cycleRepeatIndex);
  return rationalToNumber(
    positiveModuloRational(
      addRational(rationalFromInteger(baseDivision), phase.phaseShiftRational),
      cycle.division
    )
  );
}

function visualGridDivisions(cycle, cycleRepeatIndex = 0, step = 1) {
  const positions = [];
  for (let base = 0; base < cycle.division; base += step) {
    const position = visualDivisionForPhase(cycle, base, cycleRepeatIndex);
    // A boundary at zero is supplied by the body's border. A fractional
    // phase has no boundary there, so all of its shifted lines remain.
    if (position > 1e-9 && position < cycle.division - 1e-9) positions.push(position);
  }
  return positions;
}

function visualPositionToOriginalPattern(cycle, visualPosition, cycleRepeatIndex = 0) {
  if (!hasPhaseShift(cycle)) return visualPosition;
  const phase = resolveCyclePhase(cycle, cycleRepeatIndex);
  return 1 + positiveModulo(visualPosition - 1 - phase.phaseShift, cycle.division);
}

function hitVisualKey(hitValue, ratchetIndex) {
  return ratchetIndex === 0 ? String(hitValue) : `${hitValue}@${ratchetIndex}`;
}

function findTrack(trackId) {
  return state.tracks.find((t) => t.id === trackId) || null;
}

function findCycle(track, cycleId) {
  if (!track) return null;
  return getFlatCycles(track).find((c) => c.id === cycleId) || null;
}

/* ===== Rational arithmetic =====
   A cycle's span is a rational number, not a float. "0.1 beats" three
   times must be exactly 0.3 beats, and a common cycle of 3/2 against
   5/4 must come out as exactly 15/2 — neither survives repeated binary
   floating point. Floats appear only at the edges, where audio times
   and pixel positions are needed.

   The representation is a plain object so a snapshot survives
   JSON.stringify/parse intact (see the Undo/Redo groundwork note).
*/

const MAX_SPAN_TEXT_LENGTH = 32;
const MAX_DECIMAL_PLACES = 6;
const MAX_DENOMINATOR = 1000000;

function gcdInteger(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

// Returns null rather than silently losing precision: an LCM that has
// left the safe-integer range is not a number we may keep computing on.
function lcmIntegerSafe(a, b) {
  if (a === 0 || b === 0) return 0;
  const product = (a / gcdInteger(a, b)) * b;
  if (!Number.isSafeInteger(product)) return null;
  return Math.abs(product);
}

function normalizeRational(value) {
  if (!value) return null;
  let { numerator, denominator } = value;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) return null;
  if (denominator === 0) return null;
  if (denominator < 0) {
    numerator = -numerator;
    denominator = -denominator;
  }
  if (numerator === 0) return { numerator: 0, denominator: 1 };
  const divisor = gcdInteger(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function createRational(numerator, denominator) {
  return normalizeRational({ numerator, denominator });
}

function rationalFromInteger(value) {
  return createRational(value, 1);
}

function rationalToNumber(value) {
  return value.numerator / value.denominator;
}

function rationalToString(value) {
  return value.denominator === 1 ? String(value.numerator) : `${value.numerator}/${value.denominator}`;
}

function addRational(a, b) {
  return createRational(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
}

function subtractRational(a, b) {
  return createRational(a.numerator * b.denominator - b.numerator * a.denominator, a.denominator * b.denominator);
}

function multiplyRational(a, b) {
  return createRational(a.numerator * b.numerator, a.denominator * b.denominator);
}

function divideRational(a, b) {
  if (b.numerator === 0) return null;
  return createRational(a.numerator * b.denominator, a.denominator * b.numerator);
}

function compareRational(a, b) {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  return left === right ? 0 : left < right ? -1 : 1;
}

function equalRational(a, b) {
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

function floorRational(value) {
  return Math.floor(value.numerator / value.denominator);
}

function modRational(a, b) {
  const quotient = divideRational(a, b);
  if (!quotient) return null;
  const whole = rationalFromInteger(floorRational(quotient));
  return subtractRational(a, multiplyRational(whole, b));
}

// Exact conversion of a written decimal: "0.333" is 333/1000, never an
// approximation of 1/3. What the user typed is what is stored.
function rationalFromDecimalString(text) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] || "";
  if (fraction.length > MAX_DECIMAL_PLACES) return null;
  const denominator = Math.pow(10, fraction.length);
  const numerator = Number(match[1] + fraction);
  if (!Number.isSafeInteger(numerator)) return null;
  return createRational(numerator, denominator);
}

// Hit positions are stored as numbers for direct-manipulation editing, but
// their written decimal value still denotes a rational grid coordinate.
// Unlike span text, hit syntax has no six-decimal UI cap, so convert the
// finite decimal representation without rounding it to an integer.
function rationalFromHitPosition(value) {
  if (Number.isSafeInteger(value)) return rationalFromInteger(value);
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] || "";
  const denominator = Math.pow(10, fraction.length);
  const numerator = Number(match[1] + fraction);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) return null;
  return createRational(numerator, denominator);
}

/* Parses a span as written in the DSL or the Inspector. Returns
   { ok: true, value } or { ok: false, error }. Spans must be finite,
   rational and strictly positive: a zero-length cycle would occupy no
   time and a negative one has no meaning. */
function parseRationalSpan(text) {
  const raw = String(text).trim();
  if (raw === "") return { ok: false, error: "span is required" };
  if (raw.length > MAX_SPAN_TEXT_LENGTH) {
    return { ok: false, error: "Span precision exceeds the supported limit." };
  }

  let value;
  if (raw.includes("/")) {
    const match = /^(\d+)\/(\d+)$/.exec(raw);
    if (!match) return { ok: false, error: `invalid span "${raw}"` };
    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    if (denominator === 0) return { ok: false, error: "span denominator must not be 0" };
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
      return { ok: false, error: "Span precision exceeds the supported limit." };
    }
    value = createRational(numerator, denominator);
  } else {
    if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false, error: `invalid span "${raw}"` };
    if (/\.\d{7,}$/.test(raw)) {
      return { ok: false, error: "Span precision exceeds the supported limit." };
    }
    value = rationalFromDecimalString(raw);
    if (!value) return { ok: false, error: "Span precision exceeds the supported limit." };
  }

  if (!value) return { ok: false, error: `invalid span "${raw}"` };
  if (value.numerator <= 0) return { ok: false, error: "span must be greater than 0" };
  if (value.denominator > MAX_DENOMINATOR) {
    return { ok: false, error: "Span precision exceeds the supported limit." };
  }
  return { ok: true, value };
}

/* Parses the Inspector's CYCLE LENGTH field: same grammar and
   positivity rule as a span (a cycle length of 0 or less would mean the
   next cycle starts before or at this one), just worded for the field
   it belongs to. */
function parseRationalCycleLength(text) {
  const raw = String(text).trim();
  if (raw === "") return { ok: false, error: "cycle length is required" };
  if (raw.length > MAX_SPAN_TEXT_LENGTH) {
    return { ok: false, error: "Cycle length precision exceeds the supported limit." };
  }

  let value;
  if (raw.includes("/")) {
    const match = /^(\d+)\/(\d+)$/.exec(raw);
    if (!match) return { ok: false, error: `invalid cycle length "${raw}"` };
    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    if (denominator === 0) return { ok: false, error: "cycle length denominator must not be 0" };
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
      return { ok: false, error: "Cycle length precision exceeds the supported limit." };
    }
    value = createRational(numerator, denominator);
  } else {
    if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false, error: `invalid cycle length "${raw}"` };
    if (/\.\d{7,}$/.test(raw)) {
      return { ok: false, error: "Cycle length precision exceeds the supported limit." };
    }
    value = rationalFromDecimalString(raw);
    if (!value) return { ok: false, error: "Cycle length precision exceeds the supported limit." };
  }

  if (!value) return { ok: false, error: `invalid cycle length "${raw}"` };
  if (value.numerator <= 0) return { ok: false, error: "cycle length must be greater than 0" };
  if (value.denominator > MAX_DENOMINATOR) {
    return { ok: false, error: "Cycle length precision exceeds the supported limit." };
  }
  return { ok: true, value };
}

/* Parses a cycle length OFFSET: a signed rational added to a cycle's
   span to get its cycle length. Unlike a span, zero and negative values
   are meaningful (a negative offset lets the next cycle start before
   this one's pattern finishes), so only the magnitude is validated the
   way a span is — the sign is parsed separately. A bare, unsigned
   magnitude ("1", "1/2") is treated as positive, which is what lets the
   DSL grammar reuse this for the "+1" / "-1" / "-1/2" token that follows
   division. */
function parseRationalOffset(text) {
  const raw = String(text).trim();
  if (raw === "") return { ok: false, error: "offset is required" };
  if (raw.length > MAX_SPAN_TEXT_LENGTH) {
    return { ok: false, error: "Offset precision exceeds the supported limit." };
  }

  const negative = raw[0] === "-";
  const magnitudeText = raw[0] === "+" || raw[0] === "-" ? raw.slice(1) : raw;
  if (magnitudeText === "") return { ok: false, error: `invalid offset "${raw}"` };

  let magnitude;
  if (magnitudeText.includes("/")) {
    const match = /^(\d+)\/(\d+)$/.exec(magnitudeText);
    if (!match) return { ok: false, error: `invalid offset "${raw}"` };
    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    if (denominator === 0) return { ok: false, error: "offset denominator must not be 0" };
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
      return { ok: false, error: "Offset precision exceeds the supported limit." };
    }
    magnitude = createRational(numerator, denominator);
  } else {
    if (!/^\d+(\.\d+)?$/.test(magnitudeText)) return { ok: false, error: `invalid offset "${raw}"` };
    if (/\.\d{7,}$/.test(magnitudeText)) {
      return { ok: false, error: "Offset precision exceeds the supported limit." };
    }
    magnitude = rationalFromDecimalString(magnitudeText);
    if (!magnitude) return { ok: false, error: "Offset precision exceeds the supported limit." };
  }

  if (!magnitude) return { ok: false, error: `invalid offset "${raw}"` };
  if (magnitude.denominator > MAX_DENOMINATOR) {
    return { ok: false, error: "Offset precision exceeds the supported limit." };
  }
  const value = negative ? createRational(-magnitude.numerator, magnitude.denominator) : magnitude;
  return { ok: true, value };
}

// "+1", "-1/2", "0" — always signed except zero, which is how the
// Inspector's OFFSET field and cycle segment titles show it.
function formatSignedRational(value) {
  if (!value || value.numerator === 0) return "0";
  const sign = value.numerator < 0 ? "-" : "+";
  const abs = { numerator: Math.abs(value.numerator), denominator: value.denominator };
  return sign + rationalToString(abs);
}

// The DSL never writes a "+0" token: an absent offset already means 0.
function serializeOffsetToken(offset) {
  if (!offset || offset.numerator === 0) return "";
  return formatSignedRational(offset);
}

/* ===== Track sequence =====
   A track's sequence is a list of items, each either a cycle or a
   GROUP: an ordered run of cycles that plays as a unit, `repeat` times.

   A group is NOT sugar for copied cycles. [B C]*3 holds exactly one B
   and one C — one cycle id each — and the repetition lives in the
   structure. Copying would give three Bs that drift apart the moment
   one is edited, and would make "which B did I select?" unanswerable.
   Everything downstream (scheduler, lanes, timeline) therefore reads
   the repetition rather than a materialized list.

   Groups do not nest. One level keeps selection, MOVE, DELETE, id
   reconciliation and text-range syncing tractable; nesting multiplies
   every one of those problems.
*/

const RATIONAL_ZERO = { numerator: 0, denominator: 1 };

function getTrackSequence(track) {
  return track.sequence;
}

// Every cycle in the track, in structural order, groups flattened.
// Cycle-level code that does not care about grouping uses this.
function getFlatCycles(track) {
  const out = [];
  for (const item of track.sequence) {
    if (item.type === "cycle") out.push(item);
    else out.push(...item.items);
  }
  return out;
}

function findCycleInTrack(track, cycleId) {
  if (!track) return null;
  return getFlatCycles(track).find((c) => c.id === cycleId) || null;
}

function findGroup(trackId, groupId) {
  const track = findTrack(trackId);
  if (!track) return null;
  return track.sequence.find((item) => item.type === "group" && item.id === groupId) || null;
}

function findGroupContainingCycle(trackId, cycleId) {
  const track = findTrack(trackId);
  if (!track) return null;
  return (
    track.sequence.find(
      (item) => item.type === "group" && item.items.some((c) => c.id === cycleId)
    ) || null
  );
}

function isCycleInsideGroup(trackId, cycleId) {
  return findGroupContainingCycle(trackId, cycleId) !== null;
}

// Where a cycle lives, including who owns the array it sits in — every
// structural edit needs the parent, not just the cycle.
function findCycleLocation(trackId, cycleId) {
  const track = findTrack(trackId);
  if (!track) return null;
  for (let i = 0; i < track.sequence.length; i++) {
    const item = track.sequence[i];
    if (item.type === "cycle") {
      if (item.id === cycleId) {
        return { track, parentType: "track", parent: track.sequence, itemIndex: i, indexInParent: i, cycle: item, group: null };
      }
    } else {
      const inner = item.items.findIndex((c) => c.id === cycleId);
      if (inner !== -1) {
        return { track, parentType: "group", parent: item.items, itemIndex: i, indexInParent: inner, cycle: item.items[inner], group: item };
      }
    }
  }
  return null;
}

function getParentSequenceForCycle(trackId, cycleId) {
  const location = findCycleLocation(trackId, cycleId);
  return location ? location.parent : null;
}

function getSequenceItemIndex(trackId, itemId) {
  const track = findTrack(trackId);
  if (!track) return -1;
  return track.sequence.findIndex((item) => item.id === itemId);
}

/* ----- Lengths -----
   PASS cycles are skipped entirely during playback, so they never
   occupy time and must not count toward any length.
*/

// A cycle's PATTERN SPAN times its hits stays fixed; its CYCLE LENGTH —
// the span plus an independent offset — is what everything about
// looping, playback order and lane occupancy actually measures. The two
// only coincide when offset is 0 (the default), which is why every
// pre-1.8I cycle keeps behaving exactly as before.
function computeCycleLength(cycle) {
  return addRational(cycle.span, cycle.offset || RATIONAL_ZERO);
}

function computeCycleLengthNumber(cycle) {
  return rationalToNumber(computeCycleLength(cycle));
}

/* ----- Hit range (Phase 1.8J) -----
   A hit's position is a number on the division grid, but what decides
   whether it EXISTS is where it lands in beats, not whether its number
   is <= division. That is what lets a cycle with a positive offset hold
   hits past its own division ("4:4+2[1,2,3,4,5]"): position 5 is one
   full span in, which is inside a cycle length of 6.

   The bound is max(span, cycleLength), not cycleLength alone, because
   the two answer different questions and a cycle needs both:
     - up to CYCLE LENGTH, because a positive offset genuinely extends
       the cycle and hits may live in that extension;
     - never below PATTERN SPAN, because a negative offset must not
       silently delete the pattern's own tail — those hits are exactly
       the ones Phase 1.8I lets overlap the next cycle.
   With offset 0 the bound is just the span, which is algebraically the
   same rule as the old "hit < division + 1", so nothing pre-1.8J moves.
*/

// Comparisons happen in floats (hit positions are floats), so an exact
// boundary — a hit landing precisely ON the limit, which is out — needs
// a guard against a representation error letting it through.
const HIT_LIMIT_EPSILON = 1e-9;

// Beats from the start of the cycle to this hit.
function hitBeatOffset(cycle, hitValue) {
  return hitToFraction(hitValue, cycle.division) * rationalToNumber(cycle.span);
}

function hitLimitBeats(cycle) {
  const span = rationalToNumber(cycle.span);
  return Math.max(span, computeCycleLengthNumber(cycle));
}

function isHitWithinCycle(cycle, hitValue) {
  if (!Number.isFinite(hitValue) || hitValue < 1) return false;
  return hitBeatOffset(cycle, hitValue) < hitLimitBeats(cycle) - HIT_LIMIT_EPSILON;
}

// Highest hit POSITION the cycle can hold, as an exclusive bound. Used
// to clamp dragging rather than to validate — validation goes through
// isHitWithinCycle so there is one definition of "inside".
function maxHitPositionExclusive(cycle) {
  const span = rationalToNumber(cycle.span);
  if (span <= 0) return 1;
  return 1 + (hitLimitBeats(cycle) / span) * cycle.division;
}

/* Drops the hits that no longer fit. Editing division, span or offset
   can all shrink the bound, and the spec is deliberate that this is a
   silent trim rather than a rejected edit: the alternative is refusing
   to let someone lower a division while an old hit is in the way. */
function trimInvalidHits(cycle) {
  const kept = normalizeHits(cycle.hits).filter((h) => isHitWithinCycle(cycle, h));
  const changed = kept.length !== cycle.hits.length;
  cycle.hits = kept;
  normalizeCycleRatchets(cycle);
  return changed;
}

function computeCycleTotalLength(cycle) {
  if (cycle.pass) return RATIONAL_ZERO;
  return multiplyRational(computeCycleLength(cycle), rationalFromInteger(cycle.repeat));
}

function computeGroupBaseLength(group) {
  return group.items.reduce((sum, c) => addRational(sum, computeCycleTotalLength(c)), RATIONAL_ZERO);
}

function computeGroupTotalLength(group) {
  return multiplyRational(computeGroupBaseLength(group), rationalFromInteger(group.repeat));
}

function computeSequenceItemLength(item) {
  return item.type === "cycle" ? computeCycleTotalLength(item) : computeGroupTotalLength(item);
}

function computeTrackLoopLength(track) {
  return track.sequence.reduce((sum, item) => addRational(sum, computeSequenceItemLength(item)), RATIONAL_ZERO);
}

/* ----- Playback order -----
   Walks the sequence in the order it sounds, WITHOUT building the
   expanded list: a group repeated 9999 times is 9999 loop iterations,
   not 9999 array entries. `visit` returning false stops the walk, which
   is how position resolution exits as soon as it finds its pass.
*/
function walkTrackPasses(track, visit) {
  const sequence = track.sequence;
  for (let itemIndex = 0; itemIndex < sequence.length; itemIndex++) {
    const item = sequence[itemIndex];

    if (item.type === "cycle") {
      if (item.pass) continue;
      for (let r = 0; r < item.repeat; r++) {
        const go = visit({
          itemType: "cycle",
          item,
          itemIndex,
          group: null,
          groupRepeatIndex: 0,
          cycle: item,
          cycleIndexInGroup: -1,
          cycleRepeatIndex: r,
        });
        if (go === false) return false;
      }
      continue;
    }

    for (let groupRepeatIndex = 0; groupRepeatIndex < item.repeat; groupRepeatIndex++) {
      for (let ci = 0; ci < item.items.length; ci++) {
        const cycle = item.items[ci];
        if (cycle.pass) continue;
        for (let r = 0; r < cycle.repeat; r++) {
          const go = visit({
            itemType: "group",
            item,
            itemIndex,
            group: item,
            groupRepeatIndex,
            cycle,
            cycleIndexInGroup: ci,
            cycleRepeatIndex: r,
          });
          if (go === false) return false;
        }
      }
    }
  }
  return true;
}

// Kept for the places that only ask "does this track sound at all".
function activeCycles(track) {
  return getFlatCycles(track).filter((c) => !c.pass);
}

function computeTrackLoopLengthNumber(track) {
  return rationalToNumber(computeTrackLoopLength(track));
}

/* ----- Common cycle -----
   The LCM of rational loop lengths: put every length over the LCM of
   their denominators, take the integer LCM of the resulting units, and
   convert back. 3/2 and 5/4 become 6/4 and 5/4, LCM(6,5) = 30, so the
   common cycle is 30/4 = 15/2 beats exactly.

   Rational spans make it easy to ask for a common cycle that is
   astronomically long (997 against 991 against 983 is nearly a billion
   beats), so the result is a status, not a bare number: "empty" and
   "too-large" are genuinely different situations and callers must be
   able to tell them apart.
*/
const MAX_COMMON_CYCLE_UNITS = 1000000000;
const MAX_COMMON_CYCLE_BEATS = 1000000;

// Exact LCM for a set of Rational durations. The caller decides its own
// display/safety limit: the Common Timeline has a conservative cap, while
// relationship queries merely return null when exact safe-integer maths is
// no longer possible.
function leastCommonRational(values, maxUnits = Number.MAX_SAFE_INTEGER) {
  const lengths = values.filter((value) => value && value.numerator > 0);
  if (lengths.length === 0) return null;

  let denominatorLcm = 1;
  for (const length of lengths) {
    denominatorLcm = lcmIntegerSafe(denominatorLcm, length.denominator);
    if (denominatorLcm === null || denominatorLcm > maxUnits) return null;
  }

  let unitLcm = null;
  for (const length of lengths) {
    const units = length.numerator * (denominatorLcm / length.denominator);
    if (!Number.isSafeInteger(units) || units > maxUnits) return null;
    unitLcm = unitLcm === null ? units : lcmIntegerSafe(unitLcm, units);
    if (unitLcm === null || unitLcm > maxUnits) return null;
  }
  return createRational(unitLcm, denominatorLcm);
}

function computeCommonCycle(tracks) {
  const lengths = tracks.map(computeTrackLoopLength).filter((r) => r.numerator > 0);
  if (lengths.length === 0) return { status: "empty" };

  const value = leastCommonRational(lengths, MAX_COMMON_CYCLE_UNITS);
  if (!value || rationalToNumber(value) > MAX_COMMON_CYCLE_BEATS) return { status: "too-large" };
  return { status: "ok", value };
}

// Beats as a float, for pixel maths and modulo. Zero for both "no
// active cycle" and "too large" — callers that must distinguish the two
// ask computeCommonCycle() for the status.
function computeCommonCycleBeatsNumber(tracks) {
  const result = computeCommonCycle(tracks);
  return result.status === "ok" ? rationalToNumber(result.value) : 0;
}

/* ===== Cycle Relationship (Phase 2.1) =====
   Relationship is derived only: no result is attached to a Cycle or saved
   in snapshots. Span defines its periodic geometry; phase is resolved with
   the same resolver the scheduler already uses. */
function cycleSpanRatio(cycleA, cycleB) {
  const left = cycleA && cycleA.span;
  const right = cycleB && cycleB.span;
  if (!left || !right || left.numerator <= 0 || right.numerator <= 0) return null;
  const denominatorLcm = lcmIntegerSafe(left.denominator, right.denominator);
  if (denominatorLcm === null) return null;
  const leftUnits = left.numerator * (denominatorLcm / left.denominator);
  const rightUnits = right.numerator * (denominatorLcm / right.denominator);
  if (!Number.isSafeInteger(leftUnits) || !Number.isSafeInteger(rightUnits)) return null;
  const divisor = gcdInteger(leftUnits, rightUnits);
  return { left: leftUnits / divisor, right: rightUnits / divisor };
}

function getCyclesCommonLength(cycles) {
  return leastCommonRational(
    cycles.map((cycle) => cycle && cycle.span).filter(Boolean)
  );
}

function relationshipRepeatIndex(options, key) {
  const supplied = options && options[key];
  if (Number.isInteger(supplied) && supplied >= 0) return supplied;
  // No transport context belongs to derived state. The first advanced
  // repeat exposes a phase step (@>1 => +1), while callers rendering a
  // particular pass can explicitly provide its zero-based index.
  return 1;
}

function getCycleRelationship(cycleA, cycleB, options = {}) {
  if (!cycleA || !cycleB) return null;
  const cycleRepeatIndexA = relationshipRepeatIndex(options, "cycleRepeatIndexA");
  const cycleRepeatIndexB = relationshipRepeatIndex(options, "cycleRepeatIndexB");
  const phaseA = phaseShiftRationalForRepeat(cycleA, cycleRepeatIndexA);
  const phaseB = phaseShiftRationalForRepeat(cycleB, cycleRepeatIndexB);
  const commonLength = getCyclesCommonLength([cycleA, cycleB]);
  return {
    ratio: cycleSpanRatio(cycleA, cycleB),
    commonLength,
    // Division-space difference. It intentionally remains Rational, so
    // a 1/2-division Phase needs no float conversion or special case.
    phaseDifference: subtractRational(phaseA, phaseB),
    alignmentPeriod: commonLength,
  };
}

function getTrackCycleRelationship(track, options = {}) {
  const cycles = track ? getFlatCycles(track) : [];
  const commonLength = getCyclesCommonLength(cycles);
  return {
    cycles: cycles.slice(),
    commonLength,
    alignmentPeriod: commonLength,
    relationships: cycles.length < 2
      ? []
      : cycles.slice(1).map((cycle) => getCycleRelationship(cycles[0], cycle, options)),
  };
}

/* ===== Selection helpers =====
   Everything that reads the selection goes through these, so no caller
   needs to know whether one cycle or twenty are selected.

   A selection entry is now tagged: { type: "cycle", trackId, cycleId }
   or { type: "group", trackId, groupId }. A group frame and the cycles
   inside it are separately selectable — clicking the frame selects the
   group, clicking a cycle inside selects that cycle.
*/

function selectionKey(item) {
  if (item.type === "group") return `group::${item.trackId}::${item.groupId}`;
  return `cycle::${item.trackId}::${item.cycleId}`;
}

function cycleSelectionItem(trackId, cycleId) {
  return { type: "cycle", trackId, cycleId };
}

function groupSelectionItem(trackId, groupId) {
  return { type: "group", trackId, groupId };
}

function isSelectionItemSelected(item) {
  const key = selectionKey(item);
  return selectionState.items.some((it) => selectionKey(it) === key);
}

function isCycleSelected(trackId, cycleId) {
  return isSelectionItemSelected(cycleSelectionItem(trackId, cycleId));
}

function isGroupSelected(trackId, groupId) {
  return isSelectionItemSelected(groupSelectionItem(trackId, groupId));
}

function isSelectionAnchorItem(item) {
  return !!selectionState.anchor && selectionKey(selectionState.anchor) === selectionKey(item);
}

function isSelectionAnchor(trackId, cycleId) {
  return isSelectionAnchorItem(cycleSelectionItem(trackId, cycleId));
}

function clearSelection() {
  selectionState.items = [];
  selectionState.anchor = null;
}

function setSingleSelectionItem(item) {
  selectionState.items = [item];
  selectionState.anchor = item;
}

function setSingleSelection(trackId, cycleId) {
  setSingleSelectionItem(cycleSelectionItem(trackId, cycleId));
}

function addSelectionItem(item) {
  if (!isSelectionItemSelected(item)) selectionState.items.push(item);
  selectionState.anchor = item;
}

function addSelection(trackId, cycleId) {
  addSelectionItem(cycleSelectionItem(trackId, cycleId));
}

function removeSelectionItem(item) {
  const key = selectionKey(item);
  selectionState.items = selectionState.items.filter((it) => selectionKey(it) !== key);
  if (isSelectionAnchorItem(item)) {
    selectionState.anchor = selectionState.items[selectionState.items.length - 1] || null;
  }
}

function removeSelection(trackId, cycleId) {
  removeSelectionItem(cycleSelectionItem(trackId, cycleId));
}

function toggleSelectionItem(item) {
  if (isSelectionItemSelected(item)) removeSelectionItem(item);
  else addSelectionItem(item);
}

function toggleSelection(trackId, cycleId) {
  toggleSelectionItem(cycleSelectionItem(trackId, cycleId));
}

/* Adds every cycle between two ids, inclusive. Range selection stays
   within one parent — the track's own sequence, or one group's item
   list — because a range that straddles a group boundary would select
   "half a group", which no batch operation can act on. */
function selectRangeWithinTrack(trackId, fromCycleId, toCycleId) {
  const from = findCycleLocation(trackId, fromCycleId);
  const to = findCycleLocation(trackId, toCycleId);
  if (!from || !to) return;
  if (from.parent !== to.parent) return;

  const lo = Math.min(from.indexInParent, to.indexInParent);
  const hi = Math.max(from.indexInParent, to.indexInParent);
  for (let i = lo; i <= hi; i++) {
    const item = cycleSelectionItem(trackId, from.parent[i].id);
    if (!isSelectionItemSelected(item)) selectionState.items.push(item);
  }
  // The anchor stays put so repeated Shift-clicks re-range from the same origin.
}

/* Selected cycles in *structural* order (track order, then position in
   the flattened sequence) — never in click order. Batch move and delete
   both depend on that ordering. Selected GROUPS are not included here;
   see getSelectedGroups(). */
function getSelectedCycles() {
  const wanted = new Set(
    selectionState.items.filter((it) => it.type === "cycle").map(selectionKey)
  );
  if (wanted.size === 0) return [];
  const out = [];
  state.tracks.forEach((track, trackIndex) => {
    let cycleIndex = 0;
    track.sequence.forEach((item, itemIndex) => {
      const cycles = item.type === "cycle" ? [item] : item.items;
      cycles.forEach((cycle, indexInParent) => {
        if (wanted.has(selectionKey(cycleSelectionItem(track.id, cycle.id)))) {
          out.push({
            track,
            cycle,
            trackIndex,
            cycleIndex,
            itemIndex,
            indexInParent,
            parent: item.type === "cycle" ? track.sequence : item.items,
            parentType: item.type === "cycle" ? "track" : "group",
            group: item.type === "group" ? item : null,
          });
        }
        cycleIndex += 1;
      });
    });
  });
  return out;
}

function getSelectedGroups() {
  const wanted = new Set(
    selectionState.items.filter((it) => it.type === "group").map(selectionKey)
  );
  if (wanted.size === 0) return [];
  const out = [];
  state.tracks.forEach((track, trackIndex) => {
    track.sequence.forEach((item, itemIndex) => {
      if (item.type !== "group") return;
      if (wanted.has(selectionKey(groupSelectionItem(track.id, item.id)))) {
        out.push({ track, group: item, trackIndex, itemIndex });
      }
    });
  });
  return out;
}

function getSelectedCyclesByTrack() {
  const groups = new Map();
  getSelectedCycles().forEach((entry) => {
    let group = groups.get(entry.track.id);
    if (!group) {
      group = { track: entry.track, entries: [] };
      groups.set(entry.track.id, group);
    }
    group.entries.push(entry);
  });
  return Array.from(groups.values());
}

function getSelectedTrackIds() {
  const ids = getSelectedCycles().map((e) => e.track.id).concat(getSelectedGroups().map((e) => e.track.id));
  return Array.from(new Set(ids));
}

// Selection entries can outlive what they point at (delete, ungroup,
// DSL apply, any wholesale state replacement), so drop the dead ones.
function pruneSelectionState() {
  const live = new Set();
  state.tracks.forEach((track) => {
    track.sequence.forEach((item) => {
      if (item.type === "cycle") {
        live.add(selectionKey(cycleSelectionItem(track.id, item.id)));
      } else {
        live.add(selectionKey(groupSelectionItem(track.id, item.id)));
        item.items.forEach((c) => live.add(selectionKey(cycleSelectionItem(track.id, c.id))));
      }
    });
  });
  selectionState.items = selectionState.items.filter((it) => live.has(selectionKey(it)));
  if (selectionState.anchor && !live.has(selectionKey(selectionState.anchor))) {
    selectionState.anchor = selectionState.items[selectionState.items.length - 1] || null;
  }
}

/* ----- Lane time coordinates -----
   A track is one continuous time lane. Every cycle occupies an
   adjoining beat interval on it, and X is derived from absolute beats
   with a single scale shared by all tracks — that shared scale is what
   makes the same beat line up vertically across HAT/SNARE/KICK.

   There is deliberately NO padding baked into this transform: beat 0
   sits exactly at the lane's left edge and the last beat exactly at
   its right edge. Hit markers avoid clipping by being drawn in an
   overflow-visible layer instead, so the *time axis* never appears to
   have empty margins.
*/

function beatToPixel(beat) {
  return beat * LANE_PIXELS_PER_BEAT;
}

function pixelToBeat(pixel) {
  return pixel / LANE_PIXELS_PER_BEAT;
}

function cycleSegmentWidth(cycle) {
  return beatToPixel(computeCycleLengthNumber(cycle));
}

function hitToFraction(hitValue, division) {
  return (hitValue - 1) / division;
}

// Walks a track's cycles in order, returning each one's absolute beat
// interval on the lane. PASS cycles still occupy lane space (they are
// part of the edited structure) even though playback skips them.
/* The lane shows STRUCTURE, not played duration: a cycle occupies one
   span regardless of its own repeat count, and a group occupies one
   pass through its cycles regardless of ITS repeat count — in both
   cases the repeat is written in the label ("×N" / "GROUP ×N"), not
   spent in width. A group repeated 9999 times is exactly as wide as one
   repeated twice, and everything after it in the track sits right next
   to it rather than 9997 repeats away. Only the Common Timeline below
   expands every repetition into real elapsed time.

   The running position is accumulated as a rational so a lane of
   sixteenth-beat cycles does not drift; only the per-segment result is
   converted to a float, for pixels.
*/

// Lane width of one pass through a group's cycle list, using the lane's
// one-cycle-length-per-cycle convention (PASS cycles still occupy lane
// space).
function laneGroupBaseLength(group) {
  return group.items.reduce((sum, c) => addRational(sum, computeCycleLength(c)), RATIONAL_ZERO);
}

function computeLaneLayout(track) {
  const segments = []; // editable cycle segments — one pass per group
  const frames = []; // group frames, for drawing the outline
  const itemFrames = {}; // itemId -> { startBeat, baseBeats, repeat, type }
  const cycleOffsets = {}; // cycleId -> beats from the start of its own repetition

  let cursor = RATIONAL_ZERO;
  let index = 0;

  track.sequence.forEach((item, itemIndex) => {
    if (item.type === "cycle") {
      const itemLength = computeCycleLength(item);
      const next = addRational(cursor, itemLength);
      itemFrames[item.id] = {
        startBeat: rationalToNumber(cursor),
        baseBeats: rationalToNumber(itemLength),
        repeat: 1,
        type: "cycle",
      };
      cycleOffsets[item.id] = 0;
      segments.push({
        cycle: item,
        index: index++,
        itemIndex,
        group: null,
        startBeat: rationalToNumber(cursor),
        endBeat: rationalToNumber(next),
      });
      cursor = next;
      return;
    }

    const base = laneGroupBaseLength(item);
    const baseBeats = rationalToNumber(base);
    const groupStart = cursor;
    // Width is one pass only — see the note above computeLaneLayout —
    // so the frame's played width is never multiplied by item.repeat.
    const frame = {
      group: item,
      itemIndex,
      startBeat: rationalToNumber(groupStart),
      endBeat: rationalToNumber(addRational(groupStart, base)),
      baseBeats,
      repeat: item.repeat,
    };
    itemFrames[item.id] = {
      startBeat: frame.startBeat,
      baseBeats,
      repeat: item.repeat,
      type: "group",
    };

    // The one pass that is actually editable.
    let inner = groupStart;
    item.items.forEach((cycle) => {
      const next = addRational(inner, computeCycleLength(cycle));
      cycleOffsets[cycle.id] = rationalToNumber(subtractRational(inner, groupStart));
      segments.push({
        cycle,
        index: index++,
        itemIndex,
        group: item,
        startBeat: rationalToNumber(inner),
        endBeat: rationalToNumber(next),
      });
      inner = next;
    });

    frames.push(frame);
    cursor = addRational(groupStart, base);
  });

  return { segments, frames, itemFrames, cycleOffsets, totalBeats: rationalToNumber(cursor) };
}

/* Where the playhead belongs on the lane, given a resolved playing
   position. Group repeat 2 of 3 must light up the third section, not
   send the playhead back to the first. */
function laneBeatForPosition(track, layout, resolved) {
  if (!resolved) return null;
  const ownerId = resolved.groupId || resolved.cycleId;
  const frame = layout.itemFrames[ownerId];
  if (!frame) return null;
  // Every repetition — of a group, or of a plain cycle's own repeat —
  // plays through the same drawn pass, so the position never advances
  // past this one section no matter which repeat is actually sounding.
  const offsetInSection = layout.cycleOffsets[resolved.cycleId] || 0;
  return frame.startBeat + offsetInSection + resolved.offsetInCycleBeats;
}

// Absolute beat position of a hit inside its cycle's lane segment.
function hitToLaneBeat(segment, hitValue) {
  const offset = hitToFraction(hitValue, segment.cycle.division) * rationalToNumber(segment.cycle.span);
  return segment.startBeat + offset;
}

/* ===== Parser =====
   Grammar:
     line       := <trackName> <cycle>+          (at least one cycle required)
     item       := <cycle> | <group>
     group      := "(" <cycle> <cycle>+ ")" "*" <repeat>
     cycle      := <span>:<division>[<offset>][<hits>]*<repeat>[<phase>]{<properties>}
     span       := integer | decimal | integer "/" integer   (> 0)
     offset     := "" | ("+"|"-") (integer | decimal | integer "/" integer)
     hits       := "" | "all" ["*" ratchet] | hit ("," hit)*
     hit        := position ["*" ratchet]
     position   := integer | float   (1 <= position, inside the cycle)
     ratchet    := integer           (>= 1)
     phase      := "@" fixed | "@" direction step-or-sequence | random-phase
     properties := key:value (",' key:value)*    (only "pass" is recognized)

   ":" separates span from division and "/" is only ever a fraction bar.
   The two never overlap, so "1/2:2" is unambiguously span 1/2 over
   division 2. The older "span/division" form is gone rather than kept
   as a compatibility path: with fractional spans it would make
   "1/2/2" mean two different things depending on how you read it.

   OFFSET (Phase 1.8I) is span's independent companion: PATTERN SPAN
   (span) still sizes the pattern's own hit spacing, but CYCLE LENGTH —
   span + offset — is what determines when the next cycle starts. A
   cycle written "4:7+1[1]" has pattern span 4 and cycle length 5; one
   written "4:7-1[1,3]" has cycle length 3, so the next cycle starts
   before this one's pattern finishes and their hits may overlap. The
   sign is mandatory when present (there is no bare "4:7 1[..]" form)
   and omitting the offset entirely means 0, i.e. the pre-1.8I behavior
   where cycle length equals span exactly.

   HITS (Phase 1.8J) are no longer capped at the division number. What
   bounds them is where they land in beats — see the hit range note
   above hitBeatOffset() — so "4:4+2[1,2,3,4,5]" is legal: position 5 is
   one span in, inside a cycle length of 6. DIVISION therefore sets the
   grid SPACING within a span, not a hit count, and "all" (Phase 1.8K)
   means every grid position the cycle has: "4:4+2[all]" is six hits,
   because the 1-beat grid keeps going through the extension.

   The bracket contents are pulled out as raw text and handed to
   parseHitSpec() rather than being described by the token regex. That
   keeps one shorthand ("all") from turning the cycle grammar into
   something unreadable, and leaves room for the [odd] / [even] / range
   forms that are explicitly out of scope here to be added in one place.

   A GROUP is a parenthesised run of two or more cycles with its own
   repeat: "(3:4[1]*1 2:3[2]*1)*3" plays those two cycles three times
   through. One cycle in parentheses is rejected — that is what a cycle
   repeat is for — and groups do not nest.
*/

// DSL 0.1 keeps the instrument vocabulary small, but centralizes it so a
// future voice does not require independently editing parser branches.
const DSL_INSTRUMENTS = Object.freeze(["hat", "snare", "kick", "clap"]);
// Track names are an instrument plus an optional instance number:
// "hat", "hat2", "snare3", "clap2". A leading-zero suffix ("hat01") fails here;
// "hat1" matches but is rejected explicitly as an ambiguous alias.
const TRACK_NAME_RE = new RegExp(`^(${DSL_INSTRUMENTS.join("|")})([1-9]\\d*)?$`, "i");

/* ----- BPM directive (Phase 1.9I) -----
   The text IS the project file, so tempo has to live in it — a saved
   .txt that dropped the tempo would not restore what the user heard.

   It is a top-level directive rather than a per-track field: tempo
   belongs to the sequence, and "bpm" is not a valid track name, so
   there is no ambiguity with a track line. Written first and separated
   by a blank line on output; accepted anywhere on input, because a file
   a person edited by hand should still load. */
const BPM_DIRECTIVE_RE = /^bpm\s+(\S+)$/i;
const SPAN_PATTERN = String.raw`\d+(?:\.\d+)?|\d+\/\d+`;
const OFFSET_PATTERN = String.raw`[+-](?:${SPAN_PATTERN})`;
// The bracket body is captured as raw text (anything but a closing
// bracket) and validated by parseHitSpec, so shorthands live in the hit
// parser instead of in this regex.
const CYCLE_TOKEN_RE = new RegExp(
  String.raw`^(${SPAN_PATTERN}):(\d+)(${OFFSET_PATTERN})?\[([^\]]*)\](?:\*(\d+))?(?:\{([^}]*)\})?$`
);
// Phase is extracted before the base cycle regex runs. This makes both
// `...*4@>1` and the equally interpretable `...@>1*4` legal without
// duplicating the already-strict span/hit/repeat grammar.
const PHASE_TOKEN_AT_START_RE = /^(?:@\?[<>]?\([^)]*\)(?:\:\d+)?|@[<>]\([^)]*\)(?:\:\d+)?|@\?(?:\:\d+)?|@[<>][+-]?\d+(?:\/\d+)?(?:\:\d+)?|@[+-]?\d+(?:\/\d+)?)/;
// "*" is the only repeat marker now, for cycles and groups alike, so a
// leftover "x" gets a message that names the replacement.
const LEGACY_REPEAT_RE = /\][xX]\d/;
// Group and cycle repeats share one ceiling: a repeat of a million
// would let one keystroke explode the common cycle and the DOM.
const MAX_REPEAT = 9999;
// A token shaped like the retired "4/5[...]" form, so the error can say
// what to do instead. Written to NOT match a legitimate fractional span
// followed by a colon.
const LEGACY_CYCLE_TOKEN_RE = /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?\[/;
const HIT_VALUE_RE = /^\d+(\.\d+)?$/;

/* ----- Hit spec -----
   Parses the raw text between "[" and "]" into { mode, hits }. Kept as
   its own function, separate from the cycle token regex, so that the
   out-of-scope shorthands ([odd], [even], ranges) have one obvious
   place to be added later.

   "all" (Phase 1.8K) means every grid position the cycle actually has,
   which is not the same as 1..division. DIVISION defines the grid
   SPACING inside one span, not a count of hits, so when a positive
   offset lengthens the cycle that same spacing simply carries on
   through the extension:

     4:4[all]          -> [1,2,3,4]        (grid every 1 beat, 4 beats)
     4:4+2[all]        -> [1,2,3,4,5,6]    (same 1-beat grid, 6 beats)
     5/2:2+1/4[all]    -> [1,2,3]          (grid every 5/4, 11/4 beats)
     4:4-1[all]        -> [1,2,3,4]        (bound never drops below span)

   The positions are exactly the ones isHitWithinCycle accepts, so "all"
   and a hand-written list are judged by one rule rather than two.

   `cycle` supplies span / division / offset because whether a position
   is in range is a question about beats, not about the number itself.
*/
const HIT_SPEC_ALL = "all";
const MAX_RATCHET_EVENTS = 4096;

/* Division has no ceiling of its own, and a long offset multiplies how
   many grid positions a span's worth of division produces, so "all" is
   capped. Without it, "1:1000+1000[all]" would ask for a million hit
   dots and take the DOM down with it. */
const MAX_ALL_HITS = 4096;

// Every grid position of the cycle, in order. Candidates are filtered
// through isHitWithinCycle rather than trusted from the arithmetic, so
// a position landing exactly ON the bound is excluded the same way it
// would be if it had been typed out.
function generateAllHits(cycle) {
  const maxExclusive = maxHitPositionExclusive(cycle);
  if (!Number.isFinite(maxExclusive)) return [];
  const upper = Math.min(Math.ceil(maxExclusive), MAX_ALL_HITS);
  const hits = [];
  for (let i = 1; i <= upper; i++) {
    if (isHitWithinCycle(cycle, i)) hits.push(i);
  }
  return hits;
}

// What "all" would expand to, before the cap — used to refuse an
// expansion rather than silently hand back a truncated one.
function countAllHits(cycle) {
  const maxExclusive = maxHitPositionExclusive(cycle);
  if (!Number.isFinite(maxExclusive)) return 0;
  return Math.max(0, Math.ceil(maxExclusive) - 1);
}

function parseHitSpec(raw, cycle) {
  const text = String(raw === undefined ? "" : raw).trim();
  if (text === "") return { ok: true, mode: "explicit", hits: [], ratchets: {}, allRatchet: 1 };

  const allMatch = /^all(?:\*(\d+))?$/i.exec(text);
  if (allMatch) {
    const count = allMatch[1] === undefined ? 1 : Number(allMatch[1]);
    if (!Number.isSafeInteger(count) || count < 1) {
      return { ok: false, error: "ratchet count must be an integer >= 1" };
    }
    if (countAllHits(cycle) > MAX_ALL_HITS) {
      return {
        ok: false,
        error: `"all" would expand to more than ${MAX_ALL_HITS} hits — use a smaller division or a shorter cycle`,
      };
    }
    if (countAllHits(cycle) * count > MAX_RATCHET_EVENTS) {
      return {
        ok: false,
        error: `ratchets would expand to more than ${MAX_RATCHET_EVENTS} hit events`,
      };
    }
    return { ok: true, mode: "all", hits: generateAllHits(cycle), ratchets: {}, allRatchet: count };
  }

  const parts = text.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  const hits = [];
  const ratchets = {};
  let eventCount = 0;
  for (const part of parts) {
    if (/^all(?:\*|$)/i.test(part)) {
      // Reached only when "all" is one entry among several: it already
      // means every position, so mixing it with positions is a
      // contradiction rather than an addition.
      return { ok: false, error: `"all" cannot be combined with other hit positions` };
    }
    const hitMatch = /^(\d+(?:\.\d+)?)(?:\*(\d+))?$/.exec(part);
    if (!hitMatch || !HIT_VALUE_RE.test(hitMatch[1])) {
      return { ok: false, error: `hit "${part}" must be a position, optional *ratchet count, or "all"` };
    }
    const value = parseFloat(hitMatch[1]);
    const count = hitMatch[2] === undefined ? 1 : Number(hitMatch[2]);
    if (!Number.isSafeInteger(count) || count < 1) {
      return { ok: false, error: "ratchet count must be an integer >= 1" };
    }
    if (!isHitWithinCycle(cycle, value)) {
      return {
        ok: false,
        error:
          `hit position ${value} is outside cycle "${rationalToString(cycle.span)}:${cycle.division}` +
          `${serializeOffsetToken(cycle.offset)}" ` +
          `(must be >= 1 and land before beat ${formatBeatsForError(hitLimitBeats(cycle))})`,
      };
    }
    hits.push(value);
    if (count > 1) ratchets[ratchetKey(value)] = count;
    eventCount += count;
    if (eventCount > MAX_RATCHET_EVENTS) {
      return { ok: false, error: `ratchets would expand to more than ${MAX_RATCHET_EVENTS} hit events` };
    }
  }
  return { ok: true, mode: "explicit", hits, ratchets, allRatchet: 1 };
}

// Error text only: a short decimal reads better than an exact fraction
// in the middle of a sentence, and nothing computes from this.
function formatBeatsForError(beats) {
  return Number.isInteger(beats) ? String(beats) : String(Number(beats.toFixed(4)));
}

/* Splits a line into tokens. Whitespace separates, EXCEPT inside
   [...] or {...} — so a hit list may be written spaced out
   ("4:5[1, 2, 3]") and still arrive as one token. Parentheses and the
   group repeat suffix are emitted as their own tokens, because a group
   may legally be written with or without spaces around them:
     (3:4[1]*1 2:3[2]*1)*3
     ( 3:4[1]*1 2:3[2]*1 ) * 3
*/
function tokenizeLine(line) {
  const tokens = [];
  let current = "";
  let depth = 0;
  let phaseParenDepth = 0;

  const flush = () => {
    if (current !== "") {
      tokens.push(current);
      current = "";
    }
  };

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    let phaseParenCharacter = false;
    if (phaseParenDepth > 0) {
      phaseParenCharacter = true;
      if (ch === "(") phaseParenDepth += 1;
      else if (ch === ")") phaseParenDepth -= 1;
    } else if (depth === 0 && ch === "(" && /@\??[<>]?$|@\?$/.test(current)) {
      // Parentheses attached to a phase operator are a value sequence,
      // not a Cycle Group. Keep commas and optional spaces in one token.
      phaseParenCharacter = true;
      phaseParenDepth = 1;
    } else if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") depth = Math.max(0, depth - 1);

    if (depth === 0 && phaseParenDepth === 0 && !phaseParenCharacter) {
      if (/\s/.test(ch)) {
        flush();
        continue;
      }
      if (ch === "(" || ch === ")") {
        flush();
        tokens.push(ch);
        continue;
      }
      // "*" only splits when it is the group repeat marker, i.e. it
      // directly follows a ")". Inside a cycle token it is part of the
      // cycle's own repeat and must stay attached.
      if (ch === "*" && current === "" && tokens[tokens.length - 1] === ")") {
        tokens.push("*");
        continue;
      }
    }
    current += ch;
  }
  flush();
  return tokens;
}

function parseCycleProperties(raw, lineNo, errors) {
  const props = { pass: false };
  if (raw === undefined || raw.trim() === "") return props;
  const parts = raw.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  let hadError = false;
  for (const part of parts) {
    const [rawKey, rawVal] = part.split(":").map((s) => (s || "").trim());
    const key = (rawKey || "").toLowerCase();
    if (key === "pass") {
      const val = (rawVal || "").toLowerCase();
      if (val !== "true" && val !== "false") {
        errors.push(`Line ${lineNo}: pass must be true or false`);
        hadError = true;
        continue;
      }
      props.pass = val === "true";
    } else {
      errors.push(`Line ${lineNo}: unknown cycle property "${rawKey}"`);
      hadError = true;
    }
  }
  return hadError ? null : props;
}

// Provisional cycle: the parser never issues ids, or a run of syntax
// errors would burn id numbers for cycles that never existed. Identity
// is decided in reconcileCycleIds() on a successful apply.
function parseCycleToken(token, lineNo, errors) {
  let baseToken = token;
  let phaseResult = { ok: true, phase: PHASE_NONE, sourceToken: "" };
  const phaseAt = token.indexOf("@");
  if (phaseAt !== -1) {
    const phaseMatch = token.slice(phaseAt).match(PHASE_TOKEN_AT_START_RE);
    if (!phaseMatch) {
      errors.push(`Line ${lineNo}: invalid phase shift in "${token}"`);
      return null;
    }
    phaseResult = parsePhaseSpec(phaseMatch[0]);
    if (!phaseResult.ok) {
      errors.push(`Line ${lineNo}: ${phaseResult.error}`);
      return null;
    }
    baseToken = token.slice(0, phaseAt) + token.slice(phaseAt + phaseMatch[0].length);
  }

  const match = baseToken.match(CYCLE_TOKEN_RE);
  if (!match) {
    if (LEGACY_CYCLE_TOKEN_RE.test(token)) {
      errors.push(`Line ${lineNo}: use ":" between span and division, for example 4:5[1,3]*1`);
    } else if (LEGACY_REPEAT_RE.test(token)) {
      errors.push(`Line ${lineNo}: use "*" for repeat, for example 4:5[1,3]*2`);
    } else {
      errors.push(`Line ${lineNo}: invalid cycle syntax "${token}"`);
    }
    return null;
  }

  const spanResult = parseRationalSpan(match[1]);
  if (!spanResult.ok) {
    errors.push(`Line ${lineNo}: ${spanResult.error}`);
    return null;
  }

  const division = parseInt(match[2], 10);
  if (!Number.isInteger(division) || division < 1) {
    errors.push(`Line ${lineNo}: division must be an integer >= 1`);
    return null;
  }

  let offset = RATIONAL_ZERO;
  if (match[3] !== undefined) {
    const offsetResult = parseRationalOffset(match[3]);
    if (!offsetResult.ok) {
      errors.push(`Line ${lineNo}: ${offsetResult.error}`);
      return null;
    }
    offset = offsetResult.value;
  }
  const cycleLength = addRational(spanResult.value, offset);
  if (cycleLength.numerator <= 0) {
    errors.push(`Line ${lineNo}: cycle length (span + offset) must be greater than 0`);
    return null;
  }

  // Hits are validated against the cycle they belong to, so span,
  // division and offset all have to be known first — which they are,
  // since each precedes the bracket in the token.
  const hitSpec = parseHitSpec(match[4], { span: spanResult.value, division, offset });
  if (!hitSpec.ok) {
    errors.push(`Line ${lineNo}: ${hitSpec.error}`);
    return null;
  }

  const hasExplicitRepeat = match[5] !== undefined;
  let repeat = hasExplicitRepeat ? parseInt(match[5], 10) : 1;
  // A scalar accumulating phase returns to its initial division after
  // division / gcd(division, |step|) repeats. Only the omitted-repeat
  // form receives this convenience; explicit repeats remain authored.
  const phase = phaseResult.phase;
  if (!hasExplicitRepeat) repeat = autoRepeatForPhase(division, phase);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT) {
    errors.push(`Line ${lineNo}: repeat must be an integer between 1 and ${MAX_REPEAT}`);
    return null;
  }

  const props = parseCycleProperties(match[6], lineNo, errors);
  if (props === null) return null;

  return {
    type: "cycle",
    id: null,
    span: spanResult.value,
    division,
    offset,
    hits: normalizeHits(hitSpec.hits),
    hitMode: hitSpec.mode,
    ratchets: hitSpec.ratchets,
    allRatchet: hitSpec.allRatchet,
    phase,
    phaseSourceToken: phaseResult.sourceToken,
    repeat,
    repeatExplicit: hasExplicitRepeat,
    pass: props.pass,
  };
}

function cycleTokenWithFollowingPhase(tokens, index) {
  const token = tokens[index];
  const next = tokens[index + 1];
  if (token && !token.includes("@") && next && next.startsWith("@")) {
    return { token: token + next, consumed: 2 };
  }
  return { token, consumed: 1 };
}

/* Parses a track's sequence tokens into a one-level tree of cycles and
   groups. Each failure mode gets its own message: "unclosed group" and
   "group repeat is required" are very different mistakes and a generic
   syntax error would leave the user guessing which one they made. */
function parseTrackSequence(tokens, lineNo, errors) {
  const items = [];
  let i = 0;
  let failed = false;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token === ")") {
      errors.push(`Line ${lineNo}: unexpected ")"`);
      return { success: false, items: [] };
    }

    if (token === "*") {
      errors.push(`Line ${lineNo}: unexpected "*"`);
      return { success: false, items: [] };
    }

    if (token === "(") {
      const groupCycles = [];
      i += 1;
      let closed = false;
      while (i < tokens.length) {
        if (tokens[i] === ")") {
          closed = true;
          i += 1;
          break;
        }
        if (tokens[i] === "(") {
          errors.push(`Line ${lineNo}: nested groups are not supported`);
          return { success: false, items: [] };
        }
        if (tokens[i] === "*") {
          errors.push(`Line ${lineNo}: unexpected "*" inside a group`);
          return { success: false, items: [] };
        }
        const combined = cycleTokenWithFollowingPhase(tokens, i);
        const cycle = parseCycleToken(combined.token, lineNo, errors);
        if (!cycle) failed = true;
        else groupCycles.push(cycle);
        i += combined.consumed;
      }

      if (!closed) {
        errors.push(`Line ${lineNo}: unclosed group`);
        return { success: false, items: [] };
      }
      if (failed) continue;

      if (groupCycles.length === 0) {
        errors.push(`Line ${lineNo}: group cannot be empty`);
        failed = true;
        continue;
      }
      if (groupCycles.length === 1) {
        errors.push(
          `Line ${lineNo}: a group needs at least two cycles — use a cycle repeat like 4:5[1]*3 instead`
        );
        failed = true;
        continue;
      }

      if (tokens[i] !== "*") {
        errors.push(`Line ${lineNo}: group repeat is required, for example (...)*2`);
        failed = true;
        continue;
      }
      i += 1;
      const repeatText = tokens[i];
      if (repeatText === undefined || !/^\d+$/.test(repeatText)) {
        errors.push(`Line ${lineNo}: invalid group repeat "${repeatText === undefined ? "" : repeatText}"`);
        failed = true;
        continue;
      }
      const repeat = parseInt(repeatText, 10);
      if (!Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT) {
        errors.push(`Line ${lineNo}: group repeat must be an integer between 1 and ${MAX_REPEAT}`);
        failed = true;
        i += 1;
        continue;
      }
      i += 1;

      items.push({ type: "group", id: null, repeat, items: groupCycles });
      continue;
    }

    const combined = cycleTokenWithFollowingPhase(tokens, i);
    const cycle = parseCycleToken(combined.token, lineNo, errors);
    if (!cycle) failed = true;
    else items.push(cycle);
    i += combined.consumed;
  }

  if (failed) return { success: false, items: [] };
  return { success: true, items };
}

function allocateUniqueTrackName(requestedName, instrument, suffix, usedNames, reservedNames) {
  if (!usedNames.has(requestedName)) return requestedName;

  // Preserve an explicitly written suffix and continue after it. A bare
  // duplicate starts at 2 (there is intentionally no "kick1"). Names
  // that appear later in the draft are reserved so auto-numbering does
  // not steal an explicit `kick2` before that line is parsed.
  let number = suffix ? Number(suffix) + 1 : 2;
  while (number <= Number.MAX_SAFE_INTEGER) {
    const candidate = instrument + number;
    if (!usedNames.has(candidate) && !reservedNames.has(candidate)) return candidate;
    number += 1;
  }
  return null;
}

function parseSequenceText(text) {
  const lines = text.split("\n");
  const errors = [];
  const parsedTracks = []; // preserves the order the lines were written in
  const seenTrackIds = new Set();
  const reservedTrackNames = new Set();
  let tempo = null; // null until a bpm line is seen

  // Collect valid names before allocation. This preserves explicitly
  // authored instance names when an earlier duplicate needs a suffix.
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (line === "" || BPM_DIRECTIVE_RE.test(line)) return;
    const rawName = tokenizeLine(line)[0];
    const match = rawName && rawName.match(TRACK_NAME_RE);
    if (!match || match[2] === "1") return;
    reservedTrackNames.add(match[1].toLowerCase() + (match[2] || ""));
  });

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = rawLine.trim();
    if (line === "") return;

    const bpmMatch = line.match(BPM_DIRECTIVE_RE);
    if (bpmMatch) {
      if (tempo !== null) {
        errors.push(`Line ${lineNo}: bpm is declared more than once`);
        return;
      }
      const value = Number(bpmMatch[1]);
      // Number() rather than parseInt(): "120abc" and "1.5" must fail
      // rather than quietly truncate to something the user did not write.
      if (!Number.isInteger(value) || value < MIN_TEMPO || value > MAX_TEMPO) {
        errors.push(
          `Line ${lineNo}: bpm must be a whole number between ${MIN_TEMPO} and ${MAX_TEMPO} (got "${bpmMatch[1]}")`
        );
        return;
      }
      tempo = value;
      return;
    }

    const tokens = tokenizeLine(line);
    const rawTrackName = tokens[0];
    const trackMatch = rawTrackName.match(TRACK_NAME_RE);

    if (!trackMatch) {
      errors.push(`Line ${lineNo}: invalid track name "${rawTrackName}"`);
      return;
    }

    const instrument = trackMatch[1].toLowerCase();
    const suffix = trackMatch[2] || "";
    // "hat1" would be an ambiguous alias for "hat", and "hat0"/"hat01"
    // are rejected by the regex itself.
    if (suffix === "1") {
      errors.push(`Line ${lineNo}: invalid track name "${rawTrackName}" (use "${instrument}" or a suffix of 2 or more)`);
      return;
    }

    const requestedTrackName = instrument + suffix;
    const trackName = allocateUniqueTrackName(
      requestedTrackName,
      instrument,
      suffix,
      seenTrackIds,
      reservedTrackNames
    );
    if (!trackName) {
      errors.push(`Line ${lineNo}: could not allocate a unique track name for "${requestedTrackName}"`);
      return;
    }

    const parsed = parseTrackSequence(tokens.slice(1), lineNo, errors);
    if (!parsed.success) return;

    // The GUI guarantees every track keeps at least one cycle; the DSL
    // must enforce the same invariant so the two can't disagree.
    if (parsed.items.length === 0) {
      errors.push(`Line ${lineNo}: track "${requestedTrackName}" requires at least one cycle`);
      return;
    }

    seenTrackIds.add(trackName);
    parsedTracks.push({ id: trackName, name: trackName, instrument, sequence: parsed.items });
  });

  if (parsedTracks.length === 0 && errors.length === 0) {
    errors.push("At least one track is required");
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  // No bpm line means the default, not "leave the tempo alone": the text
  // is the whole project, so what it does not say, it does not have.
  return { success: true, tracks: parsedTracks, tempo: tempo === null ? DEFAULT_TEMPO : tempo };
}

/* ===== Serializer ===== */

/* True when the cycle's hits are exactly the grid "all" stands for —
   every valid position, extension included, and nothing else. Checked
   rather than trusted: hitMode records how the hits were WRITTEN, and
   anything that edits one individually clears it (see markHitsExplicit),
   so the two can only disagree if something forgot to — in which case
   the positions win and the DSL stays truthful. One added, removed or
   nudged hit is enough to fall back to an explicit list. */
function hitsCoverAllGrid(cycle) {
  const hits = normalizeHits(cycle.hits);
  const grid = generateAllHits(cycle);
  if (hits.length !== grid.length) return false;
  return hits.every((h, i) => h === grid[i]);
}

function serializeHitsToken(cycle) {
  if (cycle.hitMode === "all" && hitsCoverAllGrid(cycle)) {
    const count = ratchetCountForHit(cycle, cycle.hits[0]);
    return count > 1 ? `${HIT_SPEC_ALL}*${count}` : HIT_SPEC_ALL;
  }
  return normalizeHits(cycle.hits)
    .map((v) => {
      const count = ratchetCountForHit(cycle, v);
      return count > 1 ? `${v}*${count}` : String(v);
    })
    .join(",");
}

function serializeCycleToken(cycle) {
  const hitsStr = serializeHitsToken(cycle);
  const propsStr = cycle.pass ? "{pass:true}" : "";
  const offsetStr = serializeOffsetToken(cycle.offset);
  const phaseStr = serializePhaseToken(cycle);
  // Parsed source is allowed to omit the ordinary one-repeat marker.
  // Missing flags are legacy / GUI cycles, whose established canonical
  // representation includes a repeat token.
  const repeatStr = cycle.repeatExplicit === false ? "" : `*${cycle.repeat}`;
  return `${rationalToString(cycle.span)}:${cycle.division}${offsetStr}[${hitsStr}]${repeatStr}${phaseStr}${propsStr}`;
}

/* Canonical text, plus a map from every cycle AND every group to its
   character range, which is what lets a GUI selection highlight the
   corresponding DSL without focusing the textarea.

   Neither cycle ids nor group ids are ever written out: the DSL stays
   something a person can read and retype. */
function serializeSequence(seqState) {
  const lines = [];
  const selectionMap = [];

  /* The bpm header, then a blank line, then the tracks. The blank line
     is not decoration: it is what keeps a saved file readable as
     "settings, then music" rather than one undifferentiated block.

     Every character offset below is measured from the start of the
     whole text, so the header's length is where the first track line
     begins — get this wrong and every GUI-to-text selection highlight
     lands a few characters off. */
  // Falls back rather than emitting "bpm undefined": whatever else is
  // wrong upstream, the canonical text must always be text this parser
  // accepts.
  const tempo = Number.isInteger(seqState.tempo) ? seqState.tempo : DEFAULT_TEMPO;
  const header = `bpm ${tempo}`;
  lines.push(header, "");
  let offset = header.length + 2; // the header line and the blank line

  // Emit tracks in their current order — that order is authored by the
  // user (line order on apply, or GUI order) and must round-trip.
  seqState.tracks.forEach((track) => {
    let lineText = track.name;
    let cursor = offset + lineText.length;

    track.sequence.forEach((item) => {
      if (item.type === "cycle") {
        const cycleStr = serializeCycleToken(item);
        lineText += " " + cycleStr;
        const start = cursor + 1; // +1 skips the separating space
        const end = start + cycleStr.length;
        selectionMap.push({ type: "cycle", trackId: track.id, cycleId: item.id, start, end });
        cursor = end;
        return;
      }

      // Group: "(" and ")" hug their contents, single spaces inside.
      const groupStart = cursor + 1;
      lineText += " (";
      cursor = groupStart + 1;

      item.items.forEach((cycle, index) => {
        const cycleStr = serializeCycleToken(cycle);
        const prefix = index === 0 ? "" : " ";
        lineText += prefix + cycleStr;
        const start = cursor + prefix.length;
        const end = start + cycleStr.length;
        selectionMap.push({ type: "cycle", trackId: track.id, cycleId: cycle.id, start, end });
        cursor = end;
      });

      const tail = `)*${item.repeat}`;
      lineText += tail;
      cursor += tail.length;
      selectionMap.push({ type: "group", trackId: track.id, groupId: item.id, start: groupStart, end: cursor });
    });

    lines.push(lineText);
    offset += lineText.length + 1; // +1 accounts for the joining "\n"
  });

  return { text: lines.join("\n"), selectionMap };
}

/* ===== Cycle id reconciliation =====
   The DSL carries no ids, so re-applying text would otherwise mint a
   fresh id for every cycle and silently break selection, and anything
   else that identifies a cycle across an edit. Instead the parsed
   result is matched back against the cycles that are already applied,
   and only genuinely new cycles get new ids.

   Getting this wrong in the cautious direction (a new id for a cycle
   the user considers "the same one") merely drops a selection. Getting
   it wrong in the confident direction (reusing the id of an unrelated
   cycle) makes two different cycles look like one, so ambiguity always
   resolves toward issuing a new id.
*/

const CYCLE_MATCH_THRESHOLD = 7;
const CYCLE_MATCH_RADIUS = 2; // how far an index may shift and still be "the same cycle"

function cycleContentSignature(cycle) {
  return JSON.stringify({
    // Compared as canonical text: two rational objects with the same
    // value are always identical once normalized, and a string keeps
    // the signature a plain JSON value.
    span: rationalToString(cycle.span),
    division: cycle.division,
    offset: rationalToString(cycle.offset || RATIONAL_ZERO),
    hits: normalizeHits(cycle.hits),
    ratchets: normalizeHits(cycle.hits).map((hit) => ratchetCountForHit(cycle, hit)),
    phase: phaseToCanonicalToken(phaseSpecOf(cycle)),
    repeat: cycle.repeat,
    pass: cycle.pass,
  });
}

// Max score is 16: span 4, division 4, offset 1, repeat 2, pass 1, hit overlap 4.
function cycleSimilarity(oldCycle, newCycle) {
  let score = 0;
  if (equalRational(oldCycle.span, newCycle.span)) score += 4;
  if (oldCycle.division === newCycle.division) score += 4;
  if (equalRational(oldCycle.offset || RATIONAL_ZERO, newCycle.offset || RATIONAL_ZERO)) score += 1;
  if (oldCycle.repeat === newCycle.repeat) score += 2;
  if (oldCycle.pass === newCycle.pass) score += 1;

  const oldHits = new Set(normalizeHits(oldCycle.hits));
  const newHits = new Set(normalizeHits(newCycle.hits));
  const union = new Set([...oldHits, ...newHits]).size;
  if (union === 0) {
    score += 4; // two empty cycles agree perfectly about their hits
  } else {
    const intersection = [...oldHits].filter((v) => newHits.has(v)).length;
    score += 4 * (intersection / union);
  }
  return score;
}

// Gives an id to every cycle and group that does not already have one.
// Parsed items always arrive id-less, so for them this mints fresh ids;
// items built in code (createInitialState) keep the id they were born
// with rather than burning a second one.
function ensureSequenceIds(track) {
  return {
    ...track,
    sequence: track.sequence.map((item) => {
      if (item.type === "cycle") return item.id ? item : { ...item, id: generateCycleId() };
      return {
        ...item,
        id: item.id || generateGroupId(),
        items: item.items.map((c) => (c.id ? c : { ...c, id: generateCycleId() })),
      };
    }),
  };
}

/* Four passes, most confident first. Every pass consumes old cycles
   from a shared pool, so one old id can never land on two new cycles.
*/
function reconcileTrackCycleIds(oldCycles, newCycles) {
  const assigned = new Array(newCycles.length).fill(null);
  const usedOld = new Array(oldCycles.length).fill(false);

  const oldSignatures = oldCycles.map(cycleContentSignature);
  const newSignatures = newCycles.map(cycleContentSignature);

  // 1. Same index, identical content — nothing about this cycle changed.
  for (let i = 0; i < newCycles.length; i++) {
    if (i < oldCycles.length && !usedOld[i] && oldSignatures[i] === newSignatures[i]) {
      assigned[i] = oldCycles[i].id;
      usedOld[i] = true;
    }
  }

  // 2. Identical content elsewhere — a reorder, in the DSL or via MOVE.
  //    With duplicate content the nearest index wins, then the earliest,
  //    so the mapping is deterministic rather than order-of-arrival.
  for (let i = 0; i < newCycles.length; i++) {
    if (assigned[i] !== null) continue;
    let best = -1;
    for (let j = 0; j < oldCycles.length; j++) {
      if (usedOld[j] || oldSignatures[j] !== newSignatures[i]) continue;
      if (best === -1 || Math.abs(j - i) < Math.abs(best - i)) best = j;
    }
    if (best !== -1) {
      assigned[i] = oldCycles[best].id;
      usedOld[best] = true;
    }
  }

  // 3. Same index, close enough — one or two values were edited in place.
  for (let i = 0; i < newCycles.length; i++) {
    if (assigned[i] !== null) continue;
    if (i >= oldCycles.length || usedOld[i]) continue;
    if (cycleSimilarity(oldCycles[i], newCycles[i]) >= CYCLE_MATCH_THRESHOLD) {
      assigned[i] = oldCycles[i].id;
      usedOld[i] = true;
    }
  }

  // 4. A nearby index, close enough — an insertion or deletion shifted
  //    this cycle. The search radius is deliberately small: beyond it,
  //    a "match" is guesswork.
  for (let i = 0; i < newCycles.length; i++) {
    if (assigned[i] !== null) continue;
    let best = -1;
    let bestScore = -1;
    const lo = Math.max(0, i - CYCLE_MATCH_RADIUS);
    const hi = Math.min(oldCycles.length - 1, i + CYCLE_MATCH_RADIUS);
    for (let j = lo; j <= hi; j++) {
      if (usedOld[j]) continue;
      const score = cycleSimilarity(oldCycles[j], newCycles[i]);
      if (score < CYCLE_MATCH_THRESHOLD) continue;
      const better =
        score > bestScore ||
        (score === bestScore && Math.abs(j - i) < Math.abs(best - i));
      if (better) {
        best = j;
        bestScore = score;
      }
    }
    if (best !== -1) {
      assigned[i] = oldCycles[best].id;
      usedOld[best] = true;
    }
  }

  return newCycles.map((cycle, i) => ({
    ...cycle,
    id: assigned[i] !== null ? assigned[i] : cycle.id || generateCycleId(),
  }));
}

/* ----- Group id reconciliation -----
   Runs AFTER cycle ids are settled, because the strongest evidence that
   a group is "the same group" is that it still contains the same
   cycles. Repeat count alone is weak; the membership list is not.
*/
const GROUP_MATCH_THRESHOLD = 10;

function groupContentSignature(group) {
  return JSON.stringify({
    repeat: group.repeat,
    cycleSignatures: group.items.map(cycleContentSignature),
  });
}

function groupSimilarity(oldGroup, newGroup) {
  let score = 0;
  const oldIds = oldGroup.items.map((c) => c.id).join("|");
  const newIds = newGroup.items.map((c) => c.id).join("|");
  if (oldIds === newIds) score += 10; // same cycles, in the same order
  else {
    const oldSet = new Set(oldGroup.items.map((c) => c.id));
    const shared = newGroup.items.filter((c) => oldSet.has(c.id)).length;
    const union = new Set([...oldSet, ...newGroup.items.map((c) => c.id)]).size;
    if (union > 0) score += 8 * (shared / union);
  }
  if (oldGroup.repeat === newGroup.repeat) score += 3;
  return score;
}

// Cycle ids first, then group ids: reconcileSequenceIds() runs both in
// that order for one track.
function reconcileSequenceIds(oldSequence, newSequence) {
  const oldCycles = [];
  const newCycles = [];
  for (const item of oldSequence) {
    if (item.type === "cycle") oldCycles.push(item);
    else oldCycles.push(...item.items);
  }
  for (const item of newSequence) {
    if (item.type === "cycle") newCycles.push(item);
    else newCycles.push(...item.items);
  }

  const resolvedCycles = reconcileTrackCycleIds(oldCycles, newCycles);
  let cursor = 0;
  const withCycleIds = newSequence.map((item) => {
    if (item.type === "cycle") return resolvedCycles[cursor++];
    const items = item.items.map(() => resolvedCycles[cursor++]);
    return { ...item, items };
  });

  const oldGroups = oldSequence.filter((item) => item.type === "group");
  const oldGroupIndexes = [];
  oldSequence.forEach((item, i) => {
    if (item.type === "group") oldGroupIndexes.push(i);
  });
  const usedOld = new Array(oldGroups.length).fill(false);
  const oldSignatures = oldGroups.map(groupContentSignature);

  const newGroupPositions = [];
  withCycleIds.forEach((item, i) => {
    if (item.type === "group") newGroupPositions.push(i);
  });
  const assigned = new Array(newGroupPositions.length).fill(null);

  const newGroups = newGroupPositions.map((i) => withCycleIds[i]);
  const newSignatures = newGroups.map(groupContentSignature);

  // 1. Same sequence index, identical content.
  for (let n = 0; n < newGroups.length; n++) {
    for (let o = 0; o < oldGroups.length; o++) {
      if (usedOld[o]) continue;
      if (oldGroupIndexes[o] !== newGroupPositions[n]) continue;
      if (oldSignatures[o] !== newSignatures[n]) continue;
      assigned[n] = oldGroups[o].id;
      usedOld[o] = true;
      break;
    }
  }

  // 2. Identical content at another index — the group moved.
  for (let n = 0; n < newGroups.length; n++) {
    if (assigned[n] !== null) continue;
    for (let o = 0; o < oldGroups.length; o++) {
      if (usedOld[o] || oldSignatures[o] !== newSignatures[n]) continue;
      assigned[n] = oldGroups[o].id;
      usedOld[o] = true;
      break;
    }
  }

  // 3/4. Same or nearby index, and still recognisably the same group —
  //      which in practice means it still holds the same cycles.
  for (let n = 0; n < newGroups.length; n++) {
    if (assigned[n] !== null) continue;
    let best = -1;
    let bestScore = -1;
    for (let o = 0; o < oldGroups.length; o++) {
      if (usedOld[o]) continue;
      const score = groupSimilarity(oldGroups[o], newGroups[n]);
      if (score < GROUP_MATCH_THRESHOLD) continue;
      const sameIndex = oldGroupIndexes[o] === newGroupPositions[n];
      const weighted = score + (sameIndex ? 1 : 0);
      if (weighted > bestScore) {
        best = o;
        bestScore = weighted;
      }
    }
    if (best !== -1) {
      assigned[n] = oldGroups[best].id;
      usedOld[best] = true;
    }
  }

  let groupCursor = 0;
  return withCycleIds.map((item) => {
    if (item.type !== "group") return item;
    const id = assigned[groupCursor] !== null ? assigned[groupCursor] : item.id || generateGroupId();
    groupCursor += 1;
    return { ...item, id };
  });
}

function reconcileCycleIds(oldTracks, newTracks) {
  return newTracks.map((newTrack) => {
    const oldTrack = oldTracks.find((t) => t.id === newTrack.id);
    if (!oldTrack) return ensureSequenceIds(newTrack);
    return { ...newTrack, sequence: reconcileSequenceIds(oldTrack.sequence, newTrack.sequence) };
  });
}

/* ===== State mutations ===== */


function toggleHit(trackId, cycleId, position) {
  if (!canMutateFromGui()) return;
  const track = findTrack(trackId);
  const cycle = findCycle(track, cycleId);
  if (!cycle) return;
  const idx = cycle.hits.indexOf(position);
  if (idx >= 0) {
    cycle.hits.splice(idx, 1);
    if (cycle.ratchets) delete cycle.ratchets[ratchetKey(position)];
  }
  else cycle.hits.push(position);
  cycle.hits = normalizeHits(cycle.hits);
  markHitsExplicit(cycle);
  afterStructuralMutation(trackId);
}

// Background clicks only ever ADD at an integer position; they never
// toggle an existing hit off (removal is double-click only). When the
// position is already taken the structure is unchanged, but the click
// still counts as selecting the cycle, so refresh that either way.
function addIntegerHit(trackId, cycleId, position) {
  if (!canMutateFromGui()) return;
  const track = findTrack(trackId);
  const cycle = findCycle(track, cycleId);
  if (!cycle) return;
  if (cycle.hits.includes(position)) {
    refreshSelectionVisuals();
    return;
  }
  cycle.hits.push(position);
  cycle.hits = normalizeHits(cycle.hits);
  markHitsExplicit(cycle);
  afterStructuralMutation(trackId);
}

/* "all" describes a rule ("every position of the division"), so the
   moment someone adds, moves or deletes one hit by hand the cycle stops
   being describable that way and the DSL goes back to listing
   positions. Without this, [all] would keep re-expanding over the edit
   on the next apply. */
function markHitsExplicit(cycle) {
  if (cycle.hitMode === "all") {
    const count = ratchetCountForHit(cycle, cycle.hits[0]);
    cycle.ratchets = {};
    if (count > 1) {
      normalizeHits(cycle.hits).forEach((hit) => {
        cycle.ratchets[ratchetKey(hit)] = count;
      });
    }
  }
  cycle.hitMode = "explicit";
  cycle.allRatchet = 1;
}

function updateHitPosition(trackId, cycleId, oldValue, newValue) {
  if (!canMutateFromGui()) return;
  const track = findTrack(trackId);
  const cycle = findCycle(track, cycleId);
  if (!cycle) return;
  // Materialize an ALL rule before changing one member, then carry that
  // member's ratchet count to its new base position.
  markHitsExplicit(cycle);
  const oldCount = ratchetCountForHit(cycle, oldValue);
  if (cycle.ratchets) delete cycle.ratchets[ratchetKey(oldValue)];
  const idx = cycle.hits.indexOf(oldValue);
  if (idx >= 0) cycle.hits.splice(idx, 1);
  const clamped = clampHitPosition(cycle, newValue);
  cycle.hits.push(clamped);
  cycle.hits = normalizeHits(cycle.hits);
  const existingCount = ratchetCountForHit(cycle, clamped);
  if (Math.max(oldCount, existingCount) > 1) {
    cycle.ratchets[ratchetKey(clamped)] = Math.max(oldCount, existingCount);
  }
  afterStructuralMutation(trackId);
}

// Keeps a dropped hit inside the cycle. The ceiling is the cycle's own
// range rather than "division + a bit", so a positive offset can be
// dragged into and a negative one still keeps its whole pattern.
function clampHitPosition(cycle, value) {
  const maxExclusive = maxHitPositionExclusive(cycle);
  return clamp(value, 1, Math.max(1, maxExclusive - 0.001));
}

function removeHitAt(trackId, cycleId, value) {
  if (!canMutateFromGui()) return;
  const track = findTrack(trackId);
  const cycle = findCycle(track, cycleId);
  if (!cycle) return;
  const idx = cycle.hits.indexOf(value);
  if (idx < 0) return;
  markHitsExplicit(cycle);
  cycle.hits.splice(idx, 1);
  if (cycle.ratchets) delete cycle.ratchets[ratchetKey(value)];
  afterStructuralMutation(trackId);
}

function updateCycleRepeat(trackId, cycleId, repeat) {
  if (!canMutateFromGui()) return;
  const cycle = findCycle(findTrack(trackId), cycleId);
  if (!cycle) return;
  cycle.repeat = Math.max(1, Math.floor(repeat));
  cycle.repeatExplicit = true;
  afterStructuralMutation(trackId);
}

function updateCyclePhase(trackId, cycleId, phase) {
  if (!canMutateFromGui()) return;
  const cycle = findCycle(findTrack(trackId), cycleId);
  if (!cycle) return;
  cycle.phase = cloneStructure(phase && phase.type ? phase : PHASE_NONE);
  // Inspector edits are allowed to canonicalize. Text-applied cycles keep
  // their own phaseSourceToken until PHASE itself is changed in the GUI.
  cycle.phaseSourceToken = phaseToCanonicalToken(cycle.phase);
  // An omitted repeat remains an omitted repeat after a GUI phase edit.
  // Its runtime length follows the same scalar accumulating-phase rule
  // used by the text parser until REPEAT is explicitly edited.
  if (cycle.repeatExplicit === false) cycle.repeat = autoRepeatForPhase(cycle.division, cycle.phase);
  afterStructuralMutation(trackId);
}

// Takes an already-parsed rational, so every caller has had to decide
// what to do about invalid input before reaching the state. Callers must
// have already checked that span + the cycle's existing offset stays
// positive (see wouldCycleLengthBeInvalid) — this function trusts them,
// the same way updateCycleOffset trusts its own callers.
function updateCycleSpan(trackId, cycleId, spanRational) {
  if (!canMutateFromGui()) return;
  const cycle = findCycle(findTrack(trackId), cycleId);
  if (!cycle) return;
  cycle.span = spanRational;
  resyncCycleHits(cycle);
  afterStructuralMutation(trackId);
}

// Same contract as updateCycleSpan: the offset is already-parsed, and
// the caller has already checked span + offset stays positive.
function updateCycleOffset(trackId, cycleId, offsetRational) {
  if (!canMutateFromGui()) return;
  const cycle = findCycle(findTrack(trackId), cycleId);
  if (!cycle) return;
  cycle.offset = offsetRational;
  resyncCycleHits(cycle);
  afterStructuralMutation(trackId);
}

/* Brings a cycle's hits back in line after its SHAPE changed — span,
   division or offset, any of which moves where the grid falls and how
   far the cycle reaches.

   An "all" cycle re-expands, because "all" is a rule about the grid and
   the grid just moved: lengthening 4:4[all] to 4:4+2[all] gains the two
   positions the extension now has. An explicit cycle is only trimmed —
   its positions were chosen by hand, so the edit may drop the ones that
   no longer fit but must never invent new ones. */
function resyncCycleHits(cycle) {
  if (cycle.hitMode === "all") {
    cycle.hits = generateAllHits(cycle);
    normalizeCycleRatchets(cycle);
    return;
  }
  // Shrinking a cycle can leave hits stranded past its new end; they go
  // silently rather than as an error, the same way a division change
  // drops what no longer fits (see trimInvalidHits).
  trimInvalidHits(cycle);
}

// Shared guard for every edit path that can change a cycle's length
// (SPAN, OFFSET or the CYCLE LENGTH field itself): span + offset must
// stay strictly positive, or the cycle would occupy no time — or less
// than none — on the loop.
function wouldCycleLengthBeInvalid(span, offset) {
  return addRational(span, offset).numerator <= 0;
}

function updateCycleDivision(trackId, cycleId, division) {
  if (!canMutateFromGui()) return;
  const cycle = findCycle(findTrack(trackId), cycleId);
  if (!cycle) return;
  const newDivision = Math.max(1, Math.floor(division));
  cycle.division = newDivision;
  if (cycle.repeatExplicit === false) cycle.repeat = autoRepeatForPhase(newDivision, cycle.phase);
  resyncCycleHits(cycle);
  afterStructuralMutation(trackId);
}

function createDefaultCycle() {
  return {
    type: "cycle",
    id: generateCycleId(),
    span: rationalFromInteger(4),
    division: 4,
    offset: RATIONAL_ZERO,
    hits: [],
    hitMode: "explicit",
    ratchets: {},
    allRatchet: 1,
    phase: PHASE_NONE,
    phaseSourceToken: "",
    repeat: 1,
    repeatExplicit: true,
    pass: false,
  };
}

/* ADD CYCLE appends to the track — unless the selection says otherwise:

     a cycle inside a group    the new cycle joins that group, directly
                               after the selected one
     the group itself          the new cycle is appended to that group

   Otherwise the button would be the one way to grow a track that a
   group could never benefit from, and filling a group would mean "add
   at the end of the track, then move it in".

   The group's repeat is untouched in both cases: adding a cycle makes
   each pass longer, it does not add a pass. */
function addCycle(trackId) {
  if (!canMutateFromGui()) return;
  const track = findTrack(trackId);
  if (!track) return;

  const cycle = createDefaultCycle();
  const inGroup = getSelectedCycles()
    .filter((e) => e.track.id === trackId && e.parentType === "group")
    .pop();
  const selectedGroup = getSelectedGroups().filter((e) => e.track.id === trackId).pop();

  if (inGroup) inGroup.parent.splice(inGroup.indexInParent + 1, 0, cycle);
  else if (selectedGroup) selectedGroup.group.items.push(cycle);
  else track.sequence.push(cycle);

  afterStructuralMutation(trackId);
}

// Drag-reorder stays inside the cycle's own parent: a cycle dragged
// within a group reorders the group, and one outside stays outside.
// Dragging a cycle across a group boundary is deliberately not a
// gesture — see moveSelectedCycles().
function reorderCycle(trackId, cycleId, targetIndex) {
  if (!canMutateFromGui()) return;
  const location = findCycleLocation(trackId, cycleId);
  if (!location) return;
  const parent = location.parent;
  const idx = location.indexInParent;
  const clamped = clamp(targetIndex, 0, parent.length - 1);
  if (clamped === idx) return;
  const [item] = parent.splice(idx, 1);
  parent.splice(clamped, 0, item);
  afterStructuralMutation(trackId);
}

/* Reorders one TOP-LEVEL item — a cycle or a whole group — within its
   track. A group moves as a single unit: its cycles travel with it and
   are never unpacked into the track, which is what keeps "reorder the
   sequence" and "edit inside a group" two separate operations.

   Deliberately generic over both item kinds, because at this level
   track.sequence really is one list of interchangeable items; only the
   width they occupy on the lane differs. */
function reorderSequenceItem(trackId, itemId, targetIndex) {
  if (!canMutateFromGui()) return false;
  const track = findTrack(trackId);
  if (!track) return false;
  const idx = track.sequence.findIndex((item) => item.id === itemId);
  if (idx === -1) return false;
  const clamped = clamp(targetIndex, 0, track.sequence.length - 1);
  if (clamped === idx) return false;
  const [item] = track.sequence.splice(idx, 1);
  track.sequence.splice(clamped, 0, item);
  afterStructuralMutation(trackId);
  return true;
}

/* ===== Batch mutations over the selection =====
   Single-cycle PASS / DELETE / MOVE go through exactly these functions
   with a selection of one, so there is only ever one mutation path and
   one re-render per user action.
*/

// "ON" | "OFF" | "MIXED" | null
function getSelectionPassState() {
  const selected = getSelectedCycles();
  if (selected.length === 0) return null;
  const on = selected.filter((e) => e.cycle.pass).length;
  if (on === 0) return "OFF";
  if (on === selected.length) return "ON";
  return "MIXED";
}

function setSelectedCyclesPass(passValue) {
  if (!canMutateFromGui()) return false;
  const selected = getSelectedCycles();
  if (selected.length === 0) return false;

  // Write every cycle first, THEN rebuild once. Calling the per-cycle
  // mutation in a loop would re-schedule and re-render N times.
  let changed = false;
  for (const entry of selected) {
    if (entry.cycle.pass !== passValue) {
      entry.cycle.pass = passValue;
      changed = true;
    }
  }
  if (!changed) {
    refreshSelectionVisuals();
    return false;
  }

  afterStructuralMutation(selected.map((e) => e.track.id));
  return true;
}

function togglePassForSelection() {
  const passState = getSelectionPassState();
  if (passState === null) return false;
  // A mixed selection normalizes to ON, matching the single-cycle toggle
  // semantics of "the button reflects what you are about to get".
  return setSelectedCyclesPass(passState !== "ON");
}

// A group whose cycle list has fallen to one is not a group any more:
// it is one cycle wearing a repeat count that the DSL cannot express.
// Rather than leave that state reachable, the group dissolves and the
// survivor moves up to the track — keeping its own cycle id.
function dissolveUndersizedGroups(track) {
  let dissolved = false;
  for (let i = track.sequence.length - 1; i >= 0; i--) {
    const item = track.sequence[i];
    if (item.type !== "group" || item.items.length >= 2) continue;
    track.sequence.splice(i, 1, ...item.items);
    dissolved = true;
  }
  return dissolved;
}

/* ----- DELETE (Phase 1.9H) -----
   One operation over whatever is selected: cycles, groups, cycles
   inside groups, or any mixture of those, across any number of tracks.

   A group is removed as a single structural unit and takes its cycles
   with it, because that is what a group IS on the lane. Splitting
   DELETE into "delete cycles" and "delete one group", as it was before,
   made it the only action that could not see a mixed selection at all —
   and the user had already selected it.

   No confirmation dialog (Phase 1.9H): the whole thing is one undo step,
   so Cmd+Z is the answer to "are you sure?", and it costs one keystroke
   instead of interrupting every deletion. */
function analyzeDeleteSelection() {
  // The same normalization COPY and DUPLICATE use: a cycle inside a
  // selected group is already covered by the group.
  const units = selectionStructureUnits();
  if (units.length === 0) return { valid: false, reason: "", units, byTrack: new Map() };

  const byTrack = new Map();
  units.forEach((unit) => {
    let bucket = byTrack.get(unit.track.id);
    if (!bucket) {
      bucket = { track: unit.track, cycleCount: 0 };
      byTrack.set(unit.track.id, bucket);
    }
    // A group costs its whole cycle list, not one item.
    bucket.cycleCount += unit.item.type === "group" ? unit.item.items.length : 1;
  });

  // Every track must keep at least one cycle. A partial success — delete
  // from the legal tracks, skip the rest — would be a silent surprise,
  // so one violation rejects the whole operation.
  const violating = Array.from(byTrack.values()).filter(
    (bucket) => bucket.cycleCount >= getFlatCycles(bucket.track).length
  );
  if (violating.length > 0) {
    const names = violating.map((bucket) => `"${bucket.track.name}"`).join(", ");
    return {
      valid: false,
      reason:
        violating.length === 1
          ? `Cannot delete all cycles from track ${names}.`
          : `Cannot delete all cycles from tracks ${names}.`,
      units,
      byTrack,
    };
  }

  return { valid: true, reason: "", units, byTrack };
}

function deleteSelection() {
  if (!canMutateFromGui()) return false;
  const info = analyzeDeleteSelection();
  if (!info.valid) {
    if (info.reason) showError(info.reason);
    return false;
  }
  const { units, byTrack } = info;

  /* By identity, never by index: cycle and group ids are unique across
     the whole document, so one set covers both levels and no removal can
     invalidate another's position. */
  const doomed = new Set(units.map((unit) => unit.item.id));
  let anyDissolved = false;
  byTrack.forEach(({ track }) => {
    for (let i = track.sequence.length - 1; i >= 0; i--) {
      const item = track.sequence[i];
      if (doomed.has(item.id)) {
        track.sequence.splice(i, 1);
        continue;
      }
      if (item.type !== "group") continue;
      for (let j = item.items.length - 1; j >= 0; j--) {
        if (doomed.has(item.items[j].id)) item.items.splice(j, 1);
      }
    }
    // A group emptied down to one cycle (or none) is not a group.
    if (dissolveUndersizedGroups(track)) anyDissolved = true;
  });

  clearSelection(); // no auto-select of a neighbouring cycle
  afterStructuralMutation(Array.from(byTrack.keys()));
  if (anyDissolved) showError("Group removed because it contained fewer than two cycles.");
  return true;
}

/* ----- Batch move -----
   A multi-cycle MOVE only makes sense as "slide this block past its
   neighbour": it is restricted to one parent list and a contiguous
   range, so the result is always predictable and reversible by one MOVE
   back. Moving a cycle out of its group is NOT available here — an
   implicit group split is a bigger structural change than an arrow
   button should make. UNGROUP, move, re-group.
*/
function analyzeMoveSelection() {
  const selectedGroups = getSelectedGroups();
  const selected = getSelectedCycles();
  const base = {
    valid: false,
    trackId: null,
    kind: null,
    indices: [],
    startIndex: -1,
    endIndex: -1,
    isContiguous: false,
    canMoveLeft: false,
    canMoveRight: false,
    reason: "",
  };

  if (selected.length > 0 && selectedGroups.length > 0) {
    return { ...base, reason: "MOVE works on cycles or on one group, not both at once." };
  }

  if (selectedGroups.length > 0) {
    if (selectedGroups.length > 1) {
      return { ...base, reason: "MOVE works on one group at a time." };
    }
    const entry = selectedGroups[0];
    return {
      valid: true,
      trackId: entry.track.id,
      kind: "group",
      indices: [entry.itemIndex],
      startIndex: entry.itemIndex,
      endIndex: entry.itemIndex,
      isContiguous: true,
      canMoveLeft: entry.itemIndex > 0,
      canMoveRight: entry.itemIndex < entry.track.sequence.length - 1,
      reason: "",
    };
  }

  if (selected.length === 0) return { ...base, reason: "No cycle selected." };

  const trackIds = new Set(selected.map((e) => e.track.id));
  if (trackIds.size > 1) {
    return { ...base, reason: "MOVE requires all selected cycles to belong to the same track." };
  }

  const parents = new Set(selected.map((e) => e.parent));
  if (parents.size > 1) {
    return { ...base, reason: "MOVE requires all selected cycles to sit at the same level." };
  }

  const track = selected[0].track;
  const parent = selected[0].parent;
  const indices = selected.map((e) => e.indexInParent).sort((a, b) => a - b);
  const startIndex = indices[0];
  const endIndex = indices[indices.length - 1];
  const isContiguous = endIndex - startIndex + 1 === indices.length;

  if (!isContiguous) {
    return {
      ...base,
      trackId: track.id,
      kind: "cycle",
      indices,
      startIndex,
      endIndex,
      reason: "MOVE requires a contiguous range of cycles.",
    };
  }

  return {
    valid: true,
    trackId: track.id,
    kind: "cycle",
    indices,
    startIndex,
    endIndex,
    isContiguous: true,
    canMoveLeft: startIndex > 0,
    canMoveRight: endIndex < parent.length - 1,
    reason: "",
  };
}

// direction: -1 = left, +1 = right. The selected block swaps places
// with the single unselected neighbour, keeping the block's own
// internal order intact.
function moveSelectedCycles(direction) {
  if (!canMutateFromGui()) return false;
  const info = analyzeMoveSelection();
  if (!info.valid) {
    if (info.reason) showError(info.reason);
    return false;
  }
  if (direction < 0 && !info.canMoveLeft) return false;
  if (direction > 0 && !info.canMoveRight) return false;

  const track = findTrack(info.trackId);
  const list = info.kind === "group" ? track.sequence : getSelectedCycles()[0].parent;
  const block = list.slice(info.startIndex, info.endIndex + 1);

  if (direction < 0) {
    const before = list[info.startIndex - 1];
    list.splice(info.startIndex - 1, block.length + 1, ...block, before);
  } else {
    const after = list[info.endIndex + 1];
    list.splice(info.startIndex, block.length + 1, after, ...block);
  }

  // Selection follows the items themselves (ids are unchanged), so the
  // same block stays selected and can be moved again immediately.
  afterStructuralMutation(track.id);
  return true;
}

/* ===== Group mutations =====
   Each of these is exactly one structural mutation — one call to
   afterStructuralMutation() — so a future undo stack has one entry per
   user action rather than several.
*/

// Whether the current selection could become a group, and why not if
// not. The message is what the Inspector shows as a tooltip.
function analyzeGroupCreation() {
  const selectedGroups = getSelectedGroups();
  const selected = getSelectedCycles();

  if (selectedGroups.length > 0) {
    return { valid: false, reason: "Ungroup first to rebuild a group." };
  }
  if (selected.length < 2) {
    return { valid: false, reason: "Select two or more cycles to make a group." };
  }
  if (new Set(selected.map((e) => e.track.id)).size > 1) {
    return { valid: false, reason: "A group must stay inside one track." };
  }
  // Every selected cycle must sit directly in the track's sequence:
  // regrouping part of an existing group would need nesting.
  if (selected.some((e) => e.parentType !== "track")) {
    return { valid: false, reason: "Cycles already inside a group cannot be regrouped." };
  }

  const indices = selected.map((e) => e.itemIndex).sort((a, b) => a - b);
  const contiguous = indices[indices.length - 1] - indices[0] + 1 === indices.length;
  if (!contiguous) {
    return { valid: false, reason: "A group must be a contiguous run of cycles." };
  }

  return {
    valid: true,
    reason: "",
    trackId: selected[0].track.id,
    startIndex: indices[0],
    endIndex: indices[indices.length - 1],
    count: selected.length,
  };
}

function createGroupFromSelection(repeat) {
  if (!canMutateFromGui()) return false;
  const info = analyzeGroupCreation();
  if (!info.valid) {
    showError(info.reason);
    return false;
  }
  const count = Math.floor(repeat);
  if (!Number.isInteger(count) || count < 2 || count > MAX_REPEAT) {
    showError(`Group repeat must be an integer between 2 and ${MAX_REPEAT}.`);
    return false;
  }

  const track = findTrack(info.trackId);
  // The cycles move into the group by reference: same objects, same
  // ids, no copies.
  const members = track.sequence.slice(info.startIndex, info.endIndex + 1);
  const group = { type: "group", id: generateGroupId(), repeat: count, items: members };
  track.sequence.splice(info.startIndex, members.length, group);

  setSingleSelectionItem(groupSelectionItem(track.id, group.id));
  afterStructuralMutation(track.id);
  return true;
}

function getSelectedSingleGroup() {
  const groups = getSelectedGroups();
  if (groups.length !== 1) return null;
  if (getSelectedCycles().length > 0) return null;
  return groups[0];
}

function updateSelectedGroupRepeat(repeat) {
  if (!canMutateFromGui()) return false;
  const entry = getSelectedSingleGroup();
  if (!entry) return false;
  const count = Math.floor(repeat);
  if (!Number.isInteger(count) || count < 1 || count > MAX_REPEAT) {
    showError(`Group repeat must be an integer between 1 and ${MAX_REPEAT}.`);
    renderApp();
    return false;
  }
  if (entry.group.repeat === count) return false;
  entry.group.repeat = count; // the group's own id is untouched
  afterStructuralMutation(entry.track.id);
  return true;
}

// Removes the group and puts its cycles back in the track's sequence.
// The repeat count is simply gone: expanding it into copies would
// contradict the whole reason groups exist.
function ungroupSelectedGroup() {
  if (!canMutateFromGui()) return false;
  const entry = getSelectedSingleGroup();
  if (!entry) return false;

  const { track, group, itemIndex } = entry;
  track.sequence.splice(itemIndex, 1, ...group.items);

  // Leave the freed cycles selected, so the next edit can continue
  // straight away.
  selectionState.items = group.items.map((c) => cycleSelectionItem(track.id, c.id));
  selectionState.anchor = selectionState.items[0] || null;

  afterStructuralMutation(track.id);
  return true;
}

/* ----- Moving cycles across a group boundary -----
   MOVE and drag-reorder both stay inside a cycle's own parent list, so
   crossing a group boundary is deliberately not something an arrow
   button or a drag can do by accident. These two operations are the
   explicit way in and out, and each is one undo step.
*/

/* ADD TO GROUP wants a run of track-level cycles sitting immediately
   beside a selected group. Either side works: cycles before the group
   join at its start, cycles after it join at its end, so the sounding
   order is exactly what the lane already showed. */
function analyzeAddToGroup() {
  const groups = getSelectedGroups();
  const cycles = getSelectedCycles();
  const base = { valid: false, reason: "", side: null, trackId: null, startIndex: -1, endIndex: -1, groupId: null };

  if (groups.length !== 1) {
    return { ...base, reason: "Select one group and the cycles next to it." };
  }
  if (cycles.length === 0) {
    return { ...base, reason: "Select the cycles to add to the group." };
  }
  const entry = groups[0];
  if (cycles.some((c) => c.track.id !== entry.track.id)) {
    return { ...base, reason: "A group must stay inside one track." };
  }
  if (cycles.some((c) => c.parentType !== "track")) {
    return { ...base, reason: "Those cycles are already inside a group." };
  }

  const indices = cycles.map((c) => c.itemIndex).sort((a, b) => a - b);
  const startIndex = indices[0];
  const endIndex = indices[indices.length - 1];
  if (endIndex - startIndex + 1 !== indices.length) {
    return { ...base, reason: "Select a contiguous run of cycles." };
  }

  let side = null;
  if (endIndex + 1 === entry.itemIndex) side = "start";
  else if (startIndex === entry.itemIndex + 1) side = "end";
  else return { ...base, reason: "Only cycles directly beside the group can be added to it." };

  return {
    valid: true,
    reason: "",
    side,
    trackId: entry.track.id,
    startIndex,
    endIndex,
    groupId: entry.group.id,
    count: cycles.length,
  };
}

function addSelectedCyclesToGroup() {
  if (!canMutateFromGui()) return false;
  const info = analyzeAddToGroup();
  if (!info.valid) {
    showError(info.reason);
    return false;
  }

  const track = findTrack(info.trackId);
  const group = track.sequence.find((i) => i.type === "group" && i.id === info.groupId);
  if (!track || !group) return false;

  // Moved by reference — same objects, same ids, exactly as group
  // creation does it.
  const members = track.sequence.slice(info.startIndex, info.endIndex + 1);
  track.sequence.splice(info.startIndex, members.length);
  if (info.side === "start") group.items.unshift(...members);
  else group.items.push(...members);

  // The cycles stay selected in their new home; the group does not, or
  // the next action would face an ambiguous cycles+group selection.
  selectionState.items = members.map((c) => cycleSelectionItem(track.id, c.id));
  selectionState.anchor = selectionState.items[0] || null;

  afterStructuralMutation(track.id);
  return true;
}

/* REMOVE FROM GROUP only accepts a cycle at one END of its group. A
   middle cycle would have to either split the group in two or jump over
   its neighbours to get out, and neither is something a single button
   should decide — that is out of scope here. */
function analyzeRemoveFromGroup() {
  const cycles = getSelectedCycles();
  const groups = getSelectedGroups();
  const base = { valid: false, reason: "", side: null, trackId: null, cycleId: null };

  if (groups.length > 0) {
    return { ...base, reason: "Select the cycle to remove, not the group." };
  }
  if (cycles.length !== 1) {
    return { ...base, reason: "Select one cycle inside a group." };
  }
  const entry = cycles[0];
  if (entry.parentType !== "group") {
    return { ...base, reason: "That cycle is not inside a group." };
  }

  const last = entry.parent.length - 1;
  let side = null;
  if (entry.indexInParent === 0) side = "before";
  else if (entry.indexInParent === last) side = "after";
  else return { ...base, reason: "Only the first or last cycle of a group can be removed from it." };

  return { valid: true, reason: "", side, trackId: entry.track.id, cycleId: entry.cycle.id };
}

function removeSelectedCycleFromGroup() {
  if (!canMutateFromGui()) return false;
  const info = analyzeRemoveFromGroup();
  if (!info.valid) {
    showError(info.reason);
    return false;
  }

  const location = findCycleLocation(info.trackId, info.cycleId);
  if (!location || location.parentType !== "group") return false;
  const { track, group, cycle } = location;

  group.items.splice(location.indexInParent, 1);
  // Read AFTER the removal, but the group's own position in the track is
  // unaffected by emptying one of its slots.
  const groupIndex = track.sequence.indexOf(group);
  track.sequence.splice(info.side === "before" ? groupIndex : groupIndex + 1, 0, cycle);

  // A group of one is not a group; the existing rule handles it.
  const dissolved = dissolveUndersizedGroups(track);

  setSingleSelection(track.id, cycle.id);
  afterStructuralMutation(track.id);
  if (dissolved) showError("Group removed because it contained fewer than two cycles.");
  return true;
}

/* ----- Cross-boundary cycle moves (Phase 1.9E) -----
   A group is an editable boundary, not a sealed box: a cycle can be
   dragged into a group, out of one, or straight from one group to
   another. All three are the same move — "put this cycle at this
   position in this list" — so they share one target type and one
   mutation rather than three near-identical paths.

   A drop target is:
     { kind: "top",     index }            into the track's own sequence
     { kind: "group",   groupId, index }   into that group's items
     { kind: "invalid", reason }           refused; the drag shows no marker

   The pointer decides by lane position: whichever top-level item's
   x-range it is over wins, so being over a group means going INTO it
   and stepping outside the frame means going back to the track. That
   keeps "in" and "out" a matter of where the pointer is rather than a
   modifier key.
*/

// Lane segments of a group's own cycles, in order.
function groupInnerSegments(refs, group) {
  return refs.segments.filter((seg) => group.items.some((c) => c.id === seg.cycle.id));
}

function topLevelItemAtLaneX(items, laneX) {
  return (
    items.find((it) => laneX >= beatToPixel(it.startBeat) && laneX < beatToPixel(it.endBeat)) || null
  );
}

function resolveCycleDropTarget(trackId, cycleId, laneX) {
  const track = findTrack(trackId);
  const refs = laneRefs[trackId];
  const source = findCycleLocation(trackId, cycleId);
  if (!track || !refs || !source) return { kind: "invalid", reason: "" };

  const items = topLevelLaneItems(track, refs.layout);
  const hit = topLevelItemAtLaneX(items, laneX);

  if (hit && hit.item.type === "group") {
    const group = hit.item;
    const inner = groupInnerSegments(refs, group);
    const index = insertionIndexAtLaneX(inner, laneX);
    const markerBeat =
      inner.length === 0 ? hit.startBeat : insertionBoundaryBeat(inner, index);
    const sameGroup = source.parentType === "group" && source.group.id === group.id;

    // Emptying a group down to one cycle is not something a drop should
    // do quietly; the group would have to dissolve underneath the drag.
    if (!sameGroup && source.parentType === "group" && source.group.items.length <= 2) {
      return { kind: "invalid", reason: "A group keeps at least two cycles." };
    }
    return { kind: "group", groupId: group.id, index, markerBeat, sameParent: sameGroup };
  }

  const index = insertionIndexAtLaneX(items, laneX);
  const markerBeat =
    items.length === 0 ? 0 : insertionBoundaryBeat(items, index);
  return { kind: "top", index, markerBeat, sameParent: source.parentType === "track" };
}

/* Performs a resolved drop. One splice out, one splice in, then the
   existing undersized-group rule tidies up — a group left holding a
   single cycle dissolves, exactly as REMOVE FROM GROUP leaves it. */
function moveCycleToDropTarget(trackId, cycleId, target) {
  if (!canMutateFromGui()) return false;
  if (!target || target.kind === "invalid") return false;

  const location = findCycleLocation(trackId, cycleId);
  if (!location) return false;
  const { track, cycle, parent, indexInParent } = location;

  if (target.kind === "group") {
    const group = track.sequence.find((i) => i.type === "group" && i.id === target.groupId);
    if (!group) return false;
    let index = target.index;
    // Removing the cycle first shifts everything after it down one, so a
    // target index past its old home has to come back by one.
    if (parent === group.items && indexInParent < index) index -= 1;
    parent.splice(indexInParent, 1);
    if (parent === group.items && index === indexInParent) {
      // Dropped where it already was.
      parent.splice(indexInParent, 0, cycle);
      return false;
    }
    group.items.splice(clamp(index, 0, group.items.length), 0, cycle);
  } else {
    const wasTopLevel = location.parentType === "track";
    let index = target.index;
    if (wasTopLevel && location.itemIndex < index) index -= 1;
    if (wasTopLevel && index === location.itemIndex) return false; // no-op drop
    parent.splice(indexInParent, 1);
    track.sequence.splice(clamp(index, 0, track.sequence.length), 0, cycle);
  }

  const dissolved = dissolveUndersizedGroups(track);
  setSingleSelection(track.id, cycle.id);
  afterStructuralMutation(track.id);
  if (dissolved) showError("Group removed because it contained fewer than two cycles.");
  return true;
}

/* ----- Group frame resize -----
   Dragging a group's left or right edge moves the boundary over whole
   CYCLES, never over pixels: the group either contains a cycle or it
   does not, so a half-absorbed cycle is not a state that exists. The
   edge therefore snaps to cycle boundaries and the group's repeat is
   left alone — resizing changes what one pass contains, not how many
   passes there are.

   Only adjacent CYCLES can be absorbed. A neighbouring group is never
   swallowed, because that would nest.
*/

/* The run of cycles the edge can sweep over, ordered outward from the
   group. For the right edge that is the group's own cycles followed by
   the top-level cycles after it; for the left edge, mirrored. */
function groupResizeCandidates(track, group, side) {
  const itemIndex = track.sequence.indexOf(group);
  if (itemIndex === -1) return { inside: [], outside: [] };

  const outside = [];
  if (side === "right") {
    for (let i = itemIndex + 1; i < track.sequence.length; i++) {
      if (track.sequence[i].type !== "cycle") break;
      outside.push(track.sequence[i]);
    }
    return { inside: group.items.slice(), outside };
  }
  for (let i = itemIndex - 1; i >= 0; i--) {
    if (track.sequence[i].type !== "cycle") break;
    outside.push(track.sequence[i]);
  }
  return { inside: group.items.slice().reverse(), outside };
}

/* How many cycles the group should hold on the dragged side, given the
   pointer. Counted in the "outward" order above, clamped so the group
   never drops below two cycles. */
function computeGroupResizeCount(track, group, side, laneX, refs) {
  const { inside, outside } = groupResizeCandidates(track, group, side);
  const combined = inside.concat(outside); // outward from the group's far edge
  const byId = new Map(refs.segments.map((seg) => [seg.cycle.id, seg]));

  // Walk outward; the boundary sits past every cycle whose midpoint the
  // pointer has cleared.
  let count = 0;
  for (let i = 0; i < combined.length; i++) {
    const seg = byId.get(combined[i].id);
    if (!seg) break;
    const midX = beatToPixel((seg.startBeat + seg.endBeat) / 2);
    const cleared = side === "right" ? laneX >= midX : laneX <= midX;
    if (!cleared) break;
    count = i + 1;
  }

  // Two is the floor: a one-cycle group is not a group, and a resize
  // should refuse rather than dissolve what the user is still adjusting.
  return clamp(count, 2, combined.length);
}

/* Applies a resize: `count` is how many cycles, counted outward from the
   group's far edge on `side`, the group should end up holding. */
function applyGroupResize(trackId, groupId, side, count) {
  if (!canMutateFromGui()) return false;
  const track = findTrack(trackId);
  if (!track) return false;
  const group = track.sequence.find((i) => i.type === "group" && i.id === groupId);
  if (!group) return false;

  const { inside, outside } = groupResizeCandidates(track, group, side);
  const combined = inside.concat(outside);
  const target = clamp(count, 2, combined.length);
  if (target === inside.length) return false; // nothing to do

  const keep = combined.slice(0, target);
  const keepIds = new Set(keep.map((c) => c.id));

  // Cycles the group is gaining have to leave the track's own list.
  keep
    .filter((c) => !group.items.some((g) => g.id === c.id))
    .forEach((cycle) => {
      const idx = track.sequence.indexOf(cycle);
      if (idx !== -1) track.sequence.splice(idx, 1);
    });

  // Cycles the group is losing, still in left-to-right order.
  const expelled = group.items.filter((c) => !keepIds.has(c.id));

  // `keep` runs outward from the anchored edge, so the left handle's
  // list is reversed relative to how the group actually reads.
  group.items = side === "right" ? keep.slice() : keep.slice().reverse();

  if (expelled.length > 0) {
    // They go back to the track on the side they left from, which keeps
    // the sounding order identical to what the lane just showed.
    const groupIndex = track.sequence.indexOf(group);
    track.sequence.splice(side === "right" ? groupIndex + 1 : groupIndex, 0, ...expelled);
  }

  setSingleSelectionItem(groupSelectionItem(track.id, group.id));
  afterStructuralMutation(track.id);
  return true;
}

function moveSelectedGroup(direction) {
  return moveSelectedCycles(direction);
}

/* ===== Duplicate / Copy / Paste (Phase 1.9F) =====
   DUPLICATE and PASTE are the same operation with different sources:
   one takes its material from the selection in place, the other from the
   clipboard. Both go through cloneSequenceItemWithNewIds(), so a copy is
   never an alias — ids are what selection, the Inspector, the text
   selection map and drag all key off, and two live items sharing one
   would corrupt every one of them.
*/

function cloneCycleWithNewId(cycle) {
  const copy = cloneStructure(cycle);
  copy.id = generateCycleId();
  return copy;
}

// A group copy is a copy all the way down: its cycles are new cycles,
// not the originals moved or shared. Everything else — repeat, and each
// cycle's span/division/offset/hits/ratchets/phase/repeat/pass — comes along
// verbatim, because a duplicate that differed anywhere would not be one.
function cloneSequenceItemWithNewIds(item) {
  if (item.type !== "group") return cloneCycleWithNewId(item);
  const copy = cloneStructure(item);
  copy.id = generateGroupId();
  copy.items = item.items.map(cloneCycleWithNewId);
  return copy;
}

/* The selection reduced to the items a copy actually acts on, in
   SEQUENCE order — never click order — because the result has to read
   the same way the lane does.

   A cycle inside a SELECTED group is dropped: the group's copy already
   contains it, and keeping both would duplicate that cycle twice. */
function selectionStructureUnits() {
  const wantedCycles = new Set(
    selectionState.items.filter((it) => it.type === "cycle").map(selectionKey)
  );
  const wantedGroups = new Set(
    selectionState.items.filter((it) => it.type === "group").map(selectionKey)
  );
  if (wantedCycles.size === 0 && wantedGroups.size === 0) return [];

  const units = [];
  state.tracks.forEach((track) => {
    track.sequence.forEach((item, itemIndex) => {
      if (item.type === "cycle") {
        if (wantedCycles.has(selectionKey(cycleSelectionItem(track.id, item.id)))) {
          units.push({ track, parent: track.sequence, index: itemIndex, item, group: null });
        }
        return;
      }
      if (wantedGroups.has(selectionKey(groupSelectionItem(track.id, item.id)))) {
        units.push({ track, parent: track.sequence, index: itemIndex, item, group: null });
        return; // its own cycles travel inside the group copy
      }
      item.items.forEach((cycle, indexInParent) => {
        if (wantedCycles.has(selectionKey(cycleSelectionItem(track.id, cycle.id)))) {
          units.push({ track, parent: item.items, index: indexInParent, item: cycle, group: item });
        }
      });
    });
  });
  return units;
}

/* Selects a set of freshly created items by id. Built by walking the
   structure rather than from the creation order, so the selection is in
   sequence order even when the copies were spliced in back-to-front. */
function selectStructureItemsById(ids) {
  const items = [];
  state.tracks.forEach((track) => {
    track.sequence.forEach((item) => {
      if (item.type === "cycle") {
        if (ids.has(item.id)) items.push(cycleSelectionItem(track.id, item.id));
        return;
      }
      if (ids.has(item.id)) {
        items.push(groupSelectionItem(track.id, item.id));
        return;
      }
      item.items.forEach((c) => {
        if (ids.has(c.id)) items.push(cycleSelectionItem(track.id, c.id));
      });
    });
  });
  selectionState.items = items;
  selectionState.anchor = items[items.length - 1] || null;
}

/* Cmd/Ctrl+D. Each selected item is copied in directly after itself, so
   the duplicate lands where the eye expects it and the original keeps
   its place.

   A contiguous run duplicates as one BLOCK — [B C] becomes B C B' C',
   not B B' C C' — because the run is the thing being duplicated, and
   interleaving would scramble the phrase it forms. Runs are inserted
   back-to-front so the earlier indices stay valid while splicing. */
function duplicateSelection() {
  if (!canMutateFromGui()) return false;
  const units = selectionStructureUnits();
  if (units.length === 0) return false;

  const byParent = new Map();
  units.forEach((unit) => {
    let bucket = byParent.get(unit.parent);
    if (!bucket) {
      bucket = { track: unit.track, parent: unit.parent, indices: [] };
      byParent.set(unit.parent, bucket);
    }
    bucket.indices.push(unit.index);
  });

  const createdIds = new Set();
  const trackIds = new Set();

  byParent.forEach(({ track, parent, indices }) => {
    trackIds.add(track.id);
    const sorted = Array.from(new Set(indices)).sort((a, b) => a - b);
    const runs = [];
    sorted.forEach((index) => {
      const current = runs[runs.length - 1];
      if (current && index === current[current.length - 1] + 1) current.push(index);
      else runs.push([index]);
    });
    for (let i = runs.length - 1; i >= 0; i--) {
      const run = runs[i];
      const copies = run.map((index) => cloneSequenceItemWithNewIds(parent[index]));
      parent.splice(run[run.length - 1] + 1, 0, ...copies);
      copies.forEach((copy) => createdIds.add(copy.id));
    }
  });

  // The new material is what the user will act on next, so it takes the
  // selection — the same convention CREATE GROUP and UNGROUP follow.
  selectStructureItemsById(createdIds);
  afterStructuralMutation(Array.from(trackIds));
  return true;
}

/* Cmd/Ctrl+C. Allowed while the text draft is dirty, unlike every
   structural edit, because copying changes nothing: it reads the APPLIED
   structure, which is exactly what `state` holds — the draft is text
   that has not become structure yet. */
function copySelection() {
  const units = selectionStructureUnits();
  if (units.length === 0) return false;

  clipboardState = {
    items: units.map((unit) => cloneStructure(unit.item)),
    sourceTrackId: units[0].track.id,
  };
  // No history step: the clipboard is not part of the document.
  refreshSelectionVisuals(); // re-enables PASTE in the Inspector
  return true;
}

/* Where a paste lands, in priority order:
     a selected GROUP        → appended inside it, at the end
     a selected CYCLE        → directly after it, in its own parent
                               (inside the group if that is where it is)
     nothing selected        → end of the track the copy came from

   The last case needs *some* track and there is no selection to name
   one, so it reuses the copy's origin: paste with nothing selected puts
   the material back where it came from, which is at least predictable.
   A vanished source track falls back to the first track. */
function resolvePasteTarget() {
  const groups = getSelectedGroups();
  if (groups.length > 0) {
    const entry = groups[groups.length - 1];
    return {
      track: entry.track,
      parent: entry.group.items,
      index: entry.group.items.length,
      group: entry.group,
    };
  }

  const cycles = getSelectedCycles();
  if (cycles.length > 0) {
    // The LAST of a multi-selection, so a pasted block follows the whole
    // run rather than splitting it. The position comes from
    // findCycleLocation(), not from the selection entry: that entry's
    // indexInParent counts within a group and is 0 for every top-level
    // cycle, which is not the index this splice needs.
    const last = cycles[cycles.length - 1];
    const location = findCycleLocation(last.track.id, last.cycle.id);
    if (!location) return null;
    return {
      track: location.track,
      parent: location.parent,
      index: location.indexInParent + 1,
      group: location.group,
    };
  }

  const track = findTrack(clipboardState.sourceTrackId) || state.tracks[0];
  if (!track) return null;
  return { track, parent: track.sequence, index: track.sequence.length, group: null };
}

function canPaste() {
  return clipboardState.items.length > 0 && !editorState.isDirty;
}

// Cmd/Ctrl+V.
function pasteClipboard() {
  if (!canMutateFromGui()) return false;
  if (clipboardState.items.length === 0) return false;

  const target = resolvePasteTarget();
  if (!target) return false;

  // Groups do not nest. Rather than silently redirect the paste to the
  // track — which would put it somewhere the user did not point at — the
  // operation is refused and says why.
  if (target.group && clipboardState.items.some((item) => item.type === "group")) {
    showError("A group cannot be pasted inside another group.");
    return false;
  }

  // Cloned again on the way out: the clipboard must survive its own
  // paste intact, and two pastes must not share objects.
  const copies = clipboardState.items.map(cloneSequenceItemWithNewIds);
  target.parent.splice(clamp(target.index, 0, target.parent.length), 0, ...copies);

  selectStructureItemsById(new Set(copies.map((copy) => copy.id)));
  afterStructuralMutation(target.track.id);
  return true;
}

/* ===== GUI rendering ===== */

let tracksContainerEl,
  inspectorBarEl,
  sequenceTextEl,
  statusMessageEl,
  playBtnEl,
  stopBtnEl,
  initializeBtnEl,
  undoBtnEl,
  redoBtnEl,
  tempoInputEl,
  commonCycleValueEl,
  timelineViewToggleEl,
  timelineLabelColumnEl,
  timelineScrollViewportEl,
  timelineContentEl,
  timelineZoomControlsEl,
  zoomOutBtnEl,
  zoomInBtnEl,
  zoomFitBtnEl,
  zoomOneToOneBtnEl,
  timelineZoomValueEl,
  timelineFollowBtnEl,
  draftStatusEl,
  applySequenceBtnEl,
  revertSequenceBtnEl,
  saveProjectBtnEl,
  loadProjectBtnEl,
  projectFileInputEl;

// ----- Shared drawing primitives -----

function createHitDot(hitValue, displayPosition = hitValue) {
  const dot = document.createElement("div");
  const isInt = Number.isInteger(displayPosition);
  dot.className = "hit-dot " + (isInt ? "is-integer" : "is-fractional");
  dot.dataset.value = String(hitValue);
  return dot;
}

function createGridLine(className) {
  const line = document.createElement("div");
  line.className = className;
  return line;
}

function createPlayheadLine(className) {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

// Horizontal scroll offsets are owned by the DOM, so a full re-render
// would otherwise snap every lane back to beat 0.
function captureScrollPositions() {
  const positions = {};
  Object.entries(laneRefs).forEach(([trackId, refs]) => {
    if (refs.scrollEl) positions[trackId] = refs.scrollEl.scrollLeft;
  });
  return positions;
}

function restoreScrollPositions(positions) {
  Object.entries(positions).forEach(([trackId, value]) => {
    const refs = laneRefs[trackId];
    if (refs && refs.scrollEl) refs.scrollEl.scrollLeft = value;
  });
}

function renderApp(options = {}) {
  // Scroll offsets are carried across renders by default; only an
  // explicit reset (INITIALIZE) sends every lane back to beat 0.
  const scroll = options.resetScroll ? {} : captureScrollPositions();
  tracksContainerEl.innerHTML = "";
  laneRefs = {};
  playheadRefs = {};
  state.tracks.forEach((track) => {
    tracksContainerEl.appendChild(renderTrackLane(track));
  });
  restoreScrollPositions(scroll);
  if (options.resetScroll) {
    Object.values(laneRefs).forEach((refs) => {
      if (refs.scrollEl) refs.scrollEl.scrollLeft = 0;
    });
  }
  renderCompactInspector();
}

function renderTrackLane(track) {
  const row = document.createElement("div");
  row.className = "track-row";
  row.dataset.trackId = track.id;

  const nameEl = document.createElement("div");
  nameEl.className = "track-name";
  nameEl.textContent = track.name.toUpperCase();
  row.appendChild(nameEl);

  const scrollEl = document.createElement("div");
  scrollEl.className = "track-lane-scroll";

  const lane = document.createElement("div");
  lane.className = "track-lane";

  const layout = computeLaneLayout(track);
  lane.style.width = `${beatToPixel(layout.totalBeats)}px`;

  // segmentEls maps a cycle id OR a group id to its one element.
  playheadRefs[track.id] = { segmentEls: {}, hitEls: {}, patternRefs: {} };
  laneRefs[track.id] = { scrollEl, lane, layout, segments: layout.segments, totalBeats: layout.totalBeats };

  // Group frames sit behind the segments so their outline reads as a
  // container rather than as another cycle.
  layout.frames.forEach((frame) => {
    lane.appendChild(renderGroupFrame(track, frame));
  });

  layout.segments.forEach((segment) => {
    lane.appendChild(renderCycleSegment(track, segment));
  });

  // One playhead spans the whole lane, positioned in absolute lane beats.
  const playhead = createPlayheadLine("lane-playhead is-inactive");
  lane.appendChild(playhead);
  laneRefs[track.id].playhead = playhead;

  scrollEl.appendChild(lane);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "add-cycle-btn";
  addBtn.textContent = "+ CYCLE";

  const laneWrap = document.createElement("div");
  laneWrap.className = "track-lane-wrap";
  laneWrap.appendChild(scrollEl);
  laneWrap.appendChild(addBtn);

  row.appendChild(laneWrap);
  return row;
}

/* The group's outline spans exactly one pass through its cycles — the
   same width regardless of how many times item.repeat plays it back —
   so a group's footprint in the lane never grows with its repeat count.
   The header band along the top is a real click target rather than a
   floating caption: a group whose cycles fill it edge to edge would
   otherwise only be selectable on a few pixels of border. */
function renderGroupFrame(track, frame) {
  const el = document.createElement("div");
  const selected = isGroupSelected(track.id, frame.group.id);
  el.className = "cycle-group" + (selected ? " selected" : "");
  el.dataset.groupId = frame.group.id;
  el.style.left = `${beatToPixel(frame.startBeat)}px`;
  el.style.width = `${beatToPixel(frame.endBeat - frame.startBeat)}px`;
  el.setAttribute("role", "group");
  el.setAttribute("aria-selected", selected ? "true" : "false");
  el.setAttribute(
    "aria-label",
    `Cycle group, ${frame.group.items.length} cycles, repeated ${frame.group.repeat} times`
  );

  const header = document.createElement("div");
  header.className = "cycle-group-header";
  header.textContent = `GROUP ×${frame.group.repeat}`;
  header.setAttribute(
    "aria-label",
    `Select cycle group, repeated ${frame.group.repeat} times. Drag to reorder.`
  );
  // The header band doubles as the group's drag handle: a press selects,
  // a drag moves the whole group among the track's items.
  wireGroupDragHandle(header, el, track.id, frame.group.id);
  el.appendChild(header);

  // Edge handles widen or narrow the group over whole cycles.
  ["left", "right"].forEach((side) => {
    const grip = document.createElement("div");
    grip.className = `group-resize-handle is-${side}`;
    grip.setAttribute(
      "aria-label",
      side === "left"
        ? "Drag to take in or release the cycle before this group"
        : "Drag to take in or release the cycle after this group"
    );
    wireGroupResizeHandle(grip, track.id, frame.group.id, side);
    el.appendChild(grip);
  });

  playheadRefs[track.id].segmentEls[frame.group.id] = el;
  return el;
}

/* A cycle is two zones with two jobs, and they must not be confused:

     HEADER  — selection and drag-reorder. Never adds a hit.
     BODY    — hit entry. Every hit coordinate is measured from here, so
               the header's height can never leak into a hit position.

   Before this split, the whole segment was a hit-entry surface, which
   meant "click the cycle to select it" and "click the cycle to place a
   hit" were the same gesture and the label was a hit target.
*/
const SEGMENT_FULL_HEADER_PX = 36;
const SEGMENT_COMPACT_HEADER_PX = 16;

function renderCycleSegment(track, segment) {
  const { cycle, startBeat } = segment;
  const seg = document.createElement("div");
  seg.className = "cycle-segment" + (cycle.pass ? " is-passed" : "");
  if (segment.group) seg.classList.add("is-in-group");
  seg.dataset.cycleId = cycle.id;
  seg.style.left = `${beatToPixel(startBeat)}px`;
  const width = cycleSegmentWidth(cycle); // CYCLE LENGTH in px — the segment's own occupancy on the lane
  seg.style.width = `${width}px`;
  const selected = isCycleSelected(track.id, cycle.id);
  seg.classList.toggle("selected", selected);
  seg.classList.toggle("selection-anchor", selected && isSelectionAnchor(track.id, cycle.id));
  seg.setAttribute("aria-selected", selected ? "true" : "false");

  playheadRefs[track.id].hitEls[cycle.id] = {};

  const offset = cycle.offset || RATIONAL_ZERO;
  const hasOffset = offset.numerator !== 0;
  const spanText = rationalToString(cycle.span);
  const lengthText = rationalToString(computeCycleLength(cycle));
  const phaseText = serializePhaseToken(cycle);
  // Full information is always reachable even when nothing fits inside
  // the segment itself.
  seg.title =
    `SPAN ${spanText} · DIV ${cycle.division} · REP ${cycle.repeat}` +
    (hasOffset ? ` · LEN ${lengthText} (OFS ${formatSignedRational(offset)})` : "") +
    (phaseText ? ` · PHASE ${phaseText}` : "") +
    (cycle.pass ? " · PASS" : "");

  /* ----- Header ----- */
  const header = document.createElement("div");
  header.className = "cycle-header";
  header.setAttribute("role", "button");
  header.setAttribute(
    "aria-label",
    `Select cycle, span ${spanText}, divided into ${cycle.division}`
  );
  header.setAttribute("aria-pressed", selected ? "true" : "false");
  // Dragging across headers range-selects; a plain press falls through
  // to the click handler and selects normally.
  wireHeaderRangeSelection(header, track.id, cycle.id);

  /* A fractional span makes segments genuinely narrow — 1/16 of a beat
     is 4px. The time axis is never widened to make room for chrome:
     a minimum width would be a lie about how long the cycle is. The
     header BAND always exists so the cycle stays selectable; only its
     contents drop away. */
  if (width >= SEGMENT_COMPACT_HEADER_PX) {
    const dragHandle = document.createElement("span");
    dragHandle.className = "cycle-drag-handle";
    dragHandle.textContent = "⠿";
    dragHandle.setAttribute("aria-label", "Move cycle");
    wireDragHandle(dragHandle, seg, track.id, cycle.id);
    header.appendChild(dragHandle);

    if (width >= SEGMENT_FULL_HEADER_PX) {
      const summary = document.createElement("span");
      summary.className = "cycle-label segment-summary";
      summary.textContent = `${spanText}:${cycle.division}${hasOffset ? formatSignedRational(offset) : ""} ×${cycle.repeat}${phaseText}`;
      header.appendChild(summary);

      if (cycle.pass) {
        const passTag = document.createElement("span");
        passTag.className = "segment-pass-tag";
        passTag.textContent = "PASS";
        header.appendChild(passTag);
      }
    }

    // Right-edge handle: drags CYCLE LENGTH via OFFSET, independently of
    // PATTERN SPAN (see wireLengthHandle). Kept behind the same width
    // gate as the drag handle — a segment too narrow to reorder is too
    // narrow to grab precisely either.
    const lengthHandle = document.createElement("span");
    lengthHandle.className = "cycle-length-handle";
    lengthHandle.textContent = "↔";
    lengthHandle.setAttribute("aria-label", "Drag to change cycle length");
    lengthHandle.title = "Drag to change cycle length (offset from pattern span)";
    wireLengthHandle(lengthHandle, seg, track.id, cycle.id);
    header.appendChild(lengthHandle);
  } else {
    // Too narrow even for a drag handle: reorder via the Inspector's
    // ← / → buttons or a multi-selection MOVE. The header band is still
    // there, and still selects.
    seg.classList.add("is-tiny");
  }
  seg.appendChild(header);

  /* ----- Body row: full CYCLE LENGTH width, so PASS/selection styling
     and the offset margin below both read against the segment's real
     lane occupancy. ----- */
  const bodyRow = document.createElement("div");
  bodyRow.className = "cycle-body-row";

  /* ----- Body: the only surface that accepts hits, sized to PATTERN
     SPAN rather than CYCLE LENGTH. When offset is negative the pattern
     is wider than the segment itself and deliberately overflows past
     its right edge — that overflow, and the segment boundary drawn
     inside it, IS the "cycle ends before the pattern does" picture the
     offset describes. When offset is positive the pattern body simply
     doesn't reach the segment's right edge, leaving a plain margin. ----- */
  const body = document.createElement("div");
  body.className = "cycle-body";
  const patternWidth = beatToPixel(rationalToNumber(cycle.span));
  body.style.width = `${patternWidth}px`;

  // Hits live in an overflow-visible layer so a hit at position 1 is
  // never clipped, without introducing any padding into the time axis.
  const hitsLayer = document.createElement("div");
  hitsLayer.className = "segment-hits";
  body.appendChild(hitsLayer);
  bodyRow.appendChild(body);

  // Marks where the pattern itself ends: with a positive offset this
  // sits inside the segment (everything past it is the silent trailing
  // margin); with a negative offset it sits past the segment's own
  // right edge, inside the overflowing pattern body.
  if (hasOffset) {
    const marker = document.createElement("div");
    marker.className = "cycle-pattern-end-marker";
    marker.style.left = `${patternWidth}px`;
    bodyRow.appendChild(marker);
  }

  seg.appendChild(bodyRow);

  playheadRefs[track.id].patternRefs[cycle.id] = {
    body,
    hitsLayer,
    renderedCycleRepeatIndex: null,
  };
  renderLanePatternVisual(track, cycle, 0);
  playheadRefs[track.id].segmentEls[cycle.id] = seg;
  return seg;
}

function renderLanePatternVisual(track, cycle, cycleRepeatIndex = 0) {
  const refs = playheadRefs[track.id];
  const pattern = refs && refs.patternRefs[cycle.id];
  if (!pattern) return;

  pattern.body.querySelectorAll(".division-grid-line").forEach((line) => line.remove());
  visualGridDivisions(cycle, cycleRepeatIndex).forEach((position) => {
    const line = createGridLine("division-grid-line");
    line.style.left = `${(position / cycle.division) * 100}%`;
    pattern.body.insertBefore(line, pattern.hitsLayer);
  });

  pattern.hitsLayer.innerHTML = "";
  refs.hitEls[cycle.id] = {};
  expandCycleHitEvents(cycle, cycleRepeatIndex).forEach((hitEvent) => {
    const dot = createHitDot(hitEvent.hitValue, hitEvent.hitPosition);
    dot.dataset.ratchetIndex = String(hitEvent.ratchetIndex);
    dot.dataset.ratchetCount = String(hitEvent.ratchetCount);
    dot.dataset.phaseRepeatIndex = String(cycleRepeatIndex);
    dot.style.left = `${hitToFraction(hitEvent.hitPosition, cycle.division) * 100}%`;
    wireHitDotInteractions(dot, track.id, cycle.id, hitEvent.hitValue);
    refs.hitEls[cycle.id][hitVisualKey(hitEvent.hitValue, hitEvent.ratchetIndex)] = dot;
    pattern.hitsLayer.appendChild(dot);
  });
  pattern.body.dataset.phaseRepeatIndex = String(cycleRepeatIndex);
  pattern.renderedCycleRepeatIndex = cycleRepeatIndex;
}

/* ----- Compact Inspector -----
   Always present in a fixed spot above the lanes, so selecting a cycle
   never inserts or removes layout below the tracks.
*/

function buildInspectorField(label, inputClass, value) {
  const wrap = document.createElement("div");
  wrap.className = "inspector-field";
  const labelEl = document.createElement("span");
  labelEl.className = "inspector-label";
  labelEl.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.className = inputClass;
  input.min = "1";
  input.value = String(value);
  wrap.appendChild(labelEl);
  wrap.appendChild(input);
  return wrap;
}

// SPAN, LEN and OFS all hold a Rational, which "4", "0.5" and "1/2" can
// express but a number input cannot, so they are text fields. DIV and
// REP stay numeric — they really are integers and keep their native
// steppers.
function buildInspectorRationalField(label, inputClass, text, title) {
  const wrap = document.createElement("div");
  wrap.className = "inspector-field";
  const labelEl = document.createElement("span");
  labelEl.className = "inspector-label";
  labelEl.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.className = inputClass;
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = text;
  input.title = title;
  wrap.appendChild(labelEl);
  wrap.appendChild(input);
  return wrap;
}

function buildInspectorSpanField(cycle) {
  return buildInspectorRationalField(
    "SPAN",
    "cycle-span-input",
    rationalToString(cycle.span),
    "Pattern span in beats: 4, 0.5 or 1/2 — sizes the pattern's own hit spacing"
  );
}

// CYCLE LENGTH = PATTERN SPAN + OFFSET. Editing either one keeps the
// other fixed and solves for the offset that produces what was typed
// (see handleInspectorChange).
function buildInspectorLengthField(cycle) {
  return buildInspectorRationalField(
    "LEN",
    "cycle-length-input",
    rationalToString(computeCycleLength(cycle)),
    "Cycle length in beats (span + offset) — when the next cycle starts"
  );
}

function buildInspectorOffsetField(cycle) {
  return buildInspectorRationalField(
    "OFS",
    "cycle-offset-input",
    formatSignedRational(cycle.offset || RATIONAL_ZERO),
    "Offset from pattern span to cycle length: +1, -1/2, 0"
  );
}

function buildInspectorPhaseField(cycle) {
  const wrap = document.createElement("div");
  wrap.className = "inspector-field inspector-phase-field";
  const labelEl = document.createElement("span");
  labelEl.className = "inspector-label";
  labelEl.textContent = "PHASE";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "cycle-phase-input";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "—";
  input.value = serializePhaseToken(cycle);
  input.title = "Phase shift: @2, @>1, @>(1,-2), @?, @?>(1,-2)";
  wrap.appendChild(labelEl);
  wrap.appendChild(input);
  return wrap;
}

// Track breakdown for a multi-selection: "HAT ×2 / SNARE2 ×1". Long
// selections are truncated so the bar's width never depends on how many
// tracks happen to be involved.
const INSPECTOR_TRACK_SUMMARY_LIMIT = 3;

function buildSelectionTrackSummary(groups) {
  const shown = groups.slice(0, INSPECTOR_TRACK_SUMMARY_LIMIT);
  const parts = shown.map((g) => `${g.track.name.toUpperCase()} ×${g.entries.length}`);
  const rest = groups.length - shown.length;
  if (rest > 0) parts.push(`+${rest} TRACK${rest > 1 ? "S" : ""}`);
  return parts.join(" / ");
}

function renderCompactInspector() {
  inspectorBarEl.innerHTML = "";
  inspectorRefs = null;
  delete inspectorBarEl.dataset.trackId;
  delete inspectorBarEl.dataset.cycleId;

  delete inspectorBarEl.dataset.groupId;

  const selected = getSelectedCycles();
  const selectedGroups = getSelectedGroups();

  if (selected.length === 0 && selectedGroups.length === 0) {
    inspectorBarEl.dataset.mode = "empty";
    const empty = document.createElement("div");
    empty.className = "inspector-empty";
    empty.textContent = "NO CYCLE SELECTED";
    inspectorBarEl.appendChild(empty);
    return;
  }

  // A single group gets its own panel: span/division/hits belong to
  // cycles, and a group has none of them.
  if (selectedGroups.length === 1 && selected.length === 0) {
    renderGroupInspector(selectedGroups[0]);
    return;
  }

  if (selected.length > 1 || selectedGroups.length > 0) {
    renderMultiSelectionInspector(selected, selectedGroups);
    return;
  }

  inspectorBarEl.dataset.mode = "single";
  const track = selected[0].track;
  const cycle = selected[0].cycle;

  inspectorBarEl.dataset.trackId = track.id;
  inspectorBarEl.dataset.cycleId = cycle.id;

  const label = document.createElement("div");
  label.className = "inspector-selected";
  const trackName = document.createElement("span");
  trackName.className = "inspector-selected-track";
  trackName.textContent = track.name.toUpperCase();
  const cycleOffset = cycle.offset || RATIONAL_ZERO;
  const summary = document.createElement("span");
  summary.className = "inspector-selected-summary";
  summary.textContent = `${rationalToString(cycle.span)}:${cycle.division}${cycleOffset.numerator !== 0 ? formatSignedRational(cycleOffset) : ""} ×${cycle.repeat}`;
  label.appendChild(trackName);
  label.appendChild(summary);
  inspectorBarEl.appendChild(label);

  const fields = document.createElement("div");
  fields.className = "inspector-fields";
  fields.appendChild(buildInspectorSpanField(cycle));
  fields.appendChild(buildInspectorLengthField(cycle));
  fields.appendChild(buildInspectorOffsetField(cycle));
  fields.appendChild(buildInspectorField("DIV", "cycle-division-input", cycle.division));
  fields.appendChild(buildInspectorField("REP", "cycle-repeat-input", cycle.repeat));
  fields.appendChild(buildInspectorPhaseField(cycle));

  // CURRENT is display-only and fixed-width so live REP progress can
  // never reflow the bar.
  const currentField = document.createElement("div");
  currentField.className = "inspector-field";
  const currentLabel = document.createElement("span");
  currentLabel.className = "inspector-label";
  currentLabel.textContent = "CUR";
  const currentValue = document.createElement("span");
  currentValue.className = "inspector-current";
  currentValue.textContent = "—";
  currentField.appendChild(currentLabel);
  currentField.appendChild(currentValue);
  fields.appendChild(currentField);
  inspectorBarEl.appendChild(fields);

  const actions = document.createElement("div");
  actions.className = "inspector-actions";

  const passBtn = document.createElement("button");
  passBtn.type = "button";
  passBtn.className = "inspector-btn pass-toggle-btn" + (cycle.pass ? " is-active" : "");
  passBtn.textContent = cycle.pass ? "PASS ON" : "PASS OFF";
  actions.appendChild(passBtn);

  // Single selection is just a selection of one, so the move buttons are
  // driven by the same analysis the batch move uses.
  const move = analyzeMoveSelection();
  actions.appendChild(buildMoveButton("left", move));
  actions.appendChild(buildMoveButton("right", move));

  // Only offered for a cycle that is actually in a group — for one that
  // is not, the button would be permanently dead chrome.
  if (isCycleInsideGroup(track.id, cycle.id)) {
    const removeFromGroup = analyzeRemoveFromGroup();
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "inspector-btn remove-from-group-btn";
    removeBtn.textContent = "REMOVE FROM GROUP";
    removeBtn.disabled = !removeFromGroup.valid;
    if (!removeFromGroup.valid) removeBtn.title = removeFromGroup.reason;
    actions.appendChild(removeBtn);
  }

  appendClipboardActions(actions);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "inspector-btn remove-cycle-btn";
  deleteBtn.textContent = "DELETE";
  const del = analyzeDeleteSelection();
  deleteBtn.disabled = !del.valid;
  if (!del.valid && del.reason) deleteBtn.title = del.reason;
  actions.appendChild(deleteBtn);

  inspectorBarEl.appendChild(actions);

  inspectorRefs = { currentValueEl: currentValue, trackId: track.id, cycleId: cycle.id };
  updateInspectorCurrent();
}

/* DUPLICATE / COPY / PASTE, identical in every panel because they mean
   the same thing for a cycle, a group and a multi-selection alike.
   The keyboard shortcuts are the primary interface; these exist so the
   operations are discoverable at all. */
function appendClipboardActions(actions) {
  const duplicateBtn = document.createElement("button");
  duplicateBtn.type = "button";
  duplicateBtn.className = "inspector-btn duplicate-btn";
  duplicateBtn.textContent = "DUPLICATE";
  duplicateBtn.title = "Duplicate selection (Cmd/Ctrl+D)";
  actions.appendChild(duplicateBtn);

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "inspector-btn copy-selection-btn";
  copyBtn.textContent = "COPY";
  copyBtn.title = "Copy selection (Cmd/Ctrl+C)";
  actions.appendChild(copyBtn);

  const pasteBtn = document.createElement("button");
  pasteBtn.type = "button";
  pasteBtn.className = "inspector-btn paste-selection-btn";
  pasteBtn.textContent = "PASTE";
  pasteBtn.disabled = !canPaste();
  pasteBtn.title = clipboardState.items.length === 0
    ? "Nothing copied yet"
    : "Paste (Cmd/Ctrl+V)";
  actions.appendChild(pasteBtn);
}

function buildMoveButton(side, move) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `inspector-btn move-${side}-btn`;
  btn.textContent = side === "left" ? "←" : "→";
  const enabled = side === "left" ? move.canMoveLeft : move.canMoveRight;
  btn.disabled = !enabled;
  if (!enabled && move.reason) btn.title = move.reason;
  return btn;
}

// Multi-selection deliberately shows no SPAN / DIV / REP / CUR: those
// differ per cycle, and multi-value editing is out of scope here.
/* Group panel. PASS is deliberately absent: a group has no pass state
   of its own, and offering one would raise the question of what happens
   to the individual cycles' pass flags. To silence a group, select its
   cycles and PASS those. */
function renderGroupInspector(entry) {
  const { track, group } = entry;
  inspectorBarEl.dataset.mode = "group";
  inspectorBarEl.dataset.trackId = track.id;
  inspectorBarEl.dataset.groupId = group.id;

  const label = document.createElement("div");
  label.className = "inspector-selected";
  const title = document.createElement("span");
  title.className = "inspector-selected-track";
  title.textContent = "GROUP";
  const summary = document.createElement("span");
  summary.className = "inspector-selected-summary";
  summary.textContent = `${track.name.toUpperCase()} · ${group.items.length} CYCLES`;
  label.appendChild(title);
  label.appendChild(summary);
  inspectorBarEl.appendChild(label);

  const base = computeGroupBaseLength(group);
  const total = computeGroupTotalLength(group);

  const fields = document.createElement("div");
  fields.className = "inspector-fields";
  fields.appendChild(buildInspectorReadout("LENGTH", `${rationalToString(base)}`));

  const repeatWrap = document.createElement("div");
  repeatWrap.className = "inspector-field";
  const repeatLabel = document.createElement("span");
  repeatLabel.className = "inspector-label";
  repeatLabel.textContent = "REPEAT";
  const repeatInput = document.createElement("input");
  repeatInput.type = "number";
  repeatInput.min = "1";
  repeatInput.max = String(MAX_REPEAT);
  repeatInput.className = "group-repeat-input";
  repeatInput.value = String(group.repeat);
  repeatInput.setAttribute("aria-label", "Group repeat count");
  repeatWrap.appendChild(repeatLabel);
  repeatWrap.appendChild(repeatInput);
  fields.appendChild(repeatWrap);

  fields.appendChild(buildInspectorReadout("TOTAL", `${rationalToString(total)}`));
  inspectorBarEl.appendChild(fields);

  const actions = document.createElement("div");
  actions.className = "inspector-actions";

  const ungroupBtn = document.createElement("button");
  ungroupBtn.type = "button";
  ungroupBtn.className = "inspector-btn ungroup-btn";
  ungroupBtn.textContent = "UNGROUP";
  ungroupBtn.setAttribute("aria-label", "Remove selected cycle group");
  actions.appendChild(ungroupBtn);

  const move = analyzeMoveSelection();
  actions.appendChild(buildMoveButton("left", move));
  actions.appendChild(buildMoveButton("right", move));

  appendClipboardActions(actions);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "inspector-btn remove-cycle-btn";
  deleteBtn.textContent = "DELETE";
  const del = analyzeDeleteSelection();
  deleteBtn.disabled = !del.valid;
  if (!del.valid && del.reason) deleteBtn.title = del.reason;
  actions.appendChild(deleteBtn);

  inspectorBarEl.appendChild(actions);
}

function buildInspectorReadout(label, value) {
  const wrap = document.createElement("div");
  wrap.className = "inspector-field";
  const labelEl = document.createElement("span");
  labelEl.className = "inspector-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.className = "inspector-current";
  valueEl.textContent = value;
  wrap.appendChild(labelEl);
  wrap.appendChild(valueEl);
  return wrap;
}

function renderMultiSelectionInspector(selected, selectedGroups) {
  inspectorBarEl.dataset.mode = "multi";
  const groups = getSelectedCyclesByTrack();
  const groupCount = selectedGroups.length;

  const label = document.createElement("div");
  label.className = "inspector-selected";
  const count = document.createElement("span");
  count.className = "inspector-selected-track inspector-selection-count";
  count.textContent =
    groupCount > 0 && selected.length > 0
      ? `${selected.length} CYCLES + ${groupCount} GROUP${groupCount > 1 ? "S" : ""} SELECTED`
      : groupCount > 0
        ? `${groupCount} GROUPS SELECTED`
        : `${selected.length} CYCLES SELECTED`;
  const breakdown = document.createElement("span");
  breakdown.className = "inspector-selected-summary inspector-selection-tracks";
  breakdown.textContent = buildSelectionTrackSummary(groups);
  label.appendChild(count);
  label.appendChild(breakdown);
  inspectorBarEl.appendChild(label);

  const fields = document.createElement("div");
  fields.className = "inspector-fields";
  const passField = document.createElement("div");
  passField.className = "inspector-field";
  const passLabel = document.createElement("span");
  passLabel.className = "inspector-label";
  passLabel.textContent = "PASS";
  const passValue = document.createElement("span");
  passValue.className = "inspector-current inspector-pass-state";
  passValue.textContent = groupCount > 0 ? "—" : getSelectionPassState() || "—";
  passField.appendChild(passLabel);
  passField.appendChild(passValue);
  fields.appendChild(passField);

  // CREATE GROUP appears next to its repeat count, so the count is set
  // before the group exists rather than as a second step afterwards.
  const groupCreation = analyzeGroupCreation();
  if (groupCreation.valid) {
    const repeatWrap = document.createElement("div");
    repeatWrap.className = "inspector-field";
    const repeatLabel = document.createElement("span");
    repeatLabel.className = "inspector-label";
    repeatLabel.textContent = "GROUP REPEAT";
    const repeatInput = document.createElement("input");
    repeatInput.type = "number";
    repeatInput.min = "2";
    repeatInput.max = String(MAX_REPEAT);
    repeatInput.className = "group-create-repeat-input";
    repeatInput.value = "2";
    repeatInput.setAttribute("aria-label", "Repeat count for the new group");
    repeatWrap.appendChild(repeatLabel);
    repeatWrap.appendChild(repeatInput);
    fields.appendChild(repeatWrap);
  }
  inspectorBarEl.appendChild(fields);

  const actions = document.createElement("div");
  actions.className = "inspector-actions";

  const createGroupBtn = document.createElement("button");
  createGroupBtn.type = "button";
  createGroupBtn.className = "inspector-btn create-group-btn";
  createGroupBtn.textContent = "CREATE GROUP";
  createGroupBtn.disabled = !groupCreation.valid;
  if (!groupCreation.valid) createGroupBtn.title = groupCreation.reason;
  actions.appendChild(createGroupBtn);

  // Shown only when a group is part of the selection — with cycles
  // alone the question "into which group?" has no answer, and CREATE
  // GROUP is the operation that applies instead.
  if (groupCount > 0) {
    const addToGroup = analyzeAddToGroup();
    const addToGroupBtn = document.createElement("button");
    addToGroupBtn.type = "button";
    addToGroupBtn.className = "inspector-btn add-to-group-btn";
    addToGroupBtn.textContent = "ADD TO GROUP";
    addToGroupBtn.disabled = !addToGroup.valid;
    if (!addToGroup.valid) addToGroupBtn.title = addToGroup.reason;
    actions.appendChild(addToGroupBtn);
  }

  const passOnBtn = document.createElement("button");
  passOnBtn.type = "button";
  passOnBtn.className = "inspector-btn pass-on-btn";
  passOnBtn.textContent = "PASS ON";
  // PASS belongs to cycles; a selection containing a group has nothing
  // to apply it to.
  passOnBtn.disabled = groupCount > 0;
  const passOffBtn = document.createElement("button");
  passOffBtn.type = "button";
  passOffBtn.className = "inspector-btn pass-off-btn";
  passOffBtn.textContent = "PASS OFF";
  passOffBtn.disabled = groupCount > 0;
  if (groupCount > 0) {
    passOnBtn.title = "PASS is available for cycles, not groups.";
    passOffBtn.title = passOnBtn.title;
  }
  actions.appendChild(passOnBtn);
  actions.appendChild(passOffBtn);

  const move = analyzeMoveSelection();
  actions.appendChild(buildMoveButton("left", move));
  actions.appendChild(buildMoveButton("right", move));

  appendClipboardActions(actions);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "inspector-btn remove-cycle-btn";
  deleteBtn.textContent = "DELETE";
  // A mixed cycle+group selection deletes fine now (Phase 1.9H); the
  // only refusal left is emptying a track.
  const del = analyzeDeleteSelection();
  deleteBtn.disabled = !del.valid;
  if (!del.valid && del.reason) deleteBtn.title = del.reason;
  actions.appendChild(deleteBtn);

  inspectorBarEl.appendChild(actions);
}

// Selection-only update: refresh highlight + inspector without
// rebuilding the lanes, so scrollLeft is untouched.
function refreshSelectionVisuals() {
  Object.entries(playheadRefs).forEach(([trackId, refs]) => {
    Object.entries(refs.segmentEls).forEach(([itemId, el]) => {
      if (!el) return;
      const isGroup = el.classList.contains("cycle-group");
      const item = isGroup ? groupSelectionItem(trackId, itemId) : cycleSelectionItem(trackId, itemId);
      const selected = isSelectionItemSelected(item);
      el.classList.toggle("selected", selected);
      el.classList.toggle("selection-anchor", selected && isSelectionAnchorItem(item));
      el.setAttribute("aria-selected", selected ? "true" : "false");
      const header = el.querySelector(":scope > .cycle-header");
      if (header) header.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  });
  renderCompactInspector();
  // Selecting is not itself undoable, but it is part of what a later
  // edit will undo back to — see notePresentSelectionChanged().
  notePresentSelectionChanged();
}

// A GUI edit changes the applied state, so the editor's applied text
// (and, since the draft was in sync, the draft too) follows it.
function syncTextFromState() {
  const { text, selectionMap } = serializeSequence(state);
  sequenceTextEl.value = text;
  lastSelectionMap = selectionMap;
  editorState.appliedText = text;
  editorState.draftText = text;
  editorState.isDirty = false;
  editorState.lastApplyError = null;
  if (sequenceTextEl.classList.contains("has-error")) {
    sequenceTextEl.classList.remove("has-error");
  }
  updateEditorStatus();
}

// Drops per-track runtime maps for tracks that no longer exist, so a
// renamed/removed track can't leave stale scheduling or DOM state behind.
function pruneRuntimeTrackState() {
  const live = new Set(state.tracks.map((t) => t.id));
  [schedulerCursorBeat, schedulerFloorBeat].forEach((map) => {
    Object.keys(map).forEach((id) => {
      if (!live.has(id)) delete map[id];
    });
  });
  pendingEvents = pendingEvents.filter((ev) => live.has(ev.trackId));
}

function showError(message) {
  statusMessageEl.textContent = "⚠ " + message;
  statusMessageEl.classList.add("error");
}

function clearError() {
  statusMessageEl.textContent = "";
  statusMessageEl.classList.remove("error");
}

// Shown as an exact fraction, never as a decimal: "15/2 BEATS" is the
// answer, "7.5 BEATS" is a rendering of the answer that loses the fact
// that the number is exact.
function updateCommonCycleDisplay() {
  const result = computeCommonCycle(state.tracks);
  if (result.status === "ok") {
    commonCycleValueEl.textContent = `${rationalToString(result.value)} BEATS`;
    commonCycleValueEl.classList.remove("is-too-large");
  } else if (result.status === "too-large") {
    commonCycleValueEl.textContent = "TOO LARGE";
    commonCycleValueEl.classList.add("is-too-large");
  } else {
    commonCycleValueEl.textContent = "— BEATS";
    commonCycleValueEl.classList.remove("is-too-large");
  }
}

// Called after any change to the musical structure, whether it touched
// one cycle or twenty across several tracks. The transport is
// deliberately left alone: the queue is rebuilt by re-mapping the SAME
// absolute transport beat onto the edited sequence, so time keeps
// running and the playhead does not jump back to the start.
//
// Every step below happens exactly ONCE per mutation, no matter how
// many cycles took part — batch callers must edit all of them first and
// then call this a single time.
function afterStructuralMutation(trackIds) {
  let ids;
  if (Array.isArray(trackIds)) ids = Array.from(new Set(trackIds));
  else if (trackIds) ids = [trackIds];
  else ids = undefined;

  pruneSelectionState();
  rebuildSchedulingFromTransport({ trackIds: ids });
  renderApp();
  syncTextFromState();
  clearError();
  updateCommonCycleDisplay();
  renderTimeline();
  updateAllPlayheadsImmediately();
  // Last, so the new "present" reflects everything the edit settled on,
  // including the pruned selection.
  commitHistoryStep();
}

/* ===== Undo / Redo =====
   See the history note beside undoStack for why this is snapshot-based
   and what a snapshot deliberately leaves out.
*/

function cloneStructure(value) {
  // The model is plain JSON by construction — Rationals are {numerator,
  // denominator}, hits are numbers, ids are strings — so this is a true
  // deep copy with no shared references back into live state.
  return JSON.parse(JSON.stringify(value));
}

function captureSnapshot() {
  return {
    tracks: cloneStructure(state.tracks),
    tempo: state.tempo,
    selectionState: cloneStructure(selectionState),
  };
}

/* Records one history step. Called at the end of every commit — a
   structural mutation, a DSL apply, INITIALIZE, a tempo change — so the
   granularity is "one user action, one entry" without any mutator
   opting in. A drag is one entry for the same reason: pointermove only
   previews, and the single mutation happens on pointerup. */
function commitHistoryStep() {
  if (isRestoringHistory) return;
  if (presentSnapshot) {
    undoStack.push(presentSnapshot);
    // Oldest first: a hundred steps back is generous, and an unbounded
    // stack would keep every intermediate structure alive forever.
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  }
  // Any new edit invalidates the branch that was undone away from.
  redoStack = [];
  presentSnapshot = captureSnapshot();
  updateHistoryButtons();
}

/* Selection is part of a snapshot but is not itself an undoable action,
   so selecting does not push history — it just keeps the present
   snapshot current, so undoing a LATER edit returns to the selection
   that was actually in effect when that edit was made. */
function notePresentSelectionChanged() {
  if (isRestoringHistory || !presentSnapshot) return;
  presentSnapshot.selectionState = cloneStructure(selectionState);
}

/* Ids are restored verbatim — a snapshot IS the identity of those cycles
   and groups, and re-issuing ids would break selection, the text
   selection map and any reference held across the undo.

   The counters are never rewound, though: an id freed by an undo may
   already have been handed out again on the redone branch. Instead they
   are pushed up past anything restored, so future ids stay unique
   against both the restored structure and everything issued so far. */
function adoptRestoredIds(tracks) {
  const highest = (id, prefix) => {
    if (typeof id !== "string" || !id.startsWith(prefix)) return 0;
    const n = parseInt(id.slice(prefix.length), 10);
    return Number.isInteger(n) ? n : 0;
  };
  let maxCycle = 0;
  let maxGroup = 0;
  tracks.forEach((track) => {
    track.sequence.forEach((item) => {
      if (item.type === "cycle") {
        maxCycle = Math.max(maxCycle, highest(item.id, "cycle-"));
        return;
      }
      maxGroup = Math.max(maxGroup, highest(item.id, "group-"));
      item.items.forEach((c) => {
        maxCycle = Math.max(maxCycle, highest(c.id, "cycle-"));
      });
    });
  });
  globalCycleIdCounter = Math.max(globalCycleIdCounter, maxCycle);
  globalGroupIdCounter = Math.max(globalGroupIdCounter, maxGroup);
}

/* Puts a snapshot back. Everything here mirrors what a structural
   mutation does EXCEPT the transport, which is left running: the
   restored structure is re-resolved against the beat already playing,
   so undo never rewinds time. Parser id reconciliation is deliberately
   skipped — that is for text, which has no ids; a snapshot brings its
   own. */
function restoreSnapshot(snapshot) {
  isRestoringHistory = true;
  try {
    state.tracks = cloneStructure(snapshot.tracks);
    adoptRestoredIds(state.tracks);
    selectionState = cloneStructure(snapshot.selectionState);

    if (snapshot.tempo !== state.tempo) {
      // Re-anchors at the current beat, so only the rate moves.
      handleTempoChange(snapshot.tempo);
      if (tempoInputEl) tempoInputEl.value = String(snapshot.tempo);
    }

    pruneRuntimeTrackState();
    pruneSelectionState();
    rebuildSchedulingFromTransport();
    renderApp();
    syncTextFromState();
    clearError();
    updateCommonCycleDisplay();
    renderTimeline();
    updateAllPlayheadsImmediately();
  } finally {
    isRestoringHistory = false;
  }
  updateHistoryButtons();
}

/* An unapplied draft blocks both directions for the same reason it
   blocks GUI edits (see canMutateFromGui): restoring rewrites the text,
   which would silently throw the typing away. Inside the textarea the
   browser's own undo is the right tool and is left alone. */
function canUndo() {
  return undoStack.length > 0 && !editorState.isDirty;
}

function canRedo() {
  return redoStack.length > 0 && !editorState.isDirty;
}

function performUndo() {
  if (!canUndo()) return false;
  const previous = undoStack.pop();
  redoStack.push(presentSnapshot);
  presentSnapshot = cloneStructure(previous);
  restoreSnapshot(previous);
  return true;
}

function performRedo() {
  if (!canRedo()) return false;
  const next = redoStack.pop();
  undoStack.push(presentSnapshot);
  presentSnapshot = cloneStructure(next);
  restoreSnapshot(next);
  return true;
}

function updateHistoryButtons() {
  if (undoBtnEl) undoBtnEl.disabled = !canUndo();
  if (redoBtnEl) redoBtnEl.disabled = !canRedo();
}

/* ===== GUI event handling ===== */

function selectCycle(trackId, cycleId) {
  setSingleSelection(trackId, cycleId);
}

// Command on macOS, Control elsewhere — accept either, so the same build
// behaves natively on both.
function isMultiSelectModifier(e) {
  return e.metaKey || e.ctrlKey;
}

// Applies a click to the selection set. Returns true when the click was
// a modified (multi-select) click, which must never also edit hits.
function applySelectionClick(e, trackId, cycleId) {
  if (isMultiSelectModifier(e)) {
    toggleSelection(trackId, cycleId);
    return true;
  }
  if (e.shiftKey) {
    const anchor = selectionState.anchor;
    if (anchor && anchor.trackId === trackId) {
      selectRangeWithinTrack(trackId, anchor.cycleId, cycleId);
    } else {
      // Ranging across tracks has no meaningful order, so a cross-track
      // Shift-click simply adds the clicked cycle.
      addSelection(trackId, cycleId);
    }
    return true;
  }
  setSingleSelection(trackId, cycleId);
  return false;
}

/* Any completed drag on the lane still ends in a mouseup, which the
   browser follows with a click on whatever now sits under the pointer.
   Left alone that phantom click would act a second time — adding a hit
   right where one was just dropped, or collapsing a range selection
   back to the single cycle under the pointer. Each drag's own pointerup
   sets this so the next lane click is consumed as a no-op instead. */
let suppressNextLaneClick = false;

/* Routes a lane click to exactly one zone. The zones are checked in
   order of specificity, and each one returns — nothing falls through
   from "select this cycle" into "place a hit here". */
function handleTracksClick(e) {
  if (suppressNextLaneClick) {
    suppressNextLaneClick = false;
    return;
  }
  const trackRow = e.target.closest(".track-row");
  if (!trackRow) return;
  const trackId = trackRow.dataset.trackId;

  if (e.target.closest(".add-cycle-btn")) {
    addCycle(trackId);
    return;
  }

  if (e.target.closest(".cycle-drag-handle")) {
    return; // handled by its own pointerdown listener
  }

  // 1. Cycle header — selection only, never a hit.
  const header = e.target.closest(".cycle-header");
  if (header) {
    const segment = header.closest(".cycle-segment");
    if (!segment) return;
    applySelectionClick(e, trackId, segment.dataset.cycleId);
    refreshSelectionVisuals();
    syncTextSelectionFromState();
    return;
  }

  // 2. Cycle body — the only surface that accepts hits.
  const body = e.target.closest(".cycle-body");
  if (body) {
    const segment = body.closest(".cycle-segment");
    if (!segment) return;
    const cycleId = segment.dataset.cycleId;

    // Selection always happens, independently of whether the click also
    // edits: a blocked edit (unapplied draft) must still select the
    // cycle. Plain selection must not rebuild the lanes, or horizontal
    // scroll position would be lost.
    const modified = applySelectionClick(e, trackId, cycleId);
    refreshSelectionVisuals();
    syncTextSelectionFromState();

    // A modifier click is a pure selection gesture — it must not also
    // drop a hit into the cycle it just added to the set.
    if (modified) return;
    if (e.target.closest(".hit-dot")) return; // the dot owns its own gestures

    const cycle = findCycle(findTrack(trackId), cycleId);
    if (!cycle) return;
    // Measured from the BODY, so the header's height can never shift a
    // hit position.
    const rect = body.getBoundingClientRect();
    const fraction = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    // Background clicks snap to whole divisions only; fractional
    // positions come from dragging or from the DSL. During a phase view,
    // the body is rotated, so convert its visual coordinate back to the
    // authored pattern before committing the edit.
    const visualPosition = 1 + fraction * cycle.division;
    const repeatIndex = Number(body.dataset.phaseRepeatIndex) || 0;
    const originalPosition = visualPositionToOriginalPattern(cycle, visualPosition, repeatIndex);
    const position = clamp(Math.round(originalPosition), 1, cycle.division);
    addIntegerHit(trackId, cycleId, position);
    syncTextSelectionFromState();
    return;
  }

  // 2b. The stretch of a cycle past its pattern, when a positive offset
  //     makes the segment wider than the body. It selects like any other
  //     part of the cycle, but never takes a background hit: positions
  //     out there are opt-in, written explicitly or dragged into place.
  const bodyRow = e.target.closest(".cycle-body-row");
  if (bodyRow) {
    const segment = bodyRow.closest(".cycle-segment");
    if (!segment) return;
    applySelectionClick(e, trackId, segment.dataset.cycleId);
    refreshSelectionVisuals();
    syncTextSelectionFromState();
    return;
  }

  // 3. Group frame — its header band, its repeat area, its border. Only
  //    reached when the click missed every cycle inside it, which is
  //    what gives a group and its cycles two distinct targets.
  const groupEl = e.target.closest(".cycle-group");
  if (groupEl) {
    const groupItem = groupSelectionItem(trackId, groupEl.dataset.groupId);
    if (isMultiSelectModifier(e)) toggleSelectionItem(groupItem);
    else setSingleSelectionItem(groupItem);
    refreshSelectionVisuals();
    syncTextSelectionFromState();
    return;
  }

  // 4. Empty space past the end of a lane clears the selection.
  if (e.target.closest(".track-lane-scroll")) {
    clearSelection();
    refreshSelectionVisuals();
  }
}

// Every action here is selection-scoped, so it works identically for one
// cycle and for many.
function handleInspectorClick(e) {
  if (selectionState.items.length === 0) return;

  if (e.target.closest(".pass-toggle-btn")) {
    togglePassForSelection();
    return;
  }
  if (e.target.closest(".pass-on-btn")) {
    setSelectedCyclesPass(true);
    return;
  }
  if (e.target.closest(".pass-off-btn")) {
    setSelectedCyclesPass(false);
    return;
  }
  if (e.target.closest(".move-left-btn")) {
    if (moveSelectedCycles(-1)) syncTextSelectionFromState();
    return;
  }
  if (e.target.closest(".move-right-btn")) {
    if (moveSelectedCycles(1)) syncTextSelectionFromState();
    return;
  }
  if (e.target.closest(".create-group-btn")) {
    const input = inspectorBarEl.querySelector(".group-create-repeat-input");
    const repeat = input ? parseInt(input.value, 10) : 2;
    createGroupFromSelection(repeat);
    return;
  }
  if (e.target.closest(".ungroup-btn")) {
    if (ungroupSelectedGroup()) syncTextSelectionFromState();
    return;
  }
  if (e.target.closest(".add-to-group-btn")) {
    if (addSelectedCyclesToGroup()) syncTextSelectionFromState();
    return;
  }
  if (e.target.closest(".remove-from-group-btn")) {
    if (removeSelectedCycleFromGroup()) syncTextSelectionFromState();
    return;
  }
  if (e.target.closest(".duplicate-btn")) {
    if (duplicateSelection()) syncTextSelectionFromState();
    return;
  }
  if (e.target.closest(".copy-selection-btn")) {
    copySelection();
    return;
  }
  if (e.target.closest(".paste-selection-btn")) {
    if (pasteClipboard()) syncTextSelectionFromState();
    return;
  }
  if (e.target.closest(".remove-cycle-btn")) {
    deleteSelection();
    return;
  }
}

function handleInspectorChange(e) {
  if (e.target.classList.contains("group-repeat-input")) {
    const value = parseInt(e.target.value, 10);
    if (Number.isInteger(value)) updateSelectedGroupRepeat(value);
    else renderApp();
    syncTextSelectionFromState();
    return;
  }
  if (e.target.classList.contains("group-create-repeat-input")) return; // read on click

  const trackId = inspectorBarEl.dataset.trackId;
  const cycleId = inspectorBarEl.dataset.cycleId;
  if (!trackId || !cycleId) return;

  if (e.target.classList.contains("cycle-span-input")) {
    const result = parseRationalSpan(e.target.value);
    const cycle = findCycle(findTrack(trackId), cycleId);
    if (result.ok && cycle && wouldCycleLengthBeInvalid(result.value, cycle.offset || RATIONAL_ZERO)) {
      showError("cycle length (span + offset) must be greater than 0");
      renderApp();
    } else if (result.ok) {
      // The stored value is canonical, so the field snaps to it on the
      // re-render: type 0.5, get 1/2.
      updateCycleSpan(trackId, cycleId, result.value);
    } else {
      // Nothing changes — not the cycle, not the transport. The field
      // is put back to the value that is actually applied.
      showError(result.error);
      renderApp();
    }
    syncTextSelectionFromState();
    return;
  }

  if (e.target.classList.contains("cycle-length-input")) {
    const cycle = findCycle(findTrack(trackId), cycleId);
    const result = cycle ? parseRationalCycleLength(e.target.value) : { ok: false, error: "no cycle selected" };
    if (result.ok) {
      // OFFSET is what is actually stored; CYCLE LENGTH is span +
      // offset, so editing it here just solves for the offset that
      // produces the length that was typed.
      updateCycleOffset(trackId, cycleId, subtractRational(result.value, cycle.span));
    } else {
      showError(result.error);
      renderApp();
    }
    syncTextSelectionFromState();
    return;
  }

  if (e.target.classList.contains("cycle-offset-input")) {
    const cycle = findCycle(findTrack(trackId), cycleId);
    const result = parseRationalOffset(e.target.value);
    if (result.ok && cycle && wouldCycleLengthBeInvalid(cycle.span, result.value)) {
      showError("cycle length (span + offset) must be greater than 0");
      renderApp();
    } else if (result.ok && cycle) {
      updateCycleOffset(trackId, cycleId, result.value);
    } else {
      showError(result.ok ? "no cycle selected" : result.error);
      renderApp();
    }
    syncTextSelectionFromState();
    return;
  }

  if (e.target.classList.contains("cycle-phase-input")) {
    const result = parsePhaseSpec(e.target.value);
    if (result.ok) {
      updateCyclePhase(trackId, cycleId, result.phase);
    } else {
      showError(result.error);
      renderApp();
    }
    syncTextSelectionFromState();
    return;
  }

  const value = parseInt(e.target.value, 10);
  const valid = Number.isInteger(value) && value >= 1;

  if (e.target.classList.contains("cycle-division-input")) {
    if (valid) updateCycleDivision(trackId, cycleId, value);
    else renderApp();
    syncTextSelectionFromState();
    return;
  }
  if (e.target.classList.contains("cycle-repeat-input")) {
    if (valid) updateCycleRepeat(trackId, cycleId, value);
    else renderApp();
    syncTextSelectionFromState();
    return;
  }
}

function wireHitDotInteractions(dot, trackId, cycleId, originalValue) {
  dot.addEventListener("pointerdown", (downEvent) => {
    // The dot owns this gesture end to end: nothing below it (body hit-add,
    // cycle drag-reorder, group/header selection) may also react to it.
    downEvent.stopPropagation();
    if (!canMutateFromGui()) return;
    const cycle = findCycle(findTrack(trackId), cycleId);
    if (!cycle) return;
    // Hit coordinates come from the BODY, never the whole segment.
    const body = dot.closest(".cycle-body");
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const startX = downEvent.clientX;
    const visualRepeatIndex = Number(dot.dataset.phaseRepeatIndex) || 0;
    let dragged = false;
    let pendingValue = originalValue;

    dot.setPointerCapture(downEvent.pointerId);

    function onMove(moveEvent) {
      if (!dragged && Math.abs(moveEvent.clientX - startX) > HIT_DRAG_THRESHOLD) dragged = true;
      if (!dragged) return;
      // The fraction is deliberately NOT clamped to [0,1]: the body is
      // one pattern span wide, so a cycle extended by a positive offset
      // has usable positions past its right edge. The position itself is
      // what gets clamped, to the cycle's real range.
      const fraction = (moveEvent.clientX - rect.left) / rect.width;
      const visualPos = clampHitPosition(cycle, 1 + fraction * cycle.division);
      let newPos = visualPositionToOriginalPattern(cycle, visualPos, visualRepeatIndex);
      const nearestInt = Math.round(newPos);
      // Any whole position still inside the cycle is a snap target,
      // including ones past the division in an extended cycle.
      if (nearestInt >= 1 && isHitWithinCycle(cycle, nearestInt) && Math.abs(newPos - nearestInt) < INTEGER_SNAP_THRESHOLD) {
        newPos = nearestInt;
      } else {
        newPos = Number(newPos.toFixed(3));
      }
      pendingValue = newPos;
      const isInt = Number.isInteger(newPos);
      dot.style.left = `${hitToFraction(visualPos, cycle.division) * 100}%`;
      dot.className = "hit-dot is-dragging " + (isInt ? "is-integer" : "is-fractional");
    }

    function onUp(upEvent) {
      dot.releasePointerCapture(upEvent.pointerId);
      dot.removeEventListener("pointermove", onMove);
      dot.removeEventListener("pointerup", onUp);
      if (dragged) {
        // The pointerup below is still followed by a browser-synthesized
        // click at the drop point (mousedown and mouseup landed on
        // different elements, so the click targets their common
        // ancestor — the body). Left unguarded it would add a stray hit
        // exactly where this one was just dropped.
        suppressNextLaneClick = true;
        selectCycle(trackId, cycleId);
        updateHitPosition(trackId, cycleId, originalValue, pendingValue);
        syncTextSelectionFromState();
      }
    }

    // Captured on the dot itself, so the drag keeps tracking the pointer
    // even once it leaves the body, the lane, or the browser viewport.
    dot.addEventListener("pointermove", onMove);
    dot.addEventListener("pointerup", onUp);
  });

  dot.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Selection happens regardless of whether the draft blocks the edit
    // itself — removeHitAt() is the one that checks and, if blocked,
    // reports it; see canMutateFromGui().
    selectCycle(trackId, cycleId);
    removeHitAt(trackId, cycleId, originalValue);
  });
}

/* ----- Drag range selection -----
   Dragging across cycle headers selects the run between the cycle the
   drag started on and the one under the pointer, in either direction.

   It starts on the HEADER only. The body takes hit input, and the two
   handles inside the header own their own gestures and stop the event
   before it reaches here, so a range drag can never be confused with
   placing a hit, reordering a cycle or resizing one.

   The range is confined to the starting cycle's own parent list, which
   is what stops a selection crossing a group boundary: a drag begun
   inside a group ranges over that group's cycles, one begun outside
   ranges over the track's top-level cycles, and neither can reach the
   other. Moving cycles in or out of a group is an explicit operation
   (ADD TO GROUP / REMOVE FROM GROUP), never a side effect of selecting.

   Selection is not a structural edit, so nothing here touches the undo
   history — see commitHistoryStep(). */
const LANE_DRAG_THRESHOLD = 4; // px of travel before a press becomes a drag

function wireHeaderRangeSelection(header, trackId, cycleId) {
  header.addEventListener("pointerdown", (downEvent) => {
    if (downEvent.button !== undefined && downEvent.button !== 0) return;
    // Belt and braces: both handles already stop propagation, so this
    // only matters if that ever changes.
    if (downEvent.target.closest(".cycle-drag-handle")) return;
    if (downEvent.target.closest(".cycle-length-handle")) return;

    const refs = laneRefs[trackId];
    const location = findCycleLocation(trackId, cycleId);
    if (!refs || !location) return;

    // Only the anchor's siblings are reachable, in lane order.
    const siblingSegments = refs.segments.filter((seg) =>
      location.parent.some((c) => c.id === seg.cycle.id)
    );
    if (siblingSegments.length === 0) return;

    const anchorIndex = siblingSegments.findIndex((seg) => seg.cycle.id === cycleId);
    if (anchorIndex === -1) return;

    const additive = isMultiSelectModifier(downEvent);
    // What the selection was before the drag, so an additive drag can
    // keep adding to it as the range grows and shrinks.
    const baseItems = additive ? selectionState.items.slice() : [];
    const startX = downEvent.clientX;
    let dragging = false;

    // The sibling under x, clamped to the ends of the run — dragging
    // past the last cycle selects up to it rather than losing the
    // target, and past the first likewise.
    function siblingIndexAtX(clientX) {
      const laneRect = refs.lane.getBoundingClientRect();
      const x = clientX - laneRect.left;
      let index = 0;
      for (let i = 0; i < siblingSegments.length; i++) {
        if (x >= beatToPixel(siblingSegments[i].startBeat)) index = i;
      }
      return index;
    }

    function applyRange(targetIndex) {
      const lo = Math.min(anchorIndex, targetIndex);
      const hi = Math.max(anchorIndex, targetIndex);
      const items = baseItems.slice();
      const seen = new Set(items.map(selectionKey));
      for (let i = lo; i <= hi; i++) {
        const item = cycleSelectionItem(trackId, siblingSegments[i].cycle.id);
        const key = selectionKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
      selectionState.items = items;
      selectionState.anchor = cycleSelectionItem(trackId, cycleId);
      refreshSelectionVisuals();
    }

    function onMove(moveEvent) {
      if (!dragging) {
        if (Math.abs(moveEvent.clientX - startX) < LANE_DRAG_THRESHOLD) return;
        dragging = true;
      }
      applyRange(siblingIndexAtX(moveEvent.clientX));
    }

    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (!dragging) return; // a plain press: the click handler selects
      // The click the browser sends after this drag would collapse the
      // range back to one cycle.
      suppressNextLaneClick = true;
      syncTextSelectionFromState();
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
}

/* The track's top-level items with the lane interval each one occupies.
   Cycles and groups are measured the same way and tile contiguously, so
   a drop position can be decided from where the pointer actually is
   rather than from DOM order — which matters because a group and a
   cycle beside it are rarely the same width. */
function topLevelLaneItems(track, layout) {
  const out = [];
  track.sequence.forEach((item) => {
    const frame = layout.itemFrames[item.id];
    if (!frame) return;
    out.push({ item, startBeat: frame.startBeat, endBeat: frame.startBeat + frame.baseBeats });
  });
  return out;
}

/* Insertion index for a drop at lane position `x`, using the midpoint of
   each item as the tipping point — the same rule the cycle drag uses,
   so both gestures feel identical. */
function insertionIndexAtLaneX(items, x) {
  for (let i = 0; i < items.length; i++) {
    const midX = beatToPixel((items[i].startBeat + items[i].endBeat) / 2);
    if (x < midX) return i;
  }
  return items.length;
}

function insertionBoundaryBeat(items, insertIndex) {
  if (items.length === 0) return 0;
  if (insertIndex >= items.length) return items[items.length - 1].endBeat;
  return items[insertIndex].startBeat;
}

/* ----- Group drag-reorder -----
   The GROUP HEADER band is the group's drag handle, so the lane now has
   one gesture per zone and no overlap between them:

     group header       — move the whole group among the track's items
     cycle header       — select, and drag to range-select
     cycle drag handle  — move that cycle within its own parent
     cycle length handle— resize the cycle
     cycle body         — hits only

   A group moves as ONE item: its cycles go with it, nothing is unpacked
   into the track, and nothing can be dropped INTO a group. Getting a
   cycle in or out of a group stays an explicit operation (ADD TO GROUP
   / REMOVE FROM GROUP), and groups still never nest. */
function wireGroupDragHandle(header, groupEl, trackId, groupId) {
  header.addEventListener("pointerdown", (downEvent) => {
    if (downEvent.button !== undefined && downEvent.button !== 0) return;
    downEvent.preventDefault();
    downEvent.stopPropagation();

    const track = findTrack(trackId);
    const refs = laneRefs[trackId];
    if (!track || !refs) return;
    const startIndex = track.sequence.findIndex((item) => item.id === groupId);
    if (startIndex === -1) return;

    const items = topLevelLaneItems(track, refs.layout);
    const startX = downEvent.clientX;
    let dragging = false;
    let insertIndex = startIndex;
    let marker = null;

    function onMove(moveEvent) {
      if (!dragging) {
        // Below the threshold this is still a plain press, which the
        // click handler turns into "select this group".
        if (Math.abs(moveEvent.clientX - startX) < LANE_DRAG_THRESHOLD) return;
        dragging = true;
        groupEl.classList.add("is-dragging-group");
        marker = document.createElement("div");
        marker.className = "cycle-insertion-marker";
        refs.lane.appendChild(marker);
      }
      const laneRect = refs.lane.getBoundingClientRect();
      insertIndex = insertionIndexAtLaneX(items, moveEvent.clientX - laneRect.left);
      marker.style.left = `${beatToPixel(insertionBoundaryBeat(items, insertIndex))}px`;
    }

    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (!dragging) return; // a plain press: leave it to the click handler

      if (marker) marker.remove();
      groupEl.classList.remove("is-dragging-group");
      // The click the browser sends at the drop point would otherwise
      // re-select whatever now sits there.
      suppressNextLaneClick = true;

      let targetIndex = insertIndex;
      if (targetIndex > startIndex) targetIndex -= 1;
      // The group stays selected across its own move.
      setSingleSelectionItem(groupSelectionItem(trackId, groupId));
      if (targetIndex !== startIndex) reorderSequenceItem(trackId, groupId, targetIndex);
      else refreshSelectionVisuals();
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
}

/* Dragging a cycle by its handle now crosses group boundaries in every
   direction — into a group, out of one, or from one group to another —
   because resolveCycleDropTarget answers "where does this land" for all
   of them. The drag itself is unchanged in spirit: it only previews,
   and the single mutation happens on pointerup.

   What the drop will do is shown, not guessed at: the target group is
   highlighted when the cycle would go inside one, the insertion marker
   sits where it would land, and a refused drop shows nothing at all. */
/* Group edge handle. The preview is the insertion marker sitting where
   the boundary would land, so the drag reads as "the group will end
   here" rather than as a rubber-banding frame; the frame itself only
   moves once the drop is applied and the lane re-renders. */
function wireGroupResizeHandle(grip, trackId, groupId, side) {
  grip.addEventListener("pointerdown", (downEvent) => {
    if (downEvent.button !== undefined && downEvent.button !== 0) return;
    downEvent.preventDefault();
    downEvent.stopPropagation();

    const track = findTrack(trackId);
    const refs = laneRefs[trackId];
    if (!track || !refs) return;
    const group = track.sequence.find((i) => i.type === "group" && i.id === groupId);
    if (!group) return;

    const startCount = group.items.length;
    let count = startCount;

    const marker = document.createElement("div");
    marker.className = "cycle-insertion-marker";
    refs.lane.appendChild(marker);

    const byId = new Map(refs.segments.map((seg) => [seg.cycle.id, seg]));

    function boundaryBeatFor(nextCount) {
      const { inside, outside } = groupResizeCandidates(track, group, side);
      const combined = inside.concat(outside);
      if (combined.length === 0) return 0;
      // The edge sits just past the last cycle the group would hold.
      const edgeCycle = combined[clamp(nextCount, 1, combined.length) - 1];
      const seg = byId.get(edgeCycle.id);
      if (!seg) return 0;
      return side === "right" ? seg.endBeat : seg.startBeat;
    }

    function onMove(moveEvent) {
      const laneRect = refs.lane.getBoundingClientRect();
      count = computeGroupResizeCount(track, group, side, moveEvent.clientX - laneRect.left, refs);
      marker.style.left = `${beatToPixel(boundaryBeatFor(count))}px`;
    }

    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      marker.remove();
      suppressNextLaneClick = true;
      if (count !== startCount) applyGroupResize(trackId, groupId, side, count);
      else refreshSelectionVisuals();
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
}

function wireDragHandle(handle, segmentEl, trackId, cycleId) {
  handle.addEventListener("pointerdown", (downEvent) => {
    downEvent.preventDefault();
    downEvent.stopPropagation();
    const track = findTrack(trackId);
    if (!track) return;
    const refs = laneRefs[trackId];
    if (!refs) return;
    const location = findCycleLocation(trackId, cycleId);
    if (!location) return;

    segmentEl.classList.add("is-dragging-cycle");
    // Segments are absolutely positioned on the lane, so the insertion
    // marker is placed by beat offset rather than by DOM order.
    const marker = document.createElement("div");
    marker.className = "cycle-insertion-marker";
    refs.lane.appendChild(marker);

    let target = null;
    let highlighted = null;

    function clearHighlight() {
      if (highlighted) highlighted.classList.remove("is-drop-target");
      highlighted = null;
    }

    function onMove(moveEvent) {
      const laneRect = refs.lane.getBoundingClientRect();
      target = resolveCycleDropTarget(trackId, cycleId, moveEvent.clientX - laneRect.left);
      clearHighlight();

      if (!target || target.kind === "invalid") {
        // Nothing is shown for a refused drop, so the absence of a
        // marker is itself the answer.
        marker.style.display = "none";
        return;
      }

      marker.style.display = "";
      marker.style.left = `${beatToPixel(target.markerBeat)}px`;

      if (target.kind === "group") {
        const groupEl = playheadRefs[trackId].segmentEls[target.groupId];
        if (groupEl) {
          groupEl.classList.add("is-drop-target");
          highlighted = groupEl;
        }
      }
    }

    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      marker.remove();
      clearHighlight();
      segmentEl.classList.remove("is-dragging-cycle");
      selectCycle(trackId, cycleId); // keep the same cycle selected across the move
      if (!moveCycleToDropTarget(trackId, cycleId, target)) {
        refreshSelectionVisuals();
      }
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
}

// Default snap grain for dragging CYCLE LENGTH: a quarter beat, so a
// drag lands on tidy values without forcing the user into the Inspector
// for anything short of an odd fraction.
const LENGTH_HANDLE_SNAP_BEATS = createRational(1, 4);

/* Right-edge handle that changes a cycle's OFFSET (and so its CYCLE
   LENGTH) by dragging, leaving PATTERN SPAN — and therefore hit timing —
   untouched. Only the segment's own width is live-updated during the
   drag; siblings shift to their new positions only once the drag ends
   and afterStructuralMutation() re-renders the lane, the same tradeoff
   wireDragHandle makes with its insertion marker instead of a full
   live layout. */
function wireLengthHandle(handle, segmentEl, trackId, cycleId) {
  handle.addEventListener("pointerdown", (downEvent) => {
    downEvent.preventDefault();
    downEvent.stopPropagation();
    if (!canMutateFromGui()) return;
    const cycle = findCycle(findTrack(trackId), cycleId);
    if (!cycle) return;

    const startX = downEvent.clientX;
    const startOffset = cycle.offset || RATIONAL_ZERO;
    let pendingOffset = startOffset;

    selectCycle(trackId, cycleId);
    segmentEl.classList.add("is-resizing-cycle");
    handle.setPointerCapture(downEvent.pointerId);

    function onMove(moveEvent) {
      const deltaBeats = pixelToBeat(moveEvent.clientX - startX);
      const snapUnits = Math.round(deltaBeats / rationalToNumber(LENGTH_HANDLE_SNAP_BEATS));
      const deltaRational = multiplyRational(LENGTH_HANDLE_SNAP_BEATS, rationalFromInteger(snapUnits));
      let candidateOffset = addRational(startOffset, deltaRational);
      let candidateLength = addRational(cycle.span, candidateOffset);
      // Dragging left stops at one snap unit of cycle length rather than
      // passing through zero. Clamping (instead of ignoring the move)
      // is what makes a fast drag stick to the wall instead of snapping
      // back to where it started. The bound is exact rationals, so
      // there is no float fuzz at the boundary.
      if (compareRational(candidateLength, LENGTH_HANDLE_SNAP_BEATS) < 0) {
        candidateLength = LENGTH_HANDLE_SNAP_BEATS;
        candidateOffset = subtractRational(candidateLength, cycle.span);
      }
      pendingOffset = candidateOffset;
      segmentEl.style.width = `${beatToPixel(rationalToNumber(candidateLength))}px`;
    }

    function onUp(upEvent) {
      handle.releasePointerCapture(upEvent.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      segmentEl.classList.remove("is-resizing-cycle");
      if (!equalRational(pendingOffset, startOffset)) {
        updateCycleOffset(trackId, cycleId, pendingOffset);
      }
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  });
}

/* ===== Explicit apply pipeline =====
   Typing only mutates the draft. Nothing is parsed, no state changes,
   no errors are raised until the user explicitly applies — so a
   half-typed line is never treated as a syntax error.
*/

function handleSequenceTextInput() {
  editorState.draftText = sequenceTextEl.value;
  editorState.isDirty = editorState.draftText !== editorState.appliedText;
  updateEditorStatus();
}

function handleSequenceTextKeydown(event) {
  if (event.key !== "Enter") return;
  if (event.isComposing || event.keyCode === 229) return; // mid-IME composition
  if (event.shiftKey) return; // Shift+Enter inserts a newline

  event.preventDefault();
  applyDraftSequence();
}

let pendingApplyTextareaState = null;

function captureApplyTextareaState() {
  return {
    start: sequenceTextEl.selectionStart,
    end: sequenceTextEl.selectionEnd,
    hadFocus: document.activeElement === sequenceTextEl,
  };
}

function restoreApplyTextareaState(saved) {
  if (!saved) return;
  const length = sequenceTextEl.value.length;
  const start = clamp(Number(saved.start) || 0, 0, length);
  const end = clamp(Number(saved.end) || 0, start, length);
  if (saved.hadFocus) {
    try {
      sequenceTextEl.focus({ preventScroll: true });
    } catch (err) {
      sequenceTextEl.focus();
    }
  }
  try {
    sequenceTextEl.setSelectionRange(start, end);
  } catch (err) {
    // A text selection failure must never turn a successful APPLY into
    // an apply error; the sequence itself is already committed.
  }
}

function applyDraftSequence() {
  const textareaState = pendingApplyTextareaState || captureApplyTextareaState();
  pendingApplyTextareaState = null;
  const draft = sequenceTextEl.value;
  editorState.draftText = draft;

  const result = parseSequenceText(draft);
  if (!result.success) {
    handleApplyFailure(result.errors);
    restoreApplyTextareaState(textareaState);
    return;
  }
  commitParsedSequence(result, textareaState);
}

/* ===== Save / Load (Phase 1.9I) =====
   The project format is the SEQUENCE TEXT itself — a .txt, not JSON.
   There is nothing to serialize that the DSL does not already say, and
   a second format would be a second thing to keep in sync with the
   parser. What a file deliberately does NOT carry is everything that is
   about this session rather than the music: transport position, play
   state, selection, history, zoom/scroll/FOLLOW, and cycle/group ids —
   ids in particular are internal identity, re-minted on load.
*/

// The applied text, never the draft: what is saved is what is running.
// A trailing newline because that is what a text file has; the parser
// skips blank lines, so it round-trips unchanged.
function buildProjectSaveText() {
  const text = editorState.appliedText;
  return text.endsWith("\n") ? text : text + "\n";
}

function buildProjectFileName(now) {
  const d = now || new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `finite-cycles-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.txt`;
}

function saveProjectFile() {
  const blob = new Blob([buildProjectSaveText()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = buildProjectFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked a turn later, so the download has started reading it first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

/* An unapplied draft stops a LOAD before the file picker even opens,
   rather than after a file is chosen: the spec's rule is the existing
   one — APPLY or REVERT first — and asking for a file only to refuse it
   would be a worse way to say the same thing. No new dialog. */
function openProjectFilePicker() {
  if (!canMutateFromGui()) return false;
  if (!projectFileInputEl) return false;
  projectFileInputEl.click();
  return true;
}

/* Loading is an APPLY whose text came from a file: same parser, same
   error handling, same single history step. A separate load path would
   be a second implementation of the format.

   On a parse failure nothing applied changes — not the tracks, not the
   tempo — and the unusable text stays in the textarea as a dirty draft
   with the error shown, which is exactly what a failed APPLY does and
   is what lets the user fix it in place. */
function loadProjectText(text) {
  if (!canMutateFromGui()) return false;
  // A file written on Windows would otherwise leave "\r" on every line,
  // and the tokenizer would carry it into the last token of each.
  sequenceTextEl.value = String(text).replace(/\r\n?/g, "\n");
  handleSequenceTextInput();
  applyDraftSequence();
  return editorState.lastApplyError === null;
}

function handleProjectFileChange(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  // Cleared so picking the SAME file twice still fires a change event.
  input.value = "";
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => loadProjectText(String(reader.result));
  reader.onerror = () => showError(`Could not read "${file.name}".`);
  reader.readAsText(file, "utf-8");
}

function handleApplyFailure(errors) {
  // Nothing about the applied state is touched: tracks, playback,
  // scheduling queues and the GUI all keep running as they were.
  const first = errors[0];
  const extra = errors.length > 1 ? `\n+${errors.length - 1} more error${errors.length > 2 ? "s" : ""}` : "";
  editorState.lastApplyError = first + extra;
  showError(first + (errors.length > 1 ? ` (+${errors.length - 1} more)` : ""));
  sequenceTextEl.classList.add("has-error");
  updateEditorStatus();
}

function commitParsedSequence(result, textareaState) {
  // Before the tracks, so the sequence is rebuilt once, at the tempo the
  // text asked for. No history of its own: the apply below records the
  // single step that covers both.
  setTempo(result.tempo);
  replaceSequenceState(result.tracks, {
    reconcileIds: true,
    preserveSelection: true,
    resetTransport: false,
    resetScroll: false,
    textareaState,
  });
}

/* ----- Wholesale state replacement -----
   Both DSL apply and INITIALIZE swap the entire track list, so they go
   through one function; the differences between them are options, not
   duplicated procedures.
*/
function replaceSequenceState(nextTracks, options = {}) {
  const {
    reconcileIds = true,
    preserveSelection = true,
    resetTransport = false,
    resetScroll = false,
    textareaState = null,
  } = options;

  // Ids first: everything downstream (selection, scheduling, the
  // selection map) identifies cycles by id.
  state.tracks = reconcileIds
    ? reconcileCycleIds(state.tracks, nextTracks)
    : nextTracks.map(ensureSequenceIds);

  pruneRuntimeTrackState();

  if (preserveSelection) {
    // Whatever survived reconciliation keeps its selection; the rest is
    // dropped, including every cycle of a track that no longer exists.
    pruneSelectionState();
  } else {
    clearSelection();
  }

  if (resetTransport) {
    seekTransportToBeat(0);
  } else {
    // Transport is untouched: every track (including newly added ones)
    // is re-mapped onto the same absolute beat, so applying text
    // mid-playback does not restart the sequence.
    rebuildSchedulingFromTransport();
  }

  // Canonicalization happens only here, never while typing.
  const { text: canonical, selectionMap } = serializeSequence(state);
  sequenceTextEl.value = canonical;
  lastSelectionMap = selectionMap;

  editorState.appliedText = canonical;
  editorState.draftText = canonical;
  editorState.isDirty = false;
  editorState.lastApplyError = null;

  sequenceTextEl.classList.remove("has-error");
  clearError();
  renderApp({ resetScroll });
  updateCommonCycleDisplay();
  // INITIALIZE is the only thing that rewinds the timeline viewport.
  if (resetScroll) timelineViewState.commonScrollLeft = 0;
  renderTimeline();
  updateAllPlayheadsImmediately();
  updateEditorStatus();

  // The canonical text has fresh offsets, so the surviving selection
  // needs its range re-derived against the newly built selection map.
  if (preserveSelection) syncTextSelectionFromState();

  // GUI selection syncing above is useful after mouse edits, but APPLY
  // belongs to the text editor: its own caret/selection wins and focus
  // returns to the textarea when APPLY was invoked from it.
  restoreApplyTextareaState(textareaState);

  // A successful apply and an INITIALIZE are each one undoable step, so
  // the snapshot taken here is the pre-replacement structure — undoing
  // an apply returns to what was running before the text was applied.
  commitHistoryStep();
}

function revertDraftSequence() {
  sequenceTextEl.value = editorState.appliedText;
  editorState.draftText = editorState.appliedText;
  editorState.isDirty = false;
  editorState.lastApplyError = null;
  sequenceTextEl.classList.remove("has-error");
  clearError();
  updateEditorStatus();
}

function updateEditorStatus() {
  if (editorState.lastApplyError) {
    draftStatusEl.textContent = "APPLY ERROR";
    draftStatusEl.className = "editor-state has-error";
  } else if (editorState.isDirty) {
    draftStatusEl.textContent = "UNAPPLIED CHANGES";
    draftStatusEl.className = "editor-state is-dirty";
  } else {
    draftStatusEl.textContent = "APPLIED";
    draftStatusEl.className = "editor-state";
  }
  applySequenceBtnEl.disabled = !editorState.isDirty;
  applySequenceBtnEl.textContent = editorState.isDirty ? "APPLY ●" : "APPLY";
  revertSequenceBtnEl.disabled = !editorState.isDirty;
  // Undo/Redo are gated on the same dirty flag, so they follow it here
  // rather than needing every typing keystroke to remember them.
  updateHistoryButtons();
}

// GUI edits rewrite the applied text. If the draft has diverged, doing
// that silently would discard the user's unapplied typing, so structural
// GUI edits are blocked until the draft is applied or reverted.
function canMutateFromGui() {
  if (!editorState.isDirty) return true;
  showError("Apply or discard the text changes before editing the GUI.");
  return false;
}

/* ===== Selection mapping ===== */

// A textarea has exactly one selection range, so only a selection that
// forms one contiguous stretch of DSL can be mirrored into it: a single
// cycle, or a contiguous run of cycles within one track. Anything else
// returns null and the textarea is left alone.
function getTextRangeForSelection() {
  const selectedGroups = getSelectedGroups();
  const selected = getSelectedCycles();

  // A single group maps to its whole parenthesised token, repeat and
  // all — that is the text the group IS.
  if (selectedGroups.length === 1 && selected.length === 0) {
    const entry = lastSelectionMap.find(
      (m) => m.type === "group" &&
        m.trackId === selectedGroups[0].track.id &&
        m.groupId === selectedGroups[0].group.id
    );
    return entry ? { start: entry.start, end: entry.end } : null;
  }
  if (selectedGroups.length > 0) return null; // mixed or multiple: leave the textarea alone

  if (selected.length === 0) return null;

  const trackIds = new Set(selected.map((e) => e.track.id));
  if (trackIds.size > 1) return null;

  const indices = selected.map((e) => e.cycleIndex).sort((a, b) => a - b);
  if (indices[indices.length - 1] - indices[0] + 1 !== indices.length) return null;

  const entries = selected
    .map((e) => lastSelectionMap.find((m) => m.type === "cycle" && m.trackId === e.track.id && m.cycleId === e.cycle.id))
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  if (entries.length !== selected.length) return null;

  return { start: entries[0].start, end: entries[entries.length - 1].end };
}

// Selects the DSL range in the textarea WITHOUT focusing it. Stealing
// focus on a GUI click makes the browser scroll the textarea (and the
// page) into view, which is what previously knocked track lanes back to
// their scroll origin.
function syncTextSelectionFromState() {
  const range = getTextRangeForSelection();
  if (!range) return;
  try {
    sequenceTextEl.setSelectionRange(range.start, range.end);
  } catch (err) {
    // Selection APIs can throw in rare cross-browser edge cases; ignore.
  }
}

/* ===== Timeline view (bottom Common/Local section) ===== */

/* Expands a track across a whole common cycle for the bottom timeline.
   Groups ARE expanded here: the timeline shows real elapsed time, so
   [B C]*3 must appear as B C B C B C. Group and repetition boundaries
   are emitted alongside the cycle boundaries so the three levels of
   structure stay distinguishable. */
function computeTrackTimeline(track, totalBeats) {
  const passes = [];
  const hits = [];
  const groupStarts = [];
  const groupRepeatStarts = [];
  const loopLength = computeTrackLoopLengthNumber(track);
  if (loopLength <= 0 || totalBeats <= 0) {
    return { passes, hits, loopLength, groupStarts, groupRepeatStarts };
  }

  // The cursor advances rationally so a lane of eighth-beat cycles is
  // still exactly on the beat after a thousand repetitions; only the
  // emitted positions become floats.
  let cursorRational = RATIONAL_ZERO;
  let cursor = 0;
  let guard = 0;
  let lastGroupKey = null;

  while (cursor < totalBeats && guard < 200000) {
    const before = cursor;
    walkTrackPasses(track, (pass) => {
      if (cursor >= totalBeats || guard >= 200000) return false;

      if (pass.group) {
        const key = `${pass.group.id}#${pass.groupRepeatIndex}`;
        if (key !== lastGroupKey) {
          if (pass.groupRepeatIndex === 0) groupStarts.push(cursor);
          else groupRepeatStarts.push(cursor);
          lastGroupKey = key;
        }
      } else {
        lastGroupKey = null;
      }

      // Boxes are drawn at the full PATTERN width (so a negative offset's
      // overlap with the next pass is visible), but the cursor for the
      // NEXT pass advances by CYCLE LENGTH, matching actual playback.
      const spanBeats = rationalToNumber(pass.cycle.span);
      passes.push({ startBeat: cursor, endBeat: cursor + spanBeats, cycle: pass.cycle });
      expandCycleHitEvents(pass.cycle, pass.cycleRepeatIndex).forEach((hitEvent) => {
        hits.push({
          beatTime: cursor + hitEvent.beatOffset,
          hitValue: hitEvent.hitValue,
          hitPosition: hitEvent.hitPosition,
          ratchetIndex: hitEvent.ratchetIndex,
        });
      });

      cursorRational = addRational(cursorRational, computeCycleLength(pass.cycle));
      cursor = rationalToNumber(cursorRational);
      guard += 1;
      return true;
    });
    if (cursor === before) break; // nothing sounds; do not spin
  }

  return { passes, hits, loopLength, groupStarts, groupRepeatStarts };
}

/* ----- Timeline coordinates -----
   Deliberately separate from the lane's beatToPixel(): the timeline's
   scale is a view setting the user controls, the lane's is a constant.
*/
function timelineBeatToPixel(beat) {
  return beat * timelineViewState.pixelsPerBeat;
}

function timelinePixelToBeat(pixel) {
  return pixel / timelineViewState.pixelsPerBeat;
}

// Discrete steps rather than a continuous factor, so zooming out and
// back in lands on exactly the scale you started from.
const TIMELINE_ZOOM_STEPS = [0.5, 1, 2, 4, 8, 16, 32, 64, 96, 128];
// Fitting four beats across a wide screen would blow one cycle up to
// absurd proportions, so FIT never zooms in past the lane scale.
const FIT_MAX_PIXELS_PER_BEAT = LANE_PIXELS_PER_BEAT;
const RULER_MIN_TICK_SPACING = 80; // px between major ticks
const MAX_RULER_TICKS = 400;
const MIN_LOCAL_GRID_SPACING = 8; // px between local division lines
const MIN_CYCLE_BOUNDARY_SPACING = 6; // px between drawn cycle boundaries
const MIN_GROUP_REPEAT_BOUNDARY_SPACING = 10; // px between drawn group repetitions
const MIN_GROUP_BOUNDARY_SPACING = 14; // px between drawn group starts
const MIN_LOOP_BOUNDARY_SPACING = 18; // px between drawn track-loop boundaries
const MIN_HIT_SPACING = 4; // px; matches the rendered dot width
const RULER_END_LABEL_CLEARANCE = 44; // px kept clear before the end label

function timelineViewportWidth() {
  const width = timelineScrollViewportEl ? timelineScrollViewportEl.clientWidth : 0;
  return width > 0 ? width : 800; // pre-layout fallback
}

function computeFitPixelsPerBeat() {
  const commonCycle = computeCommonCycleBeatsNumber(state.tracks);
  if (commonCycle <= 0) return timelineViewState.minPixelsPerBeat;
  return clamp(
    timelineViewportWidth() / commonCycle,
    timelineViewState.minPixelsPerBeat,
    Math.min(FIT_MAX_PIXELS_PER_BEAT, timelineViewState.maxPixelsPerBeat)
  );
}

/* ----- Ruler tick density -----
   Two constraints: ticks must be at least RULER_MIN_TICK_SPACING apart
   on screen, and there must never be an unbounded number of them. A
   728-beat cycle zoomed all the way in would otherwise want thousands.
*/
const RULER_STEP_CANDIDATES = [1, 2, 4, 5, 8, 10, 16, 20, 32, 40, 64, 80, 100, 128, 200, 256, 400, 500, 1000];

function chooseRulerStep(pixelsPerBeat, totalBeats) {
  for (const step of RULER_STEP_CANDIDATES) {
    if (step * pixelsPerBeat < RULER_MIN_TICK_SPACING) continue;
    if (totalBeats / step > MAX_RULER_TICKS) continue;
    return step;
  }
  return Math.max(1, Math.ceil(totalBeats / MAX_RULER_TICKS));
}

function formatPixelsPerBeat(value) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/* ===== Timeline rendering =====
   Split into a structural render (expensive, runs on edits, zoom and
   mode changes) and a playhead update (cheap, runs every animation
   frame). The animation loop must never touch the structure.
*/

function renderTimeline() {
  renderTimelineStructure();
}

function renderTimelineStructure() {
  const isCommon = timelineViewState.mode === "common";
  // commonScrollLeft is kept current by the scroll listener, so it is
  // NOT re-captured here: while the Local view is showing, the viewport
  // reads 0 and capturing it would erase the remembered Common scroll.

  // Re-fit before measuring: a structural change may have altered the
  // common cycle, and in fit mode the scale follows it.
  if (isCommon && timelineViewState.fitMode) {
    timelineViewState.pixelsPerBeat = computeFitPixelsPerBeat();
  }

  timelineLabelColumnEl.innerHTML = "";
  timelineContentEl.innerHTML = "";
  timelineTrackRefs = {};
  timelineGlobalPlayhead = null;

  const rulerSpacer = document.createElement("div");
  rulerSpacer.className = "timeline-ruler-label-spacer";
  timelineLabelColumnEl.appendChild(rulerSpacer);

  state.tracks.forEach((track) => {
    const label = document.createElement("div");
    label.className = "timeline-track-label";
    label.textContent = track.name.toUpperCase();
    timelineLabelColumnEl.appendChild(label);
  });

  if (isCommon) renderCommonTimelineTracks();
  else renderLocalTimelineTracks();

  updateTimelineZoomControls();
  if (isCommon) restoreTimelineViewport();
  else timelineScrollViewportEl.scrollLeft = 0;
}

function renderCommonTimelineTracks() {
  const common = computeCommonCycle(state.tracks);
  // A common cycle of a million beats cannot be expanded hit by hit, so
  // the Common view steps aside rather than trying and hanging. Each
  // track still has its own finite loop, so playback and the Local view
  // are unaffected.
  if (common.status === "too-large") {
    renderCommonTimelineUnavailable();
    return;
  }

  const totalBeats = common.status === "ok" ? rationalToNumber(common.value) : 0;
  const viewportWidth = timelineViewportWidth();
  const contentWidth = Math.max(viewportWidth, timelineBeatToPixel(totalBeats));

  timelineContentEl.style.width = `${contentWidth}px`;
  timelineContentEl.classList.toggle("is-seekable", totalBeats > 0);

  timelineContentEl.appendChild(renderTimelineRuler(totalBeats, contentWidth));

  state.tracks.forEach((track) => {
    const bar = document.createElement("div");
    bar.className = "timeline-track-bar";
    if (totalBeats > 0) buildCommonTrackBar(track, bar, totalBeats);
    timelineContentEl.appendChild(bar);
    timelineTrackRefs[track.id] = { bar, playhead: null, totalBeats, mode: "common" };
  });

  // One playhead for the whole view rather than one per track: in the
  // common view every track is at the same absolute beat, so N copies
  // of the same line would be N times the per-frame work.
  if (totalBeats > 0) {
    timelineGlobalPlayhead = createPlayheadLine("timeline-global-playhead");
    timelineContentEl.appendChild(timelineGlobalPlayhead);
  }
}

function renderCommonTimelineUnavailable() {
  timelineContentEl.style.width = "100%";
  timelineContentEl.classList.remove("is-seekable");
  timelineLabelColumnEl.innerHTML = ""; // no rows to label

  const notice = document.createElement("div");
  notice.className = "timeline-unavailable";
  const title = document.createElement("strong");
  title.textContent = "COMMON CYCLE TOO LARGE";
  const hint = document.createElement("span");
  hint.textContent = "USE LOCAL VIEW";
  notice.appendChild(title);
  notice.appendChild(hint);
  timelineContentEl.appendChild(notice);
}

function renderTimelineRuler(totalBeats, contentWidth) {
  const ruler = document.createElement("div");
  ruler.className = "timeline-ruler";
  if (totalBeats <= 0) return ruler;

  const ppb = timelineViewState.pixelsPerBeat;

  // Minor ticks only survive at scales where they are actually legible;
  // drawing one line per beat at 1.4 px/beat is noise and DOM bloat.
  if (ppb >= MIN_LOCAL_GRID_SPACING && totalBeats <= MAX_RULER_TICKS * 4) {
    for (let b = 1; b < totalBeats; b++) {
      const minor = createGridLine("timeline-ruler-minor");
      minor.style.left = `${timelineBeatToPixel(b)}px`;
      ruler.appendChild(minor);
    }
  }

  const step = chooseRulerStep(ppb, totalBeats);
  const endPixel = timelineBeatToPixel(totalBeats);
  for (let b = 0; b < totalBeats; b += step) {
    const x = timelineBeatToPixel(b);
    // The end label is right-aligned against the content edge, so a
    // major tick too close to it would be overprinted.
    if (b > 0 && endPixel - x < RULER_END_LABEL_CLEARANCE) continue;
    const tick = document.createElement("div");
    tick.className = "timeline-ruler-tick";
    tick.style.left = `${x}px`;
    tick.textContent = String(b);
    ruler.appendChild(tick);
  }

  // The end of the common cycle is also beat 0 of the next lap, so it
  // is labelled explicitly and pulled inward to stay readable.
  const endTick = document.createElement("div");
  endTick.className = "timeline-ruler-tick is-end";
  endTick.style.left = `${timelineBeatToPixel(totalBeats)}px`;
  endTick.textContent = String(totalBeats);
  ruler.appendChild(endTick);

  ruler.style.width = `${contentWidth}px`;
  return ruler;
}

function buildCommonTrackBar(track, bar, totalBeats) {
  const { passes, hits, loopLength, groupStarts, groupRepeatStarts } = computeTrackTimeline(track, totalBeats);

  // Boundaries thin out below a minimum on-screen spacing. Drawn at
  // every repetition, a three-beat loop across 728 beats stops reading
  // as "boundaries" and becomes texture that hides the hits. The
  // stronger the tier, the more room it is given.
  let lastCycleX = -Infinity;
  passes.forEach((pass) => {
    const x = Math.round(timelineBeatToPixel(pass.startBeat));
    if (x - lastCycleX < MIN_CYCLE_BOUNDARY_SPACING) return;
    lastCycleX = x;
    const boundary = createGridLine("timeline-cycle-boundary");
    boundary.style.left = `${x}px`;
    bar.appendChild(boundary);
  });

  // Group repetition, then group start: each tier gets more room than
  // the one below it, so a dense structure thins from the bottom up and
  // the stronger boundaries survive longest.
  let lastGroupRepeatX = -Infinity;
  groupRepeatStarts.forEach((beat) => {
    const x = Math.round(timelineBeatToPixel(beat));
    if (x - lastGroupRepeatX < MIN_GROUP_REPEAT_BOUNDARY_SPACING) return;
    lastGroupRepeatX = x;
    const line = createGridLine("timeline-group-repeat-boundary");
    line.style.left = `${x}px`;
    bar.appendChild(line);
  });

  let lastGroupX = -Infinity;
  groupStarts.forEach((beat) => {
    const x = Math.round(timelineBeatToPixel(beat));
    if (x - lastGroupX < MIN_GROUP_BOUNDARY_SPACING) return;
    lastGroupX = x;
    const line = createGridLine("timeline-group-boundary");
    line.style.left = `${x}px`;
    bar.appendChild(line);
  });

  if (loopLength > 0) {
    let lastLoopX = -Infinity;
    for (let b = 0; b < totalBeats; b += loopLength) {
      const x = Math.round(timelineBeatToPixel(b));
      if (x - lastLoopX < MIN_LOOP_BOUNDARY_SPACING) continue;
      lastLoopX = x;
      const loopMark = createGridLine("timeline-loop-boundary");
      loopMark.style.left = `${x}px`;
      bar.appendChild(loopMark);
    }
  }

  const endMark = createGridLine("timeline-common-end");
  endMark.style.left = `${timelineBeatToPixel(totalBeats)}px`;
  bar.appendChild(endMark);

  // Hits are never thinned as *data*, but two dots closer together than
  // one dot is wide cannot be told apart anyway, and drawing thousands
  // of them turns the bar into a solid block. Collapsing to one dot per
  // dot-width is a rendering decision; state.tracks is untouched.
  let lastHitX = -Infinity;
  hits.forEach((hit) => {
    const x = Math.round(timelineBeatToPixel(hit.beatTime));
    if (x - lastHitX < MIN_HIT_SPACING) return;
    lastHitX = x;
    const dot = createHitDot(hit.hitValue, hit.hitPosition);
    dot.style.left = `${x}px`;
    bar.appendChild(dot);
  });
}

/* ----- Local division grid -----
   Only the INTERNAL division lines are drawn: the bar already has its
   own border, so a line at position 0 and one at `division` would just
   double that border up. The fraction is computed exactly as the lane's
   own grid computes it, so the two views agree on where a division is.

   Lines are thinned when they would be closer than
   MIN_LOCAL_GRID_SPACING apart. Hits are NEVER thinned here — a missing
   grid line costs nothing, a missing hit is missing music.
*/
function renderLocalDivisionGrid(refs, cycle, barBeats, cycleRepeatIndex = 0) {
  const division = cycle.division;
  const spanBeats = rationalToNumber(cycle.span);
  const barWidth = refs.bar.clientWidth || timelineViewportWidth();
  // Spacing is measured on screen, so it has to account for the bar
  // covering more than one span when the cycle is extended.
  const spacing = (barWidth * (spanBeats / barBeats)) / division;
  let step = 1;
  while (spacing * step < MIN_LOCAL_GRID_SPACING && step < division) step *= 2;

  visualGridDivisions(cycle, cycleRepeatIndex, step).forEach((position) => {
    const line = createGridLine("timeline-division-line");
    line.style.left = `${((position / division) * spanBeats / barBeats) * 100}%`;
    refs.bar.insertBefore(line, refs.playhead);
  });
}

/* Rebuilds a local bar's contents for one cycle. DOM order is grid,
   then hits, then playhead — the playhead is appended once at creation
   and everything else is inserted before it, so it stays on top.

   The bar covers max(span, cycleLength), not just the span, so that a
   cycle extended by a positive offset shows the hits living in that
   extension instead of clipping them off the right-hand edge. Every
   position below is therefore a fraction of that bar length rather
   than of the span. */
function rebuildLocalTrackContent(track, refs, cycle, cycleRepeatIndex = 0) {
  refs.bar
    .querySelectorAll(".hit-dot, .timeline-division-line, .cycle-pattern-end-marker")
    .forEach((el) => el.remove());
  const barBeats = cycle ? hitLimitBeats(cycle) : 1;
  refs.totalBeats = barBeats;
  refs.renderedCycleId = cycle ? cycle.id : null;
  refs.renderedDivision = cycle ? cycle.division : null;
  refs.renderedCycleRepeatIndex = cycle ? cycleRepeatIndex : null;
  if (!cycle) return;

  renderLocalDivisionGrid(refs, cycle, barBeats, cycleRepeatIndex);

  // When the bar is longer than the pattern, say where the pattern
  // stopped — otherwise the trailing space reads as an empty part of
  // the pattern rather than as the cycle's offset extension.
  const spanBeats = rationalToNumber(cycle.span);
  if (barBeats > spanBeats) {
    const marker = createGridLine("cycle-pattern-end-marker");
    marker.style.left = `${(spanBeats / barBeats) * 100}%`;
    refs.bar.insertBefore(marker, refs.playhead);
  }

  expandCycleHitEvents(cycle, cycleRepeatIndex).forEach((hitEvent) => {
    const dot = createHitDot(hitEvent.hitValue, hitEvent.hitPosition);
    dot.style.left = `${(hitEvent.beatOffset / barBeats) * 100}%`;
    refs.bar.insertBefore(dot, refs.playhead);
  });
}

// Local view is one cycle fitted to the viewport: no zoom, no scroll,
// no seek. Its job is to read one cycle closely, not to navigate.
function renderLocalTimelineTracks() {
  timelineContentEl.style.width = "100%";
  timelineContentEl.classList.remove("is-seekable");

  const ruler = document.createElement("div");
  ruler.className = "timeline-ruler is-local";
  const label = document.createElement("span");
  label.className = "timeline-ruler-caption";
  label.textContent = "CURRENT CYCLE";
  ruler.appendChild(label);
  timelineContentEl.appendChild(ruler);

  state.tracks.forEach((track) => {
    const bar = document.createElement("div");
    bar.className = "timeline-track-bar";
    const playhead = createPlayheadLine("timeline-playhead");
    bar.appendChild(playhead);
    timelineContentEl.appendChild(bar);

    const refs = {
      bar,
      playhead,
      totalBeats: 1,
      mode: "local",
      renderedCycleId: null,
      renderedDivision: null,
      renderedCycleRepeatIndex: null,
    };
    timelineTrackRefs[track.id] = refs;

    // Local view follows the cycle at the current transport position,
    // with a sensible fallback when the track is stopped. A track whose
    // cycles are all PASS has nothing playing at all, so it gets no
    // hits, no grid and no playhead.
    const sounding = computeTrackPassFraction(track.id);
    const cycle = sounding ? findCycle(track, sounding.cycleId) : activeCycles(track)[0] || null;
    rebuildLocalTrackContent(track, refs, cycle, state.isPlaying && sounding ? sounding.cycleRepeatIndex : 0);
    if (!cycle) playhead.classList.add("is-inactive");
  });
}

/* ===== Timeline viewport, zoom and follow ===== */

function captureTimelineScroll() {
  if (!timelineScrollViewportEl) return;
  timelineViewState.commonScrollLeft = timelineScrollViewportEl.scrollLeft;
}

function restoreTimelineViewport() {
  timelineScrollViewportEl.scrollLeft = timelineViewState.commonScrollLeft;
  // The browser clamps to the new content width; record what it settled
  // on so the next capture does not re-apply a stale value.
  timelineViewState.commonScrollLeft = timelineScrollViewportEl.scrollLeft;
  // This is the app moving the viewport, not the user, so FOLLOW must
  // not read it as a manual scroll on the next frame.
  resetFollowScrollTracking();
}

// Zooming keeps whatever beat is under the middle of the viewport under
// the middle of the viewport, so the view never jumps to beat 0.
function applyTimelineZoom(nextPixelsPerBeat) {
  const commonCycle = computeCommonCycleBeatsNumber(state.tracks);
  if (commonCycle <= 0) return;

  const clamped = clamp(nextPixelsPerBeat, timelineViewState.minPixelsPerBeat, timelineViewState.maxPixelsPerBeat);
  const previous = timelineViewState.pixelsPerBeat;
  if (clamped === previous) {
    updateTimelineZoomControls();
    return;
  }

  const viewport = timelineScrollViewportEl;
  const centerBeat = (viewport.scrollLeft + viewport.clientWidth / 2) / previous;

  timelineViewState.pixelsPerBeat = clamped;
  // While FOLLOW is driving, the anchor is the playing beat, not the
  // middle of the old view — otherwise the zoom lands somewhere that
  // FOLLOW then has to yank back on the next frame.
  timelineViewState.commonScrollLeft = isFollowActive()
    ? followScrollLeftForCurrentBeat(clamped)
    : Math.max(0, centerBeat * clamped - viewport.clientWidth / 2);

  renderTimelineStructure();
  updateAllPlayheadsImmediately();
}

function zoomTimelineStep(direction) {
  const current = timelineViewState.pixelsPerBeat;
  let next;
  if (direction > 0) next = TIMELINE_ZOOM_STEPS.find((v) => v > current + 1e-9);
  else next = [...TIMELINE_ZOOM_STEPS].reverse().find((v) => v < current - 1e-9);
  if (next === undefined) return;

  timelineViewState.fitMode = false; // any manual zoom leaves fit mode
  applyTimelineZoom(next);
}

function setTimelineFitMode() {
  if (computeCommonCycleBeatsNumber(state.tracks) <= 0) return;
  timelineViewState.fitMode = true;
  // Fit puts the whole common cycle on screen, so there is nothing left
  // to scroll and FOLLOW has nothing to do either way.
  timelineViewState.commonScrollLeft = 0;
  timelineViewState.pixelsPerBeat = computeFitPixelsPerBeat();
  renderTimelineStructure();
  updateAllPlayheadsImmediately();
}

function setTimelineOneToOne() {
  timelineViewState.fitMode = false;
  applyTimelineZoom(LANE_PIXELS_PER_BEAT);
}

function toggleTimelineFollow() {
  timelineViewState.autoFollow = !timelineViewState.autoFollow;
  // Turning FOLLOW on is itself the instruction to take the view back,
  // so it cancels any suspension a previous manual scroll left running.
  followSuspendedUntil = 0;
  resetFollowScrollTracking();
  updateTimelineZoomControls();
  updateAllPlayheadsImmediately();
}

function updateTimelineZoomControls() {
  const isCommon = timelineViewState.mode === "common";
  const commonCycle = computeCommonCycleBeatsNumber(state.tracks);
  const usable = isCommon && commonCycle > 0;
  const ppb = timelineViewState.pixelsPerBeat;

  timelineZoomControlsEl.classList.toggle("is-disabled", !usable);

  zoomOutBtnEl.disabled = !usable || ppb <= TIMELINE_ZOOM_STEPS[0] + 1e-9;
  zoomInBtnEl.disabled = !usable || ppb >= TIMELINE_ZOOM_STEPS[TIMELINE_ZOOM_STEPS.length - 1] - 1e-9;
  zoomFitBtnEl.disabled = !usable;
  zoomOneToOneBtnEl.disabled = !usable;
  timelineFollowBtnEl.disabled = !usable;

  const isOneToOne = Math.abs(ppb - LANE_PIXELS_PER_BEAT) < 1e-9;
  zoomFitBtnEl.classList.toggle("is-active", usable && timelineViewState.fitMode);
  zoomFitBtnEl.setAttribute("aria-pressed", usable && timelineViewState.fitMode ? "true" : "false");
  zoomOneToOneBtnEl.classList.toggle("is-active", usable && isOneToOne);
  zoomOneToOneBtnEl.setAttribute("aria-pressed", usable && isOneToOne ? "true" : "false");
  timelineFollowBtnEl.classList.toggle("is-active", timelineViewState.autoFollow);
  timelineFollowBtnEl.setAttribute("aria-pressed", timelineViewState.autoFollow ? "true" : "false");

  if (!isCommon) {
    timelineZoomValueEl.textContent = "LOCAL VIEW";
  } else if (computeCommonCycle(state.tracks).status === "too-large") {
    timelineZoomValueEl.textContent = "COMMON TIMELINE UNAVAILABLE";
  } else if (commonCycle <= 0) {
    timelineZoomValueEl.textContent = "NO ACTIVE CYCLE";
  } else {
    const prefix = timelineViewState.fitMode ? "FIT · " : isOneToOne ? "1:1 · " : "";
    timelineZoomValueEl.textContent = `${prefix}${formatPixelsPerBeat(ppb)} PX / BEAT`;
  }
}

/* ----- Playhead follow -----
   FOLLOW holds the playhead at a fixed place in the viewport and moves
   the TIMELINE underneath it, rather than letting the playhead roam and
   paging the view when it escapes. Paging meant the content jumped a
   screen at a time and the eye had to re-find the playhead after every
   jump; keeping the playhead still and sliding the content is what
   makes a long common cycle readable while it plays.

   The playhead is parked 35% in from the left, so roughly a third of
   what has just played stays visible for context while most of the
   viewport shows what is coming.

   Position is recomputed from the transport beat every frame — no CSS
   smooth-scroll, no scrollIntoView, no interpolation from the previous
   scrollLeft. That is what keeps FOLLOW correct across a zoom, a loop
   wrap or a seek: each frame simply asks "where is the beat now".
*/
const FOLLOW_PLAYHEAD_RATIO = 0.35;
// How far the viewport may differ from what FOLLOW last wrote before the
// difference is read as the user having scrolled.
const FOLLOW_MANUAL_SCROLL_EPSILON = 2; // px
// How long a manual scroll keeps FOLLOW off. Long enough that the pauses
// inside one wheel gesture do not each count as "finished".
const FOLLOW_RESUME_DELAY_MS = 1200;

// The scrollLeft FOLLOW last wrote, or null when the next frame must not
// compare (something else legitimately moved the viewport).
let lastFollowScrollLeft = null;
let followSuspendedUntil = 0;

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

/* The whole of FOLLOW's arithmetic, kept free of the DOM so it can be
   reasoned about (and tested) on its own. Clamping is what produces the
   two ends of the timeline: at the start there is nothing to scroll, so
   the playhead travels to the 35% mark on its own; at the end the view
   stops at the last scroll position and the playhead carries on to the
   right edge. */
function computeFollowScrollLeft(playheadX, viewportWidth, maxScroll) {
  if (!(viewportWidth > 0)) return 0;
  return clamp(playheadX - viewportWidth * FOLLOW_PLAYHEAD_RATIO, 0, Math.max(0, maxScroll));
}

/* Where FOLLOW would put the view for the beat playing right now, at a
   given scale. Zoom uses this instead of carrying the old scrollLeft
   across: rescaling a stale scroll position is exactly the interpolation
   that makes a zoom-while-following drift off the playhead. */
function followScrollLeftForCurrentBeat(pixelsPerBeat) {
  const commonCycle = computeCommonCycleBeatsNumber(state.tracks);
  if (commonCycle <= 0) return 0;
  const viewport = timelineScrollViewportEl;
  const width = viewport ? viewport.clientWidth : 0;
  const beat = getTransportBeat();
  const localBeat = ((beat % commonCycle) + commonCycle) % commonCycle;
  const contentWidth = Math.max(width, commonCycle * pixelsPerBeat);
  return computeFollowScrollLeft(localBeat * pixelsPerBeat, width, contentWidth - width);
}

// Any hand-driven change to the view — wheel, scrollbar, trackpad —
// hands the scroll position back to the user for a moment.
function noteManualTimelineScroll() {
  followSuspendedUntil = nowMs() + FOLLOW_RESUME_DELAY_MS;
  lastFollowScrollLeft = null;
}

// Called after anything that legitimately moves the viewport itself
// (zoom, view restore), so the next frame does not mistake that write
// for the user scrolling.
function resetFollowScrollTracking() {
  lastFollowScrollLeft = null;
}

function isFollowSuspended() {
  if (isTimelineSeeking) return true; // a drag-seek owns the scroll position
  return nowMs() < followSuspendedUntil;
}

// FOLLOW only drives the view while the sequence is actually playing;
// stopped, the view stays exactly where it was left.
function isFollowActive() {
  return (
    timelineViewState.autoFollow &&
    timelineViewState.mode === "common" &&
    state.isPlaying &&
    !isFollowSuspended()
  );
}

function followTimelinePlayhead(playheadX) {
  const viewport = timelineScrollViewportEl;
  if (!viewport) return;

  /* Manual scrolling is detected here rather than in the scroll event,
     because a scroll event can arrive a frame late and would then be
     compared against a newer write than the one that produced it. In
     the animation frame the question is simply: is the viewport still
     where FOLLOW put it? */
  if (
    lastFollowScrollLeft !== null &&
    Math.abs(viewport.scrollLeft - lastFollowScrollLeft) > FOLLOW_MANUAL_SCROLL_EPSILON
  ) {
    noteManualTimelineScroll();
  }

  if (!isFollowActive()) {
    lastFollowScrollLeft = null;
    return;
  }

  const width = viewport.clientWidth;
  if (width <= 0) return;
  const maxScroll = Math.max(0, viewport.scrollWidth - width);
  const target = computeFollowScrollLeft(playheadX, width, maxScroll);

  viewport.scrollLeft = target;
  // Read back rather than trusting the write: the browser clamps to its
  // own idea of the scrollable range, and the next frame's manual-scroll
  // check has to compare against what actually happened.
  lastFollowScrollLeft = viewport.scrollLeft;
  timelineViewState.commonScrollLeft = lastFollowScrollLeft;
}

// Alt+Wheel zooms around the pointer instead of the viewport centre,
// which is what makes wheel zoom feel direct rather than arbitrary.
function handleTimelineWheel(e) {
  if (!e.altKey) return; // plain wheel keeps its normal scrolling job
  if (timelineViewState.mode !== "common") return;
  const commonCycle = computeCommonCycleBeatsNumber(state.tracks);
  if (commonCycle <= 0) return;
  e.preventDefault();

  const viewport = timelineScrollViewportEl;
  const previous = timelineViewState.pixelsPerBeat;
  const pointerX = e.clientX - viewport.getBoundingClientRect().left;
  const pointerBeat = (viewport.scrollLeft + pointerX) / previous;

  const direction = e.deltaY < 0 ? 1 : -1;
  const next =
    direction > 0
      ? TIMELINE_ZOOM_STEPS.find((v) => v > previous + 1e-9)
      : [...TIMELINE_ZOOM_STEPS].reverse().find((v) => v < previous - 1e-9);
  if (next === undefined) return;

  timelineViewState.fitMode = false;
  timelineViewState.pixelsPerBeat = next;
  // Zooming at the pointer is the point of this gesture — unless FOLLOW
  // owns the view, in which case the playing beat wins (see
  // followScrollLeftForCurrentBeat).
  timelineViewState.commonScrollLeft = isFollowActive()
    ? followScrollLeftForCurrentBeat(next)
    : Math.max(0, pointerBeat * next - pointerX);
  renderTimelineStructure();
  updateAllPlayheadsImmediately();
}

// Fit mode tracks the viewport, so a resize has to recompute it; a
// manual zoom must be left exactly as the user set it. Coalesced into
// one animation frame so a drag-resize does not re-render per pixel.
let resizeFrameId = null;

function handleWindowResize() {
  if (resizeFrameId !== null) return;
  resizeFrameId = requestAnimationFrame(() => {
    resizeFrameId = null;
    if (timelineViewState.mode !== "common") return;
    if (!timelineViewState.fitMode) return;
    timelineViewState.pixelsPerBeat = computeFitPixelsPerBeat();
    renderTimelineStructure();
    updateAllPlayheadsImmediately();
  });
}

function updateViewToggleButtons() {
  timelineViewToggleEl.querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === timelineViewState.mode);
  });
}

function setTimelineViewMode(mode) {
  if (mode === timelineViewState.mode) return;
  // Leaving Common remembers where you were; coming back restores both
  // the zoom and the scroll, so a glance at Local does not reset the view.
  if (timelineViewState.mode === "common") captureTimelineScroll();
  timelineViewState.mode = mode;
  updateViewToggleButtons();
  renderTimelineStructure();
  updateAllPlayheadsImmediately();
}

/* ===== Audio engine =====
   Each trigger returns a handle with stop(), so events that were
   committed to WebAudio but have not sounded yet can be cancelled when
   the user hits STOP/RESET or passes/edits the cycle they belong to.
*/

let audioCtx = null;
let masterGain = null;

function ensureAudioContext() {
  if (audioCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  audioCtx = new Ctx();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.7;
  masterGain.connect(audioCtx.destination);
}

function createNoiseBuffer(duration) {
  const frameCount = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
  const buffer = audioCtx.createBuffer(1, frameCount, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function makeStopHandle(sources, gains) {
  return {
    stop() {
      const now = audioCtx ? audioCtx.currentTime : 0;
      gains.forEach((g) => {
        try {
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(0, now);
        } catch (err) {
          /* node may already be finished */
        }
      });
      sources.forEach((s) => {
        try {
          s.stop(now);
        } catch (err) {
          /* node may already be stopped */
        }
      });
    },
  };
}

function triggerKick(time) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(140, time);
  osc.frequency.exponentialRampToValueAtTime(45, time + 0.15);
  gain.gain.setValueAtTime(1, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
  osc.connect(gain).connect(masterGain);
  osc.start(time);
  osc.stop(time + 0.25);
  return makeStopHandle([osc], [gain]);
}

function triggerSnare(time) {
  const noise = audioCtx.createBufferSource();
  noise.buffer = createNoiseBuffer(0.2);
  const noiseFilter = audioCtx.createBiquadFilter();
  noiseFilter.type = "highpass";
  noiseFilter.frequency.value = 1000;
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(1, time);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
  noise.connect(noiseFilter).connect(noiseGain).connect(masterGain);
  noise.start(time);
  noise.stop(time + 0.2);

  const osc = audioCtx.createOscillator();
  const oscGain = audioCtx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(180, time);
  oscGain.gain.setValueAtTime(0.3, time);
  oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
  osc.connect(oscGain).connect(masterGain);
  osc.start(time);
  osc.stop(time + 0.1);

  return makeStopHandle([noise, osc], [noiseGain, oscGain]);
}

function triggerHat(time) {
  const noise = audioCtx.createBufferSource();
  noise.buffer = createNoiseBuffer(0.08);
  const filter = audioCtx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 7000;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.6, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
  noise.connect(filter).connect(gain).connect(masterGain);
  noise.start(time);
  noise.stop(time + 0.08);
  return makeStopHandle([noise], [gain]);
}

// A handclap is several tiny, slightly staggered noise transients rather
// than one long snare-like burst. High-pass then band-pass filtering keeps
// the low end clear for kick while leaving a short, dry mid/high crack.
function triggerClap(time) {
  const sources = [];
  const gains = [];
  const burstOffsets = [0, 0.009, 0.021, 0.035];

  burstOffsets.forEach((offset, index) => {
    const burstTime = time + offset;
    const noise = audioCtx.createBufferSource();
    noise.buffer = createNoiseBuffer(0.075);
    const highpass = audioCtx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 1200;
    const bandpass = audioCtx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = 2400;
    bandpass.Q.value = 0.85;
    const gain = audioCtx.createGain();
    const level = index === 0 ? 0.3 : 0.19;
    const decay = 0.07 + index * 0.012;
    gain.gain.setValueAtTime(level, burstTime);
    gain.gain.exponentialRampToValueAtTime(0.001, burstTime + decay);
    noise.connect(highpass).connect(bandpass).connect(gain).connect(masterGain);
    noise.start(burstTime);
    noise.stop(burstTime + decay + 0.01);
    sources.push(noise);
    gains.push(gain);
  });

  return makeStopHandle(sources, gains);
}

// Dispatch is by instrument, not track id, so "hat2" and "clap2" share
// their respective voices.
function triggerSoundForInstrument(instrument, time) {
  if (instrument === "kick") return triggerKick(time);
  if (instrument === "snare") return triggerSnare(time);
  if (instrument === "hat") return triggerHat(time);
  if (instrument === "clap") return triggerClap(time);
  return null;
}

/* ===== Transport =====
   The transport owns absolute musical position, independent of both the
   sequence structure and the scheduler. Editing the sequence never moves
   it: a structural change simply re-maps the same absolute beat onto the
   new loop, so time keeps running through edits.

   Position is stored as an anchor pair (anchorBeat at anchorAudioTime)
   rather than an elapsed-since-start time, which is what lets tempo
   changes and seeks happen without the current beat jumping.
*/

const START_DELAY = 0.05; // audio scheduling headroom when starting/seeking
const PHASE_EPSILON = 1e-9;

let transport = {
  positionBeats: 0,
  anchorAudioTime: 0,
  anchorBeat: 0,
  tempo: 120,
  isRunning: false,
};

function getTransportBeat(now) {
  if (!transport.isRunning) return transport.positionBeats;
  const current = now !== undefined ? now : audioCtx ? audioCtx.currentTime : 0;
  // Before the anchor time is reached (start/seek headroom) the transport
  // is parked at the anchor rather than running backwards.
  if (current <= transport.anchorAudioTime) return transport.anchorBeat;
  const beatDuration = 60 / transport.tempo;
  return transport.anchorBeat + (current - transport.anchorAudioTime) / beatDuration;
}

function transportBeatToAudioTime(beat) {
  const beatDuration = 60 / transport.tempo;
  return transport.anchorAudioTime + (beat - transport.anchorBeat) * beatDuration;
}

/* ----- Track phase resolution -----
   A track's playing position is derived from the absolute transport beat,
   never stored as a persistent cycle cursor. That is what makes structural
   edits safe: the same absolute beat is simply re-resolved against the new
   cycle list.
*/

function getTrackPhaseBeat(track, absoluteBeat) {
  const loopLength = computeTrackLoopLengthNumber(track);
  if (loopLength <= 0) return null;
  return ((absoluteBeat % loopLength) + loopLength) % loopLength;
}

/* Resolves an absolute transport beat to a playing position, walking
   Track loop -> sequence item -> group repeat -> group item -> cycle
   repeat -> offset. Nothing about the position is stored: it is derived
   fresh every time, which is what makes an edit safe. */
function resolveTrackPositionAtBeat(track, absoluteBeat) {
  if (!track) return null;
  // The loop length is exact as a rational, but the transport advances
  // as a float against the audio clock, so the modulo happens in floats
  // with PHASE_EPSILON guarding the boundary (see the layer note above).
  const loopLength = computeTrackLoopLengthNumber(track);
  if (loopLength <= 0) return null;

  let phaseBeat = ((absoluteBeat % loopLength) + loopLength) % loopLength;
  let result = null;
  let firstPass = null;
  let groupElapsed = 0; // beats since the start of the whole group item
  let lastGroupId = null;

  walkTrackPasses(track, (pass) => {
    // spanBeats (PATTERN SPAN) sizes the hits within this pass;
    // cycleLengthBeats (CYCLE LENGTH = span + offset) is what actually
    // gates how long this pass owns the phase before the next one
    // begins. They only differ when the cycle has a nonzero offset.
    const spanBeats = rationalToNumber(pass.cycle.span);
    const cycleLengthBeats = computeCycleLengthNumber(pass.cycle);
    if (!firstPass) firstPass = { pass, spanBeats, cycleLengthBeats };

    // Beats since the start of the CURRENT repetition, so the key has
    // to include the repetition index — otherwise the offset keeps
    // accumulating across a group's repeats.
    const groupKey = pass.group ? `${pass.group.id}#${pass.groupRepeatIndex}` : null;
    if (groupKey !== lastGroupId) {
      groupElapsed = 0;
      lastGroupId = groupKey;
    }

    // Epsilon keeps floating-point drift at a loop boundary from
    // falling through the whole list and returning null.
    if (phaseBeat < cycleLengthBeats - PHASE_EPSILON) {
      const offsetBeats = Math.max(0, phaseBeat);
      const groupBase = pass.group ? rationalToNumber(computeGroupBaseLength(pass.group)) : 0;
      result = {
        itemType: pass.itemType,
        groupId: pass.group ? pass.group.id : null,
        groupIndex: pass.group ? pass.itemIndex : -1,
        groupRepeatIndex: pass.groupRepeatIndex,
        itemIndex: pass.itemIndex,

        cycleId: pass.cycle.id,
        cycleIndexInGroup: pass.cycleIndexInGroup,
        cycleRepeatIndex: pass.cycleRepeatIndex,

        // Progress is reported against the PATTERN span (clamped to 1),
        // not the cycle length: a +offset "silent tail" reads as the
        // pattern having finished, not as overshooting past it.
        offsetInCycleBeats: offsetBeats,
        cycleFraction: spanBeats > 0 ? Math.min(1, offsetBeats / spanBeats) : 0,
        offsetInGroupRepeatBeats: pass.group ? groupElapsed + offsetBeats : 0,
        offsetInGroupTotalBeats: pass.group
          ? pass.groupRepeatIndex * groupBase + groupElapsed + offsetBeats
          : 0,

        trackLoopLength: loopLength,
        passStartBeat: absoluteBeat - offsetBeats,

        // Names the rest of the app already speaks.
        offsetBeats,
        fraction: spanBeats > 0 ? Math.min(1, offsetBeats / spanBeats) : 0,
        repeatIndex: pass.cycleRepeatIndex,
        loopLength,
        span: spanBeats,
        cycleLength: cycleLengthBeats,
        repeat: pass.cycle.repeat,
      };
      return false;
    }

    phaseBeat -= cycleLengthBeats;
    if (pass.group) groupElapsed += cycleLengthBeats;
    return true;
  });

  if (result) return result;
  if (!firstPass) return null;

  // Drifted past the end by less than an epsilon: treat as loop start.
  const { pass, spanBeats, cycleLengthBeats } = firstPass;
  return {
    itemType: pass.itemType,
    groupId: pass.group ? pass.group.id : null,
    groupIndex: pass.group ? pass.itemIndex : -1,
    groupRepeatIndex: 0,
    itemIndex: pass.itemIndex,
    cycleId: pass.cycle.id,
    cycleIndexInGroup: pass.cycleIndexInGroup,
    cycleRepeatIndex: 0,
    offsetInCycleBeats: 0,
    cycleFraction: 0,
    offsetInGroupRepeatBeats: 0,
    offsetInGroupTotalBeats: 0,
    trackLoopLength: loopLength,
    passStartBeat: absoluteBeat,
    offsetBeats: 0,
    fraction: 0,
    repeatIndex: 0,
    loopLength,
    span: spanBeats,
    cycleLength: cycleLengthBeats,
    repeat: pass.cycle.repeat,
  };
}

// Display-facing position of a track, expressed in transport beats.
function computeTrackPassFraction(trackId, absoluteBeat) {
  const beat = absoluteBeat !== undefined ? absoluteBeat : getTransportBeat();
  return resolveTrackPositionAtBeat(findTrack(trackId), beat);
}

/* ===== Scheduler =====
   Beat-based two-stage pipeline:
     expandTrackEvents()  — walks cycle passes forward in TRANSPORT BEATS
                            and appends events to pendingEvents. Each event
                            carries absoluteBeat; its audio time is derived
                            from the transport anchor. No AudioContext work.
     commitDueEvents()    — hands only events within SCHEDULE_AHEAD_TIME to
                            WebAudio, recording a stop handle so they stay
                            cancellable.

   Keeping the cursor in beats (not seconds) is what allows tempo changes,
   seeks and structural edits to rebuild the queue without disturbing the
   transport position.
*/

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_TIME = 0.1; // seconds of audio committed ahead
const EXPAND_AHEAD_BEATS = 2; // beats of pendingEvents kept filled
const MAX_PASSES_PER_TICK = 200;

let pendingEvents = []; // [{ trackId, instrument, cycleId, hitValue, absoluteBeat, time, generation }]
let scheduledAudioNodes = []; // [{ trackId, generation, time, stop }]
let schedulerCursorBeat = {}; // trackId -> next absolute beat to expand from
let schedulerFloorBeat = {}; // trackId -> earliest beat allowed to emit (never re-fire the past)
let schedulerTimerId = null;
let playbackGeneration = 0;
let timelineAnimationId = null;
let eventIdCounter = 0;

function stopFutureScheduledAudio(trackIds) {
  const now = audioCtx ? audioCtx.currentTime : 0;
  const affects = (id) => !trackIds || trackIds.includes(id);
  scheduledAudioNodes = scheduledAudioNodes.filter((node) => {
    if (affects(node.trackId) && node.time > now) {
      node.stop();
      return false;
    }
    return true;
  });
}

// Drops queued-but-unsounded events for the given tracks (all when
// omitted) and cancels any of their audio that has not started yet.
function invalidateFutureScheduling(trackIds) {
  const affects = (id) => !trackIds || trackIds.includes(id);
  pendingEvents = pendingEvents.filter((ev) => !affects(ev.trackId));
  stopFutureScheduledAudio(trackIds);
}

function initializeTrackSchedulerCursors(trackIds, absoluteBeat) {
  const targets = trackIds ? state.tracks.filter((t) => trackIds.includes(t.id)) : state.tracks;
  targets.forEach((track) => {
    const pos = resolveTrackPositionAtBeat(track, absoluteBeat);
    if (!pos) {
      // Fully passed track: park the cursor so the loop stays bounded.
      schedulerCursorBeat[track.id] = absoluteBeat;
      schedulerFloorBeat[track.id] = absoluteBeat;
      return;
    }
    // Resume from the start of the pass that contains `absoluteBeat`, but
    // never emit hits that already went by.
    schedulerCursorBeat[track.id] = pos.passStartBeat;
    schedulerFloorBeat[track.id] = absoluteBeat;
  });
}

// Rebuilds the event queue from the current transport position and the
// current sequence. Used after any structural edit, tempo change or seek.
function rebuildSchedulingFromTransport(options = {}) {
  const absoluteBeat = getTransportBeat();
  const trackIds = options.trackIds;

  invalidateFutureScheduling(trackIds);
  initializeTrackSchedulerCursors(trackIds, absoluteBeat);

  if (trackIds) {
    trackIds.forEach((id) => {
      if (!findTrack(id)) {
        delete schedulerCursorBeat[id];
        delete schedulerFloorBeat[id];
      }
    });
  }

  // The scheduler timer keeps running on its own; only (re)start it if
  // playing and no timer is pending, so it can never double-start.
  if (state.isPlaying && schedulerTimerId === null) {
    schedulerLoop();
  }
}

function expandTrackEvents(track, horizonBeat) {
  if (getFlatCycles(track).length === 0) return;

  if (schedulerCursorBeat[track.id] === undefined) {
    initializeTrackSchedulerCursors([track.id], getTransportBeat());
  }

  const floor = schedulerFloorBeat[track.id] !== undefined ? schedulerFloorBeat[track.id] : -Infinity;

  let passes = 0;
  while (schedulerCursorBeat[track.id] < horizonBeat && passes < MAX_PASSES_PER_TICK) {
    const startBeat = schedulerCursorBeat[track.id];
    const pos = resolveTrackPositionAtBeat(track, startBeat);
    if (!pos) {
      // Every cycle is passed: idle without consuming events or looping.
      schedulerCursorBeat[track.id] = horizonBeat;
      return;
    }

    const cycle = findCycle(track, pos.cycleId);
    if (!cycle || cycle.division < 1) {
      schedulerCursorBeat[track.id] = horizonBeat;
      return;
    }

    // Expanded hits are already measured against PATTERN span; the cursor
    // advances by CYCLE LENGTH, so a negative offset lets later hits land
    // after the next pass has begun (an intentional overlap).
    const cycleLengthBeats = computeCycleLengthNumber(cycle);

    // The cursor may sit mid-pass (resumed after an edit); emit from the
    // pass start but skip anything already in the past.
    const passStartBeat = startBeat - pos.offsetBeats;

    expandCycleHitEvents(cycle, pos.cycleRepeatIndex).forEach((hitEvent) => {
      const absoluteBeat = passStartBeat + hitEvent.beatOffset;
      if (absoluteBeat < floor) return; // already sounded (or seeked past)
      if (absoluteBeat < startBeat - PHASE_EPSILON) return;
      pendingEvents.push({
        id: `event-${++eventIdCounter}`,
        trackId: track.id,
        instrument: track.instrument,
        cycleId: cycle.id,
        groupId: pos.groupId,
        groupRepeatIndex: pos.groupRepeatIndex,
        cycleRepeatIndex: pos.cycleRepeatIndex,
        hitValue: hitEvent.hitValue,
        ratchetIndex: hitEvent.ratchetIndex,
        ratchetCount: hitEvent.ratchetCount,
        absoluteBeat,
        time: transportBeatToAudioTime(absoluteBeat),
        generation: playbackGeneration,
      });
    });

    schedulerCursorBeat[track.id] = passStartBeat + cycleLengthBeats;
    passes += 1;
  }
}

function commitDueEvents(horizonTime) {
  const remaining = [];
  for (const ev of pendingEvents) {
    if (ev.generation !== playbackGeneration) continue; // stale
    if (ev.time <= horizonTime) {
      const now = audioCtx.currentTime;
      if (ev.time >= now - 0.05) {
        const handle = triggerSoundForInstrument(ev.instrument, Math.max(ev.time, now));
        if (handle) {
          scheduledAudioNodes.push({
            trackId: ev.trackId,
            generation: ev.generation,
            time: ev.time,
            stop: handle.stop,
          });
        }
        scheduleVisualCallback(ev.time, () =>
          flashHitDot(ev.trackId, ev.cycleId, ev.hitValue, ev.ratchetIndex || 0)
        );
      }
    } else {
      remaining.push(ev);
    }
  }
  pendingEvents = remaining;

  const now = audioCtx.currentTime;
  scheduledAudioNodes = scheduledAudioNodes.filter((n) => n.time > now - 2);
}

function schedulerLoop() {
  schedulerTimerId = null;
  if (!state.isPlaying) return;
  const now = audioCtx.currentTime;
  const horizonBeat = getTransportBeat(now) + EXPAND_AHEAD_BEATS;

  state.tracks.forEach((track) => expandTrackEvents(track, horizonBeat));
  commitDueEvents(now + SCHEDULE_AHEAD_TIME);

  schedulerTimerId = setTimeout(schedulerLoop, LOOKAHEAD_MS);
}

/* ===== Playhead / visual sync =====
   All position display derives from the transport beat, so it reflects
   musical time rather than how far the scheduler has run ahead.
*/

function scheduleVisualCallback(time, callback) {
  const generation = playbackGeneration;
  const delayMs = Math.max(0, (time - audioCtx.currentTime) * 1000);
  setTimeout(() => {
    if (generation !== playbackGeneration || !state.isPlaying) return;
    callback();
  }, delayMs);
}

function flashHitDot(trackId, cycleId, hitValue, ratchetIndex = 0) {
  const refs = playheadRefs[trackId];
  if (!refs) return;
  const hitMap = refs.hitEls[cycleId];
  if (!hitMap) return;
  const dot = hitMap[hitVisualKey(hitValue, ratchetIndex)];
  if (!dot) return;
  dot.classList.add("is-playing");
  setTimeout(() => dot.classList.remove("is-playing"), 150);
}

function updateInspectorCurrent() {
  if (!inspectorRefs) return;
  let text = "—";
  if (state.isPlaying) {
    const result = computeTrackPassFraction(inspectorRefs.trackId);
    if (result && result.cycleId === inspectorRefs.cycleId) {
      text = `${result.repeatIndex + 1} / ${result.repeat}`;
    }
  }
  if (inspectorRefs.currentValueEl.textContent !== text) {
    inspectorRefs.currentValueEl.textContent = text;
  }
}

// Maps the playing position onto the EDIT lane, which also contains PASS
// segments: the playback loop skips those, so the lane playhead is placed
// from the sounding cycle's own segment offset.
function updateCycleVisuals(absoluteBeat) {
  state.tracks.forEach((track) => {
    const refs = playheadRefs[track.id];
    const lane = laneRefs[track.id];
    if (!refs || !lane) return;
    const result = computeTrackPassFraction(track.id, absoluteBeat);
    const activeGroupId = state.isPlaying && result ? result.groupId : null;
    // The lane draws a group's cycles as a single pass regardless of
    // repeat index (see laneBeatForPosition), so every repetition
    // highlights that same drawn cycle — the same as a plain cycle's
    // own repeat already does.
    const activeCycleId = state.isPlaying && result ? result.cycleId : null;

    Object.entries(refs.segmentEls).forEach(([itemId, el]) => {
      if (!el) return;
      if (el.classList.contains("cycle-group")) {
        el.classList.toggle("is-current-group", itemId === activeGroupId);
        return;
      }
      el.classList.toggle("is-current-cycle", itemId === activeCycleId);
    });

    // Only the sounding cycle receives its current repeat's visual
    // transform. Everything else (and every stopped lane) remains at
    // repeat zero so the authored pattern is easy to edit.
    Object.entries(refs.patternRefs || {}).forEach(([cycleId, pattern]) => {
      const cycle = findCycle(track, cycleId);
      if (!cycle) return;
      const visualRepeatIndex = cycleId === activeCycleId && result ? result.cycleRepeatIndex : 0;
      if (pattern.renderedCycleRepeatIndex !== visualRepeatIndex) {
        renderLanePatternVisual(track, cycle, visualRepeatIndex);
      }
    });

    const laneBeat = laneBeatForPosition(track, lane.layout, result);
    if (laneBeat !== null) {
      lane.playhead.classList.remove("is-inactive");
      lane.playhead.style.left = `${beatToPixel(laneBeat)}px`;
    } else {
      lane.playhead.classList.add("is-inactive");
    }
  });
  updateInspectorCurrent();
}

function updateTimelinePlayheads(absoluteBeat) {
  if (timelineViewState.mode === "common") {
    if (!timelineGlobalPlayhead) return; // no common cycle: nothing to point at
    const commonCycle = computeCommonCycleBeatsNumber(state.tracks);
    if (commonCycle <= 0) {
      timelineGlobalPlayhead.classList.add("is-inactive");
      return;
    }
    const localBeat = ((absoluteBeat % commonCycle) + commonCycle) % commonCycle;
    const x = timelineBeatToPixel(localBeat);
    timelineGlobalPlayhead.classList.remove("is-inactive");
    // transform rather than left: this runs every animation frame.
    timelineGlobalPlayhead.style.transform = `translateX(${x}px)`;
    followTimelinePlayhead(x);
    return;
  }

  state.tracks.forEach((track) => {
    const refs = timelineTrackRefs[track.id];
    if (!refs) return;
    const result = computeTrackPassFraction(track.id, absoluteBeat);
    if (!result) {
      refs.playhead.classList.add("is-inactive");
      return;
    }
    // Advancing to the next cycle can change the division (4/5 -> 4/7),
    // so the grid is rebuilt alongside the hits whenever either the
    // cycle or its division differs from what is on screen.
    const cycle = findCycle(track, result.cycleId);
    const visualRepeatIndex = state.isPlaying ? result.cycleRepeatIndex : 0;
    if (
      cycle &&
      (refs.renderedCycleId !== cycle.id ||
        refs.renderedDivision !== cycle.division ||
        (phaseDependsOnRepeat(cycle) && refs.renderedCycleRepeatIndex !== visualRepeatIndex))
    ) {
      rebuildLocalTrackContent(track, refs, cycle, visualRepeatIndex);
    }
    refs.playhead.classList.remove("is-inactive");
    // The cursor always reports elapsed position. Phase rotates the
    // rendered grid and hits underneath it instead of moving this line.
    const barBeats = refs.totalBeats > 0 ? refs.totalBeats : 1;
    refs.playhead.style.left = `${(result.offsetInCycleBeats / barBeats) * 100}%`;
  });
}

// Called right after any re-render so a fresh DOM never flashes at 0.
function updateAllPlayheadsImmediately() {
  const absoluteBeat = getTransportBeat();
  updateTimelinePlayheads(absoluteBeat);
  updateCycleVisuals(absoluteBeat);
}

function stopAllScheduledAudio() {
  scheduledAudioNodes.forEach((node) => node.stop());
  scheduledAudioNodes = [];
}

function clearHitFlashes() {
  Object.values(playheadRefs).forEach((refs) => {
    Object.values(refs.hitEls).forEach((hitMap) => {
      Object.values(hitMap).forEach((el) => el.classList.remove("is-playing"));
    });
  });
}

/* One button, two jobs: it offers the action you can take, not the state
   you are in. A disabled PLAY during playback would waste the most
   prominent control in the bar on saying nothing. */
function updateTransportUI() {
  const playing = state.isPlaying;
  playBtnEl.textContent = playing ? "PAUSE" : "PLAY";
  playBtnEl.setAttribute("aria-label", playing ? "Pause" : "Play");
}

function animateTimeline() {
  if (!audioCtx) return;
  const absoluteBeat = getTransportBeat();
  updateTimelinePlayheads(absoluteBeat);
  updateCycleVisuals(absoluteBeat);
  if (state.isPlaying) {
    timelineAnimationId = requestAnimationFrame(animateTimeline);
  }
}

function startPlayback() {
  if (state.isPlaying) return; // guard against double-start
  ensureAudioContext();
  if (audioCtx.state === "suspended") {
    audioCtx.resume().then(() => {
      // resume() is async; if the clock had not started ticking yet, the
      // anchor below was taken against a frozen currentTime. Re-anchor so
      // the first pass isn't compressed by however long resume took.
      if (!transport.isRunning) return;
      if (audioCtx.currentTime > transport.anchorAudioTime) return; // already running
      transport.anchorAudioTime = audioCtx.currentTime + START_DELAY;
      rebuildSchedulingFromTransport();
    });
  }

  // Resume from wherever the transport was left, not from zero.
  transport.anchorBeat = transport.positionBeats;
  transport.anchorAudioTime = audioCtx.currentTime + START_DELAY;
  transport.tempo = state.tempo;
  transport.isRunning = true;
  state.isPlaying = true;

  playbackGeneration += 1;
  pendingEvents = [];
  schedulerCursorBeat = {};
  schedulerFloorBeat = {};
  stopAllScheduledAudio();

  rebuildSchedulingFromTransport();
  if (timelineAnimationId) cancelAnimationFrame(timelineAnimationId);
  timelineAnimationId = requestAnimationFrame(animateTimeline);
  updateTransportUI();
}

/* PAUSE. Freezes the transport exactly where it is, so PLAY resumes
   from the same beat — the counterpart to STOP, which rewinds. Every
   scheduler queue and committed-but-unsounded node is torn down here
   too, because a pause that let already-scheduled audio fire would put
   hits after the playhead had stopped. */
function pausePlayback() {
  transport.positionBeats = getTransportBeat();
  transport.isRunning = false;
  state.isPlaying = false;

  playbackGeneration += 1; // invalidates pending visual callbacks and stale events
  if (schedulerTimerId) {
    clearTimeout(schedulerTimerId);
    schedulerTimerId = null;
  }
  if (timelineAnimationId) {
    cancelAnimationFrame(timelineAnimationId);
    timelineAnimationId = null;
  }
  pendingEvents = [];
  schedulerCursorBeat = {};
  schedulerFloorBeat = {};
  stopAllScheduledAudio();
  clearHitFlashes();
  updateAllPlayheadsImmediately();
  updateTransportUI();
}

function seekTransportToBeat(targetBeat) {
  const safeBeat = Math.max(0, targetBeat);

  if (transport.isRunning) {
    transport.anchorBeat = safeBeat;
    transport.anchorAudioTime = (audioCtx ? audioCtx.currentTime : 0) + START_DELAY;
    transport.positionBeats = safeBeat;
  } else {
    transport.positionBeats = safeBeat;
    transport.anchorBeat = safeBeat;
  }

  // New generation so any already-committed event cannot double-fire.
  playbackGeneration += 1;
  stopFutureScheduledAudio();
  pendingEvents = [];
  schedulerCursorBeat = {};
  schedulerFloorBeat = {};

  rebuildSchedulingFromTransport();
  updateAllPlayheadsImmediately();
}

/* STOP = stop playing AND return to the start. It is deliberately not a
   second kind of pause: PAUSE is the one that holds position, so STOP
   is free to mean "back to the top", which is the only other thing a
   transport needs. The sequence, selection, draft text and tempo are
   untouched — this moves time, not music, which is why it records no
   history. See initializeSequence() for the one that throws the music
   away.

   Toggling PLAY back on after a STOP therefore starts from beat 0. */
function stopPlayback() {
  pausePlayback();
  seekTransportToBeat(0);
  rewindTimelineViewIfFollowing();
  updateTransportUI();
}

/* FOLLOW drives the timeline view only while playing, so after a STOP
   nothing would put the view back — it would sit wherever the last
   played beat left it while the playhead is at 0, off screen to the
   left. Rewinding it here keeps FOLLOW's promise that the playhead is
   the thing you are looking at.

   FOLLOW OFF means the user owns the scroll position, so it is left
   alone. The target is computed rather than hardcoded to 0 so it stays
   whatever FOLLOW itself would choose for beat 0. */
function rewindTimelineViewIfFollowing() {
  if (!timelineViewState.autoFollow) return;
  if (timelineViewState.mode !== "common") return;
  const viewport = timelineScrollViewportEl;
  if (!viewport) return;
  const target = followScrollLeftForCurrentBeat(timelineViewState.pixelsPerBeat);
  viewport.scrollLeft = target;
  timelineViewState.commonScrollLeft = viewport.scrollLeft;
  // The write above is ours, not the user's — see followTimelinePlayhead().
  resetFollowScrollTracking();
}

// The PLAY button is a toggle; STOP is the separate control.
function togglePlayback() {
  if (state.isPlaying) pausePlayback();
  else startPlayback();
}

/* ===== INITIALIZE =====
   Where STOP rewinds time, INITIALIZE discards the sequence. Because it
   replaces the applied state outright it is NOT gated by
   canMutateFromGui() — there is no unapplied draft worth protecting
   when the user has just asked for a blank slate.
*/

let isInitializing = false;

/* No confirmation dialog (Phase 1.9H). INITIALIZE is one undo step, so
   the answer to "are you sure?" is Cmd+Z — and a modal that interrupts
   every use to guard against a mistake that costs one keystroke to fix
   is a worse trade than the mistake. */
function initializeSequence() {
  if (isInitializing) return false;
  isInitializing = true;
  try {
    // Stop first: this clears the scheduler timer, the animation frame,
    // the pending queue and every audio node that was committed but has
    // not sounded yet, so nothing from the old sequence can fire after.
    // It also puts the transport at 0, which is where INITIALIZE starts.
    stopPlayback();

    const fresh = createInitialState();
    state.tempo = fresh.tempo;
    transport.tempo = fresh.tempo;
    tempoInputEl.value = String(fresh.tempo);

    replaceSequenceState(fresh.tracks, {
      // The fresh cycles carry ids straight from createInitialState();
      // reconciling them against the old sequence would be meaningless.
      reconcileIds: false,
      preserveSelection: false,
      resetTransport: true,
      resetScroll: true,
    });
    updateTransportUI();
    return true;
  } finally {
    isInitializing = false;
  }
}

/* Changes the rate without recording history — the shared half of every
   path that can set the tempo: the GUI field, a DSL apply carrying a bpm
   line, a LOAD, and an undo putting one back. Returns whether anything
   moved, so callers can skip the work when the value is unchanged. */
function setTempo(newTempo) {
  if (newTempo === state.tempo) return false;

  // Re-anchor at the current beat first, so only the rate changes.
  const currentBeat = getTransportBeat();
  transport.anchorBeat = currentBeat;
  transport.anchorAudioTime = audioCtx ? audioCtx.currentTime : 0;
  transport.tempo = newTempo;
  transport.positionBeats = currentBeat;
  state.tempo = newTempo;
  if (tempoInputEl) tempoInputEl.value = String(newTempo);

  playbackGeneration += 1;
  pendingEvents = [];
  schedulerCursorBeat = {};
  schedulerFloorBeat = {};
  stopFutureScheduledAudio();
  rebuildSchedulingFromTransport();
  return true;
}

/* The GUI tempo field. BPM is part of the SEQUENCE TEXT now (Phase
   1.9I), so changing it here rewrites that text exactly as any other GUI
   edit does — which is also why it is one undo step. */
function handleTempoChange(newTempo) {
  if (!setTempo(newTempo)) return;
  syncTextFromState();
  // Skipped while restoring, because there the new tempo IS the
  // snapshot being put back.
  commitHistoryStep();
}

/* ===== Common Timeline seek =====
   Seeking is a transport operation, not a structural edit, so it stays
   available even while the text draft has unapplied changes.
*/

let isTimelineSeeking = false;

// The seek position is read from the CONTENT element's own rect, which
// already accounts for how far the viewport is scrolled — adding
// scrollLeft on top of that would double-count it.
function seekFromCommonTimelineEvent(e) {
  const commonCycle = computeCommonCycleBeatsNumber(state.tracks);
  if (commonCycle <= 0) return; // nothing to seek within

  const rect = timelineContentEl.getBoundingClientRect();
  const contentX = e.clientX - rect.left;
  // Never rounded: at 64 px/beat one pixel is 1/64 of a beat, and that
  // precision is the whole point of zooming in.
  const targetCommonBeat = clamp(timelinePixelToBeat(contentX), 0, commonCycle);

  const currentBeat = getTransportBeat();
  const lap = Math.floor(currentBeat / commonCycle);
  seekTransportToBeat(lap * commonCycle + targetCommonBeat);
}

function handleTimelinePointerDown(e) {
  if (timelineViewState.mode !== "common") return; // Local view is not seekable
  if (computeCommonCycleBeatsNumber(state.tracks) <= 0) return;
  if (!timelineContentEl.contains(e.target)) return;
  e.preventDefault();
  isTimelineSeeking = true; // suspends FOLLOW for the duration of the drag
  seekFromCommonTimelineEvent(e);

  function onMove(moveEvent) {
    if (!isTimelineSeeking) return;
    seekFromCommonTimelineEvent(moveEvent);
  }
  function onUp() {
    isTimelineSeeking = false;
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
  }
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

/* ===== Global keyboard =====
   Only two keys, and only when the user is not typing into a field —
   arrow keys are deliberately NOT bound to MOVE, so they stay free for
   normal caret and scroll behaviour.
*/

function isEditableElement(element) {
  if (!element) return false;
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element.isContentEditable === true
  );
}

function handleGlobalKeydown(e) {
  // Inside a text field the browser's own undo stack is the right one —
  // in particular the SEQUENCE TEXT area, whose draft is not part of
  // this history at all.
  if (isEditableElement(e.target)) return;

  // Cmd on macOS, Ctrl elsewhere; Ctrl+Y is accepted as the Windows
  // convention for redo.
  const modifier = e.metaKey || e.ctrlKey;
  if (modifier && (e.key === "z" || e.key === "Z")) {
    e.preventDefault();
    if (e.shiftKey) performRedo();
    else performUndo();
    return;
  }
  if (modifier && !e.shiftKey && (e.key === "y" || e.key === "Y")) {
    e.preventDefault();
    performRedo();
    return;
  }

  /* Duplicate / Copy / Paste. Each only claims its key when it has
     something to do — with no selection, Cmd+C still copies whatever
     text the user highlighted on the page, and Cmd+D still bookmarks.
     Taking a browser shortcut away to then do nothing is worse than not
     binding it. */
  if (modifier && !e.shiftKey && (e.key === "d" || e.key === "D")) {
    if (selectionState.items.length === 0) return;
    e.preventDefault();
    if (duplicateSelection()) syncTextSelectionFromState();
    return;
  }
  if (modifier && !e.shiftKey && (e.key === "c" || e.key === "C")) {
    if (selectionState.items.length === 0) return;
    e.preventDefault();
    copySelection();
    return;
  }
  if (modifier && !e.shiftKey && (e.key === "v" || e.key === "V")) {
    if (clipboardState.items.length === 0) return;
    e.preventDefault();
    if (pasteClipboard()) syncTextSelectionFromState();
    return;
  }

  if (e.key === "Escape") {
    if (selectionState.items.length === 0) return;
    clearSelection();
    refreshSelectionVisuals();
    return;
  }

  if (e.key === "Delete" || e.key === "Backspace") {
    if (selectionState.items.length === 0) return;
    e.preventDefault();
    deleteSelection();
  }
}

/* ===== Initialization ===== */

function wireEventListeners() {
  playBtnEl.addEventListener("click", togglePlayback);
  stopBtnEl.addEventListener("click", stopPlayback);
  initializeBtnEl.addEventListener("click", initializeSequence);
  undoBtnEl.addEventListener("click", performUndo);
  redoBtnEl.addEventListener("click", performRedo);

  tempoInputEl.addEventListener("change", () => {
    let value = parseInt(tempoInputEl.value, 10);
    if (!Number.isInteger(value)) value = state.tempo;
    value = clamp(value, MIN_TEMPO, MAX_TEMPO);
    tempoInputEl.value = String(value);
    if (value === state.tempo) return; // clamped back to where it was
    // BPM lives in the SEQUENCE TEXT now, so this is a text-rewriting
    // edit like any other and is blocked by an unapplied draft.
    if (!canMutateFromGui()) {
      tempoInputEl.value = String(state.tempo);
      return;
    }
    handleTempoChange(value); // re-anchors so the current beat does not jump
  });

  tracksContainerEl.addEventListener("click", handleTracksClick);

  inspectorBarEl.addEventListener("click", handleInspectorClick);
  inspectorBarEl.addEventListener("change", handleInspectorChange);

  sequenceTextEl.addEventListener("input", handleSequenceTextInput);
  sequenceTextEl.addEventListener("keydown", handleSequenceTextKeydown);
  // pointerdown runs before the button takes focus, so button-triggered
  // APPLY can restore the textarea just like Enter / Cmd+Enter does.
  applySequenceBtnEl.addEventListener("pointerdown", () => {
    if (!applySequenceBtnEl.disabled) pendingApplyTextareaState = captureApplyTextareaState();
  });
  applySequenceBtnEl.addEventListener("click", applyDraftSequence);
  revertSequenceBtnEl.addEventListener("click", revertDraftSequence);
  saveProjectBtnEl.addEventListener("click", saveProjectFile);
  loadProjectBtnEl.addEventListener("click", openProjectFilePicker);
  projectFileInputEl.addEventListener("change", handleProjectFileChange);

  timelineViewToggleEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".view-toggle-btn");
    if (!btn) return;
    setTimelineViewMode(btn.dataset.view);
  });

  zoomOutBtnEl.addEventListener("click", () => zoomTimelineStep(-1));
  zoomInBtnEl.addEventListener("click", () => zoomTimelineStep(1));
  zoomFitBtnEl.addEventListener("click", setTimelineFitMode);
  zoomOneToOneBtnEl.addEventListener("click", setTimelineOneToOne);
  timelineFollowBtnEl.addEventListener("click", toggleTimelineFollow);

  timelineScrollViewportEl.addEventListener("pointerdown", handleTimelinePointerDown);

  // Scrolling records the position and nothing else: re-rendering on
  // every scroll event would make the timeline unusable.
  timelineScrollViewportEl.addEventListener("scroll", () => {
    if (timelineViewState.mode === "common") captureTimelineScroll();
  }, { passive: true });

  // Alt+Wheel zooms around the pointer. Ctrl/Cmd+Wheel is deliberately
  // left alone because browsers use it for page zoom.
  timelineScrollViewportEl.addEventListener("wheel", handleTimelineWheel, { passive: false });

  window.addEventListener("resize", handleWindowResize);

  document.addEventListener("keydown", handleGlobalKeydown);
}

function init() {
  tracksContainerEl = document.getElementById("tracksContainer");
  inspectorBarEl = document.getElementById("inspectorBar");
  sequenceTextEl = document.getElementById("sequenceText");
  statusMessageEl = document.getElementById("statusMessage");
  playBtnEl = document.getElementById("playBtn");
  stopBtnEl = document.getElementById("stopBtn");
  initializeBtnEl = document.getElementById("initializeBtn");
  undoBtnEl = document.getElementById("undoBtn");
  redoBtnEl = document.getElementById("redoBtn");
  tempoInputEl = document.getElementById("tempoInput");
  commonCycleValueEl = document.getElementById("commonCycleValue");
  timelineViewToggleEl = document.getElementById("timelineViewToggle");
  timelineLabelColumnEl = document.getElementById("timelineLabelColumn");
  timelineScrollViewportEl = document.getElementById("timelineScrollViewport");
  timelineContentEl = document.getElementById("timelineContent");
  timelineZoomControlsEl = document.getElementById("timelineZoomControls");
  zoomOutBtnEl = document.getElementById("zoomOutBtn");
  zoomInBtnEl = document.getElementById("zoomInBtn");
  zoomFitBtnEl = document.getElementById("zoomFitBtn");
  zoomOneToOneBtnEl = document.getElementById("zoomOneToOneBtn");
  timelineZoomValueEl = document.getElementById("timelineZoomValue");
  timelineFollowBtnEl = document.getElementById("timelineFollowBtn");
  draftStatusEl = document.getElementById("draftStatus");
  applySequenceBtnEl = document.getElementById("applySequenceBtn");
  revertSequenceBtnEl = document.getElementById("revertSequenceBtn");
  saveProjectBtnEl = document.getElementById("saveProjectBtn");
  loadProjectBtnEl = document.getElementById("loadProjectBtn");
  projectFileInputEl = document.getElementById("projectFileInput");

  transport.tempo = state.tempo;

  // Minimal read-only surface for automated tests / debugging.
  window.cycleSeq = {
    getTransportBeat,
    resolveTrackPositionAtBeat,
    computeTrackLoopLength,
    computeTrackLoopLengthNumber,
    computeCommonCycle,
    computeCommonCycleBeatsNumber,
    leastCommonRational,
    getCyclesCommonLength,
    getCycleRelationship,
    getTrackCycleRelationship,
    parseRationalSpan,
    parseRationalCycleLength,
    parseRationalOffset,
    formatSignedRational,
    computeCycleLength,
    computeCycleLengthNumber,
    updateCycleOffset,
    parseHitSpec,
    generateAllHits,
    ratchetCountForHit,
    expandCycleHitEvents,
    parsePhaseSpec,
    phaseToCanonicalToken,
    serializePhaseToken,
    phaseShiftForRepeat,
    resolveCyclePhase,
    shiftedCyclePlayheadBeat,
    updateCyclePhase,
    hitBeatOffset,
    hitLimitBeats,
    isHitWithinCycle,
    maxHitPositionExclusive,
    trimInvalidHits,
    resyncCycleHits,
    countAllHits,
    hitsCoverAllGrid,
    serializeCycleToken,
    updateCycleDivision,
    performUndo,
    performRedo,
    canUndo,
    canRedo,
    captureSnapshot,
    adoptRestoredIds,
    handleTempoChange,
    get undoStack() {
      return undoStack;
    },
    get redoStack() {
      return redoStack;
    },
    get presentSnapshot() {
      return presentSnapshot;
    },
    HISTORY_LIMIT,
    rationalToString,
    rationalToNumber,
    createRational,
    equalRational,
    addRational,
    subtractRational,
    multiplyRational,
    modRational,
    rationalFromDecimalString,
    findTrack,
    seekTransportToBeat,
    startPlayback,
    pausePlayback,
    stopPlayback,
    togglePlayback,
    rewindTimelineViewIfFollowing,
    getSelectedCycles,
    getSelectedGroups,
    getSelectedCyclesByTrack,
    getFlatCycles,
    findGroup,
    findGroupContainingCycle,
    findCycleLocation,
    isCycleInsideGroup,
    isGroupSelected,
    groupSelectionItem,
    cycleSelectionItem,
    setSingleSelectionItem,
    analyzeGroupCreation,
    createGroupFromSelection,
    analyzeAddToGroup,
    addSelectedCyclesToGroup,
    reorderSequenceItem,
    resolveCycleDropTarget,
    moveCycleToDropTarget,
    groupResizeCandidates,
    computeGroupResizeCount,
    applyGroupResize,
    groupInnerSegments,
    topLevelItemAtLaneX,
    topLevelLaneItems,
    insertionIndexAtLaneX,
    insertionBoundaryBeat,
    refreshSelectionVisuals,
    addSelection,
    addSelectionItem,
    analyzeRemoveFromGroup,
    removeSelectedCycleFromGroup,
    dissolveUndersizedGroups,
    cloneCycleWithNewId,
    cloneSequenceItemWithNewIds,
    selectionStructureUnits,
    duplicateSelection,
    copySelection,
    pasteClipboard,
    resolvePasteTarget,
    canPaste,
    get clipboardState() {
      return clipboardState;
    },
    addCycle,
    deleteSelection,
    updateSelectedGroupRepeat,
    ungroupSelectedGroup,
    computeGroupBaseLength,
    computeGroupTotalLength,
    computeLaneLayout,
    laneBeatForPosition,
    computeTrackTimeline,
    walkTrackPasses,
    get globalGroupIdCounter() {
      return globalGroupIdCounter;
    },
    getSelectionPassState,
    analyzeMoveSelection,
    analyzeDeleteSelection,
    getTextRangeForSelection,
    isCycleSelected,
    clearSelection,
    setSingleSelection,
    initializeSequence,
    timelineBeatToPixel,
    timelinePixelToBeat,
    computeFitPixelsPerBeat,
    computeFollowScrollLeft,
    followScrollLeftForCurrentBeat,
    followTimelinePlayhead,
    isFollowActive,
    isFollowSuspended,
    noteManualTimelineScroll,
    resetFollowScrollTracking,
    toggleTimelineFollow,
    applyTimelineZoom,
    zoomTimelineStep,
    setTimelineFitMode,
    setTimelineOneToOne,
    FOLLOW_PLAYHEAD_RATIO,
    FOLLOW_RESUME_DELAY_MS,
    chooseRulerStep,
    formatPixelsPerBeat,
    renderTimelineStructure,
    get timelineViewState() {
      return timelineViewState;
    },
    get timelineGlobalPlayhead() {
      return timelineGlobalPlayhead;
    },
    get isTimelineSeeking() {
      return isTimelineSeeking;
    },
    cycleSimilarity,
    cycleContentSignature,
    reconcileCycleIds,
    serializeSequence,
    parseSequenceText,
    setTempo,
    handleTempoChange,
    buildProjectSaveText,
    buildProjectFileName,
    saveProjectFile,
    openProjectFilePicker,
    loadProjectText,
    handleProjectFileChange,
    DEFAULT_TEMPO,
    MIN_TEMPO,
    MAX_TEMPO,
    get editorState() {
      return editorState;
    },
    get globalCycleIdCounter() {
      return globalCycleIdCounter;
    },
    get scheduledAudioNodes() {
      return scheduledAudioNodes;
    },
    get selectionState() {
      return selectionState;
    },
    get state() {
      return state;
    },
    get transport() {
      return transport;
    },
    get schedulerTimerId() {
      return schedulerTimerId;
    },
    get pendingEvents() {
      return pendingEvents;
    },
  };

  renderApp();
  syncTextFromState();
  updateCommonCycleDisplay();
  updateViewToggleButtons();
  renderTimeline();
  updateAllPlayheadsImmediately();
  wireEventListeners();

  // The starting structure is the first "present": the first edit pushes
  // this, so the very first undo lands back on the initial sequence.
  presentSnapshot = captureSnapshot();
  updateHistoryButtons();
}

init();
