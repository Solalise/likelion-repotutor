import type { CodeNode } from "@/types/analysis";
import type { LearningCategory } from "@/types/learning";

interface GeneratedLabel {
  title: string;
  description: string;
  purpose: string;
  category: LearningCategory;
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

export function generateLearningLabel(node: CodeNode): GeneratedLabel {
  const known = KNOWN_LABELS[node.name];
  if (known) return known;

  const feature = featureLabel(node);
  if (node.type === "api") {
    return {
      title: `${node.name} API 처리`,
      description: "클라이언트 요청을 받아 필요한 서버 로직을 실행합니다.",
      purpose: "화면과 서버 기능을 연결하는 API 진입점입니다.",
      category: "api",
    };
  }
  if (node.type === "component") {
    const role = /Route$|(?:^|\/)app\//.test(`${node.name} ${node.filePath}`) ? "기능 진입"
      : /Screen$/.test(node.name) ? "화면"
        : /View$/.test(node.name) ? "화면 구성" : "UI 컴포넌트";
    return {
      title: feature ? `${feature} ${role}` : role,
      description: `${node.name} 컴포넌트가 사용자에게 보이는 UI를 구성합니다.`,
      purpose: role === "기능 진입" ? "라우트와 실제 기능 화면을 연결합니다." : "사용자가 기능을 보고 조작할 수 있는 화면 영역을 담당합니다.",
      category: role === "기능 진입" ? "start" : "ui-action",
    };
  }
  if (/(?:^|\/)services?\//i.test(node.filePath) || /Service$/.test(node.name)) {
    return {
      title: feature ? `${feature} 서비스 처리` : "서비스 로직 처리",
      description: `${node.name} 함수가 화면과 분리된 서비스 작업을 담당합니다.`,
      purpose: "화면 컴포넌트가 직접 처리하지 않도록 핵심 작업을 별도 코드로 분리합니다.",
      category: "service",
    };
  }
  if (/^handle[A-Z]|^on[A-Z]/.test(node.name)) {
    const action = actionLabel(node.name);
    return {
      title: action ?? `${node.name} · 사용자 동작`,
      description: `${node.name} 함수가 화면에서 전달된 사용자 동작을 처리합니다.`,
      purpose: "UI 이벤트를 다음 로직과 연결합니다.",
      category: "logic",
    };
  }
  return {
    title: feature ? `${feature} 핵심 로직` : "핵심 로직 처리",
    description: `${node.name} 함수가 맡은 코드 작업을 실행합니다.`,
    purpose: "앞 단계에서 전달받은 값을 처리하고 다음 코드로 연결합니다.",
    category: "logic",
  };
}
