# AISMR Prompts

This directory contains all the AI prompts used in the AISMR workflow system, extracted from the legacy workflows.

## Personas and Their Prompts

### Chatbot Persona

- **chatbot-assistant.md** - Main system prompt for the Telegram personal assistant
  - Handles general conversation
  - Can trigger AISMR video generation
  - Processes voice messages
  - Context-aware with date/time

### Idea Generator Persona

- **idea-generator-system.md** - Generates 12 monthly surreal ASMR video ideas
  - Creates unique descriptors for video concepts
  - Queries database to avoid duplicates
  - Scores ideas for entertainment value
  - Assigns mood tags

### Screen Writer Persona

- **screen-writer-system.md** - Writes cinematic Sora 2 video prompts
  - Creates detailed 4-second video specifications
  - Includes cinematography, lighting, audio design
  - Generates color grading palettes
  - Follows strict timing and structure rules

## Usage

These prompts are now stored in the database and referenced by the workflows through the `personas` and `prompts` tables with many-to-many relationships.

### Database Schema

- Each persona can have multiple prompts (system + task)
- Prompts are ordered by `display_order` in the `persona_prompts` junction table
- Prompts can be reused across multiple personas and projects

### Migration Status

- ✅ Extracted from legacy workflows
- ⏳ Being migrated to database-driven system
- ⏳ chat-v2.workflow.json uses DB queries (in progress)
