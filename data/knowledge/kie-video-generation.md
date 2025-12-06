# KIE.ai Video Generation Guide

Reference guide for generating AI video clips using the KIE.ai API.

---

## Tool: kie_generate

Generate AI video clips from text prompts.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| prompts | array[string] | Yes | List of text prompts describing videos |
| duration_seconds | number | No | Video length (default: 5, max: 10) |
| aspect_ratio | string | No | "9:16" (vertical), "16:9" (horizontal), "1:1" (square) |

### Example Call

```python
kie_generate(
    prompts=[
        "Cinematic drone shot of mountains at sunrise",
        "Peaceful ocean waves at sunset"
    ],
    duration_seconds=5,
    aspect_ratio="9:16"
)
```

---

## Writing Effective Prompts

### Prompt Structure

```
[Camera] + [Subject] + [Setting] + [Lighting] + [Atmosphere] + [Style]
```

### Good Prompt Example

```
Cinematic drone shot slowly ascending over majestic snow-capped mountain peaks 
at golden hour, soft pink clouds drifting between summits, warm morning light, 
4K nature documentary style
```

### Bad Prompt Example

```
mountains
```

### Key Elements to Include

1. **Camera Movement**
   - "drone shot ascending"
   - "slow tracking shot"
   - "static wide angle"
   - "smooth dolly forward"

2. **Subject Description**
   - Be specific: "snow-capped mountain peaks" not "mountains"
   - Include textures: "gentle rolling waves" not "ocean"
   - Add details: "ancient redwood forest" not "trees"

3. **Lighting**
   - "golden hour"
   - "sunset/sunrise"
   - "dramatic shadows"
   - "soft diffused light"
   - "volumetric light rays"

4. **Atmosphere**
   - "misty"
   - "dreamy"
   - "dramatic clouds"
   - "clear blue sky"

5. **Style Modifiers**
   - "cinematic"
   - "4K ultra HD"
   - "nature documentary"
   - "slow motion"

---

## Best Practices

### Do
- Write detailed, specific prompts (50-100 words)
- Focus on visual elements only
- Describe movement and camera work
- Include lighting and atmosphere

### Don't
- Include text or words in prompts (added in editing)
- Include people or faces
- Use vague descriptions
- Request specific brands or copyrighted content

---

## Aspect Ratios

| Platform | Ratio | Use Case |
|----------|-------|----------|
| TikTok, Reels, Shorts | 9:16 | Vertical mobile video |
| YouTube, TV | 16:9 | Horizontal widescreen |
| Instagram Feed | 1:1 | Square posts |

