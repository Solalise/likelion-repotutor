import type { SourceInput } from "@/types/analysis";

/** Synthetic source fixtures, not production data or claims about login behavior. */
export const nextLoginSources: SourceInput[] = [
  { path: "app/login/page.tsx", content: [
    'import { submit } from "../../lib/submit";',
    "export default function LoginPage() {",
    "  const onSubmit = () => submit();",
    "  return <button onClick={onSubmit}>Sign in</button>;",
    "}",
  ].join("\n") },
  { path: "lib/submit.ts", content: [
    "export function submit() {",
    '  return fetch("/api/login", { method: "POST" });',
    "}",
  ].join("\n") },
  { path: "app/api/login/route.ts", content: [
    'import { save } from "../../../lib/storage";',
    "export async function POST() {",
    "  return save();",
    "}",
  ].join("\n") },
  { path: "lib/storage.ts", content: "export function save() { return { ok: true }; }" },
  { path: "app/settings/page.tsx", content: [
    'import { submit } from "../../lib/submit";',
    "export default function SettingsPage() { return <button onClick={submit}/>; }",
  ].join("\n") },
];
