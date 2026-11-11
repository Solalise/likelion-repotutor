import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { User, UserRecord } from "./types.ts";

const SESSION_MS = 60 * 60 * 1000;
export const COOKIE_NAME = "vulnlab_basic_session";
export function passwordRecord(password: string) {
  const salt = randomBytes(16).toString("hex");
  return { salt, passwordHash: scryptSync(password, salt, 32).toString("hex") };
}
export function publicUser(user: UserRecord): User {
  return { id: user.id, name: user.name, role: user.role };
}

/** Lab-only, process-local sessions. No platform auth, DB, or Runner dependencies. */
export function createAuth(users: readonly UserRecord[], now = Date.now) {
  const sessions = new Map<string, { userId: string; expiresAt: number }>();
  const dummy = passwordRecord(randomBytes(24).toString("hex"));
  let attempts = 0;
  let attemptsAt = now();
  function prune() {
    for (const [token, session] of sessions) if (session.expiresAt <= now()) sessions.delete(token);
  }
  function cookieToken(cookie: string | undefined) {
    return cookie?.split(";").map(value => value.trim()).find(value => value.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  }
  function logout(cookie: string | undefined) {
    const token = cookieToken(cookie);
    if (token) sessions.delete(token);
  }
  return {
    authenticate(userId: string, password: string): User | undefined {
      const user = users.find(value => value.id === userId);
      const record = user ?? dummy;
      const valid = timingSafeEqual(scryptSync(password, record.salt, 32), Buffer.from(record.passwordHash, "hex"));
      return valid && user ? publicUser(user) : undefined;
    },
    allowLoginAttempt() {
      if (now() - attemptsAt >= 60000) { attemptsAt = now(); attempts = 0; }
      return ++attempts <= 20;
    },
    current(cookie: string | undefined): User | undefined {
      prune();
      const token = cookieToken(cookie);
      const session = token ? sessions.get(token) : undefined;
      const user = session && users.find(value => value.id === session.userId);
      return user ? publicUser(user) : undefined;
    },
    login(user: User, oldCookie: string | undefined) {
      prune();
      logout(oldCookie);
      // Bound this local demo's session memory; never share it with the platform.
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value!);
      const token = randomBytes(32).toString("hex");
      sessions.set(token, { userId: user.id, expiresAt: now() + SESSION_MS });
      return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`;
    },
    logout,
    clearCookie: `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
    clear() { sessions.clear(); },
  };
}
