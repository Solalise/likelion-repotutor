import { createAuth } from "./auth.ts";
import { createSeed } from "./seed.ts";

/** Each server instance owns its fixtures. Restarting discards all sessions. */
export function createStore() {
  const seed = createSeed();
  return { auth: createAuth(seed.users), posts: seed.posts };
}
export type Store = ReturnType<typeof createStore>;
