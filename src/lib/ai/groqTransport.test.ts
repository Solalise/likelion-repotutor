import { afterEach, expect, it, vi } from "vitest";
import { requestGroqCompletion } from "./groq";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("uses existing server key/model settings and returns structured completion without exposing the key", async () => {
  vi.stubEnv("GROQ_API_KEY", "synthetic-server-key"); vi.stubEnv("GROQ_MODEL", "openai/gpt-oss-20b");
  const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '{"guides":[]}' } }], usage: { total_tokens: 12 } })); vi.stubGlobal("fetch", fetcher);
  const data = await requestGroqCompletion("bounded synthetic prompt", new AbortController().signal, 700);
  expect(fetcher).toHaveBeenCalledOnce(); const init = fetcher.mock.calls[0][1];
  expect(init.headers.Authorization).toBe("Bearer synthetic-server-key");
  expect(JSON.parse(init.body)).toMatchObject({ model: "openai/gpt-oss-20b", max_completion_tokens: 700, response_format: { type: "json_object" } });
  expect(JSON.stringify(data)).not.toContain("synthetic-server-key");
});
it("reports missing configuration and upstream rate limit with sanitized errors", async () => {
  vi.stubEnv("GROQ_API_KEY", ""); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(requestGroqCompletion("prompt", new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv("GROQ_API_KEY", "synthetic"); fetcher.mockResolvedValue(Response.json({ error: { message: "private upstream detail" } }, { status: 429, headers: { "retry-after": "10" } }));
  await expect(requestGroqCompletion("prompt", new AbortController().signal)).rejects.toMatchObject({ status: 429, retryAfterSeconds: 10 });
});
it("uses a guide-specific strict schema without changing the legacy default format", async () => {
  vi.stubEnv("GROQ_API_KEY", "synthetic");
  const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '{"guides":[]}' } }] })); vi.stubGlobal("fetch", fetcher);
  const format = { type: "json_schema", json_schema: { name: "test", strict: true, schema: { type: "object" } } };
  await requestGroqCompletion("synthetic", new AbortController().signal, 4200, format);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).response_format).toEqual(format);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).reasoning_effort).toBe("medium");
});
it("preserves safe HTTP 400 diagnostics without returning provider text or failed generated content", async () => {
  vi.stubEnv("GROQ_API_KEY", "synthetic-secret-key");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "json_validate_failed", message: "private provider detail synthetic-secret-key", failed_generation: '{"guides":[{"guides":' } }, { status: 400 })));
  try { await requestGroqCompletion("synthetic", new AbortController().signal); throw new Error("must reject"); }
  catch (error) {
    expect(error).toMatchObject({ status: 502, internalCode: "UPSTREAM_JSON_VALIDATION_FAILED", diagnostics: { upstreamStatus: 400, code: "json_validate_failed", generatedJsonValid: false, generatedGuidesKeys: 2 } });
    expect(JSON.stringify(error)).not.toContain("synthetic-secret-key"); expect(JSON.stringify(error)).not.toContain("private provider");
  }
});
