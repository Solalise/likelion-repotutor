export type PracticeKind = "idor" | "sqli" | "xss" | "authz";

type PracticeRecord = {
  status?: number;
  path?: string;
  data?: Record<string, unknown>;
};

type PracticeEvent = {
  type: string;
  user?: { id: string; role: string } | null;
  policy?: string;
  record?: PracticeRecord;
  text?: string;
  executed?: boolean;
  executionDetected?: boolean;
  exposure?: { victimId: string; secret: string };
};

export declare const missions: Record<PracticeKind, [string, string, string?][]>;
export declare const hints: Record<PracticeKind, string[]>;
export declare function createPracticeState(kind: string): {
  snapshot(): { step: number; total: number; completed: boolean };
  hint(): string | undefined;
  observe(event: PracticeEvent): { step: number; total: number; completed: boolean };
};
