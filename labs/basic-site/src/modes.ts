export type PracticeMode = "guided" | "free";

export function selectedMode(
  params: URLSearchParams,
): PracticeMode | undefined {
  if (params.getAll("mode").length !== 1) return undefined;

  const mode = params.get("mode");
  return mode === "guided" || mode === "free"
    ? mode
    : undefined;
}

export function modeNavigation(
  path: string,
  lab: "idor" | "sqli",
) {
  const base = `${path}?lab=${lab}`;

  return `<nav class="practice-mode-nav" aria-label="실습 방식 선택">
    <a href="${base}&amp;mode=guided">가이드 실습</a>
    <a href="${base}&amp;mode=free">자유 실습</a>
  </nav>`;
}
