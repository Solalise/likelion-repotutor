"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { projectSelectionUrl, validConnectionId, validateApiPath, validateResourceId } from "@/lib/security-lab/projectPlan";
import { RequestPreview } from "./RequestPreview";
import RunnerLab from "./RunnerLab";
import styles from "./project.module.css";
import { useLabSession } from "@/components/security/LabSession";
import { usePathname } from "next/navigation";

type Repository = { id: string; repository: { fullName: string; defaultBranch: string } };
type LoadState = "loading" | "ready" | "login" | "error";
type Selection = { id: string; status: LoadState; repository?: Repository; message?: string };

export default function ProjectLab({ embedded = false }: { embedded?: boolean }) {
  const { data, update } = useLabSession();
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const ids = params.getAll("connectionId");
  const connectionId = ids[0] ?? "";
  const invalidSelection = ids.length > 1 || (ids.length === 1 && !validConnectionId(connectionId));
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [listState, setListState] = useState<LoadState>("loading");
  const [listError, setListError] = useState("");
  const [selection, setSelection] = useState<Selection>();
  const [reload, setReload] = useState(0);
  const { apiPath, resourceA, resourceB } = data;
  const setApiPath = (value: string) => update({ apiPath: value });
  const setResourceA = (value: string) => update({ resourceA: value });
  const setResourceB = (value: string) => update({ resourceB: value });

  useEffect(() => {
    const controller = new AbortController();
    setListState("loading");
    setRepositories([]);
    void (async () => {
      try {
        // Reuse the existing authenticated, user-scoped GitHub connection list.
        const response = await fetch("/api/github/repositories", { cache: "no-store", signal: controller.signal, redirect: "error" });
        if (controller.signal.aborted) return;
        if (response.status === 401) { setListState("login"); return; }
        if (!response.ok) throw new Error("저장소 목록을 확인하지 못했습니다. GitHub 로그인과 App 권한을 확인한 뒤 다시 불러와주세요.");
        const data: Repository[] = await response.json();
        if (!controller.signal.aborted) { setRepositories(data); setListState("ready"); }
      } catch (error) {
        if (!controller.signal.aborted) { setListError(error instanceof Error ? error.message : "저장소 목록을 불러오지 못했습니다."); setListState("error"); }
      }
    })();
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (!connectionId || invalidSelection || listState !== "ready") return;
    const controller = new AbortController();
    setSelection({ id: connectionId, status: "loading" });
    void (async () => {
      try {
        const response = await fetch(`/api/security-lab/repositories/${encodeURIComponent(connectionId)}`, { cache: "no-store", signal: controller.signal, redirect: "error" });
        const payload = await response.json();
        if (controller.signal.aborted) return;
        if (response.status === 401) { setSelection({ id: connectionId, status: "login" }); return; }
        if (!response.ok) {
          setSelection({ id: connectionId, status: "error", message: response.status === 403 || response.status === 404
            ? "접근 가능한 연결 저장소를 확인할 수 없습니다. 본인의 저장소를 다시 선택하거나 GitHub App 권한을 확인해주세요."
            : "저장소 접근권한을 확인하지 못했습니다. 목록을 다시 불러온 뒤 시도해주세요." });
          return;
        }
        setSelection({ id: connectionId, status: "ready", repository: payload });
      } catch {
        if (!controller.signal.aborted) setSelection({ id: connectionId, status: "error", message: "서버에 연결하지 못했습니다. 목록을 다시 불러와주세요." });
      }
    })();
    return () => controller.abort();
  }, [connectionId, invalidSelection, listState, reload]);

  const current = selection?.id === connectionId ? selection : undefined;
  const authorized = !invalidSelection && listState === "ready" && current?.status === "ready";
  const loginRequired = listState === "login" || current?.status === "login";
  const pathError = validateApiPath(apiPath);
  const errorA = validateResourceId(resourceA);
  const errorB = validateResourceId(resourceB) ?? (resourceA === resourceB ? "A와 B는 서로 다른 리소스 ID를 입력해주세요." : undefined);
  const listed = repositories.some((repository) => repository.id === connectionId);

  return <div className={`${styles.page} bp-practice ${embedded ? "bp-embedded" : ""}`}>
    {!embedded && <header className={styles.header}><Link href="/">↖ BreakProof</Link><span>SECURITY LAB / PROJECT</span><Link href="/security-lab">IDOR 예제 실습으로 돌아가기 →</Link></header>}
    <main id="main-content" className={styles.main}>
      <div className={styles.heading}><span className={styles.step}>ATTACK PRACTICE · IDOR</span><h1>직접 요청하고,<br />응답의 차이를 확인하세요.</h1><p>로컬 테스트 계정으로 정상 접근과 교차 접근을 비교합니다. GitHub 연결은 선택 사항입니다.</p><span className={styles.badge}>명시적 승인 · GET 전용 · 테스트 데이터</span><div className="bp-practice-links"><Link href="/services">① 웹서비스 연결</Link><a href="#api-heading">② 조건 설정</a><a href="#preview-heading">③ 요청 미리보기</a><Link href="/results">④ 실제 결과</Link></div></div>

      <details className={styles.optionalGithub}><summary>GitHub 프로젝트 선택 (선택 사항 · 테스트에 필수 아님)</summary><section className={styles.card} aria-labelledby="repository-heading"><span className={styles.step}>OPTIONAL / GITHUB</span><h2 id="repository-heading">GitHub 프로젝트 선택</h2><p>연결 정보는 참고용입니다. 기존 GitHub App에서 연결한 본인의 저장소만 표시하며 소스코드를 실행하지 않습니다.</p>
        {listState === "loading" && <p role="status">연결 저장소와 GitHub 권한을 확인하고 있습니다…</p>}
        {loginRequired && <div className={styles.notice} role="status"><strong>GitHub 연결에는 로그인이 필요합니다.</strong><p>로그인하지 않아도 아래 로컬 테스트 설정과 실제 IDOR 검증을 진행할 수 있습니다. 선택한 connectionId는 현재 주소에 유지됩니다.</p><Link href="/login">로그인 페이지로 이동 →</Link></div>}
        {listState === "error" && <p role="alert" className={styles.error}>{listError}</p>}
        {listState === "ready" && <><label className={styles.label} htmlFor="repository">연결 저장소</label><select id="repository" className={styles.input} value={invalidSelection ? "" : connectionId} onChange={(event) => { setSelection(undefined); router.replace(projectSelectionUrl(event.target.value).replace("/security-lab/project", pathname), { scroll: false }); }}>
          <option value="">프로젝트를 선택해주세요</option>
          {connectionId && !invalidSelection && !listed && <option value={connectionId} disabled>URL에 지정된 저장소 · 접근 확인 필요</option>}
          {repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.repository.fullName} · {repository.repository.defaultBranch}</option>)}
        </select>{!repositories.length && <p>연결된 저장소가 없습니다. <Link href="/repositories">저장소 연결 관리 →</Link></p>}</>}
        {invalidSelection && <p className={styles.error} role="alert">URL의 connectionId가 올바르지 않습니다. 저장소를 다시 선택해주세요.</p>}
        {!invalidSelection && connectionId && listState === "ready" && (!current || current.status === "loading") && <p role="status">선택한 저장소의 접근권한을 다시 확인하고 있습니다…</p>}
        {current?.status === "error" && <p className={styles.error} role="alert">{current.message}</p>}
        {authorized && <p role="status" className={styles.confirmed}>접근권한 확인 완료 · {current?.repository?.repository.fullName}</p>}
        <div className={styles.actions}><button type="button" className={styles.refresh} disabled={listState === "loading"} onClick={() => { setListState("loading"); setSelection(undefined); setReload((value) => value + 1); }}>저장소 목록 다시 불러오기</button><Link href="/repositories">GitHub 연결 관리 →</Link></div>
        <small>선택한 저장소는 주소의 connectionId로 유지됩니다. API 경로와 리소스 ID는 이 탭의 메모리에만 있으며 새로고침하면 예시값으로 돌아갑니다.</small>
      </section></details>

      <RunnerLab apiPath={apiPath} resourceA={resourceA} resourceB={resourceB}>
      <section className={styles.card} aria-labelledby="api-heading"><span className={styles.step}>03 / API & TEST DATA</span><h2 id="api-heading">테스트할 API 입력</h2><p>조회 전용 GET 경로를 입력하고, ID를 바꿀 위치에 <code>{"{resourceId}"}</code>를 한 번 넣어주세요.</p>
        <fieldset><legend className={styles.srOnly}>GET API 조건</legend><label className={styles.label} htmlFor="api-path">GET API 상대 경로</label><div className={styles.pathField}><span>GET</span><input id="api-path" value={apiPath} onChange={(event) => setApiPath(event.target.value)} maxLength={500} className={styles.input} aria-invalid={Boolean(pathError)} aria-describedby="api-help api-error" autoComplete="off" spellCheck={false} /></div>
          <p id="api-help" className={styles.note}>예: /api/orders/{"{resourceId}"} 또는 /api/orders?orderId={"{resourceId}"}<br />외부 URL, 호스트·포트, URL 인코딩(%)은 지원하지 않습니다. 인증정보를 입력하지 마세요.</p><p id="api-error" className={styles.error} role="status">{pathError}</p>
        </fieldset><p className={styles.note}>GitHub 연결 없이 입력할 수 있습니다. 요청은 로컬 등록과 실행 계획 승인을 완료한 뒤에만 전송됩니다.</p>
      </section>

      <section className={styles.card} aria-labelledby="data-heading"><span className={styles.step}>TEST DATA / OWNERSHIP</span><h2 id="data-heading">테스트 계정과 리소스 설정</h2><p>A와 B가 각각 소유한 가상의 테스트 리소스 ID를 입력해주세요. 실제 신원과 소유권은 실행 시 응답과 로컬 관리 화면의 예상 사용자 ID·필드 설정을 비교해 확인합니다.</p>
        <fieldset><legend className={styles.srOnly}>A와 B의 테스트 리소스</legend><div className={styles.grid}>{([
          { key: "a", label: "사용자 A 소유 리소스 ID", value: resourceA, change: setResourceA, error: errorA },
          { key: "b", label: "사용자 B 소유 리소스 ID", value: resourceB, change: setResourceB, error: errorB },
        ]).map((field) => <div key={field.key}><label className={styles.label} htmlFor={`resource-${field.key}`}>{field.label}</label><input id={`resource-${field.key}`} className={styles.input} value={field.value} maxLength={80} onChange={(event) => field.change(event.target.value)} autoComplete="off" spellCheck={false} aria-invalid={Boolean(field.error)} aria-describedby={`resource-${field.key}-help`} /><p id={`resource-${field.key}-help`} className={field.error ? styles.error : styles.note}>{field.error ?? "영문·숫자·하이픈·밑줄, 최대 80자"}</p></div>)}</div></fieldset>
        <small>101과 102는 입력 예시입니다. 비밀번호·토큰·쿠키·실제 개인정보는 입력하지 마세요.</small>
      </section>
      <RequestPreview authorized apiPath={apiPath} resourceA={resourceA} resourceB={resourceB} />
      </RunnerLab>
    </main>{!embedded && <footer className={styles.footer}>BreakProof · 테스트 계정과 테스트 데이터로 배우는 보안</footer>}
  </div>;
}
