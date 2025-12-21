import { AbsoluteFill, OffthreadVideo } from 'remotion';

export interface VideoClipProps {
  src: string;
  volume?: number;
  playbackRate?: number;
  startFrom?: number;
}

export const VideoClip: React.FC<VideoClipProps> = ({
  src,
  volume = 1,
  playbackRate = 1,
  startFrom = 0,
}) => {
  return (
    <AbsoluteFill>
      <OffthreadVideo
        src={src}
        volume={volume}
        playbackRate={playbackRate}
        startFrom={startFrom}
      />
    </AbsoluteFill>
  );
};
