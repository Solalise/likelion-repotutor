import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectLab from "./ProjectLab";
import { initialLabData } from "@/components/security/LabSession";

const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, query: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams(state.query), usePathname: () => "/practice" }));
vi.mock("@/components/security/LabSession", async original => ({ ...await original<typeof import("@/components/security/LabSession")>(), useLabSession: () => ({ data: initialLabData(), update: vi.fn(), remember: vi.fn(), disconnect: vi.fn() }) }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: () => {},
  useState: (initial: unknown) => { const index = state.cursor++; return [index in state.values ? state.values[index] : initial, vi.fn()]; },
}));
const repository = { id: "connection-a", repository: { fullName: "test/project", defaultBranch: "main" } };
beforeEach(() => { state.values = []; state.cursor = 0; state.query = ""; });

describe("project lab screen states", () => {
  it("shows local connection, IDOR, resource settings and approval without requiring GitHub", () => {
    const html = renderToStaticMarkup(<ProjectLab />);
    const sections = ["내 웹서비스 연결", "공격 방식 선택", "테스트할 API 입력", "테스트 계정과 리소스 설정", "검증 요청 미리보기", "사용자 승인 후 실제 요청 실행"];
    for (let index = 1; index < sections.length; index++) expect(html.indexOf(sections[index])).toBeGreaterThan(html.indexOf(sections[index - 1]));
    expect(html).toContain('href="/security-lab"');
    expect(html).not.toContain("<fieldset disabled");
    expect(html).not.toContain('name="tokenA"');
    expect(html).toContain('href="/services"');
    expect(html).toContain("저장소 목록 다시 불러오기");
  });
  it("offers optional GitHub login while keeping local preparation available", () => {
    state.values = [[], "login"];
    const html = renderToStaticMarkup(<ProjectLab />);
    expect(html).toContain("GitHub 연결에는 로그인이 필요합니다");
    expect(html).toContain('href="/login"');
    expect(html).not.toContain("<fieldset disabled");
    expect(html).toContain("GET /vulnerable/orders/101");
  });
  it("restores the URL selection and shows a plan only after access confirmation", () => {
    state.query = "connectionId=connection-a";
    state.values = [[repository], "ready", "", { id: repository.id, status: "ready", repository }];
    const html = renderToStaticMarkup(<ProjectLab />);
    expect(html).toMatch(/<option value="connection-a" selected=""/);
    expect(html).toContain("접근권한 확인 완료");
    expect(html).toContain("GET /vulnerable/orders/101");
    expect(html).not.toContain("<fieldset disabled");
  });
  it("does not trust a previous selection when the URL changes to another connection", () => {
    state.query = "connectionId=other-connection";
    state.values = [[repository], "ready", "", { id: repository.id, status: "ready", repository }];
    const html = renderToStaticMarkup(<ProjectLab />);
    expect(html).not.toContain("접근권한 확인 완료");
    expect(html).toContain("GET /vulnerable/orders/101");
    expect(html).not.toContain("<fieldset disabled");
  });
  it("rejects duplicated connectionId values rather than choosing the first one", () => {
    state.query = "connectionId=connection-a&connectionId=other";
    state.values = [[repository], "ready", "", { id: repository.id, status: "ready", repository }];
    const html = renderToStaticMarkup(<ProjectLab />);
    expect(html).toContain("URL의 connectionId가 올바르지 않습니다");
    expect(html).not.toContain("접근권한 확인 완료");
    expect(html).not.toContain("<fieldset disabled");
  });
});
