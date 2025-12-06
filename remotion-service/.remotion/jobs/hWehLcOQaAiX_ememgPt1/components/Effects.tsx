import { AbsoluteFill } from 'remotion';

export type ColorPreset = 'cinematic' | 'vibrant' | 'moody' | 'vintage';

export interface ColorGradeProps {
  preset?: ColorPreset;
}

const presetToFilter: Record<ColorPreset, string> = {
  cinematic: 'contrast(1.1) saturate(1.1) brightness(1.05)',
  vibrant: 'contrast(1.05) saturate(1.2)',
  moody: 'brightness(0.95) contrast(1.15) saturate(0.9)',
  vintage: 'sepia(0.35) saturate(0.9) contrast(1.05)',
};

export const ColorGrade: React.FC<ColorGradeProps> = ({ preset = 'cinematic' }) => {
  const filter = presetToFilter[preset] ?? presetToFilter.cinematic;
  return <AbsoluteFill style={{ filter, pointerEvents: 'none' }} />;
};

export interface VignetteProps {
  strength?: number; // 0-1
  color?: string;
}

export const Vignette: React.FC<VignetteProps> = ({ strength = 0.45, color = 'black' }) => {
  const intensity = Math.min(Math.max(strength, 0), 1);
  const background = `radial-gradient(circle, transparent 45%, ${color} ${70 + intensity * 20}%)`;
  return <AbsoluteFill style={{ background, pointerEvents: 'none' }} />;
};
