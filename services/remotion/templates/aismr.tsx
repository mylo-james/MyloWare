/**
 * AISMR Template - 12 Zodiac Clips with Crossfade
 *
 * This template is used by the editor agent. The agent provides:
 * - clips: array of 12 video URLs in zodiac order
 * - objects: array of 12 object names in zodiac order
 *
 * The template handles all timing, crossfades, and text overlays.
 */

// Constants for 8-second clips
const CLIP_FRAMES = 240;      // 8 seconds at 30fps
const OVERLAP_FRAMES = 60;    // 2 second crossfade
const OFFSET_FRAMES = 180;    // 6 seconds between clip starts (8 - 2)

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

const ZODIAC_SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
];

interface ZodiacClipProps {
  src: string;
  index: number;
  sign: string;
  object: string;
}

const ZodiacClip: React.FC<ZodiacClipProps> = ({ src, index, sign, object }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const safe = getTikTokSafeInsets(width, height);
  const safeHeight = height - safe.top - safe.bottom;

  // Video opacity: fade in during first 60 frames, fade out during last 60 frames
  const opacity = interpolate(
    frame,
    [0, OVERLAP_FRAMES, CLIP_FRAMES - OVERLAP_FRAMES, CLIP_FRAMES],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Text opacity: visible during middle portion (fade in after video fade, fade out before video fade)
  const textOpacity = interpolate(
    frame,
    [OVERLAP_FRAMES, OVERLAP_FRAMES + 20, CLIP_FRAMES - OVERLAP_FRAMES - 20, CLIP_FRAMES - OVERLAP_FRAMES],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ opacity }}>
      {/* OffthreadVideo is required for proper server-side rendering */}
      <OffthreadVideo
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover'
        }}
      />
      <AbsoluteFill style={{
        justifyContent: 'center',
        alignItems: 'center',
        opacity: textOpacity,
        // Constrain text to the upper 2/3 of the TikTok-safe region.
        paddingTop: safe.top,
        paddingBottom: safe.bottom + Math.round(safeHeight / 3),
        paddingLeft: safe.left,
        paddingRight: safe.right,
      }}>
        <div style={{
          color: 'white',
          textAlign: 'center',
          textShadow: '3px 3px 15px rgba(0,0,0,0.95), 0 0 40px rgba(0,0,0,0.6)',
          maxWidth: width - safe.left - safe.right,
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <div style={{
            fontSize: 76,
            fontWeight: 800,
            lineHeight: 1.05,
          }}>
            {object}
          </div>
          <div style={{
            fontSize: 56,
            fontWeight: 700,
            lineHeight: 1.1,
            marginTop: 10,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            opacity: 0.95,
          }}>
            {sign}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

interface AISMRCompositionProps {
  clips: string[];
  objects: string[];
}

export const RemotionComposition: React.FC<AISMRCompositionProps> = ({ clips, objects }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {ZODIAC_SIGNS.map((sign, index) => (
        <Sequence
          key={sign}
          from={index * OFFSET_FRAMES}
          durationInFrames={CLIP_FRAMES}
        >
          <ZodiacClip
            src={clips[index] || ''}
            index={index}
            sign={sign}
            object={objects[index] || sign}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
