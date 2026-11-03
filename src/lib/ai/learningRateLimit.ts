const WINDOW_MS = 60_000;
const MAX_REQUESTS = 5;
const requests = new Map<string, number[]>();

export function consumeLearningRequest(userId: string, now = Date.now()): { allowed: boolean; retryAfterSeconds?: number } {
  const recent = (requests.get(userId) ?? []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    requests.set(userId, recent);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - recent[0])) / 1_000)) };
  }
  recent.push(now);
  requests.set(userId, recent);
  return { allowed: true };
}

export function clearLearningRateLimitForTests(): void {
  requests.clear();
}
