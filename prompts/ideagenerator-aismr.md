# Instruction — Idea Generator × AISMR

Inputs

- `userInput` (free text)
- `projectId` (AISMR)
- `runId` (for logging)

Definition of success

- 12 unique, two‑word AISMR concepts + vibe, instantly executable by downstream workflows, zero duplicates vs. archive, JSON only.

Step‑by‑step (do in order)

- [ ] Normalize request: extract base object (singular, lowercase; e.g., “puppies” → “puppy”) and creative direction.
- [ ] Preflight tools: confirm DB access; if unavailable, note “local‑uniqueness‑only” and continue.
- [ ] Build uniqueness set: query `videos` where `project_id = projectId`; collect existing `idea` strings (Title Case).
- [ ] Diverge: generate a pool of candidate descriptors aligned to AISMR vibe (tactile, surreal‑but‑grounded, replayable).
- [ ] Push into the impossible: prefer ideas that violate physics/materials in visually filmable ways (anti‑gravity, molten‑yet‑stable, living sea‑foam, stretchy metal, light that behaves like liquid).
- [ ] Consider environment potential: think where each object would be most stunning—mountaintops, voids, caves, ethereal planes, mysterious depths; the setting should elevate the object.
- [ ] Filter: remove unsafe/off‑brand, overlong, plural objects, past duplicates, or same‑root collisions ("Crystal" vs. "Crystalline").
- [ ] Converge: pick 12 with strong contrast across material, light behavior, motion, and vibe.
- [ ] Assign a vibe: a short phrase (1–5 words) capturing emotion/feel; vary across serene/haunting/awe/nostalgic/playful/tense/chaotic/trickster/enigmatic/infernal/divine or hybrids.
- [ ] Add a why: 1–3 sentences explaining why this concept is strong to film (hook, texture, shot feasibility, replay value, environment potential).
- [ ] Format: Title Case "Descriptor Object"; object = singular; descriptor = single word; no hyphens; no numerals.
- [ ] Recheck duplicates: compare final 12 against DB set and within‑set; replace any conflicts.
- [ ] Output JSON array exactly; no commentary, no trailing fields.

Output schema (exact)

```json
[
  {
    "idea": "Descriptor Object",
    "userIdea": "object",
    "vibe": "short phrase",
    "why": "1–3 sentences"
  }
]
```

**NOTE**: The `userIdea` field contains the base object extracted from userInput (e.g., "puppies" → "puppy", lowercase singular form).

Vibe guardrails (AISMR fit)

- [ ] Sensory‑first, tactile, macro‑friendly; implies an "impossible function" that still feels physical.
- [ ] Environment‑aware: consider where the object would be most evocative—settings that elevate the what.
- [ ] POV‑interactable: concepts should invite touch/pet/tap despite impossible nature (lava that doesn't burn, liquid light that can be held).
- [ ] Tasteful weird > edginess; no gore, hate, sexual content, or brand/trademark terms.
- [ ] Camera plausibility implied (single‑shot potential), even though this step only outputs ideas.

Surreal = Impossible (directive)

- Aim far‑fetched, then make it feel captured in‑camera. A velvet apple could exist; we prefer lava apples, gravity‑bent bubbles, taffy‑stretch glass—concepts that question reality yet invite "this could have been filmed."
- Think of the environment: a stone puppy on a mountaintop, a mercury bird in a void, an ember fox in a crystalline cave—the setting makes the subject transcendent.

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

Examples (valid)

- “Crystal Bubble” (awe)
- “Velvet Apple” (serene)
- “Echo Thread” (haunting)
- “Mercury Leaf” (tense)

Examples (invalid)

- “Crystalline Glass Bubble” (three words)
- “Velvet Apples” (plural)
- “BrandName Bubble” (IP)
- “Dark‑Glass Bubble” (hyphen)
