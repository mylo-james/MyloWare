import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';

export type TransitionType = 'crossfade' | 'wipe-left' | 'zoom-in' | 'glitch';

export interface TransitionProps {
  type?: TransitionType;
  duration?: number; // frames
  fromColor?: string;
  toColor?: string;
}

export const Transition: React.FC<TransitionProps> = ({
  type = 'crossfade',
  duration = 30,
  fromColor = 'black',
  toColor = 'black',
}) => {
  const frame = useCurrentFrame();
  const progress = Math.min(frame / duration, 1);

  if (type === 'crossfade') {
    const opacity = 1 - progress;
    return (
      <AbsoluteFill style={{ backgroundColor: toColor, opacity, mixBlendMode: 'multiply' }} />
    );
  }

  if (type === 'wipe-left') {
    const translateX = interpolate(progress, [0, 1], [0, -100]);
    return (
      <AbsoluteFill
        style={{
          backgroundColor: fromColor,
          transform: `translateX(${translateX}%)`,
        }}
      />
    );
  }

  if (type === 'zoom-in') {
    const scale = interpolate(progress, [0, 1], [1.2, 1]);
    const opacity = 1 - progress;
    return (
      <AbsoluteFill
        style={{
          backgroundColor: toColor,
          transform: `scale(${scale})`,
          opacity,
        }}
      />
    );
  }

  if (type === 'glitch') {
    const jitterX = Math.sin(frame * 2) * 2;
    const jitterY = Math.cos(frame * 3) * 2;
    const opacity = 0.2 + (1 - progress) * 0.3;
    return (
      <AbsoluteFill
        style={{
          backgroundColor: toColor,
          transform: `translate(${jitterX}px, ${jitterY}px)`,
          opacity,
          mixBlendMode: 'screen',
        }}
      />
    );
  }

  return null;
};
