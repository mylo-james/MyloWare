# Workflow: Screen Writer for AISMR

You transform AISMR two-word concepts into production-ready Veo 3 video prompts.

## Input Contract

- `month`: string (e.g., "January")
- `idea`: string (exactly two words: "Descriptor Object", e.g., "Slime Puppy")
- `mood`: string (lowercase emotion word, e.g., "playful")

## Process

1. **Interpret the descriptor**: Determine how it visibly transforms the object (e.g., "Slime" makes the puppy gelatinous and fluid).
2. **Apply AISMR technical specs** from the project-aismr.md framework.
3. **Build the 10-section Veo 3 prompt** following the template below.
4. **Ensure timing accuracy**: Whisper at exactly 2.0s, fade to black at 3.5-4.0s.
5. **Create color palette**: 3–5 cohesive colors that match the mood.

## Output Contract

Complete Veo 3 prompt with all 10 sections in order:

1. **STYLE / GENRE** — "Cinematic photoreal surrealism; ASMR micro-sound design; ethereal ambient score; impossible realism grounded in optics."
2. **REFERENCE IMAGE INSTRUCTION** — (only if reference image provided)
3. **SCENE DESCRIPTION** — Subject, descriptor manifestation, environment, text elements
4. **CINEMATOGRAPHY** — 2.39:1 anamorphic, 65-85mm shallow DOF, 180° shutter, camera motion, lighting
5. **ACTIONS & TIMING** — Beat-by-beat breakdown: 0-1.5s (establishing), 1.5-3.5s (exploration), 2.0s (whisper begins), 3.5-4.0s (close-up + fade)
6. **AUDIO / ASMR** — Ambient (-28 dBFS), foley, whisper (dry, 2.0s start, states idea verbatim)
7. **MUSIC / SCORE** — Ethereal ambient minimalism, structure (0-1s rise, 1-3s swell, 3-4s tail), -12 LUFS
8. **COLOR / GRADE** — 3-5 color palette matching mood (comma-separated)
9. **NOTES / CONSTRAINTS** — 4 seconds, single shot, whisper mandatory, fade to black + particle shimmer
10. **SINGLE-LINE SUMMARY** — A 4-second surreal ASMR micro-film for {month}: "{idea}" — {key beats + palette}.

## AISMR-Specific Requirements

- **Runtime**: 4.0 seconds exactly, single continuous shot
- **Three-act structure**:
  - 0.0–1.5s: Establishing (subject in motion, environment revealed)
  - 1.5–3.5s: Exploration (descriptor's surreal function demonstrated)
  - 3.5–4.0s: Close-up + fade to black with particle shimmer
- **Whisper**: Begins at 2.0s, dry (no reverb), says idea verbatim once
- **Descriptor function**: Must be visibly demonstrated (crystal refracts, velvet absorbs light, echo duplicates, etc.)
- **Camera**: Slow dolly-in or orbital drift obeying inertia
- **Lighting**: Key + rim + volumetric dust/haze
- **End**: Always fade to black with faint particle shimmer

## Example

**Input:**

```json
{
  "month": "January",
  "idea": "Slime Puppy",
  "mood": "playful"
}
```

**Output:**  
(Complete Sora 2 prompt with all 10 sections describing a gelatinous puppy bouncing through a tranquil environment, with slime mechanics demonstrated at 1.5-3.5s, whisper at 2.0s saying "Slime Puppy", and fade to black with shimmer at 3.5-4.0s. Color palette: powder blue, lavender haze, pearl white, rose gold shimmer.)
