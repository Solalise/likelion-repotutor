import { beforeEach, describe, expect, it } from "vitest";
import { clearLearningRateLimitForTests, consumeLearningRequest } from "./learningRateLimit";

describe("consumeLearningRequest", () => {
  beforeEach(clearLearningRateLimitForTests);

  it("allows five requests per minute and rejects the sixth", () => {
    for (let index = 0; index < 5; index += 1) expect(consumeLearningRequest("user", 1_000 + index).allowed).toBe(true);
    expect(consumeLearningRequest("user", 2_000)).toMatchObject({ allowed: false });
  });

  it("isolates users and expires old requests", () => {
    for (let index = 0; index < 5; index += 1) consumeLearningRequest("first", index);
    expect(consumeLearningRequest("second", 1_000).allowed).toBe(true);
    expect(consumeLearningRequest("first", 61_000).allowed).toBe(true);
  });
});
