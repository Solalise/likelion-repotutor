import type { SourceInput } from "@/types/analysis";

export const reactEventSources: SourceInput[] = [{ path: "app/login/page.tsx", content: [
  "function handleLogin() { return 1; }",
  "function submitForm() { return 2; }",
  "function audit() { return 3; }",
  "function Button(props: { onClick: () => void }) { return <button onClick={props.onClick}/>; }",
  "export default function LoginPage() {",
  "  const ready = Boolean(Date.now());",
  "  return <>",
  '    <button onClick={handleLogin}>Sign in</button>',
  "    <form onSubmit={(event) => {",
  "      event.preventDefault();",
  "      submitForm();",
  "      audit();",
  "    }}/>",
  "    <input onChange={ready ? handleLogin : submitForm}/>",
  "    <Button onClick={handleLogin}/>",
  "  </>;",
  "}",
].join("\n") }];
