# Video Editing Knowledge Base

## Video Editing Best Practices

### Pacing and Timing

Effective pacing keeps viewers engaged by controlling the rhythm of cuts and scene lengths. Keep videos concise – for marketing content, often under 90 seconds – because viewer attention drops off quickly. Start strong with a hook in the first 5 seconds to grab interest (e.g. foreshadow a big reveal). Introduce a new visual or change about every ~8 seconds to maintain interest (the "8-second rule"), especially for social media. However, match the pace to the content's mood: fast cuts and upbeat music suit energetic topics, while slower pacing fits serious or emotional stories. Cut on action and when energy drops – don't linger on shots once their purpose is fulfilled. In summary, every edit should feel intentional: professionals make every second mean something.

### Storytelling and Narrative

A compelling edit tells a story with a clear beginning, middle, and end. Serve the story with each cut – every clip should either advance the narrative or heighten emotion. Structure your video to have a logical flow: introduce the context, develop the idea, and conclude decisively. Use visual storytelling techniques: "show, don't tell." Instead of heavy exposition, rely on imagery, facial expressions, and actions to convey meaning. Maintain continuity of tone and direction between shots so the viewer isn't jarred. Plan your storytelling beats in advance (consider writing a one-sentence summary of the story and the emotion for each scene). Remember that good editing is invisible – if viewers notice the editing (e.g. flashy effects drawing attention), it likely detracts from the story. Aim for a seamless flow that guides the audience's emotions without them realizing it.

### Transitions and Effects

Use transitions to move between scenes smoothly, but don't overuse complex transitions. Often a simple cut (instant switch) is the most effective and least distracting transition. Other basic transitions include fade in/out (to or from black) to signify openings/closings, and dissolves (crossfades) to show passage of time. More stylized moves like wipes, slide-in pans, zoom transitions, or whip pans can add flair but should fit the content's style. Overusing fancy transitions can look distracting – stick to a consistent, simple style unless a specific effect serves the story. The ideal transition is often "invisible", meaning it feels natural. Likewise, apply visual effects (color filters, slow-motion, motion blur, etc.) purposefully. For example, color grading can set a mood (warm tones for nostalgia, cool tones for tension), and speed ramps can emphasize dramatic moments. Use effects to enhance storytelling, not just to "look cool." When in doubt, less is more – the best edits keep the viewer focused on content, not the editing tricks.

### Audio and Sound Design

High-quality audio is as crucial as visuals for a professional video. Ensure dialogue and commentary are clear and in sync with on-screen action. Balance your audio mix so music and sound effects support, but don't drown out, spoken words. A common practice is audio ducking: automatically lower music volume when dialogue or voiceover is present. Introduce J-cuts and L-cuts – where audio transitions lead or lag the video cut – for smoother flow between scenes. (For example, start the audio of the next scene a moment before cutting the video, to psychologically pull the viewer along.) Use ambient sound and Foley (background noise, footsteps, wind, etc.) to add depth and realism. Also, incorporate strategic sound effects to emphasize key moments (e.g. a swoosh for a title appearance) but sparingly – they should feel natural. In sound design, sometimes silence or minimal sound can be powerful too, highlighting a dramatic moment. Finally, maintain consistent volume levels (e.g. target around -12 to -6 dB for dialogue) and avoid peaking or clipping. A polished sound mix with proper syncing will greatly elevate the perceived quality of the video.

### Color Correction and Grading

Color correction ensures all your shots look consistent and professional. Always fix basic issues first: correct white balance and exposure on all footage so that colors appear natural and not overly tinted. Then apply a uniform color grade (LUT or filter) across the project for a cohesive look. For example, you might choose a warm, saturated grade for a upbeat travel vlog, or a cooler, muted tone for a corporate or somber video. Be mindful of skin tones – keep them looking realistic; avoid over-processing that makes people look too orange or unnaturally colored. Use grading to support the story's mood: warm gold tones can evoke comfort or nostalgia, while teal/blue casts can suggest tech or tension. Ensure that shots cut together have matching color profiles (it's jarring if one clip is noticeably different in contrast or tint from the next). Also watch out for color continuity: if two consecutive shots were filmed in the same location/light but appear different, color-match them in post. A final polish is to add gentle vignettes to subtly focus attention, or slight contrast tweaks to make the image "pop," as needed. Overall, consistent color and proper exposure maintenance prevents viewer distraction and enhances the professional feel.

### Titles and Typography

On-screen text (titles, captions, lower-thirds) should be clear, legible, and stylistically appropriate. Choose fonts and styles that align with the video's tone and branding. For instance, a fun vlog might use a casual sans-serif, while a formal tutorial sticks to a clean, professional font. Use a simple, clean typeface – avoid overly decorative or ultra-thin fonts that become hard to read, especially on small screens. Ensure text is large enough to read easily but not so large that it looks out of place or "cheesy". Pay attention to contrast: titles should stand out against the background. You can improve readability by adding a subtle drop shadow, outline, or a semi-transparent dark shape behind the text. Keep these enhancements minimal (avoid thick, harsh outlines or shadows which appear amateurish) – just enough to separate text from busy backgrounds. Also maintain consistent placement and style for text elements throughout the video. Typically, keep important text within the safe title area (not too close to edges) for a polished look. When displaying titles or instructional text, keep it concise (e.g. a 3-5 word phrase rather than a long sentence). Ensure it stays on screen long enough to be read comfortably (generally, at least ~2 seconds or longer depending on length of text). In summary, good title design follows basic typography rules: consistency, alignment, appropriate font choice, and clear readability. Well-designed text overlays will complement your video without distracting from it.

---

## Remotion Video Editing Framework

Remotion is a code-based video editing framework using React. Instead of manipulating a visual timeline, you write React components that describe your video composition. Every frame is a function of React state and props.

### Core Concepts

1. **Frames vs Time**: Remotion works in frames, not seconds. At 30fps, 30 frames = 1 second.
2. **useCurrentFrame()**: Returns the current frame number for animations.
3. **useVideoConfig()**: Provides fps, width, height, and durationInFrames.
4. **Compositions**: Define video dimensions, duration, and the React component to render.

### Key Components

| Component | Purpose |
|-----------|---------|
| `<Composition>` | Define a video with dimensions, fps, duration |
| `<Sequence>` | Control timing of elements (from, durationInFrames) |
| `<Series>` | Auto-sequence components back-to-back |
| `<OffthreadVideo>` | Embed video clips (better performance) |
| `<Audio>` | Add audio tracks |
| `<AbsoluteFill>` | Full-frame container for layouts |

### Animation Functions

| Function | Purpose |
|----------|---------|
| `interpolate()` | Map values over time (fade, move, scale) |
| `spring()` | Physics-based animation (natural motion) |
| `interpolateColors()` | Animate between colors |

### Example: Fade-in Animation

```tsx
const frame = useCurrentFrame();
const opacity = interpolate(frame, [0, 30], [0, 1], {
  extrapolateRight: 'clamp',
});
```

### Example: Spring Animation

```tsx
const { fps } = useVideoConfig();
const scale = spring({
  frame,
  fps,
  config: { damping: 200 },
});
```

### Vertical Video (9:16)

For TikTok/Reels/Shorts, always use:
- **Width**: 1080
- **Height**: 1920
- **objectFit**: 'cover' on videos

```tsx
<Composition
  width={1080}
  height={1920}
  fps={30}
  component={MyVideo}
/>
```

### Best Practices for Editor Agent

1. **Always export composition as React.FC with typed props**
2. **Use `<Series>` for sequential clips** - handles timing automatically
3. **Add transitions using `@remotion/transitions`** - crossfade is safest default
4. **Use `spring()` for natural motion**, `interpolate()` for precise control
5. **Apply color grading sparingly** - cinematic preset works for most content
6. **Keep safe areas** - paddingTop: 120px, paddingBottom: 150px for mobile UI
7. **Text should be readable** - 36px+ font, bold, with shadow or background
8. **At 30fps: 30 frames = 1 second** - typical clip is 150-240 frames (5-8 seconds)

---

## References

- [Remotion Documentation](https://www.remotion.dev/docs)
- [Remotion Transitions](https://www.remotion.dev/docs/transitions)
- [Remotion Rendering](https://www.remotion.dev/docs/render)
