import { createRequestPreview } from "@/lib/security-lab/projectPlan";
import styles from "./project.module.css";

export function RequestPreview({ apiPath, resourceA, resourceB, authorized }: {
  apiPath: string; resourceA: string; resourceB: string; authorized: boolean;
}) {
  const requests = authorized ? createRequestPreview(apiPath, resourceA, resourceB) : [];
  return <section className={styles.card} aria-labelledby="preview-heading">
    <span className={styles.step}>04 / PREVIEW</span><h2 id="preview-heading">검증 요청 미리보기</h2>
    <p>아래는 리소스 검증 순서의 미리보기입니다. 이 미리보기 자체는 요청을 전송하거나 응답을 생성하지 않습니다. 실제 실행 시 이 세 요청 전에 A/B 신원 확인 GET 요청이 각각 한 번 추가됩니다.</p>
    {requests.length ? <ol className={styles.requests}>{requests.map((request, index) => <li key={index}>
      <div><strong>{request.purpose}</strong><span>계정 {request.account} → 사용자 {request.owner} 소유 데이터</span></div>
      <code>GET {request.path}</code>
    </li>)}</ol> : <div className={styles.empty}>올바른 API 경로·서로 다른 A/B 리소스 ID 입력을 완료하면 요청 순서가 표시됩니다. GitHub 연결은 필요하지 않습니다.</div>}
    <p className={styles.note}>실제 검증에서는 로그인 신원과 데이터 소유권을 확인하고 응답 내용을 비교해야 합니다. HTTP 200 또는 403만으로 취약점이나 수정 완료를 확정할 수 없습니다.</p>
  </section>;
}
