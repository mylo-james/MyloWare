# Upload-Post Publishing Guide

Reference guide for publishing videos to social media using the Upload-Post API.

---

## Tool: upload_post

Publish a video to TikTok and other social platforms.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| video_url | string | Yes | URL of the video to publish |
| caption | string | Yes | Post caption (platform limits apply) |
| tags | array[string] | Yes | Hashtags without # prefix |
| account_id | string | Yes | Target account identifier |

### Example Call

```python
upload_post(
    video_url="https://example.com/video.mp4",
    caption="Find your peace 🌊",
    tags=["motivation", "nature", "peace", "ocean"],
    account_id="AISMR"
)
```

---

## Platform Guidelines

### TikTok

| Element | Limit |
|---------|-------|
| Caption | 2,200 characters max |
| Hashtags | 3-5 recommended |
| Video | 9:16, up to 10 min |

### Caption Best Practices

1. **Hook first** - Most engaging part in first line
2. **Keep it short** - Under 150 chars for full visibility
3. **Include CTA** - "Follow for more", "Save this"
4. **Emoji sparingly** - 1-2 relevant emojis

### Hashtag Strategy

**Mix of:**
- 1-2 broad tags: #motivation #nature
- 2-3 niche tags: #mountainvibes #oceanmeditation
- 1 trending tag (if relevant)

**Avoid:**
- Banned/flagged hashtags
- Irrelevant tags for reach
- More than 5-6 tags total

---

## Caption Templates

### Motivational
```
[Quote or hook] ✨
.
.
#motivation #mindset #inspiration
```

### Nature/Relaxation
```
Find your peace 🌊
.
.
#nature #relaxing #peaceful
```

### Engagement
```
Save this for when you need it 💫
.
.
#daily #reminder #positivity
```

---

## Timing

Best posting times (general):
- Morning: 7-9 AM
- Lunch: 12-1 PM  
- Evening: 7-9 PM

Note: Actual best times depend on your specific audience.
