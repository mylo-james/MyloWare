import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { DynamicComposition } from './Composition';

const clips = ["https://tempfile.aiquickdraw.com/v/87a91b8c0b65b5b628fff9a6e15a71bc_1764992376.mp4","https://tempfile.aiquickdraw.com/v/69f1e5b8fba0b455b420a48c071442e8_1764992380.mp4"];
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
