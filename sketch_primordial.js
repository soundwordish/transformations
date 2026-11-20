// =========================================================
// TRANSMUTATIONS — HOPKINS PRIMORDIAL GENESIS & DISSOLUTION
// Stage 0 (Atomic -> Fuse) -> Stage 1 (4x Incantation) -> Hopkins -> Words -> Syntax (4x Slow Incantation) -> Dissolution -> Fracture -> Loop
// =========================================================

const NUM_PHONEMES = 52;           // ~13 words worth of raw phonemes
const INCANTATION_REPEATS = 4;     // Repeats for both the primordial wall and the peak sentence
const ALIGNMENT_STEPS = 16;        // Steps from 0% to 100% Hopkins alignment
const REPLACEMENTS_PER_STEP = 4;   // Phonemes shifted per alignment step
const HEALS_PER_STEP = 3;          // Words healed by 1 letter per crystallization step
const SHATTER_ON_NEW_CYCLE = true; // Cycle 2+ shatters back to separated atomic phonemes

let hopkinsData, phonemeData, posVocabCache;

// Playback State
let isPlaying = false;
let trajectory = [];
let activeIdx = 0;
let cycleNumber = 1;
let stackedPeaks = [];             // Accumulates constructed sentences at top until space runs out

// Voice Cast State
let availableVoices = [];
let currentVoice = null;

// Timing Clock (Native Browser Speech Synthesis)
let genStartMs = 0;
let genDurationMs = 6000;
let isAudioSpeaking = false;
const PAUSE_BETWEEN_GENS_MS = 240;

// >>> FONT SIZE & LAYOUT SETTINGS <<<
const MARGIN_X = 90;
const FONT_SIZE = 32;              // Main middle crucible font size
const LINE_HEIGHT = 46;            // Line spacing for middle crucible
const STACK_FONT_SIZE = 22;        // Top stacked archive font size
const STACK_LINE_HEIGHT = 32;      // Line spacing for top stack
const STACK_GAP = 14;
const TOP_STACK_START_Y = 95;

// 39 ARPAbet Phonemes -> Readable Graphemes
const ARPABET_TO_TEXT = {
  'P': 'p', 'B': 'b', 'T': 't', 'D': 'd', 'K': 'k', 'G': 'g',
  'CH': 'ch', 'JH': 'j', 'F': 'f', 'V': 'v', 'TH': 'th', 'S': 's', 'SH': 'sh',
  'DH': 'th', 'Z': 'z', 'ZH': 'zh', 'HH': 'h', 'M': 'm', 'N': 'n',
  'NG': 'ng', 'L': 'l', 'R': 'r', 'W': 'w', 'Y': 'y',
  'AA': 'a', 'AE': 'a', 'AH': 'u', 'AO': 'au', 'AW': 'ow', 'AY': 'ai',
  'EH': 'e', 'ER': 'er', 'EY': 'ei', 'IH': 'i', 'IY': 'ee', 'OW': 'o',
  'OY': 'oy', 'UH': 'oo', 'UW': 'oo'
};

const ALL_PHONEMES = Object.keys(ARPABET_TO_TEXT);
const HARD_PHONEMES = new Set(['P', 'B', 'T', 'D', 'K', 'G', 'CH', 'JH', 'F', 'V', 'TH', 'SH']);
const SOFT_AND_VOWELS = new Set(ALL_PHONEMES.filter(k => !HARD_PHONEMES.has(k)));

const FUNCTION_POOLS = {
  'ADP': ["in", "on", "of", "to", "by", "for", "with", "from", "into", "upon", "over", "under", "amid", "unto", "through", "beneath", "beyond"],
  'DET': ["the", "a", "an", "this", "that", "each", "some", "no", "any", "every", "all", "thy", "my", "our"],
  'PRON': ["i", "you", "we", "they", "it", "he", "she", "me", "us", "them", "who", "what", "one"],
  'AUX': ["is", "are", "was", "were", "be", "been", "will", "would", "shall", "should", "may", "might", "can", "could", "must"],
  'CCONJ': ["and", "or", "but", "yet", "nor", "so", "for"],
  'SCONJ': ["as", "if", "when", "while", "though", "until", "once", "since", "where"]
};

// Syntactic skeleton for ~13 emerging words
const BASE_POS_TEMPLATE = [
  'DET', 'ADJ', 'NOUN', 'VERB', 'ADP', 'DET', 'NOUN',
  'CCONJ', 'VERB', 'ADP', 'DET', 'ADJ', 'NOUN'
];

function preload() {
  hopkinsData = loadJSON('sprung_probabilities.json');
  phonemeData = loadJSON('phoneme_probabilities.json');
  posVocabCache = loadJSON('pos_vocab_cache.json');
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont('Georgia');
  textSize(FONT_SIZE);
  textAlign(LEFT, BASELINE);

  initVoiceCast();
  buildFullArcTrajectory(true);
}

// =========================================================
// VOICE CAST MANAGEMENT (ONE DISTINCT VOICE PER CYCLE)
// =========================================================

function initVoiceCast() {
  if (!('speechSynthesis' in window)) return;

  const loadVoices = () => {
    let all = window.speechSynthesis.getVoices();
    if (!all || all.length === 0) return;

    let english = all.filter(v => v.lang && v.lang.toLowerCase().startsWith('en'));
    let pool = english.length > 0 ? english : all;

    if (availableVoices.length === 0) {
      availableVoices = sampleArray(pool, pool.length);
      selectVoiceForCycle(cycleNumber);
      console.log(`Loaded ${availableVoices.length} English voices for cycling.`);
    }
  };

  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function selectVoiceForCycle(cycleNum) {
  if (availableVoices.length === 0) {
    currentVoice = null;
    return;
  }
  let idx = (cycleNum - 1) % availableVoices.length;
  currentVoice = availableVoices[idx];
  console.log(`Cycle ${cycleNum} voice: ${currentVoice.name} (${currentVoice.lang})`);
}

// =========================================================
// START OVERLAY & STOP/RESTART INTERACTION
// =========================================================

function handleOverlayClick() {
  if (!isPlaying) {
    let overlay = document.getElementById('start-overlay');
    if (overlay) overlay.classList.add('hidden');

    if (availableVoices.length > 0 && !currentVoice) {
      selectVoiceForCycle(cycleNumber);
    }
    isPlaying = true;
    activeIdx = 0;
    triggerStepAudio(trajectory[activeIdx]);
  }
}

function mousePressed() {
  if (isPlaying) {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    isPlaying = false;
    isAudioSpeaking = false;
    cycleNumber = 1;
    stackedPeaks = [];
    activeIdx = 0;
    if (availableVoices.length > 1) {
      availableVoices = sampleArray(availableVoices, availableVoices.length);
    }
    selectVoiceForCycle(cycleNumber);
    buildFullArcTrajectory(true);

    let overlay = document.getElementById('start-overlay');
    if (overlay) overlay.classList.remove('hidden');
  }
}

// =========================================================
// GENERATIVE ENGINE: STAGE 0 -> 1 -> 2 -> 3 -> 4 (4x) -> 5 -> FRACTURE
// =========================================================

function buildFullArcTrajectory(includeAtomicOpening = true) {
  let forwardSteps = [];

  // Generate 52 Uniform Random Phonemes (0% Hopkins)
  let phonemeSeq = [];
  for (let i = 0; i < NUM_PHONEMES; i++) {
    phonemeSeq.push(ALL_PHONEMES[Math.floor(Math.random() * ALL_PHONEMES.length)]);
  }

  // -------------------------------------------------------
  // STAGE 0: ATOMIC PARTICLES (Separated by spaces -> Collapse to Wall)
  // -------------------------------------------------------
  if (includeAtomicOpening) {
    let collapseBreaks = new Set(Array.from({ length: NUM_PHONEMES - 1 }, (_, i) => i + 1));

    forwardSteps.push({
      stage: "Stage 0: Atomic Phonemes",
      phase: "atomic",
      alpha: 0.0,
      text: renderPhonemeStream(phonemeSeq, collapseBreaks),
      isPeak: false
    });

    const collapseSteps = 3;
    for (let step = 1; step <= collapseSteps; step++) {
      let currentBreaks = Array.from(collapseBreaks);
      let remainingLeaps = collapseSteps - step + 1;
      let toRemoveCount = Math.ceil(currentBreaks.length / remainingLeaps);
      let toRemove = sampleArray(currentBreaks, Math.min(toRemoveCount, currentBreaks.length));
      for (let b of toRemove) collapseBreaks.delete(b);

      if (collapseBreaks.size > 0) {
        forwardSteps.push({
          stage: "Stage 0: Fusing Wall",
          phase: "atomic",
          alpha: 0.0,
          text: renderPhonemeStream(phonemeSeq, collapseBreaks),
          isPeak: false
        });
      }
    }
  }

  // -------------------------------------------------------
  // STAGE 1: PRIMORDIAL WALL (4x Incantation)
  // -------------------------------------------------------
  let activeBreaks = new Set();
  let fusedWallText = renderPhonemeStream(phonemeSeq, activeBreaks);

  for (let r = 1; r <= INCANTATION_REPEATS; r++) {
    forwardSteps.push({
      stage: `Stage 1: Incantation (${r}/${INCANTATION_REPEATS})`,
      phase: "incantation",
      alpha: 0.0,
      incantationIndex: r,
      text: fusedWallText,
      isPeak: false
    });
  }

  // Pre-plan 12 word-break indices (creating 13 word-sized chunks of 3-5 phonemes)
  let breakIndices = [];
  let cursor = 0;
  for (let c = 0; c < BASE_POS_TEMPLATE.length - 1; c++) {
    let remainingChunks = BASE_POS_TEMPLATE.length - c;
    let remainingPhonemes = NUM_PHONEMES - cursor;
    let avg = Math.floor(remainingPhonemes / remainingChunks);
    let stepLen = constrain(avg + Math.floor(Math.random() * 3) - 1, 2, 6);
    cursor += stepLen;
    if (cursor < NUM_PHONEMES - 1) breakIndices.push(cursor);
  }
  let shuffledBreaks = sampleArray(breakIndices, breakIndices.length);

  // -------------------------------------------------------
  // STAGE 2: GRADUAL HOPKINS ALIGNMENT (0% -> 100%) + EMERGING SPACES
  // -------------------------------------------------------
  let currentStress = 'S';
  for (let s = 1; s <= ALIGNMENT_STEPS; s++) {
    let alpha = s / ALIGNMENT_STEPS;

    let indices = sampleArray(Array.from({ length: NUM_PHONEMES }, (_, i) => i), REPLACEMENTS_PER_STEP);
    for (let idx of indices) {
      let prevPh = idx > 0 ? phonemeSeq[idx - 1] : null;
      let probs = (hopkinsData && hopkinsData.transition_matrix && hopkinsData.transition_matrix[currentStress])
        ? hopkinsData.transition_matrix[currentStress]
        : { S: 0.5 };
      let targetStress = Math.random() < probs.S ? 'S' : 'U';

      phonemeSeq[idx] = pickBlendedPhoneme(alpha, targetStress, prevPh);
      currentStress = targetStress;
    }

    if (alpha >= 0.45 && shuffledBreaks.length > 0) {
      let breaksToAdd = Math.ceil(shuffledBreaks.length / Math.max(1, ALIGNMENT_STEPS - s + 1));
      for (let b = 0; b < breaksToAdd && shuffledBreaks.length > 0; b++) {
        activeBreaks.add(shuffledBreaks.pop());
      }
    }

    forwardSteps.push({
      stage: "Stage 2: Alignment",
      phase: "alignment",
      alpha: alpha,
      text: renderPhonemeStream(phonemeSeq, activeBreaks),
      isPeak: false
    });
  }

  while (shuffledBreaks.length > 0) activeBreaks.add(shuffledBreaks.pop());
  let protoText = renderPhonemeStream(phonemeSeq, activeBreaks);
  let protoWords = protoText.split(" ").filter(Boolean);

  // -------------------------------------------------------
  // STAGE 3: LEXICAL CRYSTALLIZATION (Proto-Words -> Valid Words)
  // -------------------------------------------------------
  let posSlots = protoWords.map((_, i) => BASE_POS_TEMPLATE[i % BASE_POS_TEMPLATE.length]);
  let bannedWords = new Set();
  let targetWords = protoWords.map((pw, i) => jsFindClosestWord(pw, posSlots[i], bannedWords));

  let currentWords = [...protoWords];
  let safetyCounter = 0;
  while (currentWords.join(" ") !== targetWords.join(" ") && safetyCounter < 45) {
    safetyCounter++;
    let unhealed = [];
    for (let i = 0; i < currentWords.length; i++) {
      if (currentWords[i] !== targetWords[i]) unhealed.push(i);
    }
    if (unhealed.length === 0) break;

    let chosen = sampleArray(unhealed, Math.min(HEALS_PER_STEP, unhealed.length));
    for (let idx of chosen) {
      currentWords[idx] = jsStepWordTowardTarget(currentWords[idx], targetWords[idx]);
    }

    forwardSteps.push({
      stage: "Stage 3: Lexical Crystallization",
      phase: "reconstruction",
      alpha: 1.0,
      text: currentWords.join(" "),
      isPeak: false
    });
  }

  // -------------------------------------------------------
  // STAGE 4: SYNTACTIC / ACOUSTIC COHESION + 4x SLOW PEAK INCANTATION
  // -------------------------------------------------------
  let wordSeq = [...currentWords];
  for (let c = 0; c < 6; c++) {
    let swapped = jsStepPosCohesion(wordSeq, posSlots);
    if (!swapped) break;
    forwardSteps.push({
      stage: "Stage 4: Poetic Cohesion",
      phase: "cohesion",
      alpha: 1.0,
      text: capitalizeSentence(wordSeq.join(" ")) + ".",
      isPeak: false
    });
  }

  let peakText = capitalizeSentence(wordSeq.join(" ")) + ".";

  for (let r = 1; r <= INCANTATION_REPEATS; r++) {
    forwardSteps.push({
      stage: `Stage 4: Peak Incantation (${r}/${INCANTATION_REPEATS})`,
      phase: "peak_incantation",
      alpha: 1.0,
      incantationIndex: r,
      text: peakText,
      isPeak: (r === 1)
    });
  }

  // -------------------------------------------------------
  // STAGE 5: GENERATIVE DISSOLUTION (Peak Sense -> New Wall -> Gradual Fracture)
  // -------------------------------------------------------
  let dissolutionSteps = [];

  // 5a. Un-ordering
  let dissolveWords = [...wordSeq];
  let contentPos = ['NOUN', 'VERB', 'ADJ'];
  for (let u = 0; u < 4; u++) {
    let targetPos = contentPos[u % contentPos.length];
    let indices = [];
    posSlots.forEach((p, idx) => {
      if (p === targetPos && idx < dissolveWords.length) indices.push(idx);
    });
    if (indices.length >= 2) {
      let [i, j] = sampleArray(indices, 2);
      [dissolveWords[i], dissolveWords[j]] = [dissolveWords[j], dissolveWords[i]];
      dissolutionSteps.push({
        stage: "Stage 5: Un-ordering",
        phase: "cohesion",
        alpha: 1.0,
        text: capitalizeSentence(dissolveWords.join(" ")) + ".",
        isPeak: false
      });
    }
  }

  // 5b. Lexical Melting (100% Hopkins)
  let meltingWords = [...dissolveWords];
  for (let m = 0; m < 8; m++) {
    let validIndices = meltingWords.map((_, i) => i).filter(i => meltingWords[i].length > 0);
    let chosen = sampleArray(validIndices, Math.min(3, validIndices.length));
    for (let idx of chosen) {
      let probs = (hopkinsData && hopkinsData.transition_matrix && hopkinsData.transition_matrix[currentStress])
        ? hopkinsData.transition_matrix[currentStress]
        : { S: 0.5 };
      let targetStress = Math.random() < probs.S ? 'S' : 'U';
      let newPh = pickBlendedPhoneme(1.0, targetStress, null);
      currentStress = targetStress;

      let chars = meltingWords[idx].split("");
      let mutPt = Math.floor(Math.random() * chars.length);
      chars[mutPt] = ARPABET_TO_TEXT[newPh];
      meltingWords[idx] = chars.join("");
    }

    dissolutionSteps.push({
      stage: "Stage 5: Lexical Melting",
      phase: "dissolution",
      alpha: 1.0,
      text: meltingWords.join(" "),
      isPeak: false
    });
  }

  // 5c. De-alignment (100% -> 0% Hopkins) & Wall Fusion
  let dissolveTokens = [];
  for (let i = 0; i < meltingWords.length; i++) {
    for (let ch of meltingWords[i]) dissolveTokens.push(ch);
    if (i < meltingWords.length - 1) dissolveTokens.push(" ");
  }

  for (let s = 1; s <= ALIGNMENT_STEPS; s++) {
    let alpha = 1.0 - (s / ALIGNMENT_STEPS);

    let letterIndices = [];
    dissolveTokens.forEach((tok, idx) => {
      if (tok !== " ") letterIndices.push(idx);
    });

    let chosen = sampleArray(letterIndices, Math.min(REPLACEMENTS_PER_STEP, letterIndices.length));
    for (let idx of chosen) {
      let probs = (hopkinsData && hopkinsData.transition_matrix && hopkinsData.transition_matrix[currentStress])
        ? hopkinsData.transition_matrix[currentStress]
        : { S: 0.5 };
      let targetStress = Math.random() < probs.S ? 'S' : 'U';
      let newPh = pickBlendedPhoneme(alpha, targetStress, null);
      currentStress = targetStress;

      dissolveTokens[idx] = ARPABET_TO_TEXT[newPh];
    }

    if (alpha <= 0.55) {
      let spaceIndices = [];
      dissolveTokens.forEach((tok, idx) => {
        if (tok === " ") spaceIndices.push(idx);
      });
      if (spaceIndices.length > 0) {
        let stepsLeft = Math.max(1, ALIGNMENT_STEPS - s + 1);
        let spacesToRemove = Math.ceil(spaceIndices.length / stepsLeft);
        let toRemove = sampleArray(spaceIndices, Math.min(spacesToRemove, spaceIndices.length)).sort((a, b) => b - a);
        for (let spIdx of toRemove) {
          dissolveTokens.splice(spIdx, 1);
        }
      }
    }

    dissolutionSteps.push({
      stage: alpha === 0 ? "Stage 5: Primordial Return" : "Stage 5: De-alignment",
      phase: "dissolution",
      alpha: alpha,
      text: dissolveTokens.join(""),
      isPeak: false
    });
  }

  // 5d. Gradual Fracturing (Halves -> Quarters -> Groups of 3-4) before Cycle 2 Atomizes
  if (SHATTER_ON_NEW_CYCLE) {
    let solidWall = dissolveTokens.filter(tok => tok !== " ");
    let n = solidWall.length;

    let halfPt = Math.floor(n / 2);
    let halvesStr = solidWall.slice(0, halfPt).join("") + " " + solidWall.slice(halfPt).join("");
    dissolutionSteps.push({
      stage: "Stage 5: Fracturing (Halves)",
      phase: "atomic",
      alpha: 0.0,
      text: halvesStr,
      isPeak: false
    });

    let q1 = Math.floor(n / 4);
    let q2 = Math.floor(n / 2);
    let q3 = Math.floor((3 * n) / 4);
    let quartersStr = [
      solidWall.slice(0, q1).join(""),
      solidWall.slice(q1, q2).join(""),
      solidWall.slice(q2, q3).join(""),
      solidWall.slice(q3).join("")
    ].join(" ");
    dissolutionSteps.push({
      stage: "Stage 5: Fracturing (Quarters)",
      phase: "atomic",
      alpha: 0.0,
      text: quartersStr,
      isPeak: false
    });

    let groups = [];
    let pos = 0;
    while (pos < n) {
      let chunkSize = Math.random() < 0.5 ? 3 : 4;
      groups.push(solidWall.slice(pos, pos + chunkSize).join(""));
      pos += chunkSize;
    }
    dissolutionSteps.push({
      stage: "Stage 5: Fracturing (Clusters)",
      phase: "atomic",
      alpha: 0.0,
      text: groups.join(" "),
      isPeak: false
    });
  }

  trajectory = [...forwardSteps, ...dissolutionSteps];
  console.log(`Cycle ${cycleNumber}: Generated ${trajectory.length} total steps.`);
}

function renderPhonemeStream(phonemeSeq, breakSet) {
  let out = "";
  for (let i = 0; i < phonemeSeq.length; i++) {
    if (breakSet.has(i)) out += " ";
    out += ARPABET_TO_TEXT[phonemeSeq[i]] || "";
  }
  return out.trim();
}

function pickBlendedPhoneme(alpha, targetStress, prevPh) {
  if (Math.random() > alpha) {
    return ALL_PHONEMES[Math.floor(Math.random() * ALL_PHONEMES.length)];
  }
  let rawWeights = {};
  if (phonemeData && phonemeData.transition_matrix && prevPh && phonemeData.transition_matrix[prevPh]) {
    rawWeights = phonemeData.transition_matrix[prevPh];
  } else if (phonemeData) {
    rawWeights = phonemeData.probabilities || phonemeData.distribution || phonemeData.phonemes || phonemeData;
  }

  let allowed = targetStress === 'S' ? HARD_PHONEMES : SOFT_AND_VOWELS;
  let pool = [];
  let weights = [];

  for (let [ph, w] of Object.entries(rawWeights)) {
    let cleanPh = ph.replace(/\d+/g, "").toUpperCase();
    if (ARPABET_TO_TEXT[cleanPh] && allowed.has(cleanPh) && typeof w === 'number' && w > 0) {
      pool.push(cleanPh);
      weights.push(w);
    }
  }

  if (pool.length === 0) {
    return ALL_PHONEMES[Math.floor(Math.random() * ALL_PHONEMES.length)];
  }

  let totalW = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * totalW;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[0];
}

// =========================================================
// NATIVE BROWSER SPEECH SYNTHESIS (WITH VOICE CAST & DRIFT)
// =========================================================

function triggerStepAudio(stepObj) {
  genStartMs = millis();
  isAudioSpeaking = true;

  let charMultiplier = (stepObj.phase === "atomic" || stepObj.phase === "peak_incantation") ? 115 : 75;
  let estimatedMs = Math.max(4800, stepObj.text.length * charMultiplier);
  genDurationMs = estimatedMs;

  let cleanSpoken = stepObj.text.replace(/[.!;?]+/g, ",");
  let spokenString = stepObj.phase === "atomic" ? cleanSpoken : makePronounceableForTTS(cleanSpoken);

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    let utter = new SpeechSynthesisUtterance(spokenString);

    if (currentVoice) {
      utter.voice = currentVoice;
    }

    if (stepObj.phase === "atomic") {
      utter.rate = 0.92;
      utter.pitch = 0.78;
    } else if (stepObj.phase === "incantation") {
      let drift = ((stepObj.incantationIndex || 1) - 1) / Math.max(1, INCANTATION_REPEATS - 1);
      utter.rate = lerp(0.82, 0.88, drift);
      utter.pitch = lerp(0.66, 0.72, drift);
    } else if (stepObj.phase === "peak_incantation") {
      // >>> SLOWED SEMANTIC SENTENCE INCANTATION <<<
      let drift = ((stepObj.incantationIndex || 1) - 1) / Math.max(1, INCANTATION_REPEATS - 1);
      utter.rate = lerp(0.76, 0.68, drift);
      utter.pitch = lerp(0.90, 0.82, drift);
    } else {
      utter.rate = lerp(0.84, 0.96, stepObj.alpha);
      utter.pitch = lerp(0.68, 0.92, stepObj.alpha);
    }

    utter.onend = () => {
      isAudioSpeaking = false;
      genDurationMs = (millis() - genStartMs) + PAUSE_BETWEEN_GENS_MS;
    };
    utter.onerror = () => {
      isAudioSpeaking = false;
    };

    window.speechSynthesis.speak(utter);
  } else {
    isAudioSpeaking = false;
  }
}

function makePronounceableForTTS(textStr) {
  return textStr.split(" ").map(word => {
    let clean = word.replace(/[^\w]/g, "").toLowerCase();
    if (clean.length >= 4 && !/[aeiouy]/.test(clean)) {
      let mid = Math.floor(clean.length / 2);
      return clean.slice(0, mid) + "e" + clean.slice(mid);
    }
    return word;
  }).join(" ");
}

// =========================================================
// STACK MANAGEMENT (AUTO-ERASE WHEN OUT OF SPACE)
// =========================================================

function addPeakToStack(newPeakText) {
  let maxWidth = width - MARGIN_X * 2;
  let maxStackBottomY = height * 0.52 - 55;

  let candidateStack = [...stackedPeaks, newPeakText];
  let totalHeight = measureStackHeight(candidateStack, maxWidth);

  if (TOP_STACK_START_Y + totalHeight > maxStackBottomY) {
    stackedPeaks = [newPeakText];
  } else {
    stackedPeaks = candidateStack;
  }
}

function measureStackHeight(peaksArray, maxWidth) {
  push();
  textSize(STACK_FONT_SIZE);
  textStyle(NORMAL);
  let yOffset = 0;
  for (let i = 0; i < peaksArray.length; i++) {
    let lines = wrapTextIntoLines(peaksArray[i], maxWidth);
    yOffset += lines.length * STACK_LINE_HEIGHT;
    if (i < peaksArray.length - 1) yOffset += STACK_GAP;
  }
  pop();
  return yOffset;
}

// =========================================================
// P5.JS DRAW LOOP (ENDLESS CYCLING)
// =========================================================

function draw() {
  background(17, 17, 16);

  if (!isPlaying) {
    return;
  }

  let elapsed = millis() - genStartMs;
  let progress = constrain(elapsed / Math.max(1, genDurationMs), 0, 1);

  if (progress >= 1.0 && !isAudioSpeaking) {
    if (activeIdx < trajectory.length - 1) {
      activeIdx++;
      if (trajectory[activeIdx].isPeak) {
        addPeakToStack(trajectory[activeIdx].text);
      }
      triggerStepAudio(trajectory[activeIdx]);
      progress = 0;
    } else {
      // Advance to next cycle and rotate to the next voice in the cast
      cycleNumber++;
      selectVoiceForCycle(cycleNumber);
      buildFullArcTrajectory(SHATTER_ON_NEW_CYCLE);
      activeIdx = 0;
      triggerStepAudio(trajectory[activeIdx]);
      progress = 0;
    }
  }

  let currentStep = trajectory[activeIdx];
  let prevStep = activeIdx > 0 ? trajectory[activeIdx - 1] : currentStep;

  drawHUD(currentStep, activeIdx, trajectory.length);

  let maxWidth = width - MARGIN_X * 2;

  // 1. TOP ARCHIVE STACK
  if (stackedPeaks.length > 0) {
    push();
    textSize(STACK_FONT_SIZE);
    let y = TOP_STACK_START_Y;
    for (let i = 0; i < stackedPeaks.length; i++) {
      let isNewest = (i === stackedPeaks.length - 1);
      let alpha = (isNewest && currentStep.isPeak) ? lerp(0, 195, progress) : 165;
      y = drawCenteredWrappedBlock(stackedPeaks[i], y, maxWidth, STACK_LINE_HEIGHT, color(220, 212, 192, alpha));
      y += STACK_GAP;
    }
    pop();
  }

  // 2. MIDDLE CRUCIBLE
  textSize(FONT_SIZE);
  let crucibleY = height * 0.56;
  if (currentStep.phase === "cohesion" && prevStep.text.includes(" ")) {
    drawSlidingCohesionBlock(prevStep.text, currentStep.text, crucibleY, maxWidth, progress);
  } else {
    drawMorphingBlock(prevStep.text, currentStep.text, crucibleY, maxWidth, progress, currentStep.phase);
  }

  drawFooter();
}

// =========================================================
// CENTERED VISUAL RENDERERS
// =========================================================

function wrapTextIntoLines(fullText, maxWidth) {
  let words = fullText.split(" ");
  let lines = [];
  let currentLine = "";

  for (let w of words) {
    let testLine = currentLine ? currentLine + " " + w : w;
    if (textWidth(testLine) > maxWidth && currentLine !== "") {
      lines.push(currentLine);
      currentLine = w;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function drawCenteredWrappedBlock(fullText, startY, maxWidth, lineH, inkColor) {
  fill(inkColor);
  textStyle(NORMAL);
  let lines = wrapTextIntoLines(fullText, maxWidth);
  let y = startY;

  for (let line of lines) {
    let lineW = textWidth(line);
    let startX = (width - lineW) / 2;
    text(line, startX, y);
    y += lineH;
  }
  return y;
}

function drawMorphingBlock(prevText, currText, startY, maxWidth, progress, phase) {
  let fadeProgress = smoothstep(0.05, 0.75, progress);

  if (phase === "atomic" || phase === "incantation" || !currText.includes(" ") || !prevText.includes(" ")) {
    drawCrossfadingCharStream(prevText, currText, startY, maxWidth, fadeProgress, phase);
    return;
  }

  let prevWords = prevText.split(" ");
  let currWords = currText.split(" ");
  textStyle(NORMAL);
  let spaceW = textWidth(" ");

  let lines = [];
  let currentLine = [];
  let currentLineW = 0;

  for (let i = 0; i < currWords.length; i++) {
    let pWord = prevWords[i] || "";
    let cWord = currWords[i] || "";
    let w = lerp(textWidth(pWord), textWidth(cWord), fadeProgress);
    let addW = currentLine.length > 0 ? spaceW + w : w;

    if (currentLineW + addW > maxWidth && currentLine.length > 0) {
      lines.push({ items: currentLine, width: currentLineW });
      currentLine = [{ pWord, cWord, w }];
      currentLineW = w;
    } else {
      currentLine.push({ pWord, cWord, w });
      currentLineW += addW;
    }
  }
  if (currentLine.length > 0) {
    lines.push({ items: currentLine, width: currentLineW });
  }

  let y = startY;
  for (let line of lines) {
    let x = (width - line.width) / 2;
    for (let item of line.items) {
      if (item.pWord === item.cWord) {
        fill(232, 228, 217, 255);
        textStyle(NORMAL);
        text(item.cWord, x, y);
      } else {
        drawCrossfadingWord(item.pWord, item.cWord, x, y, fadeProgress, phase);
      }
      x += item.w + spaceW;
    }
    y += LINE_HEIGHT;
  }
}

function drawCrossfadingCharStream(oldStr, newStr, startY, maxWidth, t, phase) {
  let maxLen = max(oldStr.length, newStr.length);
  textStyle(NORMAL);

  let lines = [];
  let currentLine = [];
  let currentLineW = 0;

  for (let c = 0; c < maxLen; c++) {
    let oldChar = oldStr[c] || "";
    let newChar = newStr[c] || "";
    let wOld = oldChar ? textWidth(oldChar) : 0;
    let wNew = newChar ? textWidth(newChar) : 0;
    let charW = lerp(wOld, wNew, t);

    if (currentLineW + charW > maxWidth && currentLine.length > 0) {
      lines.push({ items: currentLine, width: currentLineW });
      currentLine = [{ oldChar, newChar, charW }];
      currentLineW = charW;
    } else {
      currentLine.push({ oldChar, newChar, charW });
      currentLineW += charW;
    }
  }
  if (currentLine.length > 0) {
    lines.push({ items: currentLine, width: currentLineW });
  }

  let y = startY;
  for (let line of lines) {
    let x = (width - line.width) / 2;
    for (let item of line.items) {
      if (item.oldChar === item.newChar) {
        fill(232, 228, 217, 255);
        textStyle(NORMAL);
        text(item.newChar, x, y);
      } else {
        if (item.oldChar !== "") {
          fill(180, 140, 120, (1.0 - t) * 255);
          textStyle(NORMAL);
          text(item.oldChar, x, y - (t * 8));
        }
        if (item.newChar !== "") {
          if (phase === "dissolution") fill(235, 175, 130, t * 255);
          else fill(175, 220, 195, t * 255);
          textStyle(ITALIC);
          text(item.newChar, x, y + ((1.0 - t) * 8));
        }
      }
      x += item.charW;
    }
    y += LINE_HEIGHT;
  }
}

function drawCrossfadingWord(oldWord, newWord, wordX, wordY, t, phase) {
  let maxLen = max(oldWord.length, newWord.length);
  let charX = wordX;

  for (let c = 0; c < maxLen; c++) {
    let oldChar = oldWord[c] || "";
    let newChar = newWord[c] || "";

    if (oldChar === newChar) {
      fill(232, 228, 217, 255);
      textStyle(NORMAL);
      text(newChar, charX, wordY);
      charX += textWidth(newChar);
    } else {
      if (oldChar !== "") {
        fill(180, 140, 120, (1.0 - t) * 255);
        textStyle(NORMAL);
        text(oldChar, charX, wordY - (t * 8));
      }
      if (newChar !== "") {
        if (phase === "dissolution") fill(235, 175, 130, t * 255);
        else fill(175, 220, 195, t * 255);
        textStyle(ITALIC);
        text(newChar, charX, wordY + ((1.0 - t) * 8));
      }
      textStyle(NORMAL);
      let wOld = oldChar ? textWidth(oldChar) : 0;
      let wNew = newChar ? textWidth(newChar) : 0;
      charX += lerp(wOld, wNew, t);
    }
  }
}

function drawSlidingCohesionBlock(prevText, currText, startY, maxWidth, progress) {
  let prevWords = prevText.replace(/[^\w\s]/g, "").toLowerCase().split(" ");
  let currWords = currText.split(" ");
  let cleanCurr = currText.replace(/[^\w\s]/g, "").toLowerCase().split(" ");

  textStyle(NORMAL);
  let prevCoords = computeCenteredWordLayout(prevWords, startY, maxWidth);
  let currCoords = computeCenteredWordLayout(currWords, startY, maxWidth);

  let slideT = smoothstep(0.05, 0.85, progress);
  let usedPrevIndices = new Set();

  for (let i = 0; i < currWords.length; i++) {
    let targetW = cleanCurr[i];
    let fromIdx = i;
    if (prevWords[i] !== targetW) {
      for (let j = 0; j < prevWords.length; j++) {
        if (!usedPrevIndices.has(j) && prevWords[j] === targetW) {
          fromIdx = j;
          break;
        }
      }
    }
    usedPrevIndices.add(fromIdx);

    let pPos = prevCoords[fromIdx] || currCoords[i];
    let cPos = currCoords[i];

    let curX = lerp(pPos.x, cPos.x, slideT);
    let curY = lerp(pPos.y, cPos.y, slideT);

    if (fromIdx !== i) {
      let arcDirection = fromIdx < i ? -1 : 1;
      curY += sin(slideT * PI) * 28 * arcDirection;
      fill(245, 215, 155, 255);
      textStyle(ITALIC);
    } else {
      fill(232, 228, 217, 255);
      textStyle(NORMAL);
    }
    text(currWords[i], curX, curY);
  }
}

function computeCenteredWordLayout(wordArray, startY, maxWidth) {
  let spaceW = textWidth(" ");
  let lines = [];
  let currentLine = [];
  let currentLineW = 0;

  for (let i = 0; i < wordArray.length; i++) {
    let w = textWidth(wordArray[i]);
    let addW = currentLine.length > 0 ? spaceW + w : w;
    if (currentLineW + addW > maxWidth && currentLine.length > 0) {
      lines.push({ items: currentLine, width: currentLineW });
      currentLine = [{ idx: i, w }];
      currentLineW = w;
    } else {
      currentLine.push({ idx: i, w });
      currentLineW += addW;
    }
  }
  if (currentLine.length > 0) {
    lines.push({ items: currentLine, width: currentLineW });
  }

  let coords = new Array(wordArray.length);
  let y = startY;
  for (let line of lines) {
    let x = (width - line.width) / 2;
    for (let item of line.items) {
      coords[item.idx] = { x: x, y: y };
      x += item.w + spaceW;
    }
    y += LINE_HEIGHT;
  }
  return coords;
}

function drawHUD(stepObj, idx, total) {
  push();
  textSize(13);
  textStyle(NORMAL);
  textAlign(CENTER, BASELINE);
  fill(130, 128, 120);
  let alignPct = Math.round((stepObj.alpha || 0) * 100);
  text(`Cycle ${cycleNumber}   |   ${stepObj.stage}   |   Hopkins Alignment: ${alignPct}%   |   Step ${idx + 1}/${total}`, width / 2, 42);
  pop();
}

function drawFooter() {
  push();
  textSize(12);
  textStyle(NORMAL);
  textAlign(CENTER, BASELINE);
  fill(100, 98, 92);
  text("Click anywhere to stop and restart", width / 2, height - 32);
  pop();
}

// =========================================================
// LEXICAL & UTILITY HELPERS
// =========================================================

function jsFindClosestWord(decayedWord, targetPos, bannedSet) {
  let clean = decayedWord.replace(/[^\w]/g, "").toLowerCase();
  if (!clean) return "the";

  if (FUNCTION_POOLS[targetPos]) {
    let pool = FUNCTION_POOLS[targetPos];
    let sorted = [...pool].sort((a, b) => jsLevenshtein(clean, a) - jsLevenshtein(clean, b));
    return sorted[Math.floor(Math.random() * Math.min(3, sorted.length))];
  }

  let bucket = (posVocabCache && posVocabCache[targetPos]) ? posVocabCache[targetPos] : ["stone", "ember", "tide", "gleam"];
  let minLen = Math.max(3, clean.length - 2);
  let maxLen = Math.min(13, Math.max(4, clean.length + 2));

  let candidates = [];
  for (let i = 0; i < bucket.length; i++) {
    let w = bucket[i];
    if (w.length >= minLen && w.length <= maxLen && !bannedSet.has(w)) {
      if (w[0] === clean[0] || w[w.length - 1] === clean[clean.length - 1]) {
        candidates.push(w);
      }
    }
  }
  if (candidates.length === 0) {
    candidates = bucket.filter(w => w.length >= minLen && w.length <= maxLen && !bannedSet.has(w));
  }
  if (candidates.length > 500) candidates = sampleArray(candidates, 500);

  let bestScore = Infinity;
  let bestMatches = [];
  for (let cand of candidates) {
    let sc = jsLevenshtein(clean, cand) + (clean[0] === cand[0] ? 0 : 0.5);
    if (sc < bestScore - 0.5) {
      bestScore = sc;
      bestMatches = [cand];
    } else if (Math.abs(sc - bestScore) <= 0.5) {
      bestMatches.push(cand);
    }
  }

  let chosen = bestMatches.length > 0 ? bestMatches[Math.floor(Math.random() * bestMatches.length)] : clean;
  bannedSet.add(chosen);
  return chosen;
}

function jsStepWordTowardTarget(curr, targ) {
  if (curr === targ) return curr;
  let cList = curr.split("");
  let tList = targ.split("");

  let mismatchIdx = -1;
  for (let i = 0; i < Math.min(cList.length, tList.length); i++) {
    if (cList[i] !== tList[i]) {
      mismatchIdx = i;
      break;
    }
  }

  if (cList.length > tList.length) {
    let delIdx = mismatchIdx !== -1 ? mismatchIdx : cList.length - 1;
    cList.splice(delIdx, 1);
  } else if (cList.length < tList.length) {
    let insIdx = mismatchIdx !== -1 ? mismatchIdx : cList.length;
    cList.splice(insIdx, 0, tList[insIdx]);
  } else {
    let diffs = [];
    for (let i = 0; i < cList.length; i++) {
      if (cList[i] !== tList[i]) diffs.push(i);
    }
    let pick = diffs[Math.floor(Math.random() * diffs.length)];
    cList[pick] = tList[pick];
  }
  return cList.join("");
}

function jsStepPosCohesion(wordList, posSlots) {
  let contentPos = ['NOUN', 'VERB', 'ADJ'];
  let currentScore = jsPoeticCohesionScore(wordList);

  for (let attempt = 0; attempt < 50; attempt++) {
    let targetPos = contentPos[Math.floor(Math.random() * contentPos.length)];
    let indices = [];
    posSlots.forEach((p, idx) => {
      if (p === targetPos && idx < wordList.length) indices.push(idx);
    });
    if (indices.length < 2) continue;

    let [i, j] = sampleArray(indices, 2);
    let cand = [...wordList];
    [cand[i], cand[j]] = [cand[j], cand[i]];

    if (jsPoeticCohesionScore(cand) > currentScore) {
      wordList[i] = cand[i];
      wordList[j] = cand[j];
      return true;
    }
  }
  return false;
}

function jsPoeticCohesionScore(words) {
  let score = 0;
  for (let i = 0; i < words.length - 1; i++) {
    let w1 = words[i], w2 = words[i + 1];
    if (!w1 || !w2) continue;
    if (w1[0] === w2[0]) score += 1.5;
    let shared = new Set(w1).size + new Set(w2).size - new Set(w1 + w2).size;
    score += shared * 0.4;
  }
  return score;
}

function jsLevenshtein(s1, s2) {
  if (s1.length < s2.length) return jsLevenshtein(s2, s1);
  if (s2.length === 0) return s1.length;
  let prevRow = Array.from({ length: s2.length + 1 }, (_, i) => i);
  for (let i = 0; i < s1.length; i++) {
    let currRow = [i + 1];
    for (let j = 0; j < s2.length; j++) {
      let ins = prevRow[j + 1] + 1;
      let del = currRow[j] + 1;
      let sub = prevRow[j] + (s1[i] !== s2[j] ? 1 : 0);
      currRow.push(Math.min(ins, del, sub));
    }
    prevRow = currRow;
  }
  return prevRow[s2.length];
}

function sampleArray(arr, k) {
  let copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, k);
}

function capitalizeSentence(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function smoothstep(edge0, edge1, x) {
  let t = constrain((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}