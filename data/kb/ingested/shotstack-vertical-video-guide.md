# Shotstack Vertical Video Guide (9:16 for TikTok/Instagram Reels)

## Critical: Resolution Format for Vertical Videos

For vertical videos (TikTok, Instagram Reels, YouTube Shorts), you MUST use the explicit resolution format:

```json
{
  "output": {
    "format": "mp4",
    "resolution": "1080x1920",
    "fps": 30
  }
}
```

**DO NOT use `"resolution": "1080"`** - this defaults to landscape 1920x1080!

## Complete 9:16 Vertical Timeline Example

```json
{
  "timeline": {
    "tracks": [
      {
        "clips": [
          {
            "asset": {
              "type": "video",
              "src": "https://example.com/clip1.mp4"
            },
            "start": 0,
            "length": 8
          },
          {
            "asset": {
              "type": "video",
              "src": "https://example.com/clip2.mp4"
            },
            "start": 8,
            "length": 8
          }
        ]
      },
      {
        "clips": [
          {
            "asset": {
              "type": "title",
              "text": "FIRST HEADER",
              "style": "minimal",
              "size": "small",
              "color": "#FFFFFF",
              "background": "#000000AA"
            },
            "start": 0,
            "length": 8,
            "position": "top",
            "offset": {
              "x": 0,
              "y": -0.35
            }
          },
          {
            "asset": {
              "type": "title",
              "text": "SECOND HEADER",
              "style": "minimal",
              "size": "small",
              "color": "#FFFFFF",
              "background": "#000000AA"
            },
            "start": 8,
            "length": 8,
            "position": "top",
            "offset": {
              "x": 0,
              "y": -0.35
            }
          }
        ]
      }
    ]
  },
  "output": {
    "format": "mp4",
    "resolution": "1080x1920",
    "fps": 30
  }
}
```

## Key Points for Alex (Editor)

1. **Resolution**: Always use `"1080x1920"` for 9:16 vertical
2. **Tracks**: First track = video clips, Second track = text overlays
3. **Timing**: Clips must be sequential with correct `start` and `length` values
4. **Text Position**: Use `"position": "top"` and `"offset": {"y": -0.35}` for header text
5. **Text Style**: Uppercase text, white color, semi-transparent black background

## Common Mistakes to Avoid

❌ **WRONG**: `"resolution": "1080"` (produces landscape 1920x1080)
❌ **WRONG**: `"resolution": "hd"` (produces landscape)
❌ **WRONG**: `"aspectRatio": "9:16"` without explicit resolution

✅ **CORRECT**: `"resolution": "1080x1920"` (produces vertical 1080x1920)
