import React from 'react';
import { AbsoluteFill, Sequence, Series, useCurrentFrame, useVideoConfig, interpolate, spring, Video } from 'remotion';
import { OffthreadVideo } from 'remotion';
import { VideoClip, AnimatedText, Transition, ColorGrade, Vignette } from './components';


// Constants for 8-second clips
const CLIP_FRAMES = 240;      // 8 seconds at 30fps
const OVERLAP_FRAMES = 60;    // 2 second crossfade
const OFFSET_FRAMES = 180;    // 6 seconds between clip starts (8 - 2)
const TOTAL_FRAMES = 2220;    // 74 seconds total

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
  const clipStart = index * OFFSET_FRAMES;
  const localFrame = frame - clipStart;
  
  // Video opacity: fade in during first 60 frames, fade out during last 60 frames
  const opacity = interpolate(
    localFrame,
    [0, OVERLAP_FRAMES, CLIP_FRAMES - OVERLAP_FRAMES, CLIP_FRAMES],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  
  // Text opacity: visible during middle portion (fade in after video fade, fade out before video fade)
  const textOpacity = interpolate(
    localFrame,
    [OVERLAP_FRAMES, OVERLAP_FRAMES + 20, CLIP_FRAMES - OVERLAP_FRAMES - 20, CLIP_FRAMES - OVERLAP_FRAMES],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  
  return (
    <AbsoluteFill style={{ opacity }}>
      <Video 
        src={src} 
        style={{ 
          width: '100%', 
          height: '100%', 
          objectFit: 'cover' 
        }} 
        muted 
      />
      <AbsoluteFill style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: 150,
        opacity: textOpacity,
      }}>
        <div style={{
          fontSize: 52,
          fontWeight: 700,
          color: 'white',
          textAlign: 'center',
          textShadow: '3px 3px 15px rgba(0,0,0,0.95), 0 0 40px rgba(0,0,0,0.6)',
          padding: '0 40px',
        }}>
          {sign} — {object}
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



// Detect exported composition component
const CompositionComponent = 
  typeof MyVideo !== 'undefined' ? MyVideo :
  typeof RemotionComposition !== 'undefined' ? RemotionComposition :
  typeof Composition !== 'undefined' ? Composition :
  undefined;

if (!CompositionComponent) {
  throw new Error('No composition component exported. Export MyVideo, RemotionComposition, or Composition.');
}

export const DynamicComposition = CompositionComponent;
