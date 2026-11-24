export type PackageManifest = { path: string; dependencies: string[]; error?: string };
export type TechnologyStack = { frameworks: string[]; databases: string[]; persistence: string[]; evidence: Array<{ package: string; source: string; kind: "dependency" | "import" }>; notes: string[] };
