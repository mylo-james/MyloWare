# AISMR Transitions & Experience Spec (v1.0)

**Purpose**: Set firm guardrails and implementation patterns so AISMR outputs feel continuous, tactile, and sacred — from the first millisecond to the last — with transitions that never “stop for the cut.”

**Audience**: AI generation agents, render pipeline, and template authors.

**Last updated**: 2025‑10‑26

---

## 0) Creative Principles (Non‑negotiable)

- **Always in motion**: Frames must _enter and exit in motion_. Do not freeze before the cut; micro‑motion continues through the last frame.
- **No cartoony look**: Objects feel **divine realism** — sacred, textured, weighty. Particle effects are allowed but subtle (dust motes in slant light, not confetti cannons).
- **Transitions never pause content**: Clips continue moving _through_ transitions. The transition is the flow, not a booking stop.
- **POV as default**: A first‑person perspective may interact with objects (trace edges, brush dust, tap). Show varied bodies/hands across clips.
- **ASMR audio direction**: Always whisper; recorded as if into a close ASMR mic (proximity effect, light mouth clicks okay), synced taps/handling to visuals.
- **Music bed**: Soft, sustained drone in **A minor** with gentle swells, never overpowering the whisper/foley.
- **Editor’s job is finishing**: Do **not** add theatrical fade‑to‑black as content; reserve hard fades for the offline edit only when requested.

---

## 1) Transition Policy

### Default: **Dissolve (Cross‑Fade via Overlap)**

**Why**: Keeps motion alive; no dip to black; feels continuous.

**Pattern**:

1. Layer Clip A **above** Clip B (A on a higher track).
2. Start Clip B **before** Clip A ends by the overlap amount (default **1.0s**).
3. Apply `transition.out: "fade"` on A. B remains visible underneath.
4. Optional: Apply `transition.in: "fade"` on the very first clip to fade in from background at the start of the video.

**Minimal JSON (1.0s overlap):**

```json
{
  "timeline": {
    "tracks": [
      {
        "clips": [
          {
            "asset": { "type": "video", "src": "A.mp4" },
            "start": 0,
            "length": 5,
            "transition": { "in": "fade", "out": "fade" }
          }
        ]
      },
      {
        "clips": [
          {
            "asset": { "type": "video", "src": "B.mp4" },
            "start": 4, // 1.0s overlap with A (A ends at 5)
            "length": 5
          }
        ]
      }
    ]
  }
}
```

**Notes**:

- The dissolve uses a **1s** implicit fade duration. For non‑1s durations, use **Animations/Tweens** to keyframe `opacity` (see §4.1).

---

### Alternative: **Dip / Fade‑Through‑Color** (rare)

**Use sparingly**: This introduces a micro‑pause; only when narrative rhythm truly benefits (e.g., section break).

**Pattern**:

- No overlap. Set `transition: { "in": "fade", "out": "fade" }` on both clips.
- The `timeline.background` color is the “through” color (default black).

**Sketch**:

```json
{
  "timeline": {
    "background": "#000000",
    "tracks": [
      {
        "clips": [
          {
            "asset": { "type": "video", "src": "A.mp4" },
            "start": 0,
            "length": 5,
            "transition": { "in": "fade", "out": "fade" }
          }
        ]
      },
      {
        "clips": [
          {
            "asset": { "type": "video", "src": "B.mp4" },
            "start": 5,
            "length": 5,
            "transition": { "in": "fade", "out": "fade" }
          }
        ]
      }
    ]
  }
}
```

---

### Designer Transitions That Still Flow

**A) Alpha Overlay (QuickTime .mov with transparency)**  
Layer a brief transition animation over the join (e.g., a soft dust ring) to hide the seam while clips keep moving.

```json
{
  "timeline": {
    "tracks": [
      {
        "clips": [
          {
            "asset": { "type": "video", "src": "A.mp4" },
            "start": 0,
            "length": 7,
            "transition": { "out": "fade" }
          }
        ]
      },
      { "clips": [{ "asset": { "type": "video", "src": "B.mp4" }, "start": 6, "length": 5 }] },
      {
        "clips": [
          {
            "asset": { "type": "video", "src": "overlays/soft-dust.mov" },
            "start": 6,
            "length": 1.5
          }
        ]
      }
    ]
  }
}
```

- Use **.mov with alpha** for transparency. Avoid WebM for alpha overlays.
- Keep overlays restrained to avoid cartoon vibes.

**B) Luma Matte Transition**  
Use a black/white animated matte to reveal B underneath A (black = transparent, white = opaque).

```json
{
  "timeline": {
    "tracks": [
      {
        "clips": [
          { "asset": { "type": "luma", "src": "luma/arrow-down.mp4" }, "start": 3, "length": 2 },
          { "asset": { "type": "video", "src": "A.mp4" }, "start": 0, "length": 4 }
        ]
      },
      {
        "clips": [{ "asset": { "type": "video", "src": "B.mp4" }, "start": 3, "length": 4 }]
      }
    ]
  }
}
```

---

## 2) Motion & Camera Rules

- **Micro‑motion baked in**: Final second of every clip must carry gentle life (e.g., slow push, sub‑pixel drift, dust).
- **Use built‑in effects for subtlety**: `effect: "zoomIn"` / `"zoomOut"` with Slow/Fast variants, or tween `offset`/`opacity` for bespoke motion.
- **Avoid hard stops**: Never freeze a clip before the cut.

**Example: last‑second micro‑motion with Tweens**

```json
{
  "timeline": {
    "tracks": [
      {
        "clips": [
          {
            "asset": { "type": "video", "src": "A.mp4" },
            "start": 0,
            "length": 6,
            "offset": {
              "x": [
                {
                  "from": 0,
                  "to": 0.02,
                  "start": 5,
                  "length": 1,
                  "interpolation": "bezier",
                  "easing": "easeInOutSine"
                }
              ]
            },
            "opacity": [
              { "from": 1, "to": 1, "start": 0, "length": 5 },
              { "from": 1, "to": 0.0, "start": 5, "length": 1 } // if doing a custom cross via underlying B
            ]
          }
        ]
      }
    ]
  }
}
```

---

## 3) Audio Policy (ASMR‑first)

- **Voice**: All narration is **whisper**, captured like a close‑mic ASMR take (proximity effect, low noise, light breath pops acceptable).
- **Foley**: Nail tapping/hand interactions must sync to visuals, especially on stone/rock surfaces.
- **Music**: Soft drone _in A minor_. Swell then soften across each piece to imply a harmonic journey.

**Suggested minimalist progressions in A minor**:

- `i – VII – VI – VII` → Amin–G–F–G (ancient, looping)
- `i – iv – v – i` → Amin–Dmin–Emin–Amin (traditional mantra)
- Add a steady **A** or **D** drone under everything; change chords by **emphasis** and **voicing**, not abrupt shifts.

**Mix discipline**:

- Music: −18 to −22 LUFS integrated; whispers ride above.
- Crossfades: On clip audio, use `volumeEffect` (`fadeIn`, `fadeOut`, `fadeInFadeOut`). On soundtrack, use `effect` to shape global fades.
- Side‑chain ducking rule (optional): If transient foley > −14 dBFS, duck music −3 dB for 200–400 ms.

**Soundtrack sketch**:

```json
{
  "timeline": {
    "soundtrack": {
      "src": "music/ambient_aminor.mp3",
      "effect": "fadeInFadeOut",
      "volume": 0.8
    },
    "tracks": [
      {
        "clips": [
          {
            "asset": {
              "type": "video",
              "src": "A.mp4",
              "volume": 0.0,
              "volumeEffect": "fadeIn" // if clip contains sync audio, crossfade appropriately
            },
            "start": 0,
            "length": 5,
            "transition": { "in": "fade", "out": "fade" }
          }
        ]
      }
    ]
  }
}
```

---

## 4) Implementation Details

### 4.1 Exact Cross‑Duration (Custom, not 1s)

Use **Animations/Tweens** to keyframe `opacity`:

- Clip A: `opacity` 1 → 0 across the overlap window.
- Clip B: either start fully visible underneath _or_ tween 0 → 1 for symmetrical dissolve.
- Tweens support `linear` or `bezier` with easings (e.g., `easeInOutQuart`).

### 4.2 Overlap Formula

For a target overlap `ovl` seconds:  
`start_B = start_A + length_A - ovl`

### 4.3 Alpha & Luma

- **Alpha overlays** must be **.mov with alpha** (WebM alpha not supported for overlays).
- **Luma mattes**: Provide grayscale video/image as `{"type":"luma"}` above the source being masked on the same track; white reveals, black hides.

### 4.4 Effect Catalog (subtle motion)

- `effect`: `"zoomIn" | "zoomOut" | "slideLeft" | "slideRight" | "slideUp" | "slideDown"`
- Speed modifiers: append `Fast` or `Slow` (e.g., `zoomInSlow`).

---

## 5) POV & Tactility

- Hands interact with objects gently: trace, brush, tap. Nails/skin tones vary across clips.
- Surfaces: stone/rock, wood, glass; ensure distinct tap timbres per material.
- Lighting: naturalistic, volumetric; particles as sunlight dust — **never** glittery/gimmicky.

---

## 6) Guardrails & QA Checks

- **No dead frames**: Assert that per‑clip end has non‑zero motion vectors or non‑constant tweens active within last 500 ms.
- **Transitions**: Reject “fade‑to‑color” unless `transition_policy = "dip"` is explicitly set for the scene.
- **Audio**: Ensure whisper track is never masked by music (min +6 dB headroom over bed during speech).
- **Visual tone**: Reject generated assets with cartoonish shader artifacts (toon edges, oversaturated gradients).

---

## 7) Ready‑to‑use Patterns

- **Default dissolve**: overlap = 1.0s; outgoing clip gets `out: "fade"`; underlying next clip starts during overlap.
- **Section break**: dip‑to‑color: both clips `in/out: "fade"`, no overlap; background sets the dip color.
- **Premium seam**: alpha overlay MOV (dust halo, soft light leak) during overlap.
- **Stylized reveal**: luma matte (subtle geometric wipe) timed to music swell.

---

## 8) Pipeline TODOs

- Add generator rule: enforce micro‑motion on last 1.0s of every shot (tween or `zoomInSlow`).
- Add transition policy switch: `"dissolve" | "dip" | "overlay" | "luma"`.
- Add audio bus: whisper (V), foley (FX), music (M) with auto‑ducking and `fadeInFadeOut` default on soundtrack.

---

## Appendix A — Reference JSON

**Dissolve template (multi‑clip overlap)** — see §1, Default.
**Overlay template (alpha MOV)** — see §1, Designer transitions.
**Luma matte template** — see §1, Designer transitions.

---

## Appendix B — Reference Links (human‑readable)

- Fades vs dissolves, 1s default fade & overlap pattern: Shotstack guide “Add fades and dissolves using the Edit API”  
  https://shotstack.io/learn/how-to-fade-dissolve-video/
- Dissolve template JSON: https://shotstack.io/templates/dissolve-fade-video-clips/
- Alpha overlay transition template (.mov with transparency): https://shotstack.io/templates/alpha-overlay-transition-circle-effect/
- Studio designer note on importing alpha MOV overlays: https://shotstack.io/learn/studio-designers-guide/
- Note re: WEBM alpha not supported for overlays; prefer MOV: https://community.shotstack.io/t/video-with-transparent-background/510
- Animations/Tweens (opacity/offset/volume): https://shotstack.io/docs/guide/architecting-an-application/animations/
- API reference (Tween, clip `transition`, asset `volumeEffect`, soundtrack `effect`): https://shotstack.io/docs/api/
- Soundtrack fadeInFadeOut example (SDK tutorials):  
  Python: https://shotstack.io/learn/turn-images-to-slideshow-video-using-python/  
  Node.js: https://shotstack.io/learn/turn-images-into-slideshow-video-nodejs/
- Motion effects catalog & Slow/Fast variants:  
  API/SDK docs & guides (e.g., https://github.com/shotstack/shotstack-sdk-ruby, slideshow guides)
