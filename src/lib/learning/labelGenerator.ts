import type { CodeEdge, CodeNode, RepositoryEntryPoint } from "@/types/analysis";
import type { LearningCategory } from "@/types/learning";

interface GeneratedLabel {
  title: string;
  description: string;
  purpose: string;
  category: LearningCategory;
  roleConfidence?: "confirmed" | "inferred" | "unknown";
  facts?: string[];
  roleBasis?: string;
}

const FEATURE_LABELS: Array<[RegExp, string]> = [
  [/PoliceReport|police-report/i, "사건 신고"],
  [/DocumentScan|document-scan/i, "문서 스캔"],
  [/PreviousCaseLookup|case-access/i, "이전 사건 조회"],
  [/NearbyAgenc(?:y|ies)|nearby-agencies/i, "주변 기관 검색"],
  [/InsuranceProduct|insurance-products/i, "보험 상품"],
  [/Direction|directions/i, "이동 경로"],
  [/Guide|guides/i, "사건 안내"],
  [/Document|documents/i, "문서 확인"],
];

function featureLabel(node: CodeNode): string | undefined {
  const value = `${node.name} ${node.filePath}`;
  return FEATURE_LABELS.find(([pattern]) => pattern.test(value))?.[1];
}

const ACTION_WORDS: Record<string, string> = {
  request: "요청", regenerate: "다시 생성", edit: "수정", value: "내용", change: "반영",
  cancel: "취소", save: "저장", share: "공유", open: "열기", close: "닫기", submit: "제출",
  load: "불러오기", fetch: "조회", create: "생성", update: "수정", delete: "삭제", remove: "삭제",
  scan: "스캔", start: "시작", retry: "다시 시도", select: "선택", confirm: "확인", back: "뒤로 이동",
  press: "누르기", click: "클릭", input: "입력", search: "검색", send: "전송", download: "다운로드",
};

function identifierWords(name: string): string[] {
  return name.replace(/^(?:handle|on)(?=[A-Z])/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase().split(/\s+/).filter(Boolean);
}

function actionLabel(name: string): string | undefined {
  const words = identifierWords(name);
  if (words.length === 0 || words.some((word) => !ACTION_WORDS[word] && word !== "or" && word !== "and")) return undefined;
  if (words.includes("or") || words.includes("and")) {
    const conjunction = words.includes("or") ? "또는" : "그리고";
    const index = words.findIndex((word) => word === "or" || word === "and");
    return `${words.slice(0, index).map((word) => ACTION_WORDS[word]).join(" ")} ${conjunction} ${words.slice(index + 1).map((word) => ACTION_WORDS[word]).join(" ")} 처리`;
  }
  const verb = words[0];
  const rest = words.slice(1);
  if (verb === "request") return `${rest.map((word) => ACTION_WORDS[word]).join(" ")} 요청`;
  if (verb === "change" || words.at(-1) === "change") {
    const subjects = words.slice(0, -1).map((word) => word === "edit" ? "수정한" : ACTION_WORDS[word]).join(" ");
    return subjects ? `${subjects} 반영` : "변경 내용 반영";
  }
  if (["cancel", "save", "update", "delete", "remove"].includes(verb) && rest.length > 0) {
    const subject = rest.length === 1 && rest[0] === "edit" && verb === "save" ? "수정 내용"
      : rest.map((word) => ACTION_WORDS[word]).join(" ");
    return `${subject} ${ACTION_WORDS[verb]}`;
  }
  return words.map((word) => ACTION_WORDS[word]).join(" ");
}

const KNOWN_LABELS: Record<string, GeneratedLabel> = {
  LoginPage: {
    title: "로그인 시작",
    description: "사용자가 로그인 페이지에 접속해 인증 과정을 시작합니다.",
    purpose: "로그인 화면을 보여주고 사용자의 입력과 버튼 동작을 연결하는 출발점입니다.",
    category: "start",
  },
  handleLogin: {
    title: "로그인 버튼 클릭",
    description: "사용자가 입력한 이메일과 비밀번호를 로그인 처리 함수에 전달합니다.",
    purpose: "화면에서 발생한 사용자 행동을 실제 인증 로직과 연결하는 시작점입니다.",
    category: "ui-action",
  },
  login: {
    title: "로그인 요청 처리",
    description: "입력받은 로그인 정보를 서버 API가 이해할 수 있는 요청으로 만듭니다.",
    purpose: "화면 코드와 서버 인증 코드를 분리하고 API 요청을 담당합니다.",
    category: "logic",
  },
  POST: {
    title: "로그인 API 요청",
    description: "POST 요청에서 로그인 정보를 읽고 사용자 조회를 시작합니다.",
    purpose: "브라우저의 요청을 서버에서 받아 인증 절차를 실행하는 진입점입니다.",
    category: "api",
  },
  findUser: {
    title: "사용자 정보 조회",
    description: "이메일과 일치하는 사용자가 저장소에 있는지 확인합니다.",
    purpose: "인증에 필요한 사용자 데이터를 Repository 계층에서 찾아 반환합니다.",
    category: "database",
  },
};

export function generateLearningLabel(node: CodeNode, mode: "analysis" | "demo" = "analysis", context: { edges?: CodeEdge[]; entryPoints?: RepositoryEntryPoint[] } = {}): GeneratedLabel {
  const known = mode === "demo" ? KNOWN_LABELS[node.name] : undefined;
  if (known) return known;

  const entry = context.entryPoints?.find((entry) => entry.nodeId === node.id);
  const confirmed = (context.edges ?? []).filter((edge) => edge.confidence === "confirmed" && edge.relation !== "import");
  const outgoing = confirmed.filter((edge) => edge.source === node.id);
  const incoming = confirmed.filter((edge) => edge.target === node.id);
  const facts = [
    ...(node.sourceCode ? ["AST에서 추출한 원본 함수 코드가 있습니다."] : []),
    ...(entry ? [`파일 기반 ${entry.kind === "page" ? "페이지" : "API"} 진입점: ${entry.method ? `${entry.method} ` : ""}${entry.routePath}`] : []),
    ...(outgoing.some((edge) => edge.relation === "call") ? ["다른 함수를 호출하는 코드가 확인됩니다."] : []),
    ...(outgoing.some((edge) => edge.relation === "api") ? ["요청 URL·메서드와 서버 라우트가 정적으로 연결됩니다."] : []),
    ...(outgoing.some((edge) => edge.relation === "component") ? ["다른 컴포넌트를 사용하는 JSX가 확인됩니다."] : []),
    ...(incoming.some((edge) => edge.relation === "reference") ? ["다른 코드에서 이 함수를 참조하거나 전달합니다. 실행 여부는 보장하지 않습니다."] : []),
  ];
  const common = { facts, purpose: "원본 코드와 연결 종류를 함께 살펴보세요. 화살표는 실제 실행 순서나 실행 여부를 보장하지 않습니다." };
  if (entry) return { ...common,
    title: entry.kind === "page" ? "페이지 진입점" : "서버 요청 처리",
    description: entry.kind === "page" ? `${entry.routePath} 페이지의 진입점으로 확인된 함수입니다.` : `${entry.method ?? ""} ${entry.routePath} 요청을 받는 서버 진입점입니다. 업무 내용은 코드에서 확인해 주세요.`,
    category: entry.kind === "page" ? "start" : "api", roleConfidence: "confirmed", roleBasis: "파일 기반 라우트의 export 연결" };
  if (outgoing.some((edge) => edge.relation === "api")) return { ...common,
    title: "서버 API 요청 연결", description: "이 함수 안의 API 요청과 서버 라우트 사이에 정적 연결이 있습니다. 요청 성공이나 실행 시점은 보장하지 않습니다.",
    category: "service", roleConfidence: "confirmed", roleBasis: "확인된 API 관계" };
  if (outgoing.some((edge) => edge.relation === "component")) return { ...common,
    title: "화면 컴포넌트 구성", description: "이 함수 안에서 다른 컴포넌트를 사용하는 JSX가 확인됩니다. 조건에 따라 표시되지 않을 수 있습니다.",
    category: "ui-action", roleConfidence: "confirmed", roleBasis: "확인된 컴포넌트 사용 관계" };
  if (node.type === "api") return { ...common, title: `${node.name} API 처리`,
    description: "정적 분석의 API 분류를 바탕으로 한 역할 추정입니다. 요청 경로와 실제 처리는 원본 코드에서 확인하세요.",
    category: "api", roleConfidence: "inferred", roleBasis: "API 노드 분류 (라우트 근거 없음)" };
  const feature = featureLabel(node);
  const action = /^handle[A-Z]|^on[A-Z]/.test(node.name) ? actionLabel(node.name) ?? "동작 처리 후보" : undefined;
  const title = action ?? (node.type === "component" ? (feature ? `${feature} ${/Screen$/.test(node.name) ? "화면" : "UI 컴포넌트"}` : "화면 구성 코드")
    : /(?:^|\/)services?\//i.test(node.filePath) || /Service$/.test(node.name) ? "서비스 로직" : undefined);
  if (title) return { ...common, title,
    description: `${node.name}의 이름·경로·분류를 바탕으로 추정한 역할입니다. 실제 동작은 원본 코드와 관계를 확인해 주세요.`,
    category: node.type === "component" ? "ui-action" : "logic", roleConfidence: "inferred", roleBasis: "이름·파일 경로·노드 분류에 따른 추정" };
  return { ...common, title: "함수 코드 살펴보기",
    description: `${node.name} 함수의 업무 역할을 판단할 근거가 부족합니다. 입력값과 반환값을 원본 코드에서 살펴보세요.`,
    category: "logic", roleConfidence: "unknown", roleBasis: "역할 판단 근거 부족" };
}
