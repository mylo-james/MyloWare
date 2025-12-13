import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { DynamicComposition } from './Composition';

const clips = ["https://tempfile.aiquickdraw.com/v/1e6d0847b4a02a1096b07bccc70a54f9_1764990721.mp4","https://tempfile.aiquickdraw.com/v/bf5f1d8f52e88048b79df4b7466e3c54_1764990727.mp4"];
const durationInFrames = 600;
const fps = 30;
const width = 1080;
const height = 1920;

const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="DynamicComposition"
      component={DynamicComposition}
      durationInFrames={durationInFrames}
      fps={fps}
      width={width}
      height={height}
      defaultProps={{ clips }}
    />
  </>
);

registerRoot(RemotionRoot);
