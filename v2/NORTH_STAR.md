# The North Star: From Message to TikTok

> **"A video in production, from a simple text message."**

---

## 🌟 The Vision

Imagine sending a text message and, minutes later, watching your fully-produced video go live on TikTok. No complex commands. No manual steps. Just natural conversation with an AI that understands what you want, remembers what you've done before, and orchestrates the entire production pipeline.

This is the North Star of V2.

---

## 🎬 The Happy Path

### Act I: The Beginning

**7:32 PM - User's Phone**

Mylo picks up their phone and opens Telegram. They have an idea.

```
Mylo: "Create an AISMR video about rain sounds"
```

It's that simple. No `/command`. No structured format. Just a thought.

---

### Act II: The Agent Awakens

**Behind the Scenes: Message Ingestion (< 100ms)**

The message arrives at the chat workflow. Here's what happens in those first milliseconds:

#### Step 1: Normalize Input

```typescript
// Message received from Telegram
const rawMessage = {
  message_id: 1234,
  from: { id: 6559268788, first_name: 'Mylo' },
  chat: { id: 6559268788 },
  text: 'Create an AISMR video about rain sounds',
};

// ⚠️ Clean for AI storage (single-line) - will be done before DB insert
// For now, just use the text as-is for processing
const userText = rawMessage.text;

// Create session identifier
const sessionId = uuid.fromString(`telegram:${rawMessage.from.id}`);
// Result: "a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b"
```

#### Step 2: Store User Turn

```typescript
// Clean for AI (single-line for DB storage)
const cleanForAI = (text: string) => text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

// Store in episodic memory (vector DB)
await memory.store({
  sessionId: 'a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b',
  role: 'user',
  content: cleanForAI(userText), // Single-line for AI embeddings
  memoryType: 'episodic',
  project: 'aismr',
  tags: ['video-request', 'rain'],
  metadata: {
    platform: 'telegram',
    timestamp: '2025-11-06T19:32:00Z',
    messageId: 1234,
  },
});

// Store in SQL (state management)
await db.sessions.upsert({
  id: 'a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b',
  userId: 'telegram:6559268788',
  lastInteractionAt: new Date(),
  context: {
    lastMessage: 'Create an AISMR video about rain sounds',
    intent: null, // Will be determined by agent
  },
});
```

#### Step 3: Assemble Agent Context

```typescript
const agentContext = {
  sessionId: 'a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b',
  userId: 'telegram:6559268788',
  userMessage: 'Create an AISMR video about rain sounds',
  platform: 'telegram',
  timestamp: '2025-11-06T19:32:00Z',
};
```

---

### Act III: The Agent Thinks

**7:32 PM + 150ms - Agent Processing**

The single AI agent node in n8n receives the context. It has access to all MCP tools. Here's its thought process:

#### Step 1: Load Identity (Context)

The agent doesn't know who it is yet. First, it loads its persona.

```typescript
// Agent calls context.get_persona
const persona = await tools.context.get_persona({
  personaName: 'casey',
});

// Returns:
{
  name: 'casey',
  description: 'Warm, helpful AI collaborator for Mylo',
  capabilities: ['conversation', 'workflow-discovery', 'orchestration'],
  tone: 'friendly',
  defaultProject: 'aismr',
  systemPrompt: 'You help Mylo create content by discovering and executing workflows...'
}
```

Now the agent knows: "I am Casey. I help Mylo with AISMR."

#### Step 2: Load Project Context

```typescript
// Agent calls context.get_project
const project = await tools.context.get_project({
  projectName: 'aismr',
});

// Returns:
{
  name: 'aismr',
  description: 'AI ASMR video generation project',
  workflows: ['idea-generation', 'screenplay', 'video-generation', 'upload'],
  guardrails: {
    runtime: '8.0 seconds',
    whisperTiming: '3.0 seconds',
    maxHands: 2,
  },
  settings: {
    outputPlatforms: ['tiktok', 'youtube'],
    defaultPlatform: 'tiktok',
  }
}
```

Now the agent knows: "This is about AISMR. Videos must be 8 seconds with specific rules."

#### Step 3: Search Memory (Agentic RAG)

The agent decides: "Should I search memory? Yes, to check for past similar requests."

```typescript
// Agent calls memory.search
const pastContext = await tools.memory.search({
  query: 'AISMR video rain sounds',
  memoryTypes: ['episodic', 'procedural'],
  project: 'aismr',
  sessionId: 'a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b',
  limit: 10,
  temporalBoost: true, // Recent memories rank higher
});

// Returns:
[
  {
    content: 'Generated 12 AISMR ideas about rain sounds',
    memoryType: 'episodic',
    timestamp: '2025-10-15T14:20:00Z',
    tags: ['idea-generation', 'rain'],
  },
  {
    content: 'User preferred gentle rain over storm sounds',
    memoryType: 'episodic',
    timestamp: '2025-10-15T14:25:00Z',
    tags: ['user-preference', 'rain'],
  }
  // ... more results
]
```

The agent learns: "We've done rain sounds before. User likes gentle rain."

#### Step 4: Understand Intent

The agent processes the user's message with all this context:

```
User: "Create an AISMR video about rain sounds"
Context: 
- I am Casey, helping with AISMR
- AISMR has specific video requirements
- We've done rain sounds before
- User prefers gentle rain

Intent Analysis:
- Action: "Create" → Generate new content
- Type: "video" → Full production workflow
- Subject: "rain sounds" → Topic for content
- Clarity: HIGH → No clarification needed

Conclusion: User wants complete video production workflow for AISMR rain sounds video
```

#### Step 5: Discover Workflow

The agent decides: "I need to find the workflow for creating AISMR videos."

```typescript
// Agent calls workflow.discover
const workflows = await tools.workflow.discover({
  intent: 'create AISMR video from idea to upload',
  project: 'aismr',
});

// Searches procedural memory and returns:
[
  {
    name: 'AISMR Complete Video Production',
    description: 'Full pipeline: idea generation → screenplay → video → upload',
    relevanceScore: 0.95,
    steps: [
      { id: 'generate_ideas', tool: 'workflow.execute', workflowName: 'Generate Ideas' },
      { id: 'await_user_selection', type: 'clarify.ask' },
      { id: 'write_screenplay', tool: 'workflow.execute', workflowName: 'Write Script' },
      { id: 'generate_video', tool: 'workflow.execute', workflowName: 'Generate Video' },
      { id: 'upload_video', tool: 'workflow.execute', workflowName: 'Upload to TikTok' },
    ],
    memoryId: 'workflow-abc-123',
  }
]
```

Perfect match! The agent found exactly what it needs.

#### Step 6: Respond to User

Before starting execution, the agent responds:

```typescript
const response = 'I\'ll create an AISMR video about rain sounds for you! I\'ll generate ideas, have you pick your favorite, write the screenplay, produce the video, and upload it to TikTok. This will take a few minutes. Starting now...';

// Send to Telegram
await telegram.sendMessage({
  chatId: 6559268788,
  text: response,
});

// Store assistant turn
await memory.store({
  sessionId: 'a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b',
  role: 'assistant',
  content: response,
  memoryType: 'episodic',
  project: 'aismr',
  tags: ['workflow-started', 'rain'],
});
```

**User sees:**
```
Casey: I'll create an AISMR video about rain sounds for you! I'll 
       generate ideas, have you pick your favorite, write the 
       screenplay, produce the video, and upload it to TikTok. 
       This will take a few minutes. Starting now...
```

---

### Act IV: Workflow Execution

**7:32 PM + 500ms - Step 1: Generate Ideas**

```typescript
// Agent executes first workflow step
const ideaResult = await tools.workflow.execute({
  workflowName: 'AISMR Idea Generation',
  input: {
    userIdea: 'rain sounds',
    sessionId: 'a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b',
    count: 12,
  },
  waitForCompletion: true,
});

// Workflow runs (internally uses MCP tools):
// 1. Searches episodic memory for past rain ideas
// 2. Searches semantic memory for AISMR archive
// 3. Generates 12 unique ideas
// 4. Validates uniqueness
// 5. Returns structured output

// Returns after ~30 seconds:
{
  success: true,
  workflowRunId: 'run-ideas-789',
  output: {
    userIdea: 'rain',
    ideas: [
      { idea: 'Gentle Rain', vibe: 'Soft patter on leaves, calming forest ambiance. Perfect for relaxation. High replay value.' },
      { idea: 'Storm Window', vibe: 'Dramatic rain against glass, cozy indoor feeling. Strong emotional hook.' },
      { idea: 'Rain Puddle', vibe: 'Playful drops creating ripples, childlike wonder. Unique tactile element.' },
      { idea: 'Umbrella Patter', vibe: 'Rhythmic drumming on fabric, protective comfort. Great sound texture.' },
      { idea: 'Roof Cascade', vibe: 'Continuous flow from gutters, architectural resonance. Soothing consistency.' },
      { idea: 'Rain Forest', vibe: 'Tropical downpour with nature sounds, immersive environment. Rich layering.' },
      { idea: 'Misty Drizzle', vibe: 'Barely-there whisper, subtle atmosphere. Minimalist appeal.' },
      { idea: 'Thunder Rain', vibe: 'Distant rumbles with rain rhythm, dramatic tension. High engagement.' },
      { idea: 'Rain Boots', vibe: 'Splashing through puddles, joyful movement. Kinetic energy.' },
      { idea: 'Rain Garden', vibe: 'Drops on flowers and soil, earthy freshness. Natural harmony.' },
      { idea: 'Cloud Rain', vibe: 'Ethereal perspective, dreamlike quality. Abstract creativity.' },
      { idea: 'Rain Dance', vibe: 'Cultural celebration meets nature, rhythmic joy. Unique narrative.' },
    ],
    uniquenessAudit: {
      passed: true,
      checkedAgainst: 47,
      allUnique: true,
    }
  }
}
```

**7:33 PM - User Notification**

```typescript
// Agent formats ideas beautifully
const ideasMessage = `I've generated 12 unique AISMR ideas about rain sounds:

1. Gentle Rain - Soft patter on leaves, calming forest ambiance
2. Storm Window - Dramatic rain against glass, cozy indoor feeling
3. Rain Puddle - Playful drops creating ripples, childlike wonder
4. Umbrella Patter - Rhythmic drumming on fabric, protective comfort
5. Roof Cascade - Continuous flow from gutters, architectural resonance
6. Rain Forest - Tropical downpour with nature sounds, immersive environment
7. Misty Drizzle - Barely-there whisper, subtle atmosphere
8. Thunder Rain - Distant rumbles with rain rhythm, dramatic tension
9. Rain Boots - Splashing through puddles, joyful movement
10. Rain Garden - Drops on flowers and soil, earthy freshness
11. Cloud Rain - Ethereal perspective, dreamlike quality
12. Rain Dance - Cultural celebration meets nature, rhythmic joy

Which one would you like to turn into a video? (Reply with the number)`;

await telegram.sendMessage({
  chatId: 6559268788,
  text: ideasMessage,
});

// Store ideas in memory
await memory.store({
  sessionId: 'a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b',
  role: 'assistant',
  content: JSON.stringify(ideaResult.output), // Single-line JSON
  memoryType: 'episodic',
  project: 'aismr',
  tags: ['ideas-generated', 'rain', 'awaiting-selection'],
  metadata: {
    workflowRunId: 'run-ideas-789',
    ideaCount: 12,
  },
});
```

**User sees:**
```
Casey: I've generated 12 unique AISMR ideas about rain sounds:

       1. Gentle Rain - Soft patter on leaves...
       2. Storm Window - Dramatic rain against glass...
       ...
       
       Which one would you like to turn into a video? 
       (Reply with the number)
```

**7:33 PM + 15s - User Selection**

```
Mylo: "1"
```

The agent receives the selection:

```typescript
// Clean and validate input
const selection = '1'.trim(); // Single-line

// Store user selection
await memory.store({
  sessionId: 'a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b',
  role: 'user',
  content: 'Selected idea #1: Gentle Rain',
  memoryType: 'episodic',
  project: 'aismr',
  tags: ['idea-selected', 'gentle-rain'],
});

// Extract selected idea
const selectedIdea = ideaResult.output.ideas[0];
// { idea: 'Gentle Rain', vibe: 'Soft patter on leaves...' }
```

**7:33 PM + 16s - Step 2: Generate Screenplay**

```typescript
// Agent executes screenplay workflow
const screenplayResult = await tools.workflow.execute({
  workflowName: 'AISMR Screenplay Generation',
  input: {
    idea: 'Gentle Rain',
    vibe: 'Soft patter on leaves, calming forest ambiance. Perfect for relaxation. High replay value.',
    sessionId: 'a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b',
  },
  waitForCompletion: true,
});

// Workflow runs (internally):
// 1. Loads AISMR specs (8.0s runtime, 3.0s whisper, max 2 hands)
// 2. Searches for successful screenplay patterns
// 3. Generates screenplay with precise timing
// 4. Validates against all guardrails
// 5. Returns validated screenplay

// Returns after ~45 seconds:
{
  success: true,
  workflowRunId: 'run-screenplay-456',
  output: {
    screenplay: {
      title: 'Gentle Rain',
      runtime: 8.0,
      scenes: [
        { timestamp: 0.0, action: 'FADE IN: Close-up of a single leaf, camera focused, shallow depth of field' },
        { timestamp: 0.5, action: 'First raindrop hits the leaf, creating a soft patter sound' },
        { timestamp: 1.2, action: 'Camera slowly pulls back revealing more leaves, rain beginning to fall gently' },
        { timestamp: 2.0, action: 'Two hands enter frame from bottom, palms up, catching raindrops delicately' },
        { timestamp: 3.0, action: 'WHISPER: "Gentle rain"' },
        { timestamp: 4.5, action: 'Hands gently turn over, letting water drip through fingers onto leaves below' },
        { timestamp: 6.0, action: 'Camera shifts focus to background, showing rain falling through forest canopy' },
        { timestamp: 7.5, action: 'Rain intensifies slightly, creating a fuller sound as camera slowly zooms out' },
        { timestamp: 8.0, action: 'FADE OUT' },
      ],
      audio: {
        ambience: 'Soft rain patter, forest sounds',
        whisper: { timestamp: 3.0, text: 'Gentle rain' },
        noMusic: true,
      },
      hands: { count: 2, timing: 'appear at 2.0s, exit at 6.0s' },
      validation: {
        runtimeCheck: { passed: true, value: 8.0, requirement: 8.0 },
        whisperCheck: { passed: true, value: 3.0, requirement: 3.0 },
        handsCheck: { passed: true, value: 2, requirement: 'max 2' },
        audioCheck: { passed: true, noMusic: true },
      }
    }
  }
}
```

**User notification:**

```typescript
await telegram.sendMessage({
  chatId: 6559268788,
  text: 'Perfect! I\'ve written the screenplay for "Gentle Rain" - it\'s validated and ready. Now generating the video... This will take about 2-3 minutes.',
});
```

**7:34 PM + 500ms - Step 3: Generate Video**

```typescript
// Agent triggers video generation (n8n workflow)
const videoResult = await tools.workflow.execute({
  workflowName: 'Generate Video',
  input: {
    screenplay: screenplayResult.output.screenplay,
    sessionId: 'a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b',
    workflowRunId: 'run-video-123',
  },
  waitForCompletion: true, // Wait for video to be generated
});

// n8n workflow (delegated execution):
// 1. Calls external video generation API (e.g., Runway, Pika)
// 2. Monitors generation progress
// 3. Downloads completed video
// 4. Validates video meets specs
// 5. Stores video file
// 6. Returns video URL

// Returns after ~180 seconds:
{
  success: true,
  workflowRunId: 'run-video-123',
  output: {
    videoUrl: 'https://storage.mjames.dev/videos/gentle-rain-abc123.mp4',
    videoId: 'video-abc123',
    duration: 8.0,
    resolution: '1080x1920',
    fileSize: '12.4 MB',
    thumbnail: 'https://storage.mjames.dev/videos/gentle-rain-abc123-thumb.jpg',
  }
}
```

**7:37 PM - User sees:**

```
Casey: Perfect! I've written the screenplay for "Gentle Rain" - 
       it's validated and ready. Now generating the video... 
       This will take about 2-3 minutes.

       [3 minutes pass]

Casey: Video generated! Looking great. Now uploading to TikTok...
```

**7:37 PM + 10s - Step 4: Upload to TikTok**

```typescript
// Agent triggers upload workflow
const uploadResult = await tools.workflow.execute({
  workflowName: 'Upload to TikTok',
  input: {
    videoId: 'video-abc123',
    videoUrl: 'https://storage.mjames.dev/videos/gentle-rain-abc123.mp4',
    title: 'Gentle Rain ASMR 🌧️',
    description: 'Soft rain patter on forest leaves. Close your eyes and listen. #ASMR #Rain #Relaxing',
    hashtags: ['ASMR', 'Rain', 'Relaxing', 'Nature', 'Sleep'],
    sessionId: 'a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b',
  },
  waitForCompletion: true,
});

// n8n workflow (delegated execution):
// 1. Authenticates with TikTok API
// 2. Uploads video file
// 3. Sets metadata (title, description, hashtags)
// 4. Publishes video
// 5. Returns TikTok URL

// Returns after ~30 seconds:
{
  success: true,
  workflowRunId: 'run-upload-789',
  output: {
    platform: 'tiktok',
    postUrl: 'https://tiktok.com/@mylo_aismr/video/7234567890123456789',
    postId: '7234567890123456789',
    publishedAt: '2025-11-06T19:37:40Z',
    status: 'published',
  }
}
```

---

### Act V: The Finale

**7:37 PM + 40s - Success Notification**

```typescript
// Agent stores complete workflow result
await memory.store({
  sessionId: 'a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b',
  role: 'assistant',
  content: JSON.stringify({
    action: 'video_production_complete',
    idea: 'Gentle Rain',
    videoId: 'video-abc123',
    tiktokUrl: 'https://tiktok.com/@mylo_aismr/video/7234567890123456789',
    totalTime: '5 minutes 10 seconds',
  }),
  memoryType: 'episodic',
  project: 'aismr',
  tags: ['video-complete', 'gentle-rain', 'tiktok-published', 'success'],
  metadata: {
    workflowChain: ['run-ideas-789', 'run-screenplay-456', 'run-video-123', 'run-upload-789'],
    ideaGenerationTime: 30,
    screenplayTime: 45,
    videoGenerationTime: 180,
    uploadTime: 30,
  },
});

// Send final message
const finalMessage = `🎉 All done! Your AISMR video "Gentle Rain" is now live on TikTok!

Watch it here: https://tiktok.com/@mylo_aismr/video/7234567890123456789

Total time: 5 minutes 10 seconds
- 12 ideas generated
- Screenplay validated
- Video produced
- Published to TikTok

Want to create another one?`;

await telegram.sendMessage({
  chatId: 6559268788,
  text: finalMessage,
});
```

**User sees:**

```
Casey: 🎉 All done! Your AISMR video "Gentle Rain" is now 
       live on TikTok!

       Watch it here: https://tiktok.com/@mylo_aismr/video/...

       Total time: 5 minutes 10 seconds
       - 12 ideas generated
       - Screenplay validated
       - Video produced
       - Published to TikTok

       Want to create another one?
```

**7:37 PM - Mylo's Phone**

Mylo taps the link. TikTok opens. The video starts playing.

*Gentle rain patters on forest leaves. Two hands enter the frame, catching raindrops. A soft whisper: "Gentle rain." The camera pulls back, showing the rain falling through the canopy. Fade out.*

8.0 seconds. Perfect.

---

## 📊 What Happened Behind the Scenes

### Memory State (Vector DB)

After this interaction, the vector database contains:

```json
// All stored as single-line JSON
[
  {
    "id": "mem-001",
    "content": "Create an AISMR video about rain sounds",
    "memoryType": "episodic",
    "role": "user",
    "sessionId": "a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b",
    "project": "aismr",
    "tags": ["video-request", "rain"],
    "timestamp": "2025-11-06T19:32:00Z"
  },
  {
    "id": "mem-002",
    "content": "I'll create an AISMR video about rain sounds for you...",
    "memoryType": "episodic",
    "role": "assistant",
    "sessionId": "a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b",
    "project": "aismr",
    "tags": ["workflow-started"],
    "relatedTo": ["mem-001"]
  },
  {
    "id": "mem-003",
    "content": "{\"userIdea\":\"rain\",\"ideas\":[{\"idea\":\"Gentle Rain\",...}]}",
    "memoryType": "episodic",
    "role": "assistant",
    "sessionId": "a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b",
    "project": "aismr",
    "tags": ["ideas-generated", "rain", "awaiting-selection"],
    "relatedTo": ["mem-002"]
  },
  {
    "id": "mem-004",
    "content": "Selected idea #1: Gentle Rain",
    "memoryType": "episodic",
    "role": "user",
    "sessionId": "a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b",
    "project": "aismr",
    "tags": ["idea-selected", "gentle-rain"],
    "relatedTo": ["mem-003"]
  },
  {
    "id": "mem-005",
    "content": "{\"action\":\"video_production_complete\",\"idea\":\"Gentle Rain\",...}",
    "memoryType": "episodic",
    "role": "assistant",
    "sessionId": "a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b",
    "project": "aismr",
    "tags": ["video-complete", "gentle-rain", "tiktok-published", "success"],
    "relatedTo": ["mem-001", "mem-003", "mem-004"],
    "metadata": {
      "workflowChain": ["run-ideas-789", "run-screenplay-456", "run-video-123", "run-upload-789"],
      "totalTime": 310
    }
  }
]
```

### SQL State (Postgres)

```sql
-- sessions table
INSERT INTO sessions (id, user_id, persona, project, last_interaction_at, context)
VALUES (
  'a3f5e9b2-4c7d-5e8a-9f1b-2c3d4e5f6a7b',
  'telegram:6559268788',
  'casey',
  'aismr',
  '2025-11-06T19:37:40Z',
  '{
    "lastWorkflow": "AISMR Complete Video Production",
    "lastIdea": "Gentle Rain",
    "lastVideoId": "video-abc123",
    "lastTikTokUrl": "https://tiktok.com/@mylo_aismr/video/7234567890123456789"
  }'::jsonb
);

-- workflow_runs table
INSERT INTO workflow_runs (id, session_id, workflow_name, status, output, created_at)
VALUES 
  ('run-ideas-789', 'a3f5e9b2-...', 'AISMR Idea Generation', 'completed', {...}, '2025-11-06T19:32:01Z'),
  ('run-screenplay-456', 'a3f5e9b2-...', 'AISMR Screenplay Generation', 'completed', {...}, '2025-11-06T19:33:16Z'),
  ('run-video-123', 'a3f5e9b2-...', 'Generate Video', 'completed', {...}, '2025-11-06T19:34:01Z'),
  ('run-upload-789', 'a3f5e9b2-...', 'Upload to TikTok', 'completed', {...}, '2025-11-06T19:37:10Z');
```

---

## 🎯 Key Principles Demonstrated

### 1. **Single-Line JSON for AI-Facing Data**

Notice that text stored in DB for AI is single-line:
- Memory content (stored in DB): `"Generated 12 AISMR ideas about rain sounds"` (cleaned, no `\n`)
- Workflow definitions (stored in DB): Minified JSON (no `\n`)
- Agent summaries (stored in DB): Single-line for embeddings

But user-facing text can be multi-line:
- Telegram messages to user: ```
Casey: I've generated 12 unique AISMR ideas:
1. Gentle Rain
2. Storm Window
```
- Logs and debug output: Multi-line OK
- Documentation: Multi-line OK

**Why:** Embeddings work better without `\n` noise, but users need readable formatting.

### 2. **Semantic Workflow Discovery**

The agent didn't have hardcoded logic saying "if user asks for video, run workflow X."

Instead:
1. User: "Create an AISMR video"
2. Agent: *searches procedural memory for workflows matching this intent*
3. Agent: *finds "AISMR Complete Video Production" with 95% relevance*
4. Agent: *executes discovered workflow*

**This is the magic of V2.** Workflows are data, not code.

### 3. **Memory as Context**

The agent remembered:
- Past rain sound ideas (searched episodic memory)
- User preference for gentle rain (found in past interaction)
- AISMR specs (loaded from semantic memory)
- Available workflows (searched procedural memory)

The agent isn't stateless—it has memory.

### 4. **Hybrid Execution**

Some steps executed directly (MCP tools):
- `context.get_persona` → Direct MCP call
- `context.get_project` → Direct MCP call
- `memory.search` → Direct MCP call
- `workflow.discover` → Direct MCP call

Some steps delegated to n8n:
- Video generation → Heavy API calls, monitoring
- TikTok upload → Authentication, file upload, publishing

The agent orchestrates both seamlessly.

### 5. **State Tracking**

Every step tracked in SQL:
- Session state (working memory)
- Workflow runs (execution history)
- Each run linked to session

If something fails, the agent can:
- Check SQL for run status
- Resume from last successful step
- Inform user of exact failure point

### 6. **User Experience**

From Mylo's perspective:
- Send one message
- Get 12 ideas
- Pick favorite
- Wait 5 minutes
- Video is live on TikTok

**That's it.** The complexity is invisible.

---

## 🚀 The Technology Stack (North Star)

```
User (Telegram)
     │
     ▼
┌────────────────────────────────────┐
│  n8n (Agent Workflow)              │
│  (One AI node + MCP client)        │
│  + Programmatic workflows          │
│  (video queuing, TikTok posting)   │
└────────────┬───────────────────────┘
             │
             ▼
┌────────────────────────────────────┐
│  MCP Server (Tool Interface)       │
│  ├─ memory.search                  │
│  ├─ memory.store                   │
│  ├─ context.get_persona            │
│  ├─ context.get_project            │
│  ├─ workflow.discover              │
│  ├─ workflow.execute               │
│  ├─ clarify.ask                    │
│  └─ docs.lookup                    │
└────────────┬───────────────────────┘
             │
             ▼
┌────────────────────────────────────┐
│  Postgres (with pgvector)          │
│  ├─ Vector DB (memories)           │
│  ├─ SQL DB (state, sessions, runs) │
│  └─ n8n DB (workflow state)        │
└────────────────────────────────────┘
```

**Three services in docker-compose:**
- **Postgres** (database with pgvector)
- **MCP Server** (tool interface)
- **n8n** (agent workflow + programmatic operations)

**Start with `docker compose up`. That's it.**

---

## 💡 Why This Is The North Star

### For Users (Mylo)
- Natural conversation
- No complex commands
- Fast results (5 minutes)
- Reliable output (validated)
- Visible progress (notifications)

### For Developers (Us)
- Simple architecture (one agent, clean tools)
- Discoverable workflows (semantic search)
- Testable (100% coverage)
- Maintainable (add workflows = add JSON)
- Debuggable (clear state tracking)

### For the Agent (Casey)
- Autonomous decisions (agentic RAG)
- Rich context (memory + personas + projects)
- Flexible execution (MCP + n8n)
- Learning over time (memory evolution)
- Clear instructions (workflow definitions)

---

## 🌈 The Future

Once this North Star is achieved, we can:

1. **Multi-Project Support**
   - Same architecture for podcasts, blog posts, social media
   - Agent discovers project-specific workflows

2. **Learning & Adaptation**
   - Agent learns user preferences over time
   - Workflows evolve based on success rates
   - Memory graph connects related concepts

3. **Predictive Suggestions**
   - "You usually create videos on Mondays. Ready?"
   - "Rain sounds performed well. Try 'Ocean Waves'?"

4. **Multi-Agent Collaboration**
   - Idea agent + Screenplay agent + Upload agent
   - Each specialized, all coordinated

But first: **Build the North Star.** Everything else follows from this foundation.

---

## 📝 Timeline

**From message to TikTok: 5 minutes 10 seconds**

```
00:00 - User message received
00:00 - Message cleaned and stored (single-line JSON)
00:00 - Agent loads persona and project context
00:00 - Agent searches memory for relevant context
00:00 - Agent discovers workflow
00:00 - Agent responds to user
00:01 - Idea generation workflow starts
00:30 - 12 ideas generated and presented
00:45 - User selects idea #1
00:46 - Screenplay workflow starts
01:31 - Screenplay completed and validated
01:31 - Video generation starts (delegated to n8n)
04:31 - Video generation completes
04:41 - Upload workflow starts
05:10 - Video live on TikTok
05:10 - User notified with link
```

**Every step tracked. Every memory stored. Every action logged.**

---

_"From a text message to a published video, in five minutes."_

**This is the North Star. This is V2.** ⭐

