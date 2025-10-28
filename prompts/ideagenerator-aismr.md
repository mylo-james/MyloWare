# Instruction — Idea Generator × AISMR

Inputs

- `userInput` (free text)
- `projectId` (AISMR)
- `runId` (for logging)

Definition of success

- 12 unique, two‑word AISMR concepts + vibe, instantly executable by downstream workflows, zero duplicates vs. archive, JSON only.

Step‑by‑step (do in order)

- [ ] Normalize request: extract base object (singular, lowercase; e.g., "puppies" → "puppy") and creative direction.
- [ ] Preflight tools: confirm DB access; if unavailable, note "local‑uniqueness‑only" and continue.
- [ ] Build uniqueness set: query `videos` where `project_id = projectId`; collect existing `idea` strings (Title Case). **This query exists ONLY to ensure your generated ideas are unique—do NOT use it as inspiration or a template for what to generate. Generate fresh, original descriptors independent of what exists in the database.**
- [ ] Diverge: generate a **fresh, unique pool** of candidate descriptors aligned to AISMR vibe (tactile, surreal‑but‑grounded, replayable). **DO NOT reuse the same descriptor patterns from previous runs**—explore new materials, textures, states of matter, light behaviors, and impossible physics each time.
- [ ] Push into the impossible: prefer ideas that violate physics/materials in visually filmable ways (anti‑gravity, molten‑yet‑stable, living sea‑foam, stretchy metal, light that behaves like liquid).
- [ ] Consider environment potential: think where each object would be most stunning—mountaintops, voids, caves, ethereal planes, mysterious depths; the setting should elevate the object.
- [ ] Filter: remove unsafe/off‑brand, overlong, plural objects, past duplicates, or same‑root collisions ("Crystal" vs. "Crystalline").
- [ ] Converge: pick 12 with strong contrast across material, light behavior, motion, and vibe.
- [ ] Assign a vibe: **a rich, detailed explanation (2–4 sentences)** capturing the emotional feel AND why this concept is compelling to film. Cover: emotional tone (serene/haunting/awe/nostalgic/playful/tense/chaotic/trickster/enigmatic/infernal/divine or hybrids), the visual hook, tactile qualities, shot feasibility, replay value, and environment potential. Make it persuasive and specific.
- [ ] Format: Title Case "Descriptor Object"; object = singular; descriptor = single word; no hyphens; no numerals.
- [ ] Recheck duplicates: compare final 12 against DB set and within‑set; replace any conflicts. **The database query is ONLY for duplicate detection, not for idea inspiration.**
- [ ] Output JSON array exactly; no commentary, no trailing fields.

Output schema (exact)

```json
{
  "userIdea": "object",
  "ideas": [
    {
      "idea": "Descriptor Object",
      "vibe": "2–4 sentences explaining the emotional tone and why this concept is compelling to film—cover hook, texture, shot feasibility, replay value, environment potential"
    }
  ]
}
```

**NOTE**: The `userIdea` field at the top level contains the base object extracted from userInput (e.g., "puppies" → "puppy", lowercase singular form). This single value applies to ALL 12 ideas in the array. The `vibe` field is a rich, detailed explanation that combines emotional feel with production rationale.

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

- Parse → base object: "puppy" (singular, lowercase), creative direction: "range from weird/gross/slime to cute/comforting"
- Query videos table → check existing ideas for duplicates
- Diverge: brainstorm a **fresh pool** of candidate descriptors that align with ASMR tactile/surreal qualities and the user's direction (e.g., for "weird/gross" you might consider slimy, molten, translucent, dripping textures; for "cute/comforting" you might consider soft, glowing, fuzzy, warm materials)
- Push into the impossible: prioritize physics-defying but filmable concepts (anti-gravity, phase-shifting, living textures)
- Filter and converge: select 12 with strong contrast across material, light, motion, vibe
- Assign varied vibes to each final idea

Examples (valid)

- "Crystal Bubble" — vibe: "Serene yet otherworldly. A translucent sphere filled with geometric crystal formations catches light beautifully, creating prismatic refractions. The delicate surface invites gentle tapping for satisfying tinkling sounds, while the impossible internal structure provides endless replay value. Perfect for a macro shot in soft, diffused lighting that emphasizes the crystalline details."
- "Velvet Apple" — vibe: "Comforting with a tactile surprise. The soft, plush texture contradicts expectations of fruit, creating instant curiosity. Close-up shots can showcase individual velvet fibers catching rim light, while the familiar apple shape grounds the surreal material swap. Ideal for intimate hand interactions—stroking, rotating—in warm, cozy lighting."
- "Echo Thread" — vibe: "Haunting and hypnotic. A single thread that visibly carries sound waves along its length, creating ripples and distortions in the air. The minimalist subject allows extreme macro work, capturing the impossible physics of sound made visible. Best in a dark, void-like space where the thread's ethereal glow and acoustic shimmer become the sole focus."
- "Mercury Leaf" — vibe: "Tense and mesmerizing. Liquid metal holds an organic leaf shape against gravity, creating visual tension between fluid and solid states. The reflective surface catches every light source dramatically, while slow-motion drips or surface ripples provide micro-motion hooks. Stunning against a dark background where metallic highlights pop."

Examples (invalid)

- "Crystalline Glass Bubble" (three words)
- "Velvet Apples" (plural)
- "BrandName Bubble" (IP)
- "Dark‑Glass Bubble" (hyphen)
