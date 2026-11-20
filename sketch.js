// =========================================================
// HOPKINS DECAY & REBIRTH — 2-CYCLE LINE EDITION
// =========================================================

// >>> DIRECTION & PACING TOGGLES <<<
// false = Forward: Starts at Original Seed -> Cycle 1 -> Cycle 2 (3 stanzas total)
// true  = Reverse: Starts at 2nd Offspring -> Excavates back to Original Seed
const REVERSE_TIMELINE = true;

const TOTAL_CYCLES = 2;         // 2 cycles (produces a 3-stanza accumulated poem)
const DECAY_STEPS = 22;         // Deep phonetic decay for short 1-2 sentence lines
const MUTATIONS_PER_STEP = 2;   // 2 words mutated per step
const HEALS_PER_STEP = 2;       // 2 words healed by 1 letter per step

let hopkinsData, phonemeData, posVocabCache;

// Playback & Generation State
let isPlaying = false;
let completedStanzas = [];
let allCyclesList = [];
let cycleTrajectory = [];
let activeIdx = 0;
let currentCycle = 0;

// Per-Generation Timing Clock
let genStartMs = 0;
let genDurationMs = 6800;
let isAudioSpeaking = false;
const PAUSE_BETWEEN_GENS_MS = 220;

// Restored generous typography for 2-cycle short lines
const MARGIN_X = 90;
const LINE_HEIGHT = 32;
const STANZA_GAP = 16;
const FONT_SIZE = 21;

// Paste your original two Hopkins sentences (or any single line of The Windhover) here:
const INITIAL_SOURCE_TEXT = "In the space before becoming light itself we sleep in this bed together, but dream alone half-formed thoughts of a time inside another time."

let currentSeedText = "";
let originalPosSlots = [];

// Phonetic & Grammatical Tables
const ARPABET_TO_TEXT = {
  'P': 'p', 'B': 'b', 'T': 't', 'D': 'd', 'K': 'k', 'G': 'g',
  'CH': 'ch', 'JH': 'j', 'F': 'f', 'V': 'v', 'TH': 'th', 'S': 's', 'SH': 'sh',
  'DH': 'th', 'Z': 'z', 'ZH': 'zh', 'HH': 'h', 'M': 'm', 'N': 'n',
  'NG': 'ng', 'L': 'l', 'R': 'r', 'W': 'w', 'Y': 'y',
  'AA': 'a', 'AE': 'a', 'AH': 'u', 'AO': 'au', 'AW': 'ow', 'AY': 'ai',
  'EH': 'e', 'ER': 'er', 'EY': 'ei', 'IH': 'i', 'IY': 'ee', 'OW': 'o',
  'OY': 'oy', 'UH': 'oo', 'UW': 'oo'
};

const HARD_PHONEMES = new Set(['P', 'B', 'T', 'D', 'K', 'G', 'CH', 'JH', 'F', 'V', 'TH', 'SH']);
const SOFT_AND_VOWELS = new Set(Object.keys(ARPABET_TO_TEXT).filter(k => !HARD_PHONEMES.has(k)));

const FUNCTION_POOLS = {
  'ADP': ["in", "on", "of", "to", "by", "for", "with", "from", "into", "upon", "over", "under", "amid", "unto", "through", "beneath", "beyond", "off", "at"],
  'DET': ["the", "a", "an", "this", "that", "each", "some", "no", "any", "every", "all", "thy", "my", "our", "his", "her", "its"],
  'PRON': ["i", "you", "we", "they", "it", "he", "she", "me", "us", "them", "who", "what", "one", "him"],
  'AUX': ["is", "are", "was", "were", "be", "been", "will", "would", "shall", "should", "may", "might", "can", "could", "must", "did", "doth"],
  'CCONJ': ["and", "or", "but", "yet", "nor", "so", "for"],
  'SCONJ': ["as", "if", "when", "while", "though", "until", "once", "since", "where", "how"],
  'PART': ["to", "not"]
};

let vocabSets = {};

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

  for (let pos of ['NOUN', 'VERB', 'ADJ', 'ADV']) {
    vocabSets[pos] = new Set(posVocabCache[pos] || []);
  }

  // Clean hyphens and line breaks so any line you paste works seamlessly
  currentSeedText = INITIAL_SOURCE_TEXT.replace(/[-—\n\r]+/g, " ").replace(/\s+/g, " ").trim();
  originalPosSlots = inferPosSlotsFromText(currentSeedText);

  buildAllCyclesTrajectory();
}

function inferPosSlotsFromText(textStr) {
  let words = textStr.split(/\s+/);
  let slots = [];

  for (let rawW of words) {
    let w = rawW.replace(/[^\w]/g, "").toLowerCase();
    if (!w) continue;

    let foundFunc = null;
    for (let [pos, pool] of Object.entries(FUNCTION_POOLS)) {
      if (pool.includes(w)) {
        foundFunc = pos;
        break;
      }
    }
    if (foundFunc) {
      slots.push(foundFunc);
      continue;
    }

    if (w.endsWith("ly") && vocabSets['ADV'] && vocabSets['ADV'].has(w)) {
      slots.push('ADV');
    } else if (vocabSets['VERB'] && vocabSets['VERB'].has(w) && (w.endsWith("ed") || w.endsWith("ing"))) {
      slots.push('VERB');
    } else if (vocabSets['ADJ'] && vocabSets['ADJ'].has(w)) {
      slots.push('ADJ');
    } else if (vocabSets['VERB'] && vocabSets['VERB'].has(w)) {
      slots.push('VERB');
    } else if (vocabSets['NOUN'] && vocabSets['NOUN'].has(w)) {
      slots.push('NOUN');
    } else if (w.endsWith("ing") || w.endsWith("ed")) {
      slots.push('VERB');
    } else {
      slots.push('NOUN');
    }
  }
  return slots;
}

function buildAllCyclesTrajectory() {
  let forwardCycles = [];
  let stanzaChain = [currentSeedText]; // [S0, S1, S2]
  let seed = currentSeedText;
  let genCounter = 0;

  // 1. Generate the 2 forward cycles to establish the 3-stanza lineage (S0 -> S1 -> S2)
  for (let c = 0; c < TOTAL_CYCLES; c++) {
    let rawSteps = generateRawCycleSteps(seed);
    forwardCycles.push(rawSteps);
    seed = rawSteps[rawSteps.length - 1].text;
    stanzaChain.push(seed);
  }

  allCyclesList = [];

  if (!REVERSE_TIMELINE) {
    // --- FORWARD MODE (S0 -> S1 -> S2) ---
    for (let c = 0; c < TOTAL_CYCLES; c++) {
      let steps = forwardCycles[c];
      let cycleArr = [];
      let startIdx = (c === 0) ? 0 : 1;

      for (let i = startIdx; i < steps.length; i++) {
        cycleArr.push({
          gen: genCounter++,
          phase: steps[i].phase,
          text: steps[i].text,
          cycle: c,
          is_cycle_end: (i === steps.length - 1)
        });
      }
      assignPanCurve(cycleArr);
      allCyclesList.push(cycleArr);
    }
  } else {
    // --- TIME-REVERSAL MODE (S2 -> S1 -> S0) ---
    // Follows exact ritual: a) Start at S_k -> b) Decay -> c) Reconstitute (Scrambled) -> d) Swap for Syntax -> e) Rise
    for (let c = 0; c < TOTAL_CYCLES; c++) {
      let startStanza = stanzaChain[TOTAL_CYCLES - c];
      let targetStanza = stanzaChain[TOTAL_CYCLES - 1 - c];

      let steps = generateTargetedCycleSteps(startStanza, targetStanza);
      let cycleArr = [];
      let startIdx = (c === 0) ? 0 : 1;

      for (let i = startIdx; i < steps.length; i++) {
        cycleArr.push({
          gen: genCounter++,
          phase: steps[i].phase,
          text: steps[i].text,
          cycle: c,
          is_cycle_end: (i === steps.length - 1)
        });
      }
      assignPanCurve(cycleArr);
      allCyclesList.push(cycleArr);
    }
    currentSeedText = stanzaChain[TOTAL_CYCLES];
  }

  currentCycle = 0;
  cycleTrajectory = allCyclesList[0];
}

function assignPanCurve(traj) {
  let totalIdx = Math.max(1, traj.length - 1);
  let midIdx = Math.floor(totalIdx / 2);

  for (let i = 0; i < traj.length; i++) {
    let panVal = -1.0;
    if (i <= midIdx) {
      let p = i / Math.max(1, midIdx);
      panVal = -1.0 + (2.0 * p);
    } else {
      let rem = Math.max(1, totalIdx - midIdx);
      let p = (i - midIdx) / rem;
      panVal = 1.0 - (2.0 * p);
    }
    traj[i].pan = constrain(panVal, -1.0, 1.0);
  }
}

function mousePressed() {
  if (!isPlaying) {
    isPlaying = true;
    activeIdx = 0;
    triggerGenerationAudioAndTimer(cycleTrajectory[activeIdx]);
  }
}

// =========================================================
// NATIVE WINDOWS VOICE ENGINE WITH PRONUNCIATION HELPER
// =========================================================

function triggerGenerationAudioAndTimer(genObj) {
  genStartMs = millis();
  isAudioSpeaking = true;

  let estimatedMs = Math.max(5500, genObj.text.length * 76);
  genDurationMs = estimatedMs;

  let cleanSpoken = genObj.text.replace(/[.!;?]+/g, ",");
  let spokenString = makePronounceableForTTS(cleanSpoken);
  speakWithNativeVoice(spokenString, genObj.pan || 0, estimatedMs);
}

function makePronounceableForTTS(textStr) {
  return textStr.split(" ").map(word => {
    let clean = word.replace(/[^\w]/g, "").toLowerCase();
    if (clean.length >= 3 && !/[aeiouy]/.test(clean)) {
      let mid = Math.floor(clean.length / 2);
      return clean.slice(0, mid) + "e" + clean.slice(mid);
    }
    return word;
  }).join(" ");
}

function speakWithNativeVoice(spokenString, panVal, estimatedMs) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    let utter = new SpeechSynthesisUtterance(spokenString);

    let norm = (panVal + 1.0) / 2.0;
    utter.rate = lerp(0.95, 0.82, norm);
    utter.pitch = lerp(0.90, 0.30, norm);

    utter.onend = () => {
      isAudioSpeaking = false;
      genDurationMs = (millis() - genStartMs) + PAUSE_BETWEEN_GENS_MS;
    };
    utter.onerror = () => {
      isAudioSpeaking = false;
    };

    window.speechSynthesis.speak(utter);
    genDurationMs = estimatedMs;
  } else {
    isAudioSpeaking = false;
    genDurationMs = estimatedMs;
  }
}

function advanceToNextGeneration() {
  let justFinishedGen = cycleTrajectory[activeIdx];

  if (justFinishedGen.phase === "source" && completedStanzas.length === 0) {
    completedStanzas.push(justFinishedGen.text);
  }

  if (justFinishedGen.is_cycle_end) {
    completedStanzas.push(justFinishedGen.text);
    currentSeedText = justFinishedGen.text;
    currentCycle++;

    if (currentCycle < TOTAL_CYCLES) {
      cycleTrajectory = allCyclesList[currentCycle];
      activeIdx = 0;
      triggerGenerationAudioAndTimer(cycleTrajectory[activeIdx]);
    }
    return;
  }

  if (activeIdx < cycleTrajectory.length - 1) {
    activeIdx++;
    triggerGenerationAudioAndTimer(cycleTrajectory[activeIdx]);
  }
}

// =========================================================
// LIVE JAVASCRIPT GENERATIVE ENGINE (2-CYCLE LINE MODE)
// =========================================================

function generateRawCycleSteps(seedText) {
  let steps = [];
  steps.push({ phase: "source", text: seedText });

  // Ban all content words already used so far so Cycle 2 never repeats Cycle 1 or Gen 0!
  let cleanSourceWords = seedText.split(/\s+/).map(w => w.replace(/[^\w]/g, "")).filter(Boolean);
  let bannedContent = new Set(cleanSourceWords.map(w => w.toLowerCase()));

  let currentText = seedText;
  let currentState = 'S';
  let lastPhoneme = null;

  // 1. STAGE 1: Dual-JSON Hopkins Decay
  for (let s = 0; s < DECAY_STEPS; s++) {
    let stepRes = jsSlowDecayStep(currentText, currentState, lastPhoneme, MUTATIONS_PER_STEP);
    currentText = stepRes.text;
    currentState = stepRes.state;
    lastPhoneme = stepRes.phoneme;
    steps.push({ phase: "decay", text: currentText });
  }

  // 2. STAGE 2: POS-Guided Unabridged Reconstruction
  let decayedWords = currentText.split(/\s+/);
  let targetWords = decayedWords.map((w, i) => {
    let slotPos = originalPosSlots[i] || 'NOUN';
    return jsFindClosestWord(w, slotPos, bannedContent);
  });

  let currentWords = decayedWords.map(w => w.replace(/[^\w]/g, "").toLowerCase());
  while (currentWords.join(" ") !== targetWords.join(" ")) {
    let unhealed = [];
    for (let i = 0; i < currentWords.length; i++) {
      if (currentWords[i] !== targetWords[i]) unhealed.push(i);
    }
    if (unhealed.length === 0) break;
    let chosen = sampleArray(unhealed, Math.min(HEALS_PER_STEP, unhealed.length));
    for (let idx of chosen) {
      currentWords[idx] = jsStepWordTowardTarget(currentWords[idx], targetWords[idx]);
    }
    currentText = currentWords.join(" ");
    steps.push({ phase: "reconstruction", text: currentText });
  }

  // 3. STAGE 3: Same-POS Cohesion Swaps
  let wordSeq = [...currentWords];
  for (let c = 0; c < 6; c++) {
    let swapped = jsStepPosCohesion(wordSeq, originalPosSlots);
    if (!swapped) break;
    currentText = capitalizeSentence(wordSeq.join(" ")) + ".";
    steps.push({ phase: "cohesion", text: currentText });
  }

  steps[steps.length - 1].text = capitalizeSentence(wordSeq.join(" ")) + ".";
  return steps;
}

function generateTargetedCycleSteps(startText, targetText) {
  let steps = [];
  steps.push({ phase: "source", text: startText });

  let currentText = startText;
  let currentState = 'S';
  let lastPhoneme = null;

  for (let s = 0; s < DECAY_STEPS; s++) {
    let stepRes = jsSlowDecayStep(currentText, currentState, lastPhoneme, MUTATIONS_PER_STEP);
    currentText = stepRes.text;
    currentState = stepRes.state;
    lastPhoneme = stepRes.phoneme;
    steps.push({ phase: "decay", text: currentText });
  }

  let finalOrderedWords = targetText.split(/\s+/).map(w => w.replace(/[^\w]/g, "").toLowerCase()).filter(Boolean);
  let scrambledTargetWords = [...finalOrderedWords];
  let swapSequence = [];

  let contentPos = ['NOUN', 'VERB', 'ADJ'];
  for (let s = 0; s < 4; s++) {
    let pos = contentPos[s % contentPos.length];
    let indices = [];
    originalPosSlots.forEach((p, idx) => {
      if (p === pos && idx < scrambledTargetWords.length) indices.push(idx);
    });
    if (indices.length >= 2) {
      let [i, j] = sampleArray(indices, 2);
      if (scrambledTargetWords[i] !== scrambledTargetWords[j]) {
        let tmp = scrambledTargetWords[i];
        scrambledTargetWords[i] = scrambledTargetWords[j];
        scrambledTargetWords[j] = tmp;
        swapSequence.push([i, j]);
      }
    }
  }

  let currentWords = currentText.split(/\s+/).map(w => w.replace(/[^\w]/g, "").toLowerCase());
  while (currentWords.join(" ") !== scrambledTargetWords.join(" ")) {
    let unhealed = [];
    for (let i = 0; i < currentWords.length; i++) {
      if (currentWords[i] !== scrambledTargetWords[i]) unhealed.push(i);
    }
    if (unhealed.length === 0) break;
    let chosen = sampleArray(unhealed, Math.min(HEALS_PER_STEP, unhealed.length));
    for (let idx of chosen) {
      currentWords[idx] = jsStepWordTowardTarget(currentWords[idx], scrambledTargetWords[idx]);
    }
    currentText = currentWords.join(" ");
    steps.push({ phase: "reconstruction", text: currentText });
  }

  let cohesionWords = [...currentWords];
  for (let k = swapSequence.length - 1; k >= 0; k--) {
    let [i, j] = swapSequence[k];
    let tmp = cohesionWords[i];
    cohesionWords[i] = cohesionWords[j];
    cohesionWords[j] = tmp;

    let stepStr = capitalizeSentence(cohesionWords.join(" ")) + ".";
    steps.push({ phase: "cohesion", text: stepStr });
  }

  steps[steps.length - 1].text = targetText;
  steps[steps.length - 1].phase = "cohesion";
  return steps;
}

function jsSlowDecayStep(text, currentState, lastPhoneme, mutationsPerStep) {
  let words = text.split(/\s+/);
  let validIndices = [];
  words.forEach((w, i) => {
    if (w.replace(/[^\w]/g, "").length > 0) validIndices.push(i);
  });

  let chosen = sampleArray(validIndices, Math.min(mutationsPerStep, validIndices.length)).sort((a, b) => a - b);
  for (let idx of chosen) {
    let probs = hopkinsData.transition_matrix[currentState] || { S: 0.5 };
    let targetStress = Math.random() < probs.S ? 'S' : 'U';
    let clean = words[idx].replace(/[^\w]/g, "");
    let chars = clean.split("");
    let mutPt = Math.floor(Math.random() * chars.length);
    let picked = jsPickWeightedPhoneme(targetStress, lastPhoneme);
    chars[mutPt] = picked.grapheme;
    words[idx] = chars.join("");
    currentState = targetStress;
    lastPhoneme = picked.phoneme;
  }
  return { text: words.join(" "), state: currentState, phoneme: lastPhoneme };
}

function jsPickWeightedPhoneme(targetStress, lastPhoneme) {
  let rawWeights = {};
  if (phonemeData.transition_matrix && lastPhoneme && phonemeData.transition_matrix[lastPhoneme]) {
    rawWeights = phonemeData.transition_matrix[lastPhoneme];
  } else {
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
    pool = Array.from(allowed);
    weights = pool.map(() => 1.0);
  }

  let totalW = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * totalW;
  let chosenPh = pool[0];
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      chosenPh = pool[i];
      break;
    }
  }
  return { grapheme: ARPABET_TO_TEXT[chosenPh], phoneme: chosenPh };
}

function jsFindClosestWord(decayedWord, targetPos, bannedSet) {
  let clean = decayedWord.replace(/[^\w]/g, "").toLowerCase();
  if (!clean) return "the";

  if (FUNCTION_POOLS[targetPos]) {
    let pool = FUNCTION_POOLS[targetPos];
    let sorted = [...pool].sort((a, b) => jsLevenshtein(clean, a) - jsLevenshtein(clean, b));
    return sorted[Math.floor(Math.random() * Math.min(3, sorted.length))];
  }

  let bucket = (posVocabCache && posVocabCache[targetPos]) ? posVocabCache[targetPos] : (posVocabCache['NOUN'] || ["stone", "ember", "tide", "gleam"]);
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
  if (candidates.length > 500) {
    candidates = sampleArray(candidates, 500);
  }

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
    let tmp = cand[i];
    cand[i] = cand[j];
    cand[j] = tmp;

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

// =========================================================
// P5.JS REAL-TIME DRAW LOOP & FLOATING STANZA RENDERER
// =========================================================

function draw() {
  background(17, 17, 16);

  if (!isPlaying) {
    drawStartScreen();
    return;
  }

  let elapsed = millis() - genStartMs;
  let progress = constrain(elapsed / Math.max(1, genDurationMs), 0, 1);

  if (progress >= 1.0 && !isAudioSpeaking && currentCycle < TOTAL_CYCLES) {
    advanceToNextGeneration();
    progress = 0;
  }

  let currentGen = cycleTrajectory[activeIdx];
  let prevGen = activeIdx > 0 ? cycleTrajectory[activeIdx - 1] : { text: currentSeedText };

  drawHUD(currentGen, activeIdx, cycleTrajectory.length);

  let maxWidth = width - MARGIN_X * 2;
  let currentStanzaY = 105;

  // 1. TOP SECTION: Draw all completed stanzas in the growing 3-stanza poem
  if (completedStanzas.length === 0 && currentGen.phase === "source") {
    currentStanzaY = drawTypewriterBlock(
      currentGen.text, MARGIN_X, currentStanzaY, maxWidth, progress, color(215, 210, 195, 255)
    ) + STANZA_GAP;
  } else {
    for (let s = 0; s < completedStanzas.length; s++) {
      currentStanzaY = drawTypewriterBlock(
        completedStanzas[s], MARGIN_X, currentStanzaY, maxWidth, 1.0, color(215, 210, 195, 190)
      ) + STANZA_GAP;
    }
  }

  let nextDockY = currentStanzaY;
  let morphRowY = max(height * 0.54, nextDockY + 80);
  let bottomRowY = height * 0.80;

  // 2. MIDDLE & BOTTOM SECTIONS: Morphing Crucible + Floating Up Stanza
  if (currentGen.phase !== "source") {
    if (currentGen.is_cycle_end) {
      let typeProgress = constrain(progress / 0.55, 0, 1);
      let floatProgress = smoothstep(0.55, 0.98, progress);

      let crucibleAlpha = (1.0 - floatProgress) * 255;
      if (crucibleAlpha > 5) {
        drawSlidingCohesionBlock(prevGen.text, currentGen.text, MARGIN_X, morphRowY, maxWidth, typeProgress, crucibleAlpha);
      }

      let floatingY = lerp(bottomRowY, nextDockY, floatProgress);
      let stanzaAlpha = lerp(255, 200, floatProgress);
      drawTypewriterBlock(
        currentGen.text, MARGIN_X, floatingY, maxWidth, typeProgress, color(245, 235, 210, stanzaAlpha)
      );
    } else if (currentGen.phase === "cohesion") {
      drawSlidingCohesionBlock(prevGen.text, currentGen.text, MARGIN_X, morphRowY, maxWidth, progress, 255);
    } else {
      drawMorphingBlock(prevGen.text, currentGen.text, MARGIN_X, morphRowY, maxWidth, progress, currentGen.phase, 255);
    }
  }
}

// --- VISUAL HELPERS ---

function drawTypewriterBlock(fullText, startX, startY, maxWidth, progress, inkColor) {
  let charLimit = floor(fullText.length * progress);
  let visibleText = fullText.substring(0, charLimit);

  fill(inkColor);
  textStyle(NORMAL);

  let allWords = fullText.split(" ");
  let visWords = visibleText.split(" ");
  let x = startX;
  let y = startY;

  for (let i = 0; i < allWords.length; i++) {
    let wFull = allWords[i] + " ";
    let wWidth = textWidth(wFull);
    if (x + wWidth > startX + maxWidth) {
      x = startX;
      y += LINE_HEIGHT;
    }
    if (i < visWords.length && visibleText.length > 0) {
      text(visWords[i], x, y);
    }
    x += wWidth;
  }
  return y + LINE_HEIGHT;
}

function drawMorphingBlock(prevText, currText, startX, startY, maxWidth, progress, phase, masterAlpha = 255) {
  let prevWords = prevText.split(" ");
  let currWords = currText.split(" ");

  let x = startX;
  let y = startY;
  let fadeProgress = smoothstep(0.05, 0.75, progress);

  for (let i = 0; i < currWords.length; i++) {
    let pWord = prevWords[i] || "";
    let cWord = currWords[i] || "";

    textStyle(NORMAL);
    let pWidth = textWidth(pWord + " ");
    let cWidth = textWidth(cWord + " ");
    let interpWidth = lerp(pWidth, cWidth, fadeProgress);

    if (x + interpWidth > startX + maxWidth) {
      x = startX;
      y += LINE_HEIGHT;
    }

    if (pWord === cWord) {
      fill(232, 228, 217, masterAlpha);
      textStyle(NORMAL);
      text(cWord, x, y);
    } else {
      drawCrossfadingWord(pWord, cWord, x, y, fadeProgress, phase, masterAlpha);
    }
    x += interpWidth;
  }
}

function drawCrossfadingWord(oldWord, newWord, wordX, wordY, t, phase, masterAlpha = 255) {
  let maxLen = max(oldWord.length, newWord.length);
  let charX = wordX;
  let alphaScale = masterAlpha / 255.0;

  for (let c = 0; c < maxLen; c++) {
    let oldChar = oldWord[c] || "";
    let newChar = newWord[c] || "";

    if (oldChar === newChar) {
      fill(232, 228, 217, masterAlpha);
      textStyle(NORMAL);
      text(newChar, charX, wordY);
      charX += textWidth(newChar);
    } else {
      if (oldChar !== "") {
        let oldAlpha = (1.0 - t) * 255 * alphaScale;
        let driftY = wordY - (t * 8);
        fill(180, 140, 120, oldAlpha);
        textStyle(NORMAL);
        text(oldChar, charX, driftY);
      }
      if (newChar !== "") {
        let newAlpha = t * 255 * alphaScale;
        let settleY = wordY + ((1.0 - t) * 8);
        if (phase === "decay") {
          fill(235, 175, 130, newAlpha);
        } else {
          fill(175, 220, 195, newAlpha);
        }
        textStyle(ITALIC);
        text(newChar, charX, settleY);
      }
      textStyle(NORMAL);
      let wOld = oldChar ? textWidth(oldChar) : 0;
      let wNew = newChar ? textWidth(newChar) : 0;
      charX += lerp(wOld, wNew, t);
    }
  }
}

function drawSlidingCohesionBlock(prevText, currText, startX, startY, maxWidth, progress, masterAlpha = 255) {
  let prevWords = prevText.replace(/[^\w\s]/g, "").toLowerCase().split(" ");
  let currWords = currText.split(" ");
  let cleanCurr = currText.replace(/[^\w\s]/g, "").toLowerCase().split(" ");

  textStyle(NORMAL);
  let prevCoords = computeWordLayout(prevWords, startX, startY, maxWidth);
  let currCoords = computeWordLayout(currWords, startX, startY, maxWidth);

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
      let arcOffset = sin(slideT * PI) * 26 * arcDirection;
      curY += arcOffset;
      fill(245, 215, 155, masterAlpha);
      textStyle(ITALIC);
    } else {
      fill(232, 228, 217, masterAlpha);
      textStyle(NORMAL);
    }
    text(currWords[i], curX, curY);
  }
}

function computeWordLayout(wordArray, startX, startY, maxWidth) {
  let coords = [];
  let x = startX;
  let y = startY;
  for (let i = 0; i < wordArray.length; i++) {
    let wWidth = textWidth(wordArray[i] + " ");
    if (x + wWidth > startX + maxWidth) {
      x = startX;
      y += LINE_HEIGHT;
    }
    coords.push({ x: x, y: y });
    x += wWidth;
  }
  return coords;
}

function drawHUD(genObj, idx, total) {
  push();
  textSize(13);
  textStyle(NORMAL);
  fill(130, 128, 120);
  let modeStr = REVERSE_TIMELINE ? "TIME-REVERSAL EXCAVATION" : "FORWARD EVOLUTION";
  text(`${modeStr}   |   CYCLE ${currentCycle + 1} / ${TOTAL_CYCLES}   |   STEP ${idx + 1} / ${total}   |   PHASE: ${genObj.phase.toUpperCase()}`, MARGIN_X, 45);
  pop();
}

function drawStartScreen() {
  push();
  textAlign(CENTER, CENTER);
  fill(220, 215, 200);
  textSize(21);
  let modeLabel = REVERSE_TIMELINE ? "Time-Reversal Mode (2nd Offspring -> Original Seed)" : "Forward Mode (Original Seed -> 2nd Offspring)";
  text(`Click anywhere to begin 2-Cycle Generative Poem\n[ ${modeLabel} ]`, width / 2, height / 2);
  pop();
}

// --- UTILITY FUNCTIONS ---

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