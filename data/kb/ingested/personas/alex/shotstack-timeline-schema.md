# Shotstack Timeline JSON Schema Contract

The helper now auto-builds the Shotstack-ready JSON with the following structure. This file remains for reference (and future manual edits) so Alex can inspect the template when needed.

## Required Structure

1. `timeline` object with `tracks` array (>=2 tracks)
2. Each track has `clips` array with objects containing:
   - `asset` object (must include `type`; optional `src`, `text`, `style`, `size`, `color`, `background`)
   - Numeric `start` and `length`
   - Optional `position` and `offset {x, y}`
3. `output` object with `format` and `resolution`; `fps` is optional but recommended

## JSON Schema
```json
{
  "type": "object",
  "required": ["timeline", "output"],
  "properties": {
    "timeline": {
      "type": "object",
      "required": ["tracks"],
      "properties": {
        "tracks": {
          "type": "array",
          "minItems": 2,
          "items": {
            "type": "object",
            "required": ["clips"],
            "properties": {
              "clips": {
                "type": "array",
                "minItems": 1,
                "items": {
                  "type": "object",
                  "required": ["asset", "start", "length"],
                  "properties": {
                    "asset": {
                      "type": "object",
                      "required": ["type"],
                      "properties": {
                        "type": {"type": "string"},
                        "src": {"type": "string"},
                        "text": {"type": "string"},
                        "style": {"type": "string"},
                        "size": {"type": "string"},
                        "color": {"type": "string"},
                        "background": {"type": "string"}
                      }
                    },
                    "start": {"type": "number"},
                    "length": {"type": "number"},
                    "position": {"type": "string"},
                    "offset": {
                      "type": "object",
                      "properties": {
                        "x": {"type": "number"},
                        "y": {"type": "number"}
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "output": {
      "type": "object",
      "required": ["format", "resolution"],
      "properties": {
        "format": {"type": "string"},
        "resolution": {"type": "string"},
        "aspectRatio": {"type": "string"},
        "fps": {"type": "number"}
      }
    }
  }
}
```

## Notes
- Reject non-JSON representations (no Python dicts, no comments).
- Use this schema when validating Alex's structured output before calling Shotstack.

## Example Timeline (Overlay + Video)

Use this trimmed example as a template when constructing timelines. Adapt the
clip `text` and `src` values to your current run while preserving the overall
shape (`timeline.tracks[].clips[]` plus a vertical-safe `output` block).

```json
{
  "output": {
    "format": "mp4",
    "resolution": "hd",
    "aspectRatio": "9:16",
    "fps": 30
  },
  "timeline": {
    "background": "#000000",
    "tracks": [
      {
        "clips": [
          {
            "start": 0.5,
            "length": 5.0,
            "position": "bottom",
            "asset": {
              "type": "text",
              "text": "Aries",
              "size": "large",
              "color": "#ffffff",
              "background": "#000000"
            }
          }
        ]
      },
      {
        "clips": [
          {
            "start": 7.0,
            "length": 5.0,
            "position": "bottom",
            "asset": {
              "type": "text",
              "text": "Taurus",
              "size": "large",
              "color": "#ffffff",
              "background": "#000000"
            }
          }
        ]
      },
      {
        "clips": [
          {
            "start": 0.0,
            "length": 8.0,
            "asset": {
              "type": "video",
              "src": "https://example.com/clip-0.mp4"
            }
          },
          {
            "start": 8.0,
            "length": 8.0,
            "asset": {
              "type": "video",
              "src": "https://example.com/clip-1.mp4"
            }
          }
        ]
      }
    ]
  }
}
```

If you intentionally pass a custom `timeline` to `render_video_timeline_tool`,
it **must** look like this object: a top-level JSON with both `timeline` and
`output` keys, at least one video track, and any number of text/overlay tracks.
When you omit `timeline` (the current fast path), the helper automatically
builds this structure from the generated clips and overlay headers.
