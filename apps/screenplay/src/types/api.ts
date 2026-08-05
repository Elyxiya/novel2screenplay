/** Pipeline status phase enum */
export type PipelinePhase =
  | 'pending'
  | 'analyzing'
  | 'segmenting'
  | 'converting'
  | 'merging'
  | 'completed'
  | 'failed';

/** Scene-level status for resume support */
export interface SceneStatus {
  sceneIndex: number;
  status: 'pending' | 'converting' | 'completed' | 'failed';
}

/** Pipeline job state synced between backend and frontend via polling */
export interface PipelineJob {
  id: string;
  status: PipelinePhase;
  currentPhase: 0 | 1 | 2 | 3 | 4;
  progress: number;
  subProgress: {
    totalScenes: number;
    completedScenes: number;
  } | null;
  scenesStatus: SceneStatus[];
  logs: Array<{
    timestamp: number;
    level: 'info' | 'warn' | 'error';
    message: string;
  }>;
  error: string | null;
  resultId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Scene definition from Phase 2 output */
export interface SceneDef {
  sceneIndex: number;
  chapterIndex: number;
  startParagraph: number;
  endParagraph: number;
  originalStartOffset: number;
  originalEndOffset: number;
  draftSlugline: string;
  keyCharacterNames: string[];
  summary: string;
}

/** Cost estimate response */
export interface CostEstimate {
  estimatedTokens: number;
  estimatedCostCNY: number;
  warning: string;
}

/** Upload response */
export interface UploadResponse {
  projectId: string;
  title: string;
  chapters: Array<{
    index: number;
    title: string;
    paragraphCount: number;
    text: string;
  }>;
}

/** Available model info */
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
}
