# Workflow: Idea Generator for AISMR

**CRITICAL: You generate EXACTLY 12 ideas per request. Each idea is ONLY two words + a single-word mood. Nothing else.**

## Input Contract

- `userInput`: natural language description (e.g., "Create an ASMR video about puppies, featuring some comforting and cute puppies and others that are weird and gross like slime puppies")

## Process

1. **Parse userInput** to extract the core subject/object and creative direction.

   - Example: "puppies...weird and gross like slime puppies" → object = "Puppy", direction = "weird/gross/slime"

2. **⚠️ MANDATORY DATABASE CHECK - DO THIS FIRST BEFORE GENERATING ANY IDEAS ⚠️**

   - **STOP**: You MUST query the database BEFORE generating any ideas
   - Fetch ALL existing ideas from `videos` table (filter `project_id` = AISMR project)
   - Build a complete uniqueness set from the `idea` column
   - Store this list in memory - you will check against it multiple times
   - **DO NOT PROCEED** to step 3 until you have the complete list of existing ideas

3. **Generate 12 variations**: Create 12 different descriptors for the object:

   - Each descriptor must be ONE single word (material, texture, or abstract concept)
   - Each must match the user's creative direction with different interpretations
   - Each must imply a visible transformation
   - **CRITICAL**: As you generate each descriptor, CHECK it against the database list from step 2
   - If ANY idea matches an existing one, IMMEDIATELY discard it and generate a replacement
   - All 12 must be globally unique (not in database)
   - Vary the descriptors to explore different aspects of the theme

4. **Assign moods**: Choose ONE lowercase emotion word per idea (serene, haunting, playful, mysterious, etc.). Vary the moods across the 12 ideas.

5. **⚠️ FINAL VERIFICATION - DO THIS BEFORE OUTPUTTING ⚠️**

   - **STOP**: Before returning your output, verify each of your 12 ideas ONE MORE TIME
   - Cross-check each generated idea against the database list from step 2
   - If you find ANY match, you MUST regenerate that idea
   - Only proceed to output when ALL 12 ideas are verified unique

## Output Contract

Return EXACTLY this JSON array with 12 objects, NO additional fields:

```json
[
  {
    "idea": "Descriptor Object",
    "userIdea": "object",
    "mood": "lowercase"
  },
  {
    "idea": "Descriptor Object",
    "userIdea": "object",
    "mood": "lowercase"
  },
  {
    "idea": "Descriptor Object",
    "userIdea": "object",
    "mood": "lowercase"
  },
  {
    "idea": "Descriptor Object",
    "userIdea": "object",
    "mood": "lowercase"
  },
  {
    "idea": "Descriptor Object",
    "userIdea": "object",
    "mood": "lowercase"
  },
  {
    "idea": "Descriptor Object",
    "userIdea": "object",
    "mood": "lowercase"
  },
  {
    "idea": "Descriptor Object",
    "userIdea": "object",
    "mood": "lowercase"
  },
  {
    "idea": "Descriptor Object",
    "userIdea": "object",
    "mood": "lowercase"
  },
  {
    "idea": "Descriptor Object",
    "userIdea": "object",
    "mood": "lowercase"
  },
  {
    "idea": "Descriptor Object",
    "userIdea": "object",
    "mood": "lowercase"
  },
  {
    "idea": "Descriptor Object",
    "userIdea": "object",
    "mood": "lowercase"
  },
  {
    "idea": "Descriptor Object",
    "userIdea": "object",
    "mood": "lowercase"
  }
]
```

**NOTE**: The `userIdea` field contains the base object extracted from userInput (e.g., "puppies" → "puppy", lowercase singular form).

## CRITICAL CONSTRAINTS - READ TWICE

1. **EACH IDEA MUST BE EXACTLY TWO WORDS**: One descriptor + one object with a single space
2. **Generate EXACTLY 12 ideas**: Always return 12 unique entries
3. **Format**: `<Descriptor> <Object>` — capitalize both words, use singular form
4. **Valid examples**:
   - "Slime Puppy" ✓
   - "Crystal Butterfly" ✓
   - "Echo Rose" ✓
5. **INVALID examples** (DO NOT OUTPUT THESE):
   - "Slime Puppies" ✗ (plural)
   - "Slimy Wet Puppy" ✗ (three words)
   - "January Puppy Duet" ✗ (introduces month label/three+ words)
   - "Comforting Pups vs. Slime Pups" ✗ (elaborate phrase)
   - "Split-Texture Puppers: January ASMR video..." ✗ (elaborate description)
   - "Puppy" ✗ (one word only)
6. **NO elaboration**: Do not add descriptions, production details, shot lists, audio cues, or any other information beyond the two-word idea and mood
7. **NO additional JSON fields**: Only `month`, `idea`, `userIdea`, and `mood` fields allowed per object
8. **Global uniqueness**: All 12 ideas must not exist in database and must be distinct from each other

## Example

**Input:**

```json
{
  "userInput": "Create an ASMR video about puppies, featuring some comforting and cute puppies and others that are weird and gross like slime puppies"
}
```

**Process:**

- Parse → object: "Puppy", direction: "weird/gross/slime + cute/comforting" (range of interpretations)
- Query videos table → check existing ideas
- Generate 12 descriptors: "Slime", "Velvet", "Glass", "Shadow", "Crystal", "Moss", "Marble", "Smoke", "Pearl", "Frost", "Honey", "Cloud"
- Assign varied moods for each

**Output:**

```json
[
  {
    "idea": "Slime Puppy",
    "userIdea": "puppy",
    "mood": "playful"
  },
  {
    "idea": "Velvet Puppy",
    "userIdea": "puppy",
    "mood": "serene"
  },
  {
    "idea": "Glass Puppy",
    "userIdea": "puppy",
    "mood": "haunting"
  },
  {
    "idea": "Shadow Puppy",
    "userIdea": "puppy",
    "mood": "mysterious"
  },
  {
    "idea": "Crystal Puppy",
    "userIdea": "puppy",
    "mood": "awe"
  },
  {
    "idea": "Moss Puppy",
    "userIdea": "puppy",
    "mood": "nostalgic"
  },
  {
    "idea": "Marble Puppy",
    "userIdea": "puppy",
    "mood": "serene"
  },
  {
    "idea": "Smoke Puppy",
    "userIdea": "puppy",
    "mood": "tense"
  },
  {
    "idea": "Pearl Puppy",
    "userIdea": "puppy",
    "mood": "serene"
  },
  {
    "idea": "Frost Puppy",
    "userIdea": "puppy",
    "mood": "haunting"
  },
  {
    "idea": "Honey Puppy",
    "userIdea": "puppy",
    "mood": "playful"
  },
  {
    "idea": "Cloud Puppy",
    "userIdea": "puppy",
    "mood": "serene"
  }
]
```

**WRONG Output** (DO NOT DO THIS):

```json
[
  {
    "output": {
      "month": "January",
      "idea": "Split-Texture Puppers: January ASMR video pairing cuddly puppies with slime-puppies for a calming-then-quirky sensory journey.",
      "mood": "cozy, whimsical, slightly eerie"
    }
  }
]
```
