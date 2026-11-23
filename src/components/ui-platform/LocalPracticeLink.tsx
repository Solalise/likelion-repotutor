"use client";

import type { AnchorHTMLAttributes } from "react";
import { localPracticeAvailable } from "@/lib/security-lab/basicSiteConnection";

export const localPracticeUnavailableMessage = "공개 사이트에서는 로컬 실습 서버에 연결하지 않습니다. 기초 학습과 내 웹서비스의 실습 준비 화면을 이용하세요. 실제 기초 실습은 로컬 개발 환경에서만 사용할 수 있습니다.";

export function ProductionPracticeNotice() {
  return localPracticeAvailable() ? null : <p role="status">{localPracticeUnavailableMessage}</p>;
}

export function LocalPracticeLink({ children, className, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (!localPracticeAvailable()) return <button type="button" disabled className={className}
    aria-label={props["aria-label"]} title={localPracticeUnavailableMessage}>{children}</button>;
  return <a {...props} className={className} onClick={event => {
    props.onClick?.(event);
    if (event.defaultPrevented || !props.href) return;
    try {
      const url = new URL(props.href);
      const topic = url.searchParams.get("lab") ?? url.pathname.match(/\/lab\/(idor|sqli|xss|authz)(?:\/|$)/)?.[1];
      if (topic && ["idor", "sqli", "xss", "authz"].includes(topic)) localStorage.setItem("vulnlab:last-practice", topic);
    } catch { /* Navigation still works when storage is unavailable. */ }
  }}>{children}</a>;
}
