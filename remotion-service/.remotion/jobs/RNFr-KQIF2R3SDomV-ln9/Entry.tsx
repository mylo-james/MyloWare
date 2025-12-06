import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { DynamicComposition } from './Composition';

const clips = ["https://tempfile.aiquickdraw.com/v/aca7445788022223fb479eeabb09ee83_1765004056.mp4","https://tempfile.aiquickdraw.com/v/5442fb868a87fc17c65590bd8330ccb3_1765004021.mp4","https://tempfile.aiquickdraw.com/v/d0367023aee71e0335faabafd686a41a_1765004025.mp4","https://tempfile.aiquickdraw.com/v/aeb50d1f5373531e97d504575e665b1f_1765004015.mp4","https://tempfile.aiquickdraw.com/v/ae2bef1c21eb3fe42ff0663d20ad4189_1765004020.mp4","https://tempfile.aiquickdraw.com/v/41549244497b8d4c6013ebcbbd599a89_1765004025.mp4","https://tempfile.aiquickdraw.com/v/e1c9410117c90b93d200f230778da4e4_1765004045.mp4","https://tempfile.aiquickdraw.com/v/d678079eaf47321bff922e7ff0c91ae5_1765004014.mp4","https://tempfile.aiquickdraw.com/v/35e304c64599b9fc167ab2253d896bde_1765004016.mp4","https://tempfile.aiquickdraw.com/v/cba4a187a9d79d54cffd76456f710a74_1765004027.mp4","https://tempfile.aiquickdraw.com/v/76123fff70d1ee0c60f3a0926aedef9a_1765004031.mp4","https://tempfile.aiquickdraw.com/v/a0d38ac77c8c51f42b7f2ee095770b6d_1765004022.mp4"];
const objects = ["Flame Spirit","Earth Golem","Shadow Serpent","Mystic Wave","Celestial Guardian","Lunar Blossom","Solar Radiance","Ethereal Dream","Cosmic Wanderer","Galactic Explorer","Starlit Whisper","Harmony Aura"];
const durationInFrames = 2220;
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
      defaultProps={{ clips, objects }}
    />
  </>
);

registerRoot(RemotionRoot);
