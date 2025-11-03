# AISMR Structured Output Schemas

## Idea Generator Schema

Copy this into the "Structured Output Parser" node for `generate-ideas.workflow.json`:

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "required": [
      "ideaTitle",
      "hookDescriptor",
      "environment",
      "materials",
      "motionPlan",
      "whisperBeatPlan",
      "loopMechanic",
      "executionNotes",
      "uniquenessEvidence"
    ],
    "properties": {
      "ideaTitle": {
        "type": "string"
      },
      "hookDescriptor": {
        "type": "string",
        "description": "Primary tactile hook; must not collide with exclusion lists."
      },
      "environment": {
        "type": "string"
      },
      "materials": {
        "type": "string"
      },
      "motionPlan": {
        "type": "string",
        "description": "Camera move + subject motion; mention continuity and rhythm."
      },
      "whisperBeatPlan": {
        "type": "string",
        "description": "Explain what happens at 3.0s and how whisper integrates."
      },
      "loopMechanic": {
        "type": "string"
      },
      "executionNotes": {
        "type": "string",
        "description": "Props, lighting, hand usage (≤2), audio treatment (no music)."
      },
      "uniquenessEvidence": {
        "type": "object",
        "properties": {
          "session": {
            "type": "string"
          },
          "archive": {
            "type": "string"
          },
          "similarityScore": {
            "type": "number"
          }
        }
      }
    }
  }
}
```

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
