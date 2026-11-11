/** Relative-path plan inputs. Never fetch these paths from the RepoTutor server. */
export function validateApiPath(value: string): string | undefined {
  if (!value) return "테스트할 GET API 상대 경로를 입력해주세요.";
  if (value.length > 500 || !value.startsWith("/") || value.includes("//") || /[\s\\#%:]/.test(value)) {
    return "/로 시작하는 상대 경로만 입력해주세요. 외부 URL, 공백, #, %, 역슬래시는 사용할 수 없습니다.";
  }
  if (value.split("{resourceId}").length !== 2) return "리소스 ID를 바꿀 위치에 {resourceId}를 정확히 한 번 넣어주세요.";
  const normalized = value.replace("{resourceId}", "RESOURCE_ID");
  const [pathname, query, ...extra] = normalized.split("?");
  if (extra.length || !/^\/[A-Za-z0-9_~./-]+$/.test(pathname) || pathname.split("/").some((part) => part === "." || part === "..")) {
    return "경로에는 영문·숫자·/, -, _, ~, .만 사용할 수 있고 . 또는 .. 경로 구간은 사용할 수 없습니다.";
  }
  if (query !== undefined && !/^[A-Za-z0-9_-]+=[A-Za-z0-9_~.-]+(?:&[A-Za-z0-9_-]+=[A-Za-z0-9_~.-]+)*$/.test(query)) {
    return "쿼리는 ?orderId={resourceId}처럼 키=값 형식으로 입력해주세요. URL이나 중첩 경로는 사용할 수 없습니다.";
  }
  return undefined;
}

export function validateResourceId(value: string): string | undefined {
  return /^[A-Za-z0-9_-]{1,80}$/.test(value) ? undefined : "리소스 ID는 영문·숫자·하이픈·밑줄로 1~80자 입력해주세요.";
}

export function createRequestPreview(path: string, resourceA: string, resourceB: string) {
  if (validateApiPath(path) || validateResourceId(resourceA) || validateResourceId(resourceB) || resourceA === resourceB) return [];
  return [
    { account: "A", owner: "A", purpose: "A의 정상 접근 확인", path: path.replace("{resourceId}", resourceA) },
    { account: "B", owner: "B", purpose: "B의 데이터와 소유권 확인", path: path.replace("{resourceId}", resourceB) },
    { account: "A", owner: "B", purpose: "다른 사용자 데이터 접근 여부 확인", path: path.replace("{resourceId}", resourceB) },
  ];
}

export function projectSelectionUrl(connectionId: string) {
  return connectionId ? `/security-lab/project?${new URLSearchParams({ connectionId })}` : "/security-lab/project";
}

export function validConnectionId(value: string) { return /^[-\w]{1,160}$/.test(value); }
