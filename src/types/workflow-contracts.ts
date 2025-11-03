/**
 * Workflow Data Contracts
 *
 * These types define the expected inputs and outputs for n8n workflows
 * to ensure consistency and type safety across the AISMR pipeline.
 */

// ============================================================================
// Generate Ideas Workflow
// ============================================================================

export interface GenerateIdeasInput {
  runId: string;
  userInput: string;
  sessionId?: string;
}

export interface IdeaCandidate {
  idea: string;
  vibe: string;
  ideaId: string;
  description?: string;
}

export interface GenerateIdeasOutput {
  ideas: IdeaCandidate[];
  selectedIdea: IdeaCandidate;
  userIdea: string;
  totalIdeas: number;
}

// ============================================================================
// Screen Writer Workflow
// ============================================================================

export interface ScreenWriterInput {
  runId: string;
  userInput: string;
  ideaId: string;
  selectedIdea: {
    idea: string;
    vibe: string;
    description?: string;
  };
}

export interface ScreenplayScene {
  sceneNumber: number;
  duration: number;
  dialogue: string;
  actions: string[];
  soundEffects: string[];
  cameraAngle: string;
}

export interface Screenplay {
  title: string;
  scenes: ScreenplayScene[];
  totalDuration: number;
  triggerWords: string[];
}

export interface ScreenWriterOutput {
  screenplay: Screenplay;
  videoId: string;
  status: 'completed';
}

// ============================================================================
// AISMR Workflow Run Context
// ============================================================================

export interface WorkflowRunContext {
  runId: string;
  chatId: string;
  turnId: string;
  userInput: string;
  sessionId?: string;
}

export interface WorkflowRunStatus {
  status:
    | 'pending'
    | 'running'
    | 'screenplay_generation'
    | 'video_generation'
    | 'editing'
    | 'uploading'
    | 'publishing'
    | 'completed'
    | 'failed'
    | 'timeout'
    | 'rejected';
  error?: string;
  completedAt?: string;
  failedAt?: string;
  timedOutAt?: string;
  rejectedAt?: string;
}

export interface WorkflowRunOutput {
  videoId: string;
  tiktokUrl: string;
  driveUrl: string;
}
