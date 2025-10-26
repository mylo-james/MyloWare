// n8n Script node: build Shotstack edit JSON honoring AISMR transition spec
const zodiacSigns = [
  'Aries',
  'Taurus',
  'Gemini',
  'Cancer',
  'Leo',
  'Virgo',
  'Libra',
  'Scorpio',
  'Sagittarius',
  'Capricorn',
  'Aquarius',
  'Pisces',
];

const MAX_CLIPS = 12;
const CLIP_DURATION = 8; // Match actual video duration (Veo 3 Fast max)
const TRANSITION_DURATION = 1; // 1-second crossfade transitions
const STRIDE = 6.5; // Clips overlap by 1.5 seconds for crossfade
const MICRO_MOTION_SECONDS = 1;
const MICRO_MOTION_DELTA = 0.015;
const MICRO_MOTION_START = Math.max(CLIP_DURATION - MICRO_MOTION_SECONDS, 0);
const TEXT_VISIBLE_DURATION = 5; // Text visible window per clip
const TEXT_ENTRY_DELAY = 0.5; // Delay before text appears, shifts fade window later

const inputItems = $input.all();

// With 12 clips at STRIDE=6.5, total duration = (12-1)*6.5 + 8 = 71.5 + 8 = 79.5 seconds

const toTimestamp = (value) => {
  const ts = Date.parse(value ?? '');
  return Number.isNaN(ts) ? 0 : ts;
};

const videos = (() => {
  const candidates = inputItems
    .filter((item) => item?.json?.video_link)
    .sort(
      (a, b) =>
        toTimestamp(a.json.created_at ?? a.json.createdAt) -
        toTimestamp(b.json.created_at ?? b.json.createdAt)
    )
    .slice(0, MAX_CLIPS)
    .map((item, idx) => ({
      link: item.json.video_link,
      label: item.json.idea?.trim() || `Idea ${idx + 1}`,
    }));

  console.log(`Found ${candidates.length} videos from input data`);

  if (candidates.length === 0) {
    throw new Error(
      'No videos found in input data. Expected items with video_link property.'
    );
  }

  console.log(`Using ${candidates.length} videos from input`);
  return candidates;
})();

const items = videos.map((video, idx) => ({
  link: video.link,
  label: video.label,
  title: zodiacSigns[idx % zodiacSigns.length],
  start: idx * STRIDE,
}));

console.log(
  `Creating ${
    items.length
  } video clips with ${TRANSITION_DURATION}s crossfade (stride: ${STRIDE}s, total: ${
    (items.length - 1) * STRIDE + CLIP_DURATION
  }s)`
);

const buildTextClip = (item, { text, fontSize, height, position }) => ({
  asset: {
    type: 'text',
    text,
    width: 1000,
    height,
    font: {
      family: 'Futura', // Elegant, minimal, modern — perfect for ASMR aesthetic
      color: '#ffffff',
      size: fontSize,
      weight: 500, // Medium weight for clean readability
    },
    alignment: {
      horizontal: 'center',
      vertical: 'top',
    },
  },
  start: item.start + TEXT_ENTRY_DELAY,
  length: TEXT_VISIBLE_DURATION,
  position,
  transition: { in: 'fade', out: 'fade' },
});

const topTracks = items.map((item) => ({
  clips: [
    buildTextClip(item, {
      text: item.title,
      fontSize: 92,
      height: 400,
      position: 'bottom',
    }),
  ],
}));

const bottomTracks = items.map((item) => ({
  clips: [
    buildTextClip(item, {
      text: item.label,
      fontSize: 64,
      height: 250,
      position: 'bottom',
    }),
  ],
}));

const makeVideoClip = (item, index, totalClips) => {
  const clip = {
    asset: {
      type: 'video',
      src: item.link,
    },
    start: item.start,
    length: CLIP_DURATION,
    effect: 'zoomInSlow',
  };

  // Add micro-motion at the end of each clip
  // CRITICAL: Tween start times are RELATIVE TO CLIP, not timeline!
  if (CLIP_DURATION > MICRO_MOTION_SECONDS) {
    clip.offset = {
      x: [
        {
          from: 0,
          to: MICRO_MOTION_DELTA,
          start: MICRO_MOTION_START, // Clip-relative: starts at 7s into the clip
          length: MICRO_MOTION_SECONDS,
          interpolation: 'bezier',
          easing: 'easeInOutSine',
        },
      ],
    };
  }

  // Use custom opacity tweens for crossfade (no built-in transitions)
  // Per AISMR spec: "Transitions never pause content - clips continue moving through transitions"
  // CRITICAL: Tween start times are RELATIVE TO CLIP, not timeline (start from 0)
  const opacityTweens = [];

  if (index === 0) {
    // First clip: fade in 0→1 (0-1s), hold at 1 (1-7s), fade out 1→0 (7-8s)
    opacityTweens.push(
      {
        from: 0,
        to: 1,
        start: 0,
        length: TRANSITION_DURATION,
        interpolation: 'bezier',
        easing: 'easeInOutSine',
      },
      {
        from: 1,
        to: 1,
        start: TRANSITION_DURATION,
        length: CLIP_DURATION - 2 * TRANSITION_DURATION, // Hold for 6 seconds
        interpolation: 'linear',
      },
      {
        from: 1,
        to: 0,
        start: CLIP_DURATION - TRANSITION_DURATION,
        length: TRANSITION_DURATION,
        interpolation: 'bezier',
        easing: 'easeInOutSine',
      }
    );
  } else if (index === totalClips - 1) {
    // Last clip: fade in 0→1 (0-1s), hold at 1 (1-8s), no fade out
    opacityTweens.push(
      {
        from: 0,
        to: 1,
        start: 0,
        length: TRANSITION_DURATION,
        interpolation: 'bezier',
        easing: 'easeInOutSine',
      },
      {
        from: 1,
        to: 1,
        start: TRANSITION_DURATION,
        length: CLIP_DURATION - TRANSITION_DURATION, // Hold for 7 seconds
        interpolation: 'linear',
      }
    );
  } else {
    // Middle clips: fade in 0→1 (0-1s), hold at 1 (1-7s), fade out 1→0 (7-8s)
    opacityTweens.push(
      {
        from: 0,
        to: 1,
        start: 0,
        length: TRANSITION_DURATION,
        interpolation: 'bezier',
        easing: 'easeInOutSine',
      },
      {
        from: 1,
        to: 1,
        start: TRANSITION_DURATION,
        length: CLIP_DURATION - 2 * TRANSITION_DURATION, // Hold for 6 seconds
        interpolation: 'linear',
      },
      {
        from: 1,
        to: 0,
        start: CLIP_DURATION - TRANSITION_DURATION,
        length: TRANSITION_DURATION,
        interpolation: 'bezier',
        easing: 'easeInOutSine',
      }
    );
  }

  clip.opacity = opacityTweens;

  return clip;
};

// Create video tracks with proper layering for crossfade transitions
// Each clip on separate track so top clip fades out to reveal clip below
const videoTracks = items.map((item, idx) => ({
  clips: [makeVideoClip(item, idx, items.length)],
}));

const tracks = [
  ...topTracks, // text overlays stay above video
  ...bottomTracks,
  ...videoTracks,
];

const timeline = {
  background: '#000000',
  tracks,
};

const edit = {
  timeline,
  output: {
    format: 'mp4',
    resolution: 'hd',
    aspectRatio: '9:16',
  },
};

return [{ json: edit }];
