# Remotion Text Overlay Template (Test Video Gen)

Use this TSX composition for the motivational two-clip format. Imports are provided by Remotion runtime; do not add import statements.

```tsx
const TextOverlay = ({ text, bold = false }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15, 105, 120], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = interpolate(frame, [0, 15], [0.9, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 50 }}>
      <div
        style={{
          fontSize: bold ? 72 : 56,
          fontWeight: bold ? 900 : 700,
          color: 'white',
          textAlign: 'center',
          textShadow: '4px 4px 20px rgba(0,0,0,0.9), 0 0 60px rgba(0,0,0,0.5)',
          textTransform: bold ? 'uppercase' : 'none',
          letterSpacing: bold ? '0.05em' : '-0.01em',
          opacity,
          transform: `scale(${scale})`,
          maxWidth: '90%',
          lineHeight: 1.3,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const RemotionComposition = ({ clips }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* Video 1: 0-8s (frames 0-240) */}
      <Sequence from={0} durationInFrames={240}>
        <Video src={clips[0]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
      </Sequence>

      {/* Video 2: 8-16s (frames 240-480) */}
      <Sequence from={240} durationInFrames={240}>
        <Video src={clips[1]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
      </Sequence>

      {/* Text overlays */}
      <Sequence from={0} durationInFrames={120}>
        <TextOverlay text="TEXT A HERE" bold={true} />
      </Sequence>
      <Sequence from={120} durationInFrames={120}>
        <TextOverlay text="Text B here" />
      </Sequence>
      <Sequence from={240} durationInFrames={120}>
        <TextOverlay text="Text C here" />
      </Sequence>
      <Sequence from={360} durationInFrames={120}>
        <TextOverlay text="TEXT D HERE" bold={true} />
      </Sequence>

      {/* Vignette */}
      <AbsoluteFill
        style={{
          background: 'radial-gradient(circle, transparent 40%, rgba(0,0,0,0.5) 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
```

## Usage
- Replace TEXT A/B/C/D with ideation overlays.
- Keep aspect_ratio 9:16, fps 30, duration_seconds 16.
- Call `remotion_render` with `composition_code` set to this TSX and `clips` set to the two video URLs.
