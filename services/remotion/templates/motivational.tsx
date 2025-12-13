/**
 * Motivational Template - 2 Clips with Text Overlays (AISMR-style)
 * 
 * This template follows the same pattern as AISMR:
 * - clips: array of 2 video URLs (8 seconds each)
 * - texts: array of 4 text overlays (2 per clip, 4 seconds each)
 * 
 * Timeline (16 seconds at 30fps = 480 frames):
 *   Clip 1: frames 0-240 (with 30-frame crossfade at end)
 *   Clip 2: frames 210-480 (starts 30 frames before clip 1 ends)
 *   
 *   texts[0]: 0-4s (within clip 1)
 *   texts[1]: 4-8s (within clip 1)
 *   texts[2]: 8-12s (within clip 2)
 *   texts[3]: 12-16s (within clip 2)
 */

// Constants matching AISMR pattern
const CLIP_FRAMES = 240;      // 8 seconds at 30fps
const OVERLAP_FRAMES = 30;    // 1 second crossfade (shorter than AISMR's 2s)
const OFFSET_FRAMES = 210;    // 7 seconds between clip starts (8 - 1)
const TEXT_FRAMES = 120;      // 4 seconds per text overlay

interface MotivationalClipProps {
  src: string;
  clipIndex: number;
  texts: string[];        // 2 texts for this clip
  textStartFrame: number; // Global frame where first text starts
}

const MotivationalClip: React.FC<MotivationalClipProps> = ({ src, clipIndex, texts, textStartFrame }) => {
  const frame = useCurrentFrame();
  
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
        justifyContent: 'center',
        alignItems: 'center',
        opacity: textOpacity,
      }}>
        <div style={{
          fontSize: 56,
          fontWeight: 800,
          color: 'white',
          textAlign: 'center',
          textShadow: '3px 3px 15px rgba(0,0,0,0.95), 0 0 40px rgba(0,0,0,0.6)',
          padding: '0 50px',
          maxWidth: '90%',
          lineHeight: 1.3,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
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
          textStartFrame={0}
        />
      </Sequence>
      
      {/* Clip 2: frames 210-480 (overlaps with clip 1 for crossfade) */}
      <Sequence 
        from={OFFSET_FRAMES} 
        durationInFrames={CLIP_FRAMES + OVERLAP_FRAMES}
      >
        <MotivationalClip
          src={clips[1] || ''}
          clipIndex={1}
          texts={clip2Texts}
          textStartFrame={OFFSET_FRAMES}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
