import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from 'remotion';

export type TextAnimation = 'fade-up' | 'slide-in' | 'scale-in' | 'typewriter';

export interface AnimatedTextProps {
  text: string;
  animation?: TextAnimation;
  delay?: number;
  style?: React.CSSProperties;
}

export const AnimatedText: React.FC<AnimatedTextProps> = ({
  text,
  animation = 'fade-up',
  delay = 0,
  style = {},
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const delayedFrame = Math.max(0, frame - delay);

  const springValue = spring({
    frame: delayedFrame,
    fps,
    config: { damping: 200 },
  });

  let opacity = 1;
  let translateY = 0;
  let translateX = 0;
  let scale = 1;

  switch (animation) {
    case 'fade-up':
      opacity = interpolate(springValue, [0, 1], [0, 1]);
      translateY = interpolate(springValue, [0, 1], [50, 0]);
      break;
    case 'slide-in':
      translateX = interpolate(springValue, [0, 1], [-100, 0]);
      break;
    case 'scale-in':
      scale = springValue;
      opacity = springValue;
      break;
    case 'typewriter': {
      const charsToShow = Math.floor(springValue * text.length);
      return (
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            ...style,
          }}
        >
          {text.slice(0, charsToShow)}
        </AbsoluteFill>
      );
    }
    default:
      break;
  }

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        opacity,
        transform: `translateX(${translateX}px) translateY(${translateY}px) scale(${scale})`,
        ...style,
      }}
    >
      {text}
    </AbsoluteFill>
  );
};
