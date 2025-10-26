# Prompt Reorganization Summary

## Changes Made

Successfully reorganized all prompts to follow proper separation of concerns: **persona-level** knowledge is generic and reusable, **project-level** describes the framework, and **persona-project** contains only the specific workflow contract.

---

## ✅ Completed Changes

### 1. **persona-ideagenerator.md** (GENERIC)

**Before:** Contained ASMR-specific terminology, filmability criteria, material examples  
**After:** Pure concept generation principles applicable to ANY project

- Changed "filmable concepts" → "actionable concepts"
- Removed ASMR examples (materials, textures, surreal mechanics)
- Generalized quality criteria: memorability, distinctiveness, execution feasibility
- Removed specific database references ("Supabase ASMR ideas")
- **Now works for:** Product naming, marketing campaigns, game concepts, any creative work

### 2. **persona-screenwriter.md** (MODEL-AGNOSTIC)

**Before:** "Sora 2 video generation" specific  
**After:** Generic "AI video generation models"

- Changed "Sora 2" → "AI video generation models"
- Changed "realistic, natural-looking" → "clear, vivid, and filmable"
- Added camera options: static, surreal tones
- Added particles to environmental effects
- **Now works for:** Sora, Runway, Pika, any future AI video model

### 3. **persona-chat.md** (ENHANCED)

**Before:** Good foundation, missing workflow summary capability  
**After:** Added explicit workflow result summarization

- Added bullet point: "Workflow results: when tasks complete, summarize outcomes clearly"
- Example added: "Generated idea: 'Crystal Butterfly', mood: serene"
- **Now handles:** Task completion summaries, error reporting, execution logs

### 4. **ideagenerator-aismr.md** (WORKFLOW ONLY)

**Before:** 27 lines with repeated persona-level content  
**After:** 57 lines focused purely on the AISMR workflow contract

**Removed:**

- All general concept generation education (assumes persona knowledge)
- Quality scoring frameworks (persona handles that)
- Evaluation criteria details (persona handles that)

**Kept:**

- Input contract: `month`, `userInput`
- Process: Parse → Query DB → Generate → Assign mood
- Output contract: `{"idea": "Descriptor Object", "mood": "lowercase"}`
- Hard constraints: EXACTLY TWO WORDS, uniqueness verification
- Example with full input/output

### 5. **screenwriter-aismr.md** (WORKFLOW ONLY)

**Before:** 97 lines with general screenwriting education  
**After:** 57 lines focused purely on the AISMR workflow contract

**Removed:**

- General video prompt engineering principles (assumes persona knowledge)
- Cinematography education (persona handles that)
- "Overview" teaching sections

**Kept:**

- Input contract: `month`, `idea`, `mood`
- Process: Interpret descriptor → Apply AISMR specs → Build 10 sections
- Output contract: Complete Sora 2 prompt with all 10 sections
- AISMR-specific requirements: timing, whisper, fade, color palette
- Template structure (10 sections listed)
- Example with full input/output

---

## Key Benefits

### 1. **Reusability**

- Idea Generator can now work on non-ASMR projects (product names, campaigns, etc.)
- Screen Writer can work with any AI video model (not just Sora 2)
- Chatbot can summarize any workflow results

### 2. **Maintainability**

- AISMR specifications live in ONE place: `project-aismr.md`
- No duplication across multiple files
- Changes to AISMR framework only require editing one file

### 3. **Clarity**

- Each prompt has a single, clear responsibility
- Persona prompts teach transferable skills
- Project prompts describe the creative framework
- Persona-project prompts are pure workflow contracts

### 4. **Efficiency**

- Persona-project prompts dramatically simplified (27→57 for idea generator, 97→57 for screenwriter)
- Less token usage when prompts are concatenated
- Easier to understand and debug

### 5. **Scalability**

- Easy to add new projects without bloating persona prompts
- Easy to add new personas without project-specific baggage
- Clear template for future prompt architecture

---

## Prompt Hierarchy (How They Combine)

### For Idea Generator on AISMR:

```
1. persona-ideagenerator.md    → General concept generation skills
2. project-aismr.md             → AISMR framework (two-words, surreal, etc.)
3. ideagenerator-aismr.md       → Workflow: month+userInput → query DB → JSON output
```

### For Screen Writer on AISMR:

```
1. persona-screenwriter.md      → General AI video prompt engineering
2. project-aismr.md             → AISMR framework
3. screenwriter-aismr.md        → Workflow: month+idea+mood → 10-section Sora prompt
```

### For Chatbot on AISMR:

```
1. persona-chat.md              → Conversational partner + workflow summaries
2. project-aismr.md             → AISMR context (optional, for user questions)
```

---

## Files Modified

1. `/prompts/persona-ideagenerator.md` - Removed ASMR-specific content, generalized
2. `/prompts/persona-screenwriter.md` - Changed Sora 2 → AI video models
3. `/prompts/persona-chat.md` - Added workflow result summarization
4. `/prompts/ideagenerator-aismr.md` - Stripped to workflow contract only
5. `/prompts/screenwriter-aismr.md` - Stripped to workflow contract only
6. `/sql/prompts-inserts.sql` - Regenerated with new content
7. `/sql/dev-reset.sql` - Updated with new prompts (595 lines, +8 from original)

---

## Testing Recommendations

1. **Test Idea Generator on AISMR:**

   - Input: `{"month": "February", "userInput": "Create an ASMR video about butterflies, featuring crystal-like, refractive butterflies that shimmer"}`
   - Expected: `{"idea": "Crystal Butterfly", "mood": "serene"}`

2. **Test Screen Writer on AISMR:**

   - Input: `{"month": "February", "idea": "Crystal Butterfly", "mood": "serene"}`
   - Expected: Complete 10-section Sora 2 prompt with whisper at 2.0s, fade at 3.5-4.0s, color palette

3. **Test Chatbot workflow summary:**
   - After idea generation completes, chatbot should summarize: "Generated idea: 'Crystal Butterfly', mood: serene"
   - If workflow fails, chatbot should report: "Video generation failed: timeout error"

---

## Next Steps

1. Run `npm run dev-reset:sql` to apply changes to database
2. Test end-to-end AISMR workflow with real inputs
3. Monitor output quality to ensure separation of concerns didn't impact results
4. Consider adding more projects to test persona reusability
