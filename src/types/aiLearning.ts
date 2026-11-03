export interface AiLearningEvidence {
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface AiLearningKeyFunction {
  name: string;
  role: string;
  evidence: AiLearningEvidence[];
}

export interface AiLearningConcept {
  name: string;
  explanation: string;
}

export interface AiLearningExplanation {
  title: string;
  role: string;
  executionSteps: string[];
  keyFunctions: AiLearningKeyFunction[];
  concepts: AiLearningConcept[];
  beginnerExplanation: string;
  limitations: string[];
}

export interface AiLearningResponse {
  explanation: AiLearningExplanation;
  cached: boolean;
  model: string;
  createdAt: string;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}
