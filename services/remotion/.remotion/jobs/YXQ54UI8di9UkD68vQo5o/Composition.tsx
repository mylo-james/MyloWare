import React from 'react';
import { AbsoluteFill, Sequence, Series, useCurrentFrame, useVideoConfig, interpolate, spring, Video } from 'remotion';
import { OffthreadVideo } from 'remotion';
import { VideoClip, AnimatedText, Transition, ColorGrade, Vignette } from './components';

const ZODIAC_SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
];

const OBJECTS = [
  'Fiery Passion Puppy',     // Aries
  'Gentle Earth Puppy',     // Taurus
  'Curious Twins Puppy',    // Gemini
  'Emotional Water Puppy',   // Cancer
  'Playful Lion Puppy',      // Leo
  'Diligent Flower Puppy',   // Virgo
  'Charming Balance Puppy',   // Libra
  'Mystical Shadow Puppy',   // Scorpio
  'Adventurous Traveler Puppy',// Sagittarius
  'Grounded Mountain Puppy',  // Capricorn
  'Innovative Breeze Puppy',  // Aquarius
  'Dreamy Wave Puppy'        // Pisces
];

const CLIP_FRAMES = 300;
const OVERLAP_FRAMES = 60;
const OFFSET_FRAMES = 240;

const ZodiacClip = ({ src, index, sign, object }) => {
  const frame = useCurrentFrame();
  const localFrame = frame - (index * OFFSET_FRAMES);
  
  const opacity = interpolate(
    localFrame,
    [0, OVERLAP_FRAMES, CLIP_FRAMES - OVERLAP_FRAMES, CLIP_FRAMES],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  
  const textOpacity = interpolate(
    localFrame,
    [OVERLAP_FRAMES, OVERLAP_FRAMES + 30, CLIP_FRAMES - OVERLAP_FRAMES - 30, CLIP_FRAMES - OVERLAP_FRAMES],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  
  return (
    <AbsoluteFill style={{ opacity }}>
      <Video src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
      <AbsoluteFill style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: 120,
        opacity: textOpacity,
      }}>
        <div style={{
          fontSize: 48,
          fontWeight: 700,
          color: 'white',
          textAlign: 'center',
          textShadow: '3px 3px 15px rgba(0,0,0,0.9), 0 0 30px rgba(0,0,0,0.5)',
        }}>
          {sign} - {object}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const RemotionComposition = ({ clips }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {clips.map((src, index) => (
        <Sequence key={index} from={index * OFFSET_FRAMES} durationInFrames={CLIP_FRAMES}>
          <ZodiacClip
            src={src}
            index={index}
            sign={ZODIAC_SIGNS[index]}
            object={OBJECTS[index]}
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
