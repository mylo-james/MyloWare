# AISMR Structured Output Schemas

## Idea Generator Schema

Copy this into the "Structured Output Parser" node for `generate-ideas.workflow.json`:

**Note**: This is the simplified schema - each idea is just a 2-word title, vibe description, and uniqueness check.

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "required": ["ideaTitle", "vibe", "uniquenessCheck"],
    "properties": {
      "ideaTitle": {
        "type": "string",
        "description": "Exactly 2 words (e.g., 'velvet puppy', 'void puppy')",
        "pattern": "^[a-zA-Z]+ [a-zA-Z]+$"
      },
      "vibe": {
        "type": "string",
        "description": "2-3 sentences describing atmosphere and mood for screenwriter"
      },
      "uniquenessCheck": {
        "type": "object",
        "properties": {
          "exists": {
            "type": "boolean"
          },
          "matchedVideos": {
            "type": "array",
            "items": {
              "type": "object"
            }
          },
          "confidence": {
            "type": "string",
            "enum": ["exact", "fuzzy", "none"]
          }
        }
      }
    }
  }
}
```

**Expected Output**: Array of exactly 12 idea objects, each with:
- `ideaTitle`: Two-word title like "velvet puppy" or "void puppy"
- `vibe`: 2-3 sentence description of mood/atmosphere for the screenwriter
- `uniquenessCheck`: Result from `video_query` tool showing if idea already exists in videos table

---

## Screenwriter Schema

Copy this into the "Structured Output Parser" node for `screen-writer.workflow.json`:

```json
{
  "type": "object",
  "required": [
    "title",
    "logline",
    "timestamps",
    "camera",
    "materials",
    "audio",
    "handDiscipline",
    "loopMechanic",
    "validationSummary"
  ],
  "properties": {
    "title": {
      "type": "string"
    },
    "logline": {
      "type": "string"
    },
    "timestamps": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["time", "action", "sensoryDetail"],
        "properties": {
          "time": {
            "type": "string",
            "pattern": "^\\d+\\.\\d+s$"
          },
          "action": {
            "type": "string"
          },
          "sensoryDetail": {
            "type": "string"
          }
        }
      }
    },
    "camera": {
      "type": "string"
    },
    "materials": {
      "type": "string"
    },
    "audio": {
      "type": "string",
      "description": "Detail tactile foley, whisper integration, and confirmation of no music."
    },
    "handDiscipline": {
      "type": "string",
      "description": "Explicit hand choreography ensuring ≤2 hands."
    },
    "loopMechanic": {
      "type": "string"
    },
    "validationSummary": {
      "type": "object",
      "required": ["timing", "hands", "audio", "loop", "notes"],
      "properties": {
        "timing": {
          "type": "string"
        },
        "hands": {
          "type": "string"
        },
        "audio": {
          "type": "string"
        },
        "loop": {
          "type": "string"
        },
        "notes": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

---

## Troubleshooting

If n8n is still showing the wrong schema after push:

1. **In n8n UI**: Open each workflow
2. Click on the "Structured Output Parser" node
3. Make sure "Schema Type" is set to "Manual"
4. Copy the appropriate schema from above and paste it into the "JSON Schema" field
5. Click "Save" on the node
6. Save the workflow

This forces n8n to update its internal cache.
