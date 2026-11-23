import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(resolve("prisma/migrations/20261119000100_security_test_records/migration.sql"), "utf8");
const manualCheck = 'CONSTRAINT "security_test_records_manual_source_check" CHECK ("source" = \'MANUAL\')';
const statements = (value: string) => value.replace(/--[^\r\n]*/g, "").split(";").map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
let generated: string[];

beforeAll(() => {
  // Offline SQL generation only: no datasource inspection, shadow DB or apply.
  const result = spawnSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"], {
    encoding: "utf8", timeout: 45000,
    env: { ...process.env, DATABASE_URL: "postgresql://offline:offline@127.0.0.1:1/offline", DIRECT_DATABASE_URL: "postgresql://offline:offline@127.0.0.1:1/offline" },
  });
  if (result.status !== 0) throw new Error("Offline Prisma SQL generation failed; connection details suppressed.");
  generated = statements(result.stdout).filter(s => /^(CREATE TABLE|ALTER TABLE) "security_test_records" /.test(s) || /^CREATE INDEX "[^"]+" ON "security_test_records"\(/.test(s));
}, 50000);

describe("SecurityTestRecord migration compatibility", () => {
  it("matches Prisma-generated columns, defaults, indexes and FK actions except the documented provenance CHECK", () => {
    expect(generated).toHaveLength(5);
    expect(statements(sql.replace(` ${manualCheck}`, "")).sort()).toEqual([...generated].sort());
  });

  it("only creates the new table, its indexes and its foreign keys", () => {
    expect(statements(sql)).toHaveLength(5);
    for (const statement of statements(sql)) {
      expect(statement).toMatch(/^(CREATE TABLE "security_test_records" \(|CREATE INDEX "[^"]+" ON "security_test_records"\(|ALTER TABLE "security_test_records" ADD CONSTRAINT "[^"]+" FOREIGN KEY)/);
    }
  });

  it("keeps every PostgreSQL identifier within 63 UTF-8 bytes", () => {
    for (const [, identifier] of sql.matchAll(/"([^"]+)"/g)) expect(Buffer.byteLength(identifier, "utf8")).toBeLessThanOrEqual(63);
  });

  it("retains a named MANUAL-only provenance constraint", () => {
    expect(sql).toContain(manualCheck);
    expect(sql).toContain("Prisma cannot model this CHECK");
  });
});
