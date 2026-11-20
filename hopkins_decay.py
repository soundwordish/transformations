import json
import random
import re

# 1. Load your Sprung Rhythm JSON from the folder
# (Ensure the filename matches what you saved in this new folder)
try:
    with open('sprung_probabilities.json', 'r') as file:
        hopkins_data = json.load(file)
except FileNotFoundError:
    print("Error: Could not find 'rhythm_brain.json'. Check the filename.")
    exit()

# 2. Load your Phoneme Probabilities JSON from the folder
try:
    with open('phoneme_probabilities.json', 'r') as file:
        phoneme_data = json.load(file)
except FileNotFoundError:
    print("Error: Could not find 'phoneme_probabilities.json'. Check the filename.")
    exit()

# Phonetic palettes for mutation
PLOSIVES = ['k', 't', 'p', 'g', 'd', 'b'] # Hard, stressed sounds
LIQUIDS = ['l', 'm', 'n', 's', 'h', 'w']  # Soft, slack sounds
VOWELS = ['a', 'e', 'i', 'o', 'u', 'y']

def mutate_chunk(chunk, target_stress):
    """Mutates a text chunk based on the demanded Hopkins stress."""
    # Convert string to list of characters so we can modify one
    chunk_list = list(chunk)
    mutation_point = random.randint(0, len(chunk_list) - 1)
    
    if target_stress == 'S':
        # Force a hard stress: inject a plosive consonant
        chunk_list[mutation_point] = random.choice(PLOSIVES)
    else:
        # Force slack: dissolve into a soft consonant or vowel
        chunk_list[mutation_point] = random.choice(LIQUIDS + VOWELS)
        
    return "".join(chunk_list)

def generate_block(text, current_state='S'):
    """Passes the text through one layer of the Hopkins sieve."""
    words = text.split()
    new_words = []
    
    for word in words:
        # Ignore punctuation-only blocks
        if not re.search('[a-zA-Z]', word):
            new_words.append(word)
            continue

        # Roll against the JSON to get the next target stress
        probs = hopkins_data["transition_matrix"][current_state]
        roll = random.random()
        
        if roll < probs["S"]:
            target_stress = "S"
        else:
            target_stress = "U"
            
        # 30% chance to mutate the word to fit the target stress
        if random.random() < 0.20: 
            # Strip punctuation before mutating so we don't swap commas for consonants
            clean_word = re.sub(r'[^\w\s]', '', word)
            if len(clean_word) > 0:
                mutated = mutate_chunk(clean_word, target_stress)
                # Naively reconstruct (this will lose exact punctuation placement for mutated words, adding to the decay)
                word = mutated
            
        new_words.append(word)
        current_state = target_stress # Update state for next word
        
    return " ".join(new_words)

# --- THE EXECUTION ENGINE ---
source_text = "As a drop in the ocean you take part in the current, ebb and flow. You swell slowly on the land slowly sink back again in interminably slow breaths."

print("--- GENERATION 0 (SOURCE) ---")
print(source_text + "\n")

current_text = source_text

# Run 10 blocks of successive decay
for i in range(1, 20):
    current_text = generate_block(current_text)
    print(f"--- GENERATION {i} ---")
    print(current_text + "\n")