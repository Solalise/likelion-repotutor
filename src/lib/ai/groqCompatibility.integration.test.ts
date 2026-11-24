import dotenv from "dotenv";
import { expect, it, vi } from "vitest";
import { groqModel, requestGroqCompletion } from "./groq";
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
it.runIf(process.env.RUN_ACTUAL_REPO_AI === "1")("checks minimal schema compatibility without repository data", async () => {
  const fetcher = globalThis.fetch;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const sent = JSON.parse(String(init?.body));
    console.info("request metadata", { model: sent.model, format: sent.response_format.type, strict: sent.response_format.json_schema?.strict, reasoning: sent.reasoning_effort, includeReasoning: sent.include_reasoning, budget: sent.max_completion_tokens });
    const response = await fetcher(url, init);
    const data = await response.clone().json().catch(() => ({}));
    console.info("response metadata", { status: response.status, code: data.error?.code, type: data.error?.type, parameter: data.error?.param, contentCharacters: data.choices?.[0]?.message?.content?.length });
    return response;
  });
  try {
    const response = await requestGroqCompletion('Return the JSON object {"ok":true}.', AbortSignal.timeout(30000), 128, { type: "json_schema", json_schema: { name: "compatibility_probe", strict: true, schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } });
    console.info("configured model", groqModel());
    expect(JSON.parse(response.choices![0].message!.content!)).toEqual({ ok: true });
  } finally { spy.mockRestore(); }
}, 35000);
