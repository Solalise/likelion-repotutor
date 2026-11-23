import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ transaction: vi.fn(), user: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { $transaction: state.transaction } }));
vi.mock("@/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/auth/currentUser", () => ({ requireUserId: state.user }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); }, useRouter: () => ({}), usePathname: () => "/practice" }));
import { reserveAnalysisRun } from "./analysisAdmission";
import { GET as publicAnalysis } from "@/app/api/analyze/route";
import { checkBasicSite } from "@/lib/security-lab/basicSiteConnection";
import { PracticeDashboard } from "@/components/ui-platform/PracticeDashboard";
import { DashboardUI, LearningUI } from "@/components/ui-platform/PlatformViews";
import { LocalPracticeLink } from "@/components/ui-platform/LocalPracticeLink";
import { LearningDashboard, LearningCourse } from "@/components/learning/Learning";
import { courses } from "@/lib/learn/courses";
import RepositoriesPage from "@/app/repositories/page";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("reserves a durable bounded analysis budget atomically and refuses production anonymous or unavailable-DB work", async () => {
  const rows: Array<{ requestedByUserId: string; startedAt: Date }> = [];
  const statements: string[] = [];
  let queue = Promise.resolve();
  const clock = new Date("2026-11-18T00:00:00Z");
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?"); statements.push(sql);
      return sql.includes("FOR UPDATE") ? [{ id: "user-a" }] : [{ now: clock }];
    },
    analysisRun: {
      count: async ({ where }: { where: { requestedByUserId: string; startedAt: { gte: Date } } }) =>
        rows.filter(row => row.requestedByUserId === where.requestedByUserId && row.startedAt >= where.startedAt.gte).length,
      create: async ({ data }: { data: { requestedByUserId: string; startedAt: Date } }) => {
        rows.push(data); return { id: String(rows.length), ...data };
      },
    },
  };
  // Simulates independent callers sharing a serialized DB user-row lock, not a process-local limiter.
  state.transaction.mockImplementation((work: (value: typeof tx) => Promise<unknown>) => {
    const result = queue.then(() => work(tx)); queue = result.then(() => undefined, () => undefined); return result;
  });
  const input = { userId: "user-a", repositoryFullName: "org/repo", source: "CONNECTED_REPOSITORY" as const };
  const attempts = await Promise.allSettled(Array.from({ length: 11 }, (_, index) => reserveAnalysisRun({ ...input, repositoryFullName: `org/repo-${index}` })));
  expect(attempts.filter(item => item.status === "fulfilled")).toHaveLength(10);
  const denied = attempts.find(item => item.status === "rejected") as PromiseRejectedResult;
  expect(denied.reason).toMatchObject({ status: 429, retryAfterSeconds: 600 });
  expect(rows).toHaveLength(10); expect(statements.filter(sql => sql.includes("FOR UPDATE"))).toHaveLength(11);
  state.transaction.mockRejectedValueOnce(new Error("DB unavailable"));
  await expect(reserveAnalysisRun(input)).rejects.toMatchObject({ status: 503 });
  expect(rows).toHaveLength(10);
  vi.stubEnv("NODE_ENV", "production"); state.user.mockRejectedValue(new Error("not authenticated"));
  const before = state.transaction.mock.calls.length;
  expect((await publicAnalysis(new Request("https://vulnlab.example/api/analyze?source=github&url=https://github.com/org/repo"))).status).toBe(401);
  expect((await publicAnalysis(new Request("https://vulnlab.example/api/analyze?source=sample"))).status).toBe(403);
  expect(state.transaction.mock.calls).toHaveLength(before);
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  expect(manifest.scripts.build).toBe("prisma generate && next build");
  expect(manifest.scripts.build).not.toContain("migrate");
});

it("disables production loopback links and probes while preserving learning, local links and the repository redirect", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); vi.stubEnv("NODE_ENV", "production");
  for (const element of [<PracticeDashboard key="practice" />, <DashboardUI key="dashboard" />, <LearningUI key="learning" />, <LearningDashboard key="courses" />, <LearningCourse key="course" course={courses[0]} />]) {
    const markup = renderToStaticMarkup(element);
    expect(markup).not.toMatch(/href="http:\/\/(?:127\.0\.0\.1|localhost)/);
    expect(markup).toContain("공개 사이트에서는 로컬 실습 서버에 연결하지 않습니다");
  }
  const disabled = renderToStaticMarkup(<LocalPracticeLink href="http://127.0.0.1:4400/">실습 시작</LocalPracticeLink>);
  expect(disabled).toMatch(/<button[^>]*disabled/); expect(disabled).not.toContain("href=");
  expect(await checkBasicSite(new AbortController().signal)).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  expect(() => RepositoriesPage()).toThrow("/services");
  vi.stubEnv("NODE_ENV", "development");
  expect(renderToStaticMarkup(<LocalPracticeLink href="http://127.0.0.1:4400/">실습 시작</LocalPracticeLink>)).toContain('href="http://127.0.0.1:4400/"');
});
