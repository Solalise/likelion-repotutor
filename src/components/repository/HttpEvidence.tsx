import type { ProbeResponseEvidence } from "@/lib/security-lab/probeTypes";
import styles from "./sqliRequestEditor.module.css";
export function HttpEvidence({ evidence }: { evidence: ProbeResponseEvidence | null }) {
  return <>
    <dl className="repository-metadata">
      <div><dt>HTTP 상태 코드</dt><dd>{evidence?.statusCode ?? "응답 없음"}</dd></div>
      <div><dt>응답 시간</dt><dd>{evidence?.durationMs == null ? "측정되지 않음" : `${evidence.durationMs} ms`}</dd></div>
      <div><dt>요청 상태</dt><dd>{evidence?.outcome ?? "미실행"}</dd></div>
      <div><dt>오류 메시지</dt><dd>{evidence ? evidence.errorMessage ?? "없음" : "표시할 요청 근거가 없습니다."}</dd></div>
      <div><dt>Content-Type</dt><dd>{evidence?.contentType ?? "확인되지 않음"}</dd></div>
    </dl>
    <h5>응답 본문</h5>
    <pre className={styles.body}>{evidence?.body == null ? "수신된 응답 본문이 없습니다." : evidence.body === "" ? "(빈 응답 본문)" : evidence.body}</pre>
    {evidence?.bodyTruncated && <p>응답 본문 일부만 표시합니다.</p>}
  </>;
}

