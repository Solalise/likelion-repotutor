import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ServicesUI } from "./PlatformViews";

it("keeps the services page connection-only with no test token inputs or execution controls", () => {
  const html = renderToStaticMarkup(<ServicesUI/>);
  expect(html).toContain("실행기 페어링");
  expect(html).toContain("포트 일치 여부");
  expect(html).toContain("공격 실행 승인이 아닙니다");
  expect(html).toContain("연결 전 · 페어링 필요");
  expect(html).not.toContain('name="tokenA"');
  expect(html).not.toContain('name="tokenB"');
  expect(html).not.toContain("승인된 계획 실제 실행");
  expect(html).not.toContain("현재 조건으로 요청 계획 등록");
});
