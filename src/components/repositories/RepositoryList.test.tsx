import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryList } from "./RepositoryList";
import { Sidebar } from "@/components/layout/Sidebar";

const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0 }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/repositories",
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: () => {},
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    return [index in hooks.states ? hooks.states[index] : initial, vi.fn()];
  },
}));

const repositories = [
  { id: "ready", owner: "team", name: "alpha", visibility: "PRIVATE", branch: "main", suspended: false, status: "COMPLETED", analyzedAt: "2026-11-01T00:00:00Z", startedAt: "2026-11-01T00:00:00Z" },
  { id: "running", owner: "org", name: "beta", visibility: "PUBLIC", branch: "main", suspended: false, status: "RUNNING", analyzedAt: null, startedAt: "2026-11-02T00:00:00Z" },
  { id: "blocked", owner: "team", name: "gamma", visibility: "INTERNAL", branch: "main", suspended: true, status: "FAILED", analyzedAt: null, startedAt: null },
];

beforeEach(() => { hooks.states = []; hooks.cursor = 0; });

describe("repository management UI", () => {
  it("shows connection instructions without inventing repositories", () => {
    const html = renderToStaticMarkup(<RepositoryList repositories={[]} />);
    expect(html).toContain("아직 연결된 저장소가 없어요");
    expect(html).toContain("/api/github/installations/start");
    expect(html).not.toContain("/repository?connected=");
  });

  it("disables running and suspended analyses while retaining authorized navigation", () => {
    const html = renderToStaticMarkup(<RepositoryList repositories={repositories} />);
    expect(html).toContain("/repository?connected=ready");
    expect(html).not.toContain("/repository?connected=running");
    expect(html).not.toContain("/repository?connected=blocked");
    expect(html).toContain("disabled");
    expect(html).toContain("설치가 중지");
  });

  it("combines owner search and status filtering", () => {
    hooks.states = ["team", "COMPLETED", "name"];
    const html = renderToStaticMarkup(<RepositoryList repositories={repositories} />);
    expect(html).toContain("alpha");
    expect(html).not.toContain("beta");
    expect(html).not.toContain("gamma");
  });

  it("orders by actual analysis timestamps", () => {
    hooks.states = ["", "ALL", "recent"];
    const html = renderToStaticMarkup(<RepositoryList repositories={repositories} />);
    expect(html.indexOf("beta")).toBeLessThan(html.indexOf("alpha"));
  });

  it("marks the current route and exposes upcoming features without links", () => {
    const html = renderToStaticMarkup(<Sidebar name="Learner"><button>로그아웃</button></Sidebar>);
    expect(html).toMatch(/<a(?=[^>]*href="\/repositories")(?=[^>]*aria-current="page")[^>]*>/);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(4);
    expect(html).not.toContain('href="/teach-back"');
  });
});
