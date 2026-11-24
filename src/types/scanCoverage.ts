export type ScanStatus = "completed" | "partial" | "failed" | "unsupported";
export type FileExclusion = "unsupported-language" | "excluded-directory" | "generated-file" | "empty-file" | "file-size-limit" | "file-count-limit" | "total-byte-limit";
export type CollectionFile = { path: string; bytes: number; status: "included" | "excluded"; reason?: FileExclusion };
export type ScanDiagnostic = { filePath: string; line: number; code: string; message: string; kind: "parse" | "unresolved" | "unsupported" | "limit" };
export type ScanPoint = { filePath: string; line: number; code: string; description: string };
export type ScanCoverage = {
  status: ScanStatus;
  inputs: ScanPoint[];
  sinks: ScanPoint[];
  connectedSinks: number;
  suspectedCandidates: number;
  diagnostics: ScanDiagnostic[];
};
export const scanStatusLabels: Record<ScanStatus, string> = { completed: "분석 완료", partial: "일부 완료", failed: "분석 실패", unsupported: "미지원" };
