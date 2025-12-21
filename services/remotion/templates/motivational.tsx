/**
 * Motivational Template - 2 Clips with Text Overlays (AISMR-style)
 *
 * This template follows the same pattern as AISMR:
 * - clips: array of 2 video URLs (8 seconds each)
 * - texts: array of 4 text overlays (2 per clip, 4 seconds each)
 *
 * Timeline (15 seconds at 30fps = 450 frames):
 *   Clip 1: frames 0-240 (with 30-frame crossfade at end)
 *   Clip 2: frames 210-450 (starts 30 frames before clip 1 ends)
 *
 *   texts[0]: 0-4s (within clip 1)
 *   texts[1]: 4-8s (within clip 1)
 *   texts[2]: 7-11s (within clip 2)
 *   texts[3]: 11-15s (within clip 2)
 */

// Constants matching AISMR pattern
const CLIP_FRAMES = 240;      // 8 seconds at 30fps
const OVERLAP_FRAMES = 30;    // 1 second crossfade (shorter than AISMR's 2s)
const OFFSET_FRAMES = 210;    // 7 seconds between clip starts (8 - 1)
const TEXT_FRAMES = 120;      // 4 seconds per text overlay

const TIKTOK_SAFE_INSETS_1080x1920 = {
  top: 130,
  bottom: 250,
  left: 60,
  right: 120,
};

const getTikTokSafeInsets = (width: number, height: number) => {
  return {
    top: Math.round(height * (TIKTOK_SAFE_INSETS_1080x1920.top / 1920)),
    bottom: Math.round(height * (TIKTOK_SAFE_INSETS_1080x1920.bottom / 1920)),
    left: Math.round(width * (TIKTOK_SAFE_INSETS_1080x1920.left / 1080)),
    right: Math.round(width * (TIKTOK_SAFE_INSETS_1080x1920.right / 1080)),
  };
};

interface MotivationalClipProps {
  src: string;
  clipIndex: number;
  texts: string[];        // 2 texts for this clip
}

const MotivationalClip: React.FC<MotivationalClipProps> = ({ src, clipIndex, texts }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const safe = getTikTokSafeInsets(width, height);
  const safeHeight = height - safe.top - safe.bottom;

  // Video opacity: fade in during first frames, fade out during last frames
  // First clip doesn't fade in, last clip doesn't fade out
  const isFirstClip = clipIndex === 0;
  const isLastClip = clipIndex === 1;

  const opacity = interpolate(
    frame,
    [0, OVERLAP_FRAMES, CLIP_FRAMES - OVERLAP_FRAMES, CLIP_FRAMES],
    [isFirstClip ? 1 : 0, 1, 1, isLastClip ? 1 : 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Calculate which text to show (0 or 1 within this clip)
  const localTextIndex = frame < TEXT_FRAMES ? 0 : 1;
  const currentText = texts[localTextIndex] || '';

  // Text opacity: fade in/out within each 4-second segment
  const textLocalFrame = frame % TEXT_FRAMES;
  const textOpacity = interpolate(
    textLocalFrame,
    [0, 15, TEXT_FRAMES - 15, TEXT_FRAMES],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ opacity }}>
      <OffthreadVideo
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover'
        }}
      />
      <AbsoluteFill style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        opacity: textOpacity,
        paddingTop: safe.top + Math.round(safeHeight / 3),
        paddingBottom: safe.bottom,
        paddingLeft: safe.left,
        paddingRight: safe.right,
      }}>
        <div style={{
          fontSize: 56,
          fontWeight: 800,
          color: 'white',
          textAlign: 'center',
          textShadow: '3px 3px 15px rgba(0,0,0,0.95), 0 0 40px rgba(0,0,0,0.6)',
          maxWidth: width - safe.left - safe.right,
          lineHeight: 1.3,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          whiteSpace: 'pre-line',
        }}>
          {currentText}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

interface MotivationalCompositionProps {
  clips: string[];
  texts: string[];
}

export const RemotionComposition: React.FC<MotivationalCompositionProps> = ({ clips, texts }) => {
  // Split texts: first 2 for clip 1, last 2 for clip 2
  const clip1Texts = texts.slice(0, 2);
  const clip2Texts = texts.slice(2, 4);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* Clip 1: frames 0-240 */}
      <Sequence
        from={0}
        durationInFrames={CLIP_FRAMES}
      >
        <MotivationalClip
          src={clips[0] || ''}
          clipIndex={0}
          texts={clip1Texts}
        />
      </Sequence>

      {/* Clip 2: frames 210-450 (overlaps with clip 1 for crossfade) */}
      <Sequence
        from={OFFSET_FRAMES}
        durationInFrames={CLIP_FRAMES}
      >
        <MotivationalClip
          src={clips[1] || ''}
          clipIndex={1}
          texts={clip2Texts}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
