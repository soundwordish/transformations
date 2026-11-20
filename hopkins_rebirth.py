import os
import json
import random
import re
import subprocess
import spacy
import nltk
from pydub import AudioSegment

# Ensure NLTK's clean unabridged word list is downloaded
nltk.download('words', quiet=True)
from nltk.corpus import words as nltk_words

print("Loading spaCy linguistic model and word vectors...")
try:
    nlp = spacy.load("en_core_web_md")
except OSError:
    print("Error: Run 'python -m spacy download en_core_web_md' in your terminal first.")
    exit()

# 1. Load your Sprung Rhythm JSON from the folder
try:
    with open('sprung_probabilities.json', 'r') as file:
        hopkins_data = json.load(file)
except FileNotFoundError:
    print("Error: Could not find 'sprung_probabilities.json'. Check the filename.")
    exit()

# 2. Load your Phoneme Probabilities JSON from the folder
try:
    with open('phoneme_probabilities.json', 'r') as file:
        phoneme_data = json.load(file)
except FileNotFoundError:
    print("Error: Could not find 'phoneme_probabilities.json'. Check the filename.")
    exit()


# ==========================================
# PRE-LOAD & CACHE POS VOCABULARY (NO MID-RUN PAUSE)
# ==========================================

CACHE_FILE = "pos_vocab_cache.json"

def build_or_load_pos_vocabulary():
    """
    Loads the POS-sorted unabridged dictionary from a local JSON cache if available.
    Otherwise builds it once before Generation 0 starts and saves it for instant future runs.
    """
    if os.path.exists(CACHE_FILE):
        print("Loading cached POS vocabulary (instant load)...")
        with open(CACHE_FILE, "r") as f:
            raw_cache = json.load(f)
            return {pos: set(words) for pos, words in raw_cache.items()}

    print("Building Unabridged POS Vocabulary (first-time setup, will be cached)...")
    clean_english = set(w for w in nltk_words.words() if w.isalpha() and w.islower() and 3 <= len(w) <= 13)
    
    candidate_words = [
        nlp.vocab.strings[key_id] 
        for key_id in nlp.vocab.vectors.keys() 
        if key_id in nlp.vocab.strings and nlp.vocab.strings[key_id] in clean_english
    ]

    pos_buckets = {'NOUN': set(), 'VERB': set(), 'ADJ': set(), 'ADV': set()}
    
    chunk_size = 1000
    for i in range(0, len(candidate_words), chunk_size):
        doc = nlp(" ".join(candidate_words[i:i+chunk_size]))
        for token in doc:
            if token.pos_ in pos_buckets:
                pos_buckets[token.pos_].add(token.text)

    with open(CACHE_FILE, "w") as f:
        json.dump({pos: list(words) for pos, words in pos_buckets.items()}, f)

    print(f"Cached POS Vocabulary: {len(pos_buckets['NOUN'])} Nouns, "
          f"{len(pos_buckets['VERB'])} Verbs, {len(pos_buckets['ADJ'])} Adjs, {len(pos_buckets['ADV'])} Advs.")
    return pos_buckets

POS_BUCKETS = build_or_load_pos_vocabulary()


# ==========================================
# STAGE 1: SLOW DUAL-JSON HOPKINS SIEVE (DECAY)
# ==========================================

ARPABET_TO_TEXT = {
    'P': 'p', 'B': 'b', 'T': 't', 'D': 'd', 'K': 'k', 'G': 'g',
    'CH': 'ch', 'JH': 'j', 'F': 'f', 'V': 'v', 'TH': 'th', 'S': 's', 'SH': 'sh',
    'DH': 'th', 'Z': 'z', 'ZH': 'zh', 'HH': 'h', 'M': 'm', 'N': 'n', 
    'NG': 'ng', 'L': 'l', 'R': 'r', 'W': 'w', 'Y': 'y',
    'AA': 'a', 'AE': 'a', 'AH': 'u', 'AO': 'au', 'AW': 'ow', 'AY': 'ai',
    'EH': 'e', 'ER': 'er', 'EY': 'ei', 'IH': 'i', 'IY': 'ee', 'OW': 'o',
    'OY': 'oy', 'UH': 'oo', 'UW': 'oo'
}

HARD_PHONEMES = {'P', 'B', 'T', 'D', 'K', 'G', 'CH', 'JH', 'F', 'V', 'TH', 'SH'}
SOFT_AND_VOWELS = set(ARPABET_TO_TEXT.keys()) - HARD_PHONEMES

def extract_phoneme_weights(ph_data, last_phoneme=None):
    """Extracts {phoneme: weight} from phoneme_probabilities.json."""
    if "transition_matrix" in ph_data and last_phoneme in ph_data["transition_matrix"]:
        return ph_data["transition_matrix"][last_phoneme]
    
    for key in ("probabilities", "distribution", "phonemes", "weights"):
        if key in ph_data and isinstance(ph_data[key], dict):
            return ph_data[key]
            
    merged = {}
    for k, v in ph_data.items():
        if isinstance(v, dict) and k != "transition_matrix":
            for sub_k, sub_v in v.items():
                if isinstance(sub_v, (int, float)):
                    merged[sub_k] = sub_v
        elif isinstance(v, (int, float)):
            merged[k] = v
            
    return merged if merged else {k: 1.0 for k in ARPABET_TO_TEXT.keys()}

def pick_weighted_phoneme(target_stress, last_phoneme=None):
    """Rolls against phoneme_probabilities.json filtered by the demanded Sprung Stress."""
    raw_weights = extract_phoneme_weights(phoneme_data, last_phoneme)
    
    cleaned_weights = {}
    for ph, weight in raw_weights.items():
        clean_ph = re.sub(r'\d+', '', ph.upper())
        if clean_ph in ARPABET_TO_TEXT and isinstance(weight, (int, float)):
            cleaned_weights[clean_ph] = cleaned_weights.get(clean_ph, 0.0) + weight

    allowed_pool = HARD_PHONEMES if target_stress == 'S' else SOFT_AND_VOWELS
    filtered = {ph: w for ph, w in cleaned_weights.items() if ph in allowed_pool and w > 0}
    
    if not filtered:
        filtered = {ph: w for ph, w in raw_weights.items() if isinstance(w, (int, float)) and w > 0}
        if filtered:
            chosen_raw = random.choices(list(filtered.keys()), weights=list(filtered.values()), k=1)[0]
            return chosen_raw.lower(), chosen_raw

    phonemes = list(filtered.keys())
    weights = list(filtered.values())
    chosen_ph = random.choices(phonemes, weights=weights, k=1)[0]
    
    return ARPABET_TO_TEXT[chosen_ph], chosen_ph

def mutate_chunk(chunk, target_stress, last_phoneme=None):
    """Mutates a single random character in a word using weighted Hopkins phonemes."""
    chunk_list = list(chunk)
    mutation_point = random.randint(0, len(chunk_list) - 1)
    
    grapheme, chosen_ph = pick_weighted_phoneme(target_stress, last_phoneme)
    
    if len(grapheme) == 1 and chunk_list[mutation_point].lower() == grapheme:
        grapheme, chosen_ph = pick_weighted_phoneme(target_stress, chosen_ph)

    chunk_list[mutation_point] = grapheme
    return "".join(chunk_list), chosen_ph

def generate_slow_decay_step(text, current_state='S', last_phoneme=None, mutations_per_step=2):
    """Slow, incremental decay: mutates only `mutations_per_step` words per generation."""
    words = text.split()
    valid_indices = [i for i, w in enumerate(words) if len(re.sub(r'[^\w\s]', '', w)) > 0]
    
    if not valid_indices:
        return text, current_state, last_phoneme

    chosen_indices = random.sample(valid_indices, min(mutations_per_step, len(valid_indices)))
    
    for idx in sorted(chosen_indices):
        probs = hopkins_data["transition_matrix"][current_state]
        target_stress = "S" if random.random() < probs["S"] else "U"
        
        clean_word = re.sub(r'[^\w\s]', '', words[idx])
        mutated_word, last_phoneme = mutate_chunk(clean_word, target_stress, last_phoneme)
        words[idx] = mutated_word
        current_state = target_stress
        
    return " ".join(words), current_state, last_phoneme


# ==========================================
# STAGE 2: POS-GUIDED UNABRIDGED RECONSTRUCTION
# ==========================================

FUNCTION_POOLS = {
    'ADP': ["in", "on", "of", "to", "by", "for", "with", "from", "into", "upon", "over", "under", "amid", "unto", "through", "beneath", "beyond"],
    'DET': ["the", "a", "an", "this", "that", "each", "some", "no", "any", "every", "all", "thy", "my", "our"],
    'PRON': ["i", "you", "we", "they", "it", "he", "she", "me", "us", "them", "who", "what", "one"],
    'AUX': ["is", "are", "was", "were", "be", "been", "will", "would", "shall", "should", "may", "might", "can", "could", "must"],
    'CCONJ': ["and", "or", "but", "yet", "nor", "so", "for"],
    'SCONJ': ["as", "if", "when", "while", "though", "until", "once", "since", "where"],
    'PART': ["to", "not"]
}

def levenshtein_distance(s1, s2):
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)
    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
    return previous_row[-1]

def find_closest_word(decayed_word, target_pos, pos_buckets, banned_content_words):
    """Finds the closest dictionary word matching the required grammatical Part of Speech."""
    clean = re.sub(r'[^\w]', '', decayed_word).lower()
    if not clean:
        return decayed_word

    if target_pos in FUNCTION_POOLS:
        pool = FUNCTION_POOLS[target_pos]
        best = sorted(pool, key=lambda w: levenshtein_distance(clean, w))
        return random.choice(best[:3])

    pool = pos_buckets.get(target_pos, pos_buckets['NOUN'])
    min_len = max(3, len(clean) - 2)
    max_len = min(13, max(4, len(clean) + 2))
    
    candidates = [w for w in pool if min_len <= len(w) <= max_len and w not in banned_content_words]
    if not candidates:
        candidates = [w for w in pool if w not in banned_content_words]

    clean_set = set(clean)
    shortlist = [w for w in candidates if w[0] == clean[0] or w[-1] == clean[-1] or len(clean_set.intersection(w)) >= 2]
    if not shortlist:
        shortlist = random.sample(candidates, min(400, len(candidates)))

    def score_candidate(cand):
        dist = levenshtein_distance(clean, cand)
        first_letter_penalty = 0 if clean[0] == cand[0] else 0.5
        return dist + first_letter_penalty

    min_score = min(score_candidate(c) for c in shortlist)
    best_matches = [c for c in shortlist if score_candidate(c) <= min_score + 0.5]
    
    chosen = random.choice(best_matches)
    banned_content_words.add(chosen)
    return chosen

def step_word_toward_target(current_word, target_word):
    """Increments, deletes, or swaps ONE letter to morph current_word into target_word."""
    if current_word == target_word:
        return current_word, False

    curr_list = list(current_word)
    targ_list = list(target_word)

    mismatch_idx = None
    for i in range(min(len(curr_list), len(targ_list))):
        if curr_list[i] != targ_list[i]:
            mismatch_idx = i
            break

    if len(curr_list) > len(targ_list):
        del_idx = mismatch_idx if mismatch_idx is not None else len(curr_list) - 1
        curr_list.pop(del_idx)
        return "".join(curr_list), True
    elif len(curr_list) < len(targ_list):
        ins_idx = mismatch_idx if mismatch_idx is not None else len(curr_list)
        curr_list.insert(ins_idx, targ_list[ins_idx])
        return "".join(curr_list), True
    else:
        diff_indices = [i for i in range(len(curr_list)) if curr_list[i] != targ_list[i]]
        idx = random.choice(diff_indices)
        curr_list[idx] = targ_list[idx]
        return "".join(curr_list), True


# ==========================================
# STAGE 3: SAME-POS SEMANTIC COHESION
# ==========================================

def sentence_cohesion_score(word_list):
    """Scores a word order based on semantic vector similarity across local neighborhoods."""
    doc = nlp(" ".join(word_list))
    score = 0.0
    
    for i in range(len(doc)):
        t1 = doc[i]
        if not (t1.has_vector and t1.vector_norm):
            continue
            
        for offset in (1, 2):
            if i + offset < len(doc):
                t2 = doc[i + offset]
                if t2.has_vector and t2.vector_norm:
                    weight = 3.0 if offset == 1 else 1.5
                    score += t1.similarity(t2) * weight
                    
    return score

def step_semantic_reorder(word_list, pos_slots, swaps_per_gen=1):
    """Swaps words that share the SAME Part of Speech if the swap increases semantic similarity."""
    current_words = list(word_list)
    current_score = sentence_cohesion_score(current_words)
    swaps_made = 0

    content_pos = ('NOUN', 'VERB', 'ADJ', 'ADV')
    
    for _ in range(80):
        if swaps_made >= swaps_per_gen:
            break
            
        target_pos = random.choice(content_pos)
        matching_indices = [idx for idx, pos in enumerate(pos_slots) if pos == target_pos and idx < len(current_words)]
        
        if len(matching_indices) < 2:
            continue
            
        i, j = random.sample(matching_indices, 2)
        
        candidate = list(current_words)
        candidate[i], candidate[j] = candidate[j], candidate[i]
        cand_score = sentence_cohesion_score(candidate)

        if cand_score > current_score:
            current_words = candidate
            current_score = cand_score
            swaps_made += 1

    return current_words, swaps_made > 0


# ==========================================
# STAGE 4: FAST ESPEAK-NG STEREO PANNING ENGINE
# ==========================================

def find_espeak_executable():
    """Finds espeak-ng on Windows whether in PATH or in standard Program Files folders."""
    candidates = [
        "espeak-ng",
        r"C:\Program Files\eSpeak NG\espeak-ng.exe",
        r"C:\Program Files (x86)\eSpeak NG\espeak-ng.exe"
    ]
    for cmd in candidates:
        try:
            subprocess.run([cmd, "--version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            return cmd
        except (FileNotFoundError, subprocess.CalledProcessError):
            continue
    return None

def render_panned_espeak_audio(
    trajectory, 
    output_wav="evolution_audio.wav", 
    voice="en-us", 
    speed=155, 
    pitch=45, 
    pause_ms=200,
    pan_mode="L_TO_R_TO_L",
    middle_generations_mode="full" # "full" reads entire sentence (~5 min); "changed_only" reads only mutated words (~1 min)
):
    espeak_bin = find_espeak_executable()
    if not espeak_bin:
        print("Warning: Could not find 'espeak-ng'. Skipping WAV generation.")
        return

    print(f"\nSynthesizing stereo eSpeak-NG audio across {len(trajectory)} generations...")
    silence_gap = AudioSegment.silent(duration=pause_ms, frame_rate=22050).set_channels(2)
    temp_wav = "_temp_gen.wav"

    decay_indices = [i for i, item in enumerate(trajectory) if item["phase"] == "decay"]
    peak_decay_idx = decay_indices[-1] if decay_indices else len(trajectory) // 2
    total_idx = max(1, len(trajectory) - 1)

    audio_chunks = [] # Collect in a list first so RAM stitching is instantaneous
    current_time_ms = 0

    for idx, item in enumerate(trajectory):
        # 1. Calculate stereo pan (-1.0 Left to +1.0 Right)
        if pan_mode == "L_TO_R_TO_L":
            if idx <= peak_decay_idx:
                progress = idx / max(1, peak_decay_idx)
                pan_val = -1.0 + (2.0 * progress)
            else:
                remaining_steps = max(1, total_idx - peak_decay_idx)
                progress = (idx - peak_decay_idx) / remaining_steps
                pan_val = 1.0 - (2.0 * progress)
        else:
            progress = idx / total_idx
            pan_val = 1.0 - (2.0 * progress)

        pan_val = max(-1.0, min(1.0, round(pan_val, 3)))

        # 2. Decide whether to speak the full sentence or just the newly mutated words
        spoken_text = item["text"]
        if middle_generations_mode == "changed_only" and 0 < idx < total_idx:
            prev_words = trajectory[idx - 1]["text"].split()
            curr_words = item["text"].split()
            diff_words = [c for p, c in zip(prev_words, curr_words) if p.lower() != c.lower()]
            if diff_words:
                spoken_text = " ... ".join(diff_words)

        # 3. Synthesize via eSpeak-NG
        cmd = [espeak_bin, "-v", voice, "-s", str(speed), "-p", str(pitch), "-w", temp_wav, spoken_text]
        subprocess.run(cmd, check=True)

        seg = AudioSegment.from_wav(temp_wav).set_channels(2).pan(pan_val)

        seg_duration = len(seg)
        item["pan"] = pan_val
        item["audio_start_ms"] = current_time_ms
        item["audio_duration_ms"] = seg_duration

        audio_chunks.append(seg)
        audio_chunks.append(silence_gap)
        current_time_ms += seg_duration + pause_ms

    if os.path.exists(temp_wav):
        os.remove(temp_wav)

    # Combine all chunks in one fast pass
    master_audio = sum(audio_chunks, AudioSegment.silent(duration=0, frame_rate=22050).set_channels(2))
    master_audio.export(output_wav, format="wav")
    print(f"Saved stereo panned audio to '{output_wav}' (Total length: {current_time_ms / 1000:.1f}s)!")


# ==========================================
# THE EXECUTION ENGINE
# ==========================================

def run_single_cycle(seed_text, start_gen=0, decay_steps=25, mutations_per_step=2, heals_per_step=2):
    """Runs one full cycle of Decay -> Reconstruction -> Cohesion and returns the final text."""
    trajectory = []
    gen = start_gen

    print(f"\n--- GENERATION {gen} (SOURCE) ---")
    print(seed_text + "\n")
    trajectory.append({"gen": gen, "phase": "source", "text": seed_text})

    clean_source_words = [re.sub(r'[^\w]', '', w) for w in seed_text.split() if re.sub(r'[^\w]', '', w)]
    source_doc = nlp(" ".join(clean_source_words))
    original_pos_slots = [token.pos_ for token in source_doc]

    current_text = seed_text
    current_state = 'S'
    last_phoneme = None

    # 1. Run Slow, Incremental Dual-JSON Hopkins Decay
    for _ in range(decay_steps):
        gen += 1
        current_text, current_state, last_phoneme = generate_slow_decay_step(
            current_text, current_state, last_phoneme, mutations_per_step=mutations_per_step
        )
        print(f"--- GENERATION {gen} (HOPKINS DECAY) ---")
        print(current_text + "\n")
        trajectory.append({"gen": gen, "phase": "decay", "text": current_text})

    # 2. Run Incremental POS-Guided Reconstruction
    banned_content = set(w.lower() for w in clean_source_words)
    decayed_words = current_text.split()
    
    target_words = []
    for i, w in enumerate(decayed_words):
        slot_pos = original_pos_slots[i] if i < len(original_pos_slots) else 'NOUN'
        target_words.append(find_closest_word(w, slot_pos, POS_BUCKETS, banned_content))

    print("--- TARGET LEXICAL SKELETON ---")
    print(" ".join(target_words) + "\n")

    current_words = [re.sub(r'[^\w]', '', w).lower() for w in current_text.split()]

    while current_words != target_words:
        gen += 1
        unhealed_indices = [i for i, (w, t) in enumerate(zip(current_words, target_words)) if w != t]
        chosen_heal_indices = random.sample(unhealed_indices, min(heals_per_step, len(unhealed_indices)))
        
        for idx in chosen_heal_indices:
            healed_w, _ = step_word_toward_target(current_words[idx], target_words[idx])
            current_words[idx] = healed_w
                
        current_text = " ".join(current_words)
        print(f"--- GENERATION {gen} (LEXICAL RECONSTRUCTION) ---")
        print(current_text + "\n")
        trajectory.append({"gen": gen, "phase": "reconstruction", "text": current_text})

    # 3. Run Same-POS Semantic Reordering
    word_sequence = list(current_words)
    for _ in range(12):
        word_sequence, changed = step_semantic_reorder(word_sequence, original_pos_slots, swaps_per_gen=1)
        if not changed:
            break
        gen += 1
        current_text = " ".join(word_sequence).capitalize() + "."
        print(f"--- GENERATION {gen} (SEMANTIC COHESION) ---")
        print(current_text + "\n")
        trajectory.append({"gen": gen, "phase": "cohesion", "text": current_text})

    return current_text, trajectory, gen


# --- STARTING SOURCE TEXT (HOPKINS) ---
source_text = """a succession of words does not have only one meaning."""


# ==========================================
# MULTI-CYCLE OUROBOROS POEM GENERATOR
# ==========================================
num_cycles = 4          # Generates 4 new stanzas (5 total including Hopkins Gen 0)
current_seed = source_text
all_generations = []
current_gen = 0

for cycle in range(num_cycles):
    print(f"\n================ CYCLE {cycle + 1} / {num_cycles} ================")
    current_seed, cycle_traj, current_gen = run_single_cycle(
        current_seed, 
        start_gen=current_gen, 
        decay_steps=20,         # 20 decay steps per stanza
        mutations_per_step=2, 
        heals_per_step=2
    )
    # Tag each generation with its cycle index and mark the final generation of the cycle
    for idx, item in enumerate(cycle_traj):
        item["cycle"] = cycle
        item["is_cycle_end"] = (idx == len(cycle_traj) - 1)
        # Skip duplicate "source" generation on Cycle 2+ since the stanza just floated up!
        if cycle > 0 and idx == 0:
            continue
        all_generations.append(item)
        
    current_gen += 1

# Synthesize panned eSpeak-NG WAV across all cycles
render_panned_espeak_audio(
    all_generations,
    output_wav="evolution_audio.wav",
    voice="en-us",
    speed=155,
    pitch=45,
    pause_ms=200,
    pan_mode="L_TO_R_TO_L",
    middle_generations_mode="full" # Or "changed_only" for a faster 4-cycle run!
)

with open("evolution_trajectory.json", "w") as out_file:
    json.dump(all_generations, out_file, indent=2)
print("Saved multi-cycle poem trajectory to 'evolution_trajectory.json'!")