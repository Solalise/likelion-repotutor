import type { GuideBundle, GuideStep, ProjectGuide } from "@/lib/security-lab/reviewGuide";

/** Presentation only: input is validated AI content or trusted server baseline content. */
export function expandValidatedGuide(guide: ProjectGuide): ProjectGuide {
  if (!guide.features.length || guide.steps.length !== 2) return guide;
  const [review, observe] = guide.steps;
  const cited = new Set(guide.steps.flatMap(step => step.sourceIds));
  const reviewFeature = guide.features.find(feature => feature.id === review.featureId);
  const sources = guide.sources.filter(source => cited.has(source.id) && reviewFeature?.sourceIds.includes(source.id));
  const roles = new Set(reviewFeature?.roles ?? []);
  // A route is displayed only when the existing feature label contains a static page entry.
  // Parameterized routes are never filled with guessed resource identifiers.
  const page = reviewFeature?.label.match(/(?:^| · )(\/[^\s]*) 페이지(?: ·|$)/)?.[1];
  const route = page && !/[\[\]():*?#\\]/.test(page) ? page : undefined;
  const featureName = reviewFeature?.label.match(/^(.+?) · \//)?.[1] ?? ({ XSS: "입력 내용 표시 기능", IDOR: "개별 자료 접근 기능", AUTHORIZATION: "서버 작업 권한 검토", SQL_INJECTION: "데이터베이스 처리 기능" }[guide.kind]);
  const aiNote = review.explanation.split("\nAI 참고 설명: ")[1];
  const overviewInterpretation = {
    expected: "검토할 기능과 화면 위치를 확인한 기록입니다. 보안 동작까지 검증한 것은 아닙니다.",
    unexpected: "화면이 안내와 다르면 배포 버전이나 기능 연결의 차이를 기록하세요. 취약점으로 확정하지 않습니다.",
    unknown: "기능 위치나 분석 커밋과의 대응을 확인하지 못하면 판정 불가로 남기세요. 경로를 추측하지 마세요.",
  };
  const preparations = {
    XSS: roles.has("input") && roles.has("output") ? "승인된 격리 환경, 합성 입력 문구 2개(VulnLab 메모 / <b>VulnLab 메모</b>), 입력을 표시하는 기존 화면을 준비하세요. 실제 사용자 데이터는 사용하지 않습니다." : "입력·출력 연결이 미확인이므로 기존 합성 데이터 출력 테스트 기록만 준비하세요. 입력칸을 추측하거나 예시 문구를 넣지 마세요.",
    IDOR: "승인된 격리 환경에 합성 계정 A와 B를 준비하세요. 기존 기능에서 만든 A 소유 자료와 B 소유 자료의 식별자·소유자를 적고 공개·비공개 정책을 먼저 확인하세요.",
    AUTHORIZATION: roles.has("role") ? "승인된 격리 환경에 실제 정책상 허용 역할과 비허용 역할의 합성 계정을 각각 준비하세요. 역할 이름·허용 작업·기존 테스트의 기대값을 적어 두세요." : "먼저 담당자와 실제 역할 구분·허용 정책을 확인하세요. 역할이 확인되지 않았으므로 관리자 전용 기능이나 관리자 계정이 있다고 가정하지 마세요.",
    SQL_INJECTION: observe.preparation ?? "승인된 격리 환경과 합성 데이터, 기존 데이터베이스 방어 테스트 기록을 준비하세요.",
  };
  const steps: GuideStep[] = [{ ...review, id: `${review.id}-overview`,
    action: route ? `${route}에 대응하는 기능 화면을 직접 확인하세요.` : "검토할 기능이 실제로 어느 화면에 있는지 확인하세요.",
    explanation: `${route ? `코드상 경로: ${route}\n실제 접속 URL: 직접 확인 필요. 준비한 격리 환경의 기존 화면을 이용하세요.` : page ? `코드상 경로 패턴: ${page}\n실제 접속 URL: 미확인. 합성 자료로 기존 화면의 이동 절차를 사용해 확인하세요. 패턴의 식별자를 임의로 채우지 마세요.` : "페이지 경로가 확인되지 않았습니다. 실제 화면과 기능의 연결을 담당자나 기존 테스트 기록에서 확인하세요. 임의 URL을 만들지 마세요."}${aiNote ? `\n참고: ${aiNote}` : ""}`,
    preparation: preparations[guide.kind], expected: "분석에서 확인한 기능이 어느 화면에 대응하는지 확인합니다. 화면이 없거나 버전이 다르면 실행하지 않습니다.",
    observe: "화면을 찾았는지, 분석한 기능과 같은지 선택하세요. 아직 찾지 못했다면 판정 불가로 남기세요.", interpretation: overviewInterpretation }];
  const codeStep = (suffix: string, action: string, explanation: string, roles: string[], details: Partial<Pick<GuideStep, "expected" | "observe" | "interpretation">> = {}) => {
    const ids = sources.filter(source => source.role && roles.includes(source.role)).map(source => source.id);
    if (!ids.length) return;
    steps.push({ ...review, id: `${review.id}-${suffix}`, action, explanation, sourceIds: ids, preparation: preparations[guide.kind],
      observe: "필요할 때 관련 코드를 펼쳐 화면과 연결되는 근거를 확인하세요. 확인되지 않은 기능이나 정책은 판정 불가로 남기세요.", interpretation: overviewInterpretation, ...details });
  };
  if (guide.kind === "XSS") {
    codeStep("input", "실제 화면에서 사용할 입력칸을 찾아보세요.", "승인된 격리 환경의 실제 입력 화면에서 사용할 입력칸을 찾으세요. 화면에 있는 제출·반영 절차만 사용하며, 없는 입력칸이나 버튼은 가정하지 않습니다.", ["input", "form", "server-action", "database"], { expected: "검토할 문구를 넣을 입력칸과 기존 반영 방법을 직접 확인합니다.", observe: "입력 기능을 찾았는지 선택하세요. 액션이나 DB 코드만 있고 화면 연결은 미확인이면 입력하지 말고 판정 불가로 남기세요." });
    codeStep("output", "입력한 문구가 표시되는 위치를 찾아보세요.", "같은 합성 문구를 보여 주는 기존 화면을 확인하세요. 정적 입력·출력 코드가 있어도 실제로 같은 값이 전달되는지는 별도 확인이 필요합니다.", ["output"], { expected: "입력 문구가 어디에 반영되는지 확인합니다. 저장·상세 페이지 등 미확인 화면을 새로 가정하지 않습니다.", observe: "화면에서 같은 문구를 찾았는지 확인하세요. 경로를 모르거나 입력과의 연결을 확인하지 못했다면 판정 불가입니다." });
  } else if (guide.kind === "IDOR") codeStep("object-scope", "이 자료가 공개 자료인지 개인 자료인지 먼저 확인하세요.", "담당자가 확인한 정책으로 A 소유·B 소유 자료와 공개 범위를 적으세요. 소유자 필드를 저장하는 것만으로 접근 제한이 증명되지는 않습니다.", ["database", "ownership"], { expected: "자료의 실제 소유자와 공개 정책이 구분됩니다. 공개 자료 접근을 곧바로 문제로 판단하지 않습니다.", observe: "소유자·식별자·공개 정책을 확인했는지 선택하세요. 관련 코드는 소유 필드와 조회 범위를 구분할 때 참고하세요." });
  else if (guide.kind === "AUTHORIZATION") codeStep("server-guard", "역할별로 허용할 작업과 거부할 작업을 적어 보세요.", roles.has("role") ? "실제로 확인된 역할만 사용해 허용·비허용 정책을 정리하세요. 화면의 버튼 표시 여부와 서버가 작업을 허용하는지는 서로 다릅니다." : "로그인 확인과 작업 권한은 다릅니다. 역할 조건이 미확인이므로 담당자나 기존 테스트에서 정책부터 확인하세요.", ["authentication", "role", "database"], { expected: "실제 역할 정책과 기존 테스트의 허용·거부 기대값을 확인합니다.", observe: "각 합성 계정의 역할과 기대 결과를 확인했는지 선택하세요. 역할 구분이 없다는 근거가 있으면 해당 없음, 아직 모르겠으면 판정 불가입니다." });
  else codeStep("query", "입력값과 쿼리 호출의 인수를 구분하세요.", "값을 별도로 전달하는지 관련 호출을 읽어 보세요. 안전성이나 실제 실행 결과를 추정하지 마세요.", ["input", "sql", "database"]);
  if (observe.preparation?.trim()) steps.push({ ...observe, id: `${observe.id}-prepare`, action: "검토에 필요한 환경과 합성 데이터를 준비하세요.", explanation: preparations[guide.kind], preparation: preparations[guide.kind],
    expected: "승인된 격리 환경과 필요한 합성 데이터가 확인됩니다. 준비되지 않으면 실행하지 않고 코드나 기존 테스트 기록만 검토합니다.",
    observe: "환경·계정·데이터 준비 여부를 직접 확인하세요. 준비하지 못한 항목을 확인 완료로 선택하지 마세요.", interpretation: { expected: "준비 조건을 확인한 수동 기록입니다. 테스트 결과나 안전성 판정은 아닙니다.", unexpected: "운영 환경이나 실제 사용자 데이터라면 실행하지 말고 중단하세요.", unknown: "승인·격리·합성 데이터 여부가 미확인이면 실행하지 말고 기존 테스트 기록만 검토하세요." } });
  const comparison: Partial<GuideStep> = guide.kind === "XSS" ? {
    action: roles.has("input") && roles.has("output") ? "무해한 두 문구의 표시 결과를 비교하세요." : "기존 출력 테스트 기록에서 문자 처리 결과를 확인하세요.",
    explanation: roles.has("input") && roles.has("output") ? "승인된 격리 환경의 확인된 입력칸에서 두 문구를 차례로 반영하고 같은 출력 위치를 보세요. 입력·출력 연결을 확인하지 못했다면 실행하지 않습니다." : "입력·출력 연결이 모두 확인되지 않았습니다. 새 입력 위치를 추측하지 말고 기존 합성 데이터 테스트 기록만 비교하세요.",
    preparation: preparations.XSS,
    expected: "일반 텍스트 기능: <b>VulnLab 메모</b>가 태그까지 문자로 보입니다.\n의도된 HTML 기능: 허용 정책과 정화 처리를 별도로 확인해야 합니다.",
    observe: "정상 문구: VulnLab 메모 → 입력한 글자가 보이는지\nHTML 모양 문구: <b>VulnLab 메모</b> → 태그까지 문자로 보이는지, 굵은 서식으로 보이는지\n동일한 출력 위치에서 비교한 뒤 결과를 선택하세요.",
    interpretation: { expected: "확인한 입력·출력 범위에서 기대한 표시와 일치한 기록입니다. 다른 화면까지 안전하다는 뜻은 아닙니다.", unexpected: "서식으로 해석됐다면 의도된 HTML 기능인지 정책을 확인하세요. 굵게 보인 사실만으로 XSS를 확정하지 않습니다.", unknown: "출력 위치·문자 처리 정책·격리 환경을 확인하지 못했으면 판정 불가로 남기세요." },
  } : guide.kind === "IDOR" ? {
    action: "합성 계정별 본인 자료와 타인 자료의 결과를 비교하세요.", explanation: "승인된 격리 환경의 기존 객체별 접근 제어 테스트를 사용하세요. 실제로 확인된 화면·기존 테스트 절차만 이용하고 임의 API 경로를 만들지 않습니다.", preparation: preparations.IDOR,
    expected: "본인 자료의 허용 작업은 성공합니다. 비공개 타인 자료는 내용 노출·변경 없이 거부됩니다. 공개 자료는 확인된 정책대로 허용할 수 있습니다.",
    observe: "A → A 소유 자료: 허용된 내용·작업이 맞는지\nB → B 소유 자료: 허용된 내용·작업이 맞는지\nB → A의 비공개 자료: 내용이 보이지 않고 변경도 없는지\n계정 전환은 별도 브라우저 프로필 또는 기존 로그아웃·로그인 절차로 하세요.",
    interpretation: { expected: "확인한 객체와 작업이 정책대로 동작한 수동 기록입니다. 모든 자료의 접근 제어를 보장하지 않습니다.", unexpected: "비공개 타인 자료가 노출되거나 변경됐다면 문제 의심으로 기록하세요. 소유 관계·공개 정책·관찰 조건을 함께 남기세요.", unknown: "자료 소유자·공개 정책·계정 구분·테스트 결과 중 하나라도 미확인이면 판정 불가로 남기세요." },
  } : guide.kind === "AUTHORIZATION" ? {
    action: "합성 역할별 기존 테스트 결과를 정책과 비교하세요.", explanation: "동일한 서버 작업에 대해 허용 역할과 비허용 역할의 기존 테스트 결과를 비교하세요. 화면에서 버튼이 숨겨진 것만으로 거부됐다고 판단하지 않습니다.", preparation: preparations.AUTHORIZATION,
    expected: "허용 역할은 정책상 가능한 작업만 성공합니다. 비허용 역할은 내용 조회나 데이터 변경 부작용 없이 거부됩니다.",
    observe: "허용 역할 계정 → 허용 작업의 결과가 맞는지\n비허용 역할 계정 → 같은 작업이 거부되는지\n거부된 작업 뒤 → 실제 데이터도 바뀌지 않았는지\n기존 테스트의 기대값·실제 결과를 확인한 뒤 선택하세요.",
    interpretation: { expected: "확인한 역할·작업·정책 범위에서 일치한 기록입니다. 서비스 전체 권한 검증 완료는 아닙니다.", unexpected: "비허용 역할의 작업 성공이나 데이터 변경이 관찰되면 문제 의심으로 남기세요. 실제 역할 정책도 다시 확인하세요.", unknown: "역할·정책·서버 결과가 미확인이면 판정 불가입니다. 관리자 전용 기능을 임의로 가정하지 마세요." },
  } : {};
  steps.push({ ...observe, ...comparison, id: `${observe.id}-observe` });
  if (guide.kind !== "SQL_INJECTION") {
    const index = steps.findIndex(step => step.id.endsWith("-prepare"));
    if (index >= 0) steps.unshift(...steps.splice(index, 1));
    for (const step of steps) if (!step.id.endsWith("-prepare")) step.preparation = undefined;
  }
  for (const step of steps) step.feature = featureName;
  // No new feature, source, claim of execution or observation can be added by expansion.
  const features = new Set(guide.steps.map(step => step.featureId));
  if (new Set(steps.map(step => step.id)).size !== steps.length || steps.some(step => !features.has(step.featureId) || step.sourceIds.some(id => !cited.has(id)
    || !guide.features.find(feature => feature.id === step.featureId)?.sourceIds.includes(id)))) throw new Error("INVALID_DISPLAY_EXPANSION");
  return { ...guide, steps };
}
export function presentGuideBundle(bundle: GuideBundle): GuideBundle {
  return { ...bundle, guides: bundle.guides.map(expandValidatedGuide) };
}
