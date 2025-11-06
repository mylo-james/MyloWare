# The North Star: The AI Production Studio

> **"From a text message to a published video—orchestrated by autonomous AI agents working like a real production company."**

---

## 🌟 The Vision

Imagine sending a text message: "Make an AISMR video about candles." Minutes later, you're watching a stunning 96-second compilation of 12 surreal candle variations going live on TikTok. Or say: "Make a video about how different generations react to AI," and watch as 6 perfectly-crafted generational reaction clips get stitched into a viral-ready post.

No complex commands. No manual coordination. Just natural conversation with **Casey**, the Showrunner, who kicks off a pipeline of specialized AI agents—each an expert in their craft, each autonomous, each passing work seamlessly to the next like a real production studio.

**This is the North Star of V2: Agents calling agents to do work.**

---

## 🎭 The Studio

### The Team

**Casey** - The Showrunner

- Receives user requests
- Discovers which workflow to execute
- Kicks off the first agent
- Waits for completion
- Notifies user when done

**Iggy** - Creative Director

- Generates concept ideas
- For AISMR: Creates 12 surreal modifiers for an object
- For GenReact: Develops 6 generational scenarios
- Searches memory for uniqueness
- Can trigger HITL via n8n Telegram "Send and Wait"

**Riley** - Head Writer

- Writes detailed screenplays
- For AISMR: 12 scripts (8s each, one per modifier)
- For GenReact: 6 scripts (8s each, one per generation)
- Validates against project specs
- Ensures timing, guardrails, feasibility

**Veo** - Production (n8n workflow)

- Generates videos from screenplays
- Handles API calls to video generation services
- Monitors progress, retries on failure
- Batch processing for multiple videos

**Alex** - Editor (Post-Production)

- Stitches multiple videos together
- Adds captions, overlays, generation labels
- Applies effects and transitions
- Can trigger HITL via n8n Telegram "Send and Wait"
- Exports final compilation

**Quinn** - Social Media Manager

- Creates optimized captions and hashtags
- Uploads to correct platform (TikTok, YouTube, etc.)
- Handles platform-specific formatting
- Reports back with post URL

---

## 🎯 Core Principle: Autonomous Handoffs

Every agent (except Casey) is a **black box autonomous worker**:

1. **Receives natural language instructions** (like a coworker would)
2. **Reads instructions** to understand what's being asked
3. **Loads own persona** to know their role and capabilities
4. **Loads project context** to understand specs and guardrails
5. **Searches memory** to find everything they need (previous agent's work, patterns, past examples)
6. **Does the work** using specialized skills
7. **Can trigger HITL** via n8n Telegram "Send and Wait" if user input needed
8. **Hands off to next agent** with natural language instructions (no return to Casey)
9. **Signals completion** when workflow is done

**Key insight:** Agents communicate like coworkers. No rigid JSON schemas—just natural instructions that agents interpret autonomously.

**Casey never coordinates mid-workflow.** She kicks off, then waits for completion signal.

---

## 📋 The Two Projects

### Project 1: AISMR

**Concept:** Surreal 8-second micro-films of everyday objects with impossible modifiers
**Format:** 12 videos stitched together (~96 seconds)
**Examples:** Void candle, Lava book, Crystal water, Shadow mirror, Smoke glass

**Specs:**

- Runtime: 8.0 seconds per video
- Whisper timing: 3.0 seconds into each video
- Max hands: 2
- Audio: Ambient only, no music
- Total compilation: ~96s (12 × 8s)

### Project 2: GenReact

**Concept:** How each generation (Silent through Alpha) reacts to modern situations
**Format:** 6 videos stitched together (~48 seconds)
**Examples:** Generations reacting to AI, TikTok trends, dating apps

**Specs:**

- Runtime: 8.0 seconds per generation
- 6 generations: Silent Generation, Boomer, Gen X, Millennial, Gen Z, Alpha
- Style: Humorous but respectful, culturally accurate
- Total compilation: ~48s (6 × 8s)

**Key Insight:** Same pipeline, same agents, different project context determines behavior.

---

## 🎬 Story 1: AISMR Happy Path

### User Request

**8:00 PM - Mylo's Phone (Telegram)**

```
Mylo: "Make an AISMR video about candles"
```

---

### Casey Receives & Kicks Off

**8:00 PM + 100ms**

```typescript
// Casey (Showrunner) processes request
1. ASSESS INTENT
   "User wants AISMR video production"
   → Object: "candles"
   → Project: AISMR (detected from context/history)

2. LOAD CONTEXT
   → context_get_persona('casey')
   → context_get_project('aismr')

   Project specs loaded:
   - 12 surreal modifiers per object
   - 8.0s per video
   - Compilation format
   - Whisper at 3.0s

3. DISCOVER WORKFLOW
   → prompt_discover({
       intent: 'create AISMR compilation video',
       project: 'aismr'
     })

   Workflow found: "AISMR Complete Production"
   Steps:
   1. Iggy: Generate 12 surreal modifiers
   2. HITL: User approves modifiers
   3. Riley: Write 12 screenplays
   4. Veo: Generate 12 videos
   5. Alex: Edit/stitch compilation
   6. HITL: User reviews final
   7. Quinn: Upload to platform

4. CREATE EXECUTION TRACE
   → trace_create({
       sessionId: 'telegram:6559268788',
       workflowName: 'AISMR Complete Production',
       project: 'aismr',
       context: { object: 'candles' }
     })

   Returns: traceId = 'trace-aismr-001'

5. KICK OFF FIRST AGENT (Natural Language)
   → handoff_to_agent({
       toAgent: 'iggy',
       instructions: `Iggy, generate 12 surreal modifiers for "candles" for the AISMR project.
                      The user wants to create a compilation video.
                      Make sure they're all unique and validated against our archive.`,
       traceId: 'trace-aismr-001',
       project: 'aismr'
     })

6. RESPOND TO USER
   "I'll create an AISMR video about candles! Iggy is generating
    12 surreal modifier ideas. This will take a few minutes..."

7. WAIT FOR COMPLETION
   [Casey goes idle, waiting for completion signal]
```

---

### Iggy: Creative Director

**8:00 PM + 500ms - Iggy Takes Over**

```typescript
// Iggy receives natural language instructions
Handoff received: {
  fromAgent: 'casey',
  instructions: `Iggy, generate 12 surreal modifiers for "candles" for the AISMR project.
                 The user wants to create a compilation video.
                 Make sure they're all unique and validated against our archive.`,
  traceId: 'trace-aismr-001',
  project: 'aismr'
}

// Iggy's autonomous process
1. READ INSTRUCTIONS
   "I need to generate 12 surreal modifiers for 'candles'"
   "This is for AISMR project"
   "Must be unique and validated"

2. LOAD MY CONTEXT
   → context_get_persona('iggy')
     "I am Iggy, Creative Director for AISMR. I generate
      surreal modifiers and ensure uniqueness."

   → context_get_project('aismr')
     "12 modifiers per object, 8s videos, compilation format"

2. SEARCH FOR UNIQUENESS (Layer 1: Session)
   → memory_search({
       query: 'AISMR candles past ideas',
       memoryTypes: ['episodic'],
       project: 'aismr',
       temporalBoost: true
     })

   Found: "Fire candle, Melting candle" (used 2 months ago)
   Exclusion list: ['fire', 'melting', 'wax']

3. SEARCH FOR UNIQUENESS (Layer 2: Archive)
   → memory_search({
       query: 'AISMR concepts similar to candles flame light',
       memoryTypes: ['semantic', 'procedural'],
       project: 'aismr',
       minSimilarity: 0.70
     })

   Found: 47 past AISMR ideas, none too similar
   Safe to proceed

4. SEARCH FOR INSPIRATION
   → memory_search({
       query: 'successful AISMR surreal modifiers',
       memoryTypes: ['semantic'],
       project: 'aismr',
       expandGraph: true,
       maxHops: 2
     })

   Found patterns: void, liquid, crystalline, shadow work well

5. GENERATE 12 SURREAL MODIFIERS
   Based on exclusions + inspiration:

   1. Void Candle - Flame that absorbs light instead of emitting
   2. Liquid Candle - Wax flows upward defying gravity
   3. Crystal Candle - Transparent crystalline structure, inner glow
   4. Shadow Candle - Casts light but made of shadow
   5. Smoke Candle - Solid smoke pillar with ethereal flame
   6. Frozen Candle - Ice cold but burns with frost fire
   7. Electric Candle - Lightning coursing through wax
   8. Magnetic Candle - Iron filings dance around flame
   9. Holographic Candle - Glitching digital projection
   10. Obsidian Candle - Volcanic glass with magma core
   11. Ethereal Candle - Translucent, ghost-like flicker
   12. Mirror Candle - Reflective surface, infinite flames

6. VALIDATE UNIQUENESS
   → memory_search for each modifier
   All unique ✓

7. STORE RESULT
   → memory_store({
       content: 'Generated 12 surreal candle modifiers for AISMR',
       memoryType: 'episodic',
       project: ['aismr'],
       persona: ['iggy'],
       tags: ['ideas-generated', 'candles', 'validated'],
       metadata: {
         traceId: 'trace-aismr-001',
         object: 'candles',
         modifiers: [...12 modifiers...],
         uniquenessAudit: { passed: true, checked: 47 }
       }
     })

8. TRIGGER HITL (User Approval via n8n)
   // Iggy's n8n workflow includes Telegram "Send and Wait" node
   → Telegram.sendAndWait({
       chatId: session.userId,
       message: `I've created 12 surreal candle concepts:

       1. Void Candle - Flame that absorbs light
       2. Liquid Candle - Wax flows upward
       3. Crystal Candle - Transparent with inner glow
       4. Shadow Candle - Made of shadow, casts light
       5. Smoke Candle - Solid smoke with ethereal flame
       6. Frozen Candle - Ice cold but burns
       7. Electric Candle - Lightning through wax
       8. Magnetic Candle - Iron filings dance
       9. Holographic Candle - Glitching projection
       10. Obsidian Candle - Volcanic glass, magma core
       11. Ethereal Candle - Ghost-like flicker
       12. Mirror Candle - Infinite reflections

       Approve these modifiers to continue?`,
       responseType: 'Approval', // n8n's approval mode with buttons
       approveLabel: 'Approve',
       declineLabel: 'Request Changes'
     })

   [n8n workflow pauses, waiting for user button click]
```

**8:01 PM - User Sees**

```
Iggy: I've created 12 surreal candle concepts:

      1. Void Candle - Flame that absorbs light
      2. Liquid Candle - Wax flows upward
      ...

      Approve these modifiers to continue?
      [Approve] [Request Changes]
```

**8:01 PM + 30s - User Approves**

```
Mylo: [Clicks Approve]
```

```typescript
// Iggy receives approval
9. APPROVAL RECEIVED
   → memory_store({
       content: 'User approved 12 candle modifiers',
       memoryType: 'episodic',
       tags: ['approval', 'candles'],
       metadata: { traceId: 'trace-aismr-001' }
     })

10. HANDOFF TO RILEY (Natural Language)
    → handoff_to_agent({
        toAgent: 'riley',
        instructions: `Riley, write 12 screenplays for the candle modifiers I just generated.
                       User approved all 12: Void, Liquid, Crystal, Shadow, Smoke, Frozen,
                       Electric, Magnetic, Holographic, Obsidian, Ethereal, and Mirror.

                       Each should be 8 seconds, AISMR format. You'll find the full details
                       in my last memory entry (mem-iggy-001).`,
        traceId: 'trace-aismr-001',
        project: 'aismr'
      })

    [Iggy's work complete, passes to Riley]
```

---

### Riley: Head Writer

**8:02 PM - Riley Takes Over**

```typescript
// Riley receives natural language instructions
Handoff received: {
  fromAgent: 'iggy',
  instructions: `Riley, write 12 screenplays for the candle modifiers I just generated.
                 User approved all 12: Void, Liquid, Crystal, Shadow, Smoke, Frozen,
                 Electric, Magnetic, Holographic, Obsidian, Ethereal, and Mirror.

                 Each should be 8 seconds, AISMR format. You'll find the full details
                 in my last memory entry (mem-iggy-001).`,
  traceId: 'trace-aismr-001',
  project: 'aismr'
}

// Riley's autonomous process
1. READ INSTRUCTIONS
   "I need to write 12 screenplays for candle modifiers"
   "Names: Void, Liquid, Crystal... (12 total)"
   "Format: AISMR, 8 seconds each"
   "Details are in Iggy's memory (mem-iggy-001)"

2. SEARCH FOR IGGY'S WORK
   → memory_search({
       query: 'trace-aismr-001 candle modifiers Iggy generated',
       memoryTypes: ['episodic'],
       project: 'aismr',
       limit: 5
     })

   Found: Full modifier details with descriptions

3. LOAD MY CONTEXT
   → context_get_persona('riley')
     "I am Riley, Head Writer. I write precise, validated screenplays."

   → context_get_project('aismr')
     Specs: 8.0s runtime, whisper at 3.0s, max 2 hands, no music

4. SEARCH FOR PATTERNS
   → memory_search({
       query: 'successful AISMR candle fire flame screenplays',
       memoryTypes: ['semantic', 'procedural'],
       project: 'aismr',
       expandGraph: true
     })

   Found: Best practices for fire/light scenes, timing patterns

5. WRITE 12 SCREENPLAYS (Parallel/Batch)

   For each modifier, generate detailed screenplay:

   Example: Void Candle
   {
     title: 'Void Candle',
     runtime: 8.0,
     scenes: [
       { time: 0.0, action: 'FADE IN: Candle in darkness, flame pulls light inward' },
       { time: 0.8, action: 'Close-up: Black flame consuming ambient light' },
       { time: 2.0, action: 'Two hands enter, fingers approach the void flame' },
       { time: 3.0, action: 'WHISPER: "Void candle"' },
       { time: 4.5, action: 'Hand passes through flame, light bends around fingers' },
       { time: 6.0, action: 'Pull back, room darkening as flame intensifies' },
       { time: 7.5, action: 'Void flame pulses, consuming all light' },
       { time: 8.0, action: 'FADE OUT to complete darkness' }
     ],
     audio: {
       ambience: 'Deep hum, subtle whoosh as light disappears',
       whisper: { time: 3.0, text: 'Void candle' },
       noMusic: true
     },
     hands: { count: 2, timing: '2.0s to 6.0s' },
     feasibility: 'Black flame effect, reverse lighting, hands visible in darkness'
   }

   [Generates all 12 screenplays...]

6. VALIDATE EACH SCREENPLAY
   For each:
   → Runtime check: 8.0s ✓
   → Whisper timing: 3.0s ✓
   → Hands: ≤2 ✓
   → Audio: No music ✓

   All 12 pass validation

7. STORE RESULTS
   → memory_store({
       content: 'Wrote 12 validated AISMR screenplays for candle modifiers',
       memoryType: 'episodic',
       project: ['aismr'],
       persona: ['riley'],
       tags: ['screenplays-complete', 'candles', 'validated'],
       metadata: {
         traceId: 'trace-aismr-001',
         count: 12,
         allValidated: true,
         screenplays: [...summaries...]
       }
     })

8. HANDOFF TO VEO (Natural Language)
   → handoff_to_agent({
       toAgent: 'veo',
       instructions: `Veo, generate 12 videos from the screenplays I just wrote.
                      All 12 are validated and ready. Generate them in parallel/batch mode.
                      They're all 8 seconds, 1080x1920 format.

                      Find the screenplays in my last memory (trace-aismr-001, riley).`,
       traceId: 'trace-aismr-001',
       project: 'aismr'
     })

   [Riley's work complete, passes to Veo]
```

---

### Veo: Production (n8n Workflow)

**8:03 PM - Veo Takes Over**

```typescript
// Veo (n8n workflow) receives natural language instructions
Handoff received: {
  fromAgent: 'riley',
  instructions: `Veo, generate 12 videos from the screenplays I just wrote.
                 All 12 are validated and ready. Generate them in parallel/batch mode.
                 They're all 8 seconds, 1080x1920 format.

                 Find the screenplays in my last memory (trace-aismr-001, riley).`,
  traceId: 'trace-aismr-001',
  project: 'aismr'
}

// n8n workflow process (Veo can also search memory!)
1. SEARCH FOR RILEY'S SCREENPLAYS
   → memory_search({
       query: 'trace-aismr-001 riley screenplays',
       memoryTypes: ['episodic'],
       project: 'aismr',
       limit: 5
     })

   Found: All 12 screenplays with full details

2. BATCH VIDEO GENERATION
   For each screenplay:
   → HTTP Request to Veo 3 Fast API
   → Submit screenplay description + specs
   → Receive job ID

   Submitted 12 jobs in parallel

3. POLL FOR COMPLETION
   → Monitor all 12 jobs
   → Poll every 10 seconds
   → Wait for all to complete

   [2-3 minutes pass]

4. DOWNLOAD VIDEOS
   All 12 videos generated:
   - void-candle-abc123.mp4 (8.0s, 1080x1920)
   - liquid-candle-def456.mp4 (8.0s, 1080x1920)
   - crystal-candle-ghi789.mp4 (8.0s, 1080x1920)
   ... [12 total]

5. VALIDATE VIDEOS
   For each:
   → Duration check: 8.0s ✓
   → Resolution: 1080x1920 ✓
   → File integrity ✓

   All pass

6. UPLOAD TO STORAGE
   → Store all 12 videos in cloud storage
   → Generate URLs

7. STORE RESULTS
   → memory_store({
       content: '12 AISMR candle videos generated successfully',
       memoryType: 'episodic',
       project: ['aismr'],
       tags: ['videos-generated', 'candles', 'batch-complete'],
       metadata: {
         traceId: 'trace-aismr-001',
         count: 12,
         totalDuration: 96,
         videoUrls: [...]
       }
     })

8. HANDOFF TO ALEX (Natural Language)
   → handoff_to_agent({
       toAgent: 'alex',
       instructions: `Alex, edit the 12 candle videos I just generated into a compilation.
                      All videos are ready and stored. Use the AISMR style: sequential with
                      title overlays for each modifier.

                      Make it ~110 seconds total (including intro/outro cards).
                      Find my video URLs in memory (trace-aismr-001, veo).`,
       traceId: 'trace-aismr-001',
       project: 'aismr'
     })

   [Veo's work complete, passes to Alex]
```

---

### Alex: Editor (Post-Production)

**8:06 PM - Alex Takes Over**

```typescript
// Alex receives natural language instructions
Handoff received: {
  fromAgent: 'veo',
  instructions: `Alex, edit the 12 candle videos I just generated into a compilation.
                 All videos are ready and stored. Use the AISMR style: sequential with
                 title overlays for each modifier.

                 Make it ~110 seconds total (including intro/outro cards).
                 Find my video URLs in memory (trace-aismr-001, veo).`,
  traceId: 'trace-aismr-001',
  project: 'aismr'
}

// Alex's autonomous process
1. READ INSTRUCTIONS
   "I need to edit 12 videos into a compilation"
   "Style: AISMR sequential with titles"
   "Target: ~110 seconds"
   "Find video URLs in Veo's memory"

2. SEARCH FOR VEO'S VIDEOS
   → memory_search({
       query: 'trace-aismr-001 veo candle videos generated',
       memoryTypes: ['episodic'],
       project: 'aismr',
       limit: 5
     })

   Found: All 12 video URLs and metadata

3. LOAD MY CONTEXT
   → context_get_persona('alex')
     "I am Alex, Editor. I stitch, caption, and polish videos."

   → context_get_project('aismr')
     Style: Clean titles, smooth transitions, brand consistent

4. SEARCH FOR STYLE GUIDELINES
   → memory_search({
       query: 'AISMR editing style titles transitions',
       memoryTypes: ['semantic'],
       project: 'aismr'
     })

   Found: Use fade transitions, title cards 1s, consistent font

5. DOWNLOAD ALL 12 VIDEOS
   → Download from cloud storage

6. EDIT COMPILATION
   Using video editing tools:

   Sequence:
   - Intro title card (2s): "AISMR: Candles"
   - Void Candle (8s)
   - Title overlay (1s): "Void"
   - Liquid Candle (8s)
   - Title overlay (1s): "Liquid"
   - Crystal Candle (8s)
   - Title overlay (1s): "Crystal"
   ... [continue for all 12]
   - Outro card (2s): "Which was your favorite?"

   Total: ~110s (includes title cards)

7. ADD EFFECTS
   → Smooth fade transitions between clips
   → Title overlays with AISMR branding
   → Color grading for consistency
   → Audio leveling

8. EXPORT FINAL VIDEO
   → Export: aismr-candles-compilation-final.mp4
   → Duration: 110s
   → Resolution: 1080x1920 (TikTok format)
   → Bitrate: Optimized

7. STORE RESULT
   → memory_store({
       content: 'Completed AISMR candles compilation edit',
       memoryType: 'episodic',
       project: ['aismr'],
       persona: ['alex'],
       tags: ['edit-complete', 'candles', 'compilation'],
       metadata: {
         traceId: 'trace-aismr-001',
         duration: 110,
         clipsUsed: 12,
         finalUrl: 'https://storage.mjames.dev/aismr-candles-final.mp4'
       }
     })

10. TRIGGER HITL (User Review via n8n)
   // Alex's n8n workflow includes Telegram "Send and Wait" node
   → Telegram.sendAndWait({
       chatId: session.userId,
       message: `I've edited your AISMR candles compilation!

       🎬 Duration: 110 seconds
       📹 12 candle variations
       ✨ Includes title cards and transitions

       Preview: [Link to video]

       Approve for upload?`,
       responseType: 'Approval',
       approveLabel: 'Approve',
       declineLabel: 'Request Changes'
     })

   [n8n workflow pauses for user review]
```

**8:07 PM - User Reviews**

```
Alex: I've edited your AISMR candles compilation!

      🎬 Duration: 110 seconds
      📹 12 candle variations
      ✨ Includes title cards and transitions

      [Preview Link]

      Approve for upload?
      [Approve] [Request Changes]
```

**8:08 PM - User Approves**

```
Mylo: [Clicks Approve]
```

```typescript
// Alex receives approval
9. APPROVAL RECEIVED
   → memory_store({
       content: 'User approved final AISMR candles compilation',
       memoryType: 'episodic',
       tags: ['approval', 'final-video'],
       metadata: { traceId: 'trace-aismr-001' }
     })

12. HANDOFF TO QUINN (Natural Language)
    → handoff_to_agent({
        toAgent: 'quinn',
        instructions: `Quinn, publish the AISMR candles compilation I just finished editing.
                       User approved it. Upload to TikTok with AISMR branding.

                       It's a surreal object compilation about candles (12 variations).
                       Find the final video URL in my last memory (trace-aismr-001, alex).`,
        traceId: 'trace-aismr-001',
        project: 'aismr'
      })

    [Alex's work complete, passes to Quinn]
```

---

### Quinn: Social Media Manager

**8:08 PM + 30s - Quinn Takes Over**

```typescript
// Quinn receives natural language instructions
Handoff received: {
  fromAgent: 'alex',
  instructions: `Quinn, publish the AISMR candles compilation I just finished editing.
                 User approved it. Upload to TikTok with AISMR branding.

                 It's a surreal object compilation about candles (12 variations).
                 Find the final video URL in my last memory (trace-aismr-001, alex).`,
  traceId: 'trace-aismr-001',
  project: 'aismr'
}

// Quinn's autonomous process
1. READ INSTRUCTIONS
   "I need to publish AISMR candles video to TikTok"
   "User already approved"
   "Content type: surreal object compilation"
   "Find video in Alex's memory"

2. SEARCH FOR ALEX'S VIDEO
   → memory_search({
       query: 'trace-aismr-001 alex final compilation video',
       memoryTypes: ['episodic'],
       project: 'aismr',
       limit: 3
     })

   Found: Final video URL and metadata

3. LOAD MY CONTEXT
   → context_get_persona('quinn')
     "I am Quinn, Social Media Manager. I optimize and publish."

   → context_get_project('aismr')
     Platform: TikTok primary, brand voice: mysterious/calming

4. SEARCH FOR BEST PRACTICES
   → memory_search({
       query: 'AISMR TikTok successful captions hashtags',
       memoryTypes: ['semantic', 'episodic'],
       project: 'aismr',
       temporalBoost: true
     })

   Found: Top hashtags, caption patterns, optimal posting times

5. GENERATE CAPTION & HASHTAGS
   Based on search results:

   Caption: "12 candles that shouldn't exist 🕯️✨
   From void flames to liquid wax defying gravity...
   Which one mesmerized you the most?

   Part of the AISMR series exploring impossible objects"

   Hashtags: #AISMR #SurrealArt #OddlySatisfying #MindBending
             #Candles #ArtTok #Aesthetic #Surreal #Relaxing

6. DOWNLOAD VIDEO
   → Download final video from storage

7. UPLOAD TO TIKTOK
   → Authenticate with TikTok API
   → Upload video file
   → Set caption and hashtags
   → Set privacy: Public
   → Enable comments and duets
   → Publish

8. GET POST URL
   → TikTok returns: tiktok.com/@mylo_aismr/video/7234567890

9. STORE RESULT
   → memory_store({
       content: 'Published AISMR candles compilation to TikTok',
       memoryType: 'episodic',
       project: ['aismr'],
       persona: ['quinn'],
       tags: ['published', 'tiktok', 'candles', 'success'],
       metadata: {
         traceId: 'trace-aismr-001',
         platform: 'tiktok',
         postUrl: 'tiktok.com/@mylo_aismr/video/7234567890',
         publishedAt: '2025-11-06T20:08:45Z'
       }
     })

10. SIGNAL COMPLETION TO CASEY
   → workflow_complete({
       traceId: 'trace-aismr-001',
       status: 'success',
       outputs: {
         postUrl: 'tiktok.com/@mylo_aismr/video/7234567890',
         platform: 'tiktok',
         duration: 110,
         clipsUsed: 12
       }
     })

   [Quinn's work complete, signals Casey]
```

---

### Casey: Final Notification

**8:09 PM - Casey Receives Completion**

```typescript
// Casey receives completion signal
Workflow completed: {
  traceId: 'trace-aismr-001',
  status: 'success',
  outputs: {
    postUrl: 'tiktok.com/@mylo_aismr/video/7234567890',
    ...
  }
}

// Casey notifies user
await telegram.sendMessage({
  chatId: 6559268788,
  text: `🎉 Your AISMR candles video is live on TikTok!

Watch it here: tiktok.com/@mylo_aismr/video/7234567890

✨ 12 surreal candle variations
⏱️ 110 seconds of mesmerizing content
🚀 Published with optimized caption and hashtags

The team delivered:
💡 Iggy: 12 unique modifiers
✍️ Riley: 12 screenplays
🎬 Veo: 12 videos generated
✂️ Alex: Edited compilation
📱 Quinn: Published to TikTok

Want to create another?`
});
```

**User Sees:**

```
Casey: 🎉 Your AISMR candles video is live on TikTok!

       Watch it here: tiktok.com/@mylo_aismr/video/...

       ✨ 12 surreal candle variations
       ⏱️ 110 seconds of mesmerizing content
       🚀 Published with optimized caption and hashtags

       Want to create another?
```

---

## 🎬 Story 2: GenReact Happy Path

### User Request

**9:15 PM - Mylo's Phone**

```
Mylo: "Make a video about how different generations react to AI"
```

---

### Casey: Detects Different Project

```typescript
// Casey processes request
1. ASSESS INTENT
   "User wants generational reactions video"
   → Keywords: "different generations", "react to"
   → Project: GenReact (detected)

2. LOAD CONTEXT
   → context_get_project('genreact')

   Specs:
   - 6 generations: Silent, Boomer, Gen X, Millennial, Gen Z, Alpha
   - 8.0s per generation
   - Compilation: ~48s total
   - Style: Humorous but respectful

3. DISCOVER WORKFLOW
   Workflow: "GenReact Complete Production"
   Same steps, different specs

4. KICK OFF IGGY
   → handoff_to_agent({
       toAgent: 'iggy',
       task: 'generate_generational_scenarios',
       inputs: { situation: 'reacting to AI' },
       project: 'genreact',
       traceId: 'trace-genreact-002'
     })
```

---

### Iggy: Generates Scenarios

```typescript
// Iggy receives handoff for GenReact
1. LOAD CONTEXT
   → context_get_project('genreact')
     "6 generations, culturally accurate, humorous"

2. SEARCH FOR PATTERNS
   → memory_search({
       query: 'successful GenReact stereotypes humor',
       memoryTypes: ['semantic'],
       project: 'genreact'
     })

   Found: Avoid harmful stereotypes, use tech references

3. GENERATE 6 SCENARIOS

   1. Silent Generation (1928-1945):
      "What's AI? Is that like the radio?"
      Setting: Retirement home, newspaper
      Tone: Innocent confusion, sweet

   2. Baby Boomer (1946-1964):
      "I don't need AI, I have common sense!"
      Setting: Home office, reading glasses
      Tone: Skeptical but secretly curious

   3. Gen X (1965-1980):
      *sighs* "Another thing to learn... whatever"
      Setting: Kitchen, coffee mug
      Tone: Resigned acceptance, eye roll

   4. Millennial (1981-1996):
      "Wait, can AI run my 7 side hustles?"
      Setting: Home office, multiple tabs open
      Tone: Hustle culture humor

   5. Gen Z (1997-2012):
      "AI is so 2022, we're already over it"
      Setting: Bedroom, LED lights
      Tone: Been-there-done-that dismissiveness

   6. Gen Alpha (2013+):
      *already coding with AI* "You guys are just figuring this out?"
      Setting: Desk with iPad, already using AI
      Tone: Digital native wisdom

4. VALIDATE UNIQUENESS
   → Search for similar GenReact scenarios
   → All unique and respectful ✓

5. TRIGGER HITL
   → Present scenarios to user for approval
```

**User approves**, Iggy hands off to Riley...

---

### Riley: Writes 6 Scripts

```typescript
// Riley receives 6 scenarios
1. LOAD GENREACT SPECS
   → 8s per generation, culturally accurate, age-appropriate

2. WRITE 6 SCREENPLAYS

   Example: Gen Z screenplay
   {
     title: 'Gen Z Reacts to AI',
     generation: 'Gen Z',
     runtime: 8.0,
     scenes: [
       { time: 0.0, 'Gen Z in bedroom, LED lights, phone in hand' },
       { time: 1.0, 'Sees AI news notification, dismissive look' },
       { time: 3.0, 'Eye roll, "AI is so 2022"' },
       { time: 5.0, 'Continues scrolling, already moved on' },
       { time: 7.0, 'Barely glances up, "We're over it"' },
       { time: 8.0, 'Back to phone, FADE OUT' }
     ],
     ...
   }

   [Writes all 6]

3. HANDOFF TO VEO
   → 6 screenplays ready for production
```

---

### Veo: Generates 6 Videos

```typescript
// Veo generates 6 generation videos in parallel
→ Silent Generation: 8s video
→ Boomer: 8s video
→ Gen X: 8s video
→ Millennial: 8s video
→ Gen Z: 8s video
→ Alpha: 8s video

Total: 6 videos @ 8s each = 48s raw footage
```

---

### Alex: Edits GenReact Compilation

```typescript
// Alex receives 6 videos
1. LOAD GENREACT STYLE
   → Search for GenReact editing patterns
   → Found: Add generation labels, smooth transitions

2. EDIT COMPILATION

   Sequence:
   - Intro title (2s): "How Each Generation Reacts to AI"
   - Silent Generation clip (8s) with label overlay
   - Transition (0.5s)
   - Boomer clip (8s) with label
   - Transition (0.5s)
   - Gen X clip (8s) with label
   - Transition (0.5s)
   - Millennial clip (8s) with label
   - Transition (0.5s)
   - Gen Z clip (8s) with label
   - Transition (0.5s)
   - Alpha clip (8s) with label
   - Outro (2s): "Which generation are you? 👇"

   Total: ~54s

3. ADD GENERATION LABELS
   → "Silent Generation" overlay on first clip
   → "Boomer" overlay on second clip
   → etc.

4. EXPORT & TRIGGER HITL
   → User reviews and approves
```

---

### Quinn: Publishes to TikTok

```typescript
// Quinn optimizes for GenReact
1. GENERATE CAPTION
   "How each generation reacts to AI 😂

   Which one is most accurate? Drop your generation below! 👇

   Silent → Boomer → Gen X → Millennial → Gen Z → Alpha"

   Hashtags: #GenerationalHumor #AI #Relatable #GenZ #Millennial
             #Boomer #GenX #GenAlpha #Comedy #Viral

2. UPLOAD TO TIKTOK
   → Published successfully

3. SIGNAL COMPLETION
   → Casey notifies user
```

---

## ⚠️ Story 3: AISMR Error & Correction Path

### User Request

**10:00 PM**

```
Mylo: "Make an AISMR video about books"
```

---

### Iggy: Generates Modifiers

```typescript
// Iggy generates 12 modifiers for books
Modifiers generated:
1. Void Book - Pages absorb light
2. Liquid Book - Text flows like water
3. Crystal Book - Transparent pages
4. Shadow Book - Made of darkness
5. Smoke Book - Ethereal pages
6. Frozen Book - Ice pages
7. Electric Book - Lightning text
8. Magnetic Book - Pages attract/repel
9. Holographic Book - Digital projection
10. Obsidian Book - Volcanic glass pages
11. Ethereal Book - Ghost-like pages
12. Mirror Book - Reflective pages

// HITL: User approval
→ User approves ✓
```

---

### Riley: Writes Screenplays

```typescript
// Riley writes 12 screenplays
// Problem: Screenplay #4 (Shadow Book) has timing issue

Screenplay #4 validation:
{
  title: 'Shadow Book',
  runtime: 8.5, // ❌ TOO LONG (spec is 8.0s)
  whisperTiming: 3.0, // ✓
  hands: 2, // ✓
  validation: {
    runtimeCheck: {
      passed: false,
      value: 8.5,
      requirement: 8.0,
      deviation: 0.5
    }
  }
}

// Riley's error handling
1. DETECT VALIDATION FAILURE
   Screenplay #4 failed runtime check

2. ANALYZE ERROR
   → Too many scene elements (10 scenes)
   → Need to condense to fit 8.0s

3. INTELLIGENT RETRY
   → Regenerate screenplay #4 only
   → Remove 2 scenes, tighten timing
   → Re-validate

4. RETRY RESULT
   New Screenplay #4:
   {
     title: 'Shadow Book',
     runtime: 8.0, // ✓ FIXED
     scenes: [8 scenes instead of 10],
     validation: { runtimeCheck: { passed: true } }
   }

5. STORE ERROR & FIX
   → memory_store({
       content: 'Screenplay validation error: Shadow Book exceeded 8.0s runtime, regenerated successfully',
       memoryType: 'episodic',
       tags: ['error', 'corrected', 'validation-failure'],
       metadata: {
         error: 'runtime_exceeded',
         screenplay: 'Shadow Book',
         originalRuntime: 8.5,
         fixedRuntime: 8.0,
         retryCount: 1
       }
     })

6. CONTINUE WORKFLOW
   → All 12 screenplays now validated
   → Handoff to Veo
```

---

### Veo: Video Generation Failure

```typescript
// Veo generates 12 videos
// Problem: Video #7 (Electric Book) generation fails

Video #7 API Response:
{
  status: 'failed',
  error: 'Content policy violation: electric effects too intense',
  videoId: 'electric-book-fail'
}

// Veo's error handling
1. DETECT FAILURE
   Video #7 generation failed due to content policy

2. ANALYZE ERROR
   → Content policy issue with "lightning" effects
   → Other 11 videos succeeded

3. STORE ERROR
   → memory_store({
       content: 'Video generation failed for Electric Book due to content policy (lightning effects)',
       tags: ['video-generation-error', 'content-policy'],
       metadata: { failedVideo: 'Electric Book', reason: 'lightning_effects' }
     })

4. HANDOFF BACK TO RILEY (Intelligent Routing)
   → handoff_to_agent({
       toAgent: 'riley',
       task: 'revise_screenplay',
       inputs: {
         screenplayIndex: 7,
         modifier: 'Electric Book',
         issue: 'Lightning effects too intense for video API',
         suggestion: 'Reduce intensity, use subtle glow instead'
       },
       traceId: 'trace-aismr-001'
     })
```

---

### Riley: Revises Screenplay

```typescript
// Riley receives revision request
1. LOAD ORIGINAL SCREENPLAY
   → Screenplay #7: Electric Book with lightning

2. REVISE BASED ON FEEDBACK
   Original: "Lightning coursing through pages"
   Revised: "Soft electric glow between pages, gentle crackling"

   → Reduced intensity
   → Maintained concept
   → Should pass content policy

3. STORE REVISION
   → memory_store({
       content: 'Revised Electric Book screenplay: reduced lightning intensity to soft glow',
       tags: ['revision', 'content-policy-fix']
     })

4. HANDOFF BACK TO VEO
   → handoff_to_agent({
       toAgent: 'veo',
       task: 'regenerate_single_video',
       inputs: {
         screenplayIndex: 7,
         revisedScreenplay: {...}
       },
       traceId: 'trace-aismr-001'
     })
```

---

### Veo: Regenerates Video #7

```typescript
// Veo regenerates only video #7
1. REGENERATE WITH REVISED SCREENPLAY
   → Submit revised Electric Book screenplay
   → Wait for generation
   → Success! ✓

2. NOW HAVE ALL 12 VIDEOS
   → Videos 1-6, 8-12: Original (succeeded)
   → Video 7: Regenerated (succeeded on retry)

3. STORE SUCCESS
   → memory_store({
       content: 'Regenerated Electric Book video successfully after screenplay revision',
       tags: ['retry-success', 'electric-book']
     })

4. CONTINUE TO ALEX
   → handoff_to_agent({
       toAgent: 'alex',
       task: 'edit_compilation',
       inputs: { videoUrls: [...all 12...] }
     })
```

---

### Alex: User Requests Changes

```typescript
// Alex presents final compilation for review
HITL: User reviews video

User feedback:
"This is great but can you remove the Holographic Book (#9)?
 It doesn't fit the aesthetic. Maybe replace it with something warmer?"

// Alex's intelligent response
1. PARSE FEEDBACK
   → User wants to remove video #9
   → Wants "warmer" replacement
   → Specific request, not full restart needed

2. DETERMINE RETRY SCOPE
   Options:
   a) Redo all 12 videos ❌ (wasteful)
   b) Remove #9, edit 11-video compilation ❌ (doesn't address "replace")
   c) Go back to Iggy for warm replacement ✓ (efficient)

3. HANDOFF TO IGGY (Targeted Revision)
   → handoff_to_agent({
       toAgent: 'iggy',
       task: 'replace_modifier',
       inputs: {
         object: 'books',
         removeModifier: 'Holographic Book',
         replaceWith: 'Something warm',
         keepOthers: [...11 modifiers...]
       },
       traceId: 'trace-aismr-001',
       userFeedback: 'User wants warmer aesthetic'
     })
```

---

### Iggy: Generates Replacement

```typescript
// Iggy receives targeted replacement request
1. UNDERSTAND REQUEST
   → Remove: Holographic Book (too digital/cold)
   → Need: Warm replacement
   → Keep: Other 11 modifiers

2. SEARCH FOR WARM CONCEPTS
   → memory_search({
       query: 'warm cozy AISMR concepts fire amber glow',
       project: 'aismr'
     })

   Found: Fire, amber, molten work well

3. GENERATE WARM REPLACEMENT
   New modifier: "Ember Book - Pages glow with warm amber light, gentle heat"

   → Checks uniqueness against archive ✓
   → Fits "warm" request ✓
   → Not duplicate of existing 11 ✓

4. TRIGGER HITL (via n8n Telegram)
   → Telegram.sendAndWait({
       chatId: session.userId,
       message: 'How about "Ember Book" instead?
                Pages glowing with warm amber light, gentle heat radiating.

                This replaces Holographic Book. Approve?',
       responseType: 'Approval',
       approveLabel: 'Perfect!',
       declineLabel: 'Try Again'
     })

   User: [Clicks "Perfect!"]

5. HANDOFF TO RILEY (Single Screenplay)
   → handoff_to_agent({
       toAgent: 'riley',
       task: 'write_single_screenplay',
       inputs: {
         modifier: 'Ember Book',
         description: 'Pages glow with warm amber light, gentle heat'
       }
     })
```

---

### Pipeline Continues

```typescript
// Riley writes Ember Book screenplay
→ Validates ✓

// Handoff to Veo
→ Generates Ember Book video ✓

// Handoff to Alex
→ Replaces video #9 with Ember Book
→ Re-edits compilation
→ Presents to user
→ User approves ✓

// Handoff to Quinn
→ Publishes final compilation with Ember Book

// Completion
→ Casey notifies user: Done!
```

---

## ⚠️ Story 4: GenReact Error & Correction Path

### User Request

**11:00 PM**

```
Mylo: "Make a video about generations reacting to TikTok trends"
```

---

### Iggy: Generates Scenarios

```typescript
// Iggy generates 6 generational scenarios
Scenarios presented to user:

1. Silent Generation: "What's a TikTok?"
2. Boomer: "Why are they dancing?"
3. Gen X: "I'm too old for this"
4. Millennial: "Should I start a TikTok?"
5. Gen Z: "Let me show you how it's done"
6. Alpha: *already viral* "10M views, easy"

// HITL: User provides feedback
User: "I like most of these but Millennial feels too generic.
       Can we make it more about trying to learn the dance
       but failing hilariously?"
```

---

### Iggy: Intelligent Revision

```typescript
// Iggy receives feedback
1. PARSE FEEDBACK
   → Issue: Millennial scenario (#4) too generic
   → Specific request: Show them trying and failing at dance
   → Keep: Other 5 scenarios

2. REGENERATE ONLY MILLENNIAL
   Original: "Should I start a TikTok?"
   Revised: "Attempts dance, trips over coffee table, 'I'm too old for this'"

   → More physical comedy
   → Self-aware humor
   → Maintains age-appropriate tone

3. PRESENT REVISION (via n8n Telegram)
   → Telegram.sendAndWait({
       chatId: session.userId,
       message: 'How about this for Millennial:

                "Attempts the dance, trips over coffee table
                mid-move, laughs at self: I guess I am too old for this"

                Better?',
       responseType: 'Approval',
       approveLabel: 'Perfect!',
       declineLabel: 'Try Again'
     })

   User: [Clicks "Perfect!"]

4. HANDOFF TO RILEY
   → All 6 scenarios now approved
   → Includes revised Millennial
```

---

### Riley: Writes Scripts

```typescript
// Riley writes 6 screenplays
All validated ✓

// Handoff to Veo
```

---

### Veo: Generates 6 Videos

```typescript
// Veo generates videos
Problem: Videos #2 and #5 take too long

Video #2 (Boomer): 12s runtime ❌ (should be 8s)
Video #5 (Gen Z): 11s runtime ❌ (should be 8s)
Videos #1, #3, #4, #6: 8s ✓

// Veo's error handling
1. DETECT TIMING ISSUES
   2 videos exceed 8s spec

2. HANDOFF TO RILEY (Revise Scripts)
   → handoff_to_agent({
       toAgent: 'riley',
       task: 'tighten_screenplays',
       inputs: {
         screenplayIndexes: [2, 5],
         issue: 'Generated videos too long',
         current: [12s, 11s],
         target: 8s
       }
     })
```

---

### Riley: Tightens Scripts

```typescript
// Riley receives revision request
1. ANALYZE ORIGINAL SCREENPLAYS
   #2 (Boomer): Too many reaction shots
   #5 (Gen Z): Too much setup

2. REVISE
   #2: Remove 2 reaction shots, tighten timing
   #5: Jump straight to action, remove intro

3. RE-VALIDATE
   Both now structured for 8s ✓

4. HANDOFF TO VEO (Regenerate)
   → handoff_to_agent({
       toAgent: 'veo',
       task: 'regenerate_videos',
       inputs: {
         videoIndexes: [2, 5],
         revisedScreenplays: [...]
       }
     })
```

---

### Veo: Regenerates Videos

```typescript
// Veo regenerates #2 and #5
Video #2: 8.0s ✓
Video #5: 8.0s ✓

// Now have all 6 videos at correct duration
→ Handoff to Alex
```

---

### Alex: Compilation & User Feedback

```typescript
// Alex creates compilation
→ Presents to user for review

User: "Love it! But can you add a final screen that says
       'Tag someone from each generation' at the end?"

// Alex handles feedback
1. DETERMINE SCOPE
   → Minor addition, no regeneration needed
   → Can handle in edit

2. ADD END CARD
   → Create text overlay: "Tag someone from each generation 👇"
   → Add 3s end card
   → New total: ~57s

3. RE-PRESENT
   → User approves ✓

4. HANDOFF TO QUINN
```

---

### Quinn: Publishes with Optimization

```typescript
// Quinn receives final video
1. GENERATE CAPTION
   "How each generation reacts to TikTok trends 😂

   Tag someone from each generation below! 👇

   Which reaction was most accurate?"

   Hashtags optimized for engagement

2. PUBLISH
   → TikTok successfully

3. SIGNAL COMPLETION
   → Casey notifies user
```

---

## 📊 What Makes This Work

### 1. Autonomous Agents

Each agent (except Casey) is a black box:

- **Loads own context** (persona + project specs)
- **Searches memory** for relevant information
- **Makes decisions** within domain expertise
- **Handles errors** intelligently
- **Routes work** to appropriate next agent

### 2. Project Context Drives Behavior

```typescript
// Same agents, different behavior based on project

// AISMR Project
{
  format: 'single_object_surreal_modifiers',
  videoCount: 12,
  compilationLength: ~96s,
  hitlPoints: ['after_modifiers', 'before_upload']
}

// GenReact Project
{
  format: 'generational_reactions',
  generations: 6,
  compilationLength: ~48s,
  hitlPoints: ['after_scenarios', 'before_upload']
}
```

The **same Iggy** generates:

- 12 surreal modifiers for AISMR
- 6 generational scenarios for GenReact

Because project context tells Iggy what to do!

### 3. Intelligent Error Handling

Agents don't just fail—they:

- **Analyze the error** (content policy, timing, validation)
- **Determine retry scope** (redo one? redo all? go back how far?)
- **Route intelligently** (back to writer? new idea? user clarification?)
- **Store learnings** (avoid same errors in future)

### 4. Memory as Coordination

Agents coordinate via episodic memory:

```typescript
// Agent stores work
memory_store({
  content: 'Generated 12 candle modifiers',
  traceId: 'trace-aismr-001',
  outputs: {...}
})

// Next agent loads context
memory_search({
  query: 'trace-aismr-001 candle modifiers',
  memoryTypes: ['episodic']
})
```

No need for Casey to pass context—it's in memory!

### 5. User-Centric HITL via n8n Telegram

HITL happens at natural checkpoints using **n8n's native Telegram "Send and Wait"** node:

- **After ideation** (approve concepts) - Iggy triggers Telegram approval
- **Before final upload** (review finished product) - Alex triggers Telegram approval
- **On-demand** (any agent can request feedback) - Any agent workflow can include Telegram wait node

**How it works:**

```typescript
// Each agent's n8n workflow can include Telegram node
Telegram.sendAndWait({
  chatId: session.userId,
  message: 'Approve these concepts?',
  responseType: 'Approval',
  approveLabel: 'Approve ✓',
  declineLabel: 'Request Changes',
});

// n8n pauses workflow, waits for button click
// On approval: continues to next step
// On decline: agent can handle feedback and retry
```

User never sees the complexity—just clean approval buttons in Telegram.

---

## 🎯 The Key Insight

**Same pipeline. Different projects. Autonomous agents.**

```
User Request
    ↓
Casey (discovers workflow)
    ↓
Iggy (generates concepts based on PROJECT)
    ↓
HITL (user approves)
    ↓
Riley (writes scripts based on PROJECT)
    ↓
Veo (generates videos)
    ↓
Alex (edits based on PROJECT style)
    ↓
HITL (user reviews)
    ↓
Quinn (publishes with PROJECT branding)
    ↓
Casey (notifies user)
```

**Project context determines:**

- What Iggy generates (modifiers vs scenarios)
- How many videos (12 vs 6)
- Compilation style (titles vs generation labels)
- Caption tone (mysterious vs humorous)
- Platform optimization

**The pipeline stays the same. The specialists adapt.**

---

## 🚀 The Technology Stack

```
User (Telegram)
     │
     ▼
┌────────────────────────────────────────────────┐
│  n8n Instance                                  │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │  Casey's Workflow                         │ │
│  │  • AI Agent (Casey persona)               │ │
│  │  • MCP Tools: workflow discover, trace    │ │
│  │  • Kicks off first agent workflow         │ │
│  │  • Waits for workflow_complete signal     │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │  Iggy's Workflow (Creative Director)      │ │
│  │  • AI Agent (Iggy persona)                │ │
│  │  • MCP Tools: memory_search, memory_store │ │
│  │  • MCP Tools: context_get_*, handoff      │ │
│  │  • Telegram "Send and Wait" node          │ │
│  │  • Handoff to Riley's workflow            │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │  Riley's Workflow (Head Writer)           │ │
│  │  • AI Agent (Riley persona)               │ │
│  │  • MCP Tools: memory_search, memory_store │ │
│  │  • MCP Tools: screenplay validation       │ │
│  │  • Handoff to Veo's workflow              │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │  Veo's Workflow (Production)              │ │
│  │  • HTTP Requests to video API             │ │
│  │  • Polling loops                          │ │
│  │  • Batch processing                       │ │
│  │  • MCP Tools: memory_search, memory_store │ │
│  │  • Handoff to Alex's workflow             │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │  Alex's Workflow (Editor)                 │ │
│  │  • AI Agent (Alex persona)                │ │
│  │  • MCP Tools: memory_search, memory_store │ │
│  │  • Video editing nodes/tools              │ │
│  │  • Telegram "Send and Wait" node          │ │
│  │  • Handoff to Quinn's workflow            │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │  Quinn's Workflow (Publisher)             │ │
│  │  • AI Agent (Quinn persona)               │ │
│  │  • MCP Tools: memory_search, memory_store │ │
│  │  • TikTok API nodes                       │ │
│  │  • workflow_complete signal to Casey      │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
└────────────────┬───────────────────────────────┘
                 │
                 ▼ HTTP (MCP Protocol)
┌────────────────────────────────────────────────┐
│  MCP Server (Tool Interface)                   │
│  • memory_search, memory_store                 │
│  • context_get_persona, context_get_project    │
│  • prompt_discover                             │
│  • trace_create, handoff_to_agent              │
│  • workflow_complete                           │
└────────────────┬───────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────┐
│  Postgres + pgvector                           │
│  • memories (episodic/semantic/procedural)     │
│  • execution_traces                            │
│  • personas (Iggy, Riley, Alex, Quinn)         │
│  • projects (AISMR, GenReact)                  │
└────────────────────────────────────────────────┘
```

**One n8n instance. Six separate workflows. Each agent autonomous.**

---

## 🎯 One Workflow Per Agent

### Why Each Agent Needs Their Own Workflow

Each agent is a **separate n8n workflow** with its own AI Agent node:

```typescript
// Iggy's Workflow
{
  name: "Iggy - Creative Director",
  trigger: "Webhook" (called by Casey or previous agent),
  nodes: [
    {
      type: "AI Agent",
      persona: "iggy",
      systemPrompt: "[Iggy's specialized instructions]",
      mcpTools: [
        "memory_search",
        "memory_store",
        "context_get_persona",
        "context_get_project",
        "handoff_to_agent"
      ]
    },
    {
      type: "Telegram Send and Wait",
      // For user approval of generated concepts
    },
    {
      type: "Execute Workflow",
      // Calls Riley's workflow when done
    }
  ]
}
```

### Benefits of Separate Workflows

1. **Tool Access Control**: Each agent only has the MCP tools they need
   - Iggy: Needs memory search for uniqueness, no screenplay tools
   - Riley: Needs screenplay validation, no TikTok tools
   - Quinn: Needs social media APIs, no video generation tools

2. **Independent Execution**: Each workflow can be tested/debugged separately
   - Run Iggy's workflow in isolation
   - Mock previous agent's memory output
   - Test HITL interactions independently

3. **Parallel Development**: Different workflows can be built simultaneously
   - One dev works on Iggy
   - Another works on Riley
   - No merge conflicts

4. **Scalability**: Easy to add new agents
   - Create new workflow
   - Define which tools it needs
   - Connect via handoff_to_agent
   - Done

5. **Security**: Principle of least privilege
   - Riley can't access TikTok APIs
   - Quinn can't modify screenplays in memory
   - Each agent scoped to their domain

### Example: Iggy's Workflow Structure

```yaml
Workflow: "Iggy - Creative Director"

Trigger:
  - Webhook (receives natural language instructions)

Nodes:
  1. Parse Instructions
     - Extract traceId, project, instructions from webhook

  2. AI Agent (Iggy)
     - Persona: "iggy"
     - System Prompt: "You are Iggy, Creative Director..."
     - Available Tools:
       * memory_search (to check uniqueness)
       * memory_store (to save generated ideas)
       * context_get_persona (to load Iggy persona)
       * context_get_project (to load project specs)
       * handoff_to_agent (to pass work to Riley)
     - Temperature: 0.7

  3. Telegram Send and Wait
     - Send generated concepts to user
     - Wait for approval button click
     - Branch on response:
       * Approved → Continue
       * Changes Requested → Loop back to AI Agent

  4. Execute Workflow (Call Riley)
     - Workflow: "Riley - Head Writer"
     - Data: Natural language instructions + traceId
```

### Example: Riley's Workflow Structure

```yaml
Workflow: "Riley - Head Writer"

Trigger:
  - Webhook (called by Iggy)

Nodes:
  1. Parse Instructions
     - Extract traceId, project, instructions

  2. AI Agent (Riley)
     - Persona: "riley"
     - System Prompt: "You are Riley, Head Writer..."
     - Available Tools:
       * memory_search (to find Iggy's work)
       * memory_store (to save screenplays)
       * context_get_persona
       * context_get_project
       * handoff_to_agent
     - Temperature: 0.5 (more deterministic)

  3. Validation Loop
     - Check each screenplay against specs
     - Retry if validation fails

  4. Execute Workflow (Call Veo)
     - Workflow: "Veo - Production"
     - Data: Natural language instructions + traceId
```

### How Handoffs Work Between Workflows

```typescript
// Inside Iggy's AI Agent
// After work is complete:

await handoff_to_agent({
  toAgent: 'riley',
  instructions: `Riley, write 12 screenplays for the candle modifiers 
                 I just generated. User approved all 12. Find the details 
                 in my last memory (trace-aismr-001, iggy).`,
  traceId: 'trace-aismr-001',
  project: 'aismr',
});

// This MCP tool returns: { workflowWebhookUrl: 'https://n8n.../riley' }

// Iggy's workflow then has an "Execute Workflow" node that:
// 1. Calls Riley's webhook with the instructions
// 2. Riley's workflow starts
// 3. Iggy's workflow completes
```

### Workflow Communication Pattern

```
Casey's Workflow
  → handoff_to_agent('iggy', instructions)
  → Execute Workflow: "Iggy - Creative Director"
      ↓
Iggy's Workflow
  → receives instructions
  → does work
  → stores in memory
  → handoff_to_agent('riley', instructions)
  → Execute Workflow: "Riley - Head Writer"
      ↓
Riley's Workflow
  → receives instructions
  → memory_search (finds Iggy's work)
  → does work
  → stores in memory
  → handoff_to_agent('veo', instructions)
  → Execute Workflow: "Veo - Production"
      ↓
... and so on
```

### Tool Requirements Per Agent

| Agent     | Memory Tools  | Context Tools            | Workflow Tools                  | Platform Tools | HITL           |
| --------- | ------------- | ------------------------ | ------------------------------- | -------------- | -------------- |
| **Casey** | search        | get_persona, get_project | discover, trace_create, handoff | -              | No             |
| **Iggy**  | search, store | get_persona, get_project | handoff                         | -              | Yes (Telegram) |
| **Riley** | search, store | get_persona, get_project | handoff                         | -              | No             |
| **Veo**   | search, store | -                        | handoff                         | Video API      | No             |
| **Alex**  | search, store | get_persona, get_project | handoff                         | Video editing  | Yes (Telegram) |
| **Quinn** | search, store | get_persona, get_project | workflow_complete               | TikTok API     | No             |

**Key Insight:** Each agent's workflow only includes the tools they actually need. This is true modularity.

---

## 💡 Why This Is The North Star

### For Users

- **Natural requests**: "Make a video about X"
- **Simple approvals**: Just 2 HITL checkpoints
- **Fast results**: 5-8 minutes to published video
- **Quality guaranteed**: Validated at every step

### For Developers

- **Reusable pipeline**: Add new projects = add JSON
- **Autonomous agents**: No coordination code needed
- **Clear separation**: Each agent has one job
- **Easy debugging**: Memory trail shows everything

### For The Business

- **Scalable**: Same team handles multiple content types
- **Consistent**: Every video follows proven workflow
- **Learnable**: Agents improve from memory
- **Extensible**: Add new projects without changing code

---

## 🌈 The Future

Once this works:

1. **More Projects**
   - ProductReviews: 5 camera angles, 30s each
   - MicroDocumentaries: 10 chapters, 15s each
   - TutorialSeries: 8 steps, 12s each

   Same agents. New project configs.

2. **More Platforms**
   - YouTube Shorts
   - Instagram Reels
   - LinkedIn videos

   Quinn adapts based on platform specs.

3. **Learning & Evolution**
   - Track which modifiers go viral
   - Optimize caption patterns
   - Learn user preferences

   Memory drives improvement.

4. **Agent Specialization**
   - Multiple Iggys (comedy, drama, educational)
   - Multiple Rileys (short-form, long-form, documentary)
   - A/B test different agents

   Best performers win.

---

## 📝 Success Metrics

| Metric                         | Target  | How Measured                  |
| ------------------------------ | ------- | ----------------------------- |
| User request → published       | <10 min | Trace timestamps              |
| HITL approval rate             | >90%    | User approvals / total        |
| Video quality (validated)      | 100%    | Screenplay validation pass    |
| Agent errors requiring restart | <5%     | Error count / total workflows |
| Memory uniqueness              | 100%    | Zero collisions in archive    |
| User satisfaction              | >4.5/5  | Post-publication feedback     |

---

## 🎓 What We Learned

### From The Reviews

**From GPT-5 Codex Review:**

- Workflow tools need to be exposed via MCP ✓
- Agent system prompt needs RAG guidance ✓
- Prompt discovery should use MCP native API ✓

**From Sonnet 4.5 Review:**

- Recursive pattern simpler than handoffs ✓
- Memory graph = automatic audit trail ✓
- Single coordinator + specialists = elegant ✓

**From The Proposals:**

- Handoff model too complex (5 tables, leases, custody)
- Recursive model perfect (memory + traces)
- Agents should be autonomous black boxes ✓

### Our Design Decisions

1. **Casey as coordinator only** - She doesn't orchestrate mid-workflow
2. **Direct agent handoffs** - No returning to Casey between steps
3. **Project-driven behavior** - Context determines what agents do
4. **Memory-based coordination** - Agents find context in memory
5. **Intelligent retry** - Agents determine retry scope
6. **Natural HITL points** - User involvement at decision moments only

---

_"From a text message to a published video, orchestrated by autonomous AI agents working like a real production studio."_

**This is the North Star. This is V2.** ⭐
