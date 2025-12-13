import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { DynamicComposition } from './Composition';

const clips = ["https://tempfile.aiquickdraw.com/v/0db01460c277486b092bce19af66ca4a_1764996118.mp4","https://tempfile.aiquickdraw.com/v/204a490de6e64fe0300f3309368cbcfa_1764996122.mp4","https://tempfile.aiquickdraw.com/v/97fead6b95f643273f698baaeac2d8f1_1764996122.mp4","https://tempfile.aiquickdraw.com/v/51d08bc689255d43ccbb96d34d12c2a5_1764996122.mp4","https://tempfile.aiquickdraw.com/v/d2f0c479d510b4116ccfe66f4735ee85_1764996123.mp4","https://tempfile.aiquickdraw.com/v/340d294d57b32a605f544c8ef065b0d5_1764996123.mp4","https://tempfile.aiquickdraw.com/v/1c580e0e64bf28eb1a206c9a2cd5fb83_1764996127.mp4","https://tempfile.aiquickdraw.com/v/e6d6d8f8037c12f630384d18a55f1c9a_1764996128.mp4","https://tempfile.aiquickdraw.com/v/25cadcf4aea5adae345f28f8819dc3b0_1764996132.mp4","https://tempfile.aiquickdraw.com/v/9bccee0bec18ba4826af9e5711beda77_1764996133.mp4","https://tempfile.aiquickdraw.com/v/21954298c6b802f3c06eb1f16ebc29e7_1764996133.mp4","https://tempfile.aiquickdraw.com/v/dcafccbf14340c353544897b5dd690cb_1764996137.mp4"];
const durationInFrames = 2940;
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
