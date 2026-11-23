import Link from "next/link";
import { removeService } from "@/app/services/actions";
import styles from "@/app/services/services.module.css";
export type ServiceConnection = {
  id: string; fullName: string; branch: string; suspended: boolean;
  vercelUrl: string | null; verified: boolean; analysisStatus: string;
};
const statuses: Record<string, string> = { NONE: "분석 전", RUNNING: "분석 중", COMPLETED: "분석 완료", FAILED: "분석 실패" };
export function ServiceConnections({ services, selectedId }: { services: ServiceConnection[]; selectedId?: string }) {
  return <section aria-labelledby="services-list-title"><h2 id="services-list-title">연결된 웹서비스</h2>
    {!services.length && <div className="vl-card"><h3>GitHub 저장소로 첫 서비스를 연결하세요.</h3><p className="vl-description">GitHub App에서 허용한 저장소가 여기에 표시됩니다. 저장소를 선택한 뒤 Vercel 테스트 배포를 연결할 수 있습니다.</p><Link className="vl-outline-button" href="/api/github/installations/start">GitHub App 설치 및 저장소 선택</Link></div>}
    {services.map(service => <article className="vl-card" key={service.id}>
      <div className="vl-card-heading"><h3>{service.fullName}</h3><span className="vl-status">{service.suspended ? "GitHub 설치 중지" : "연결 기록 있음"}</span></div>
      <dl><dt>GitHub 저장소 / 브랜치</dt><dd>{service.fullName} / {service.branch}</dd>
        <dt>Vercel 테스트 배포</dt><dd>{service.vercelUrl ?? "미연결"}</dd>
        <dt>소유권</dt><dd>{service.verified ? "검증 기록 있음" : "미검증"}</dd>
        <dt>내부 분석</dt><dd>{statuses[service.analysisStatus] ?? "상태 미확인"}</dd>
        <dt>실습 준비</dt><dd>{service.suspended ? "GitHub 권한 확인 필요" : !service.vercelUrl ? "배포 URL 연결 필요" : !service.verified ? "사이트 소유권 확인 필요" : "배포 커밋·실습 범위·환경 승인 확인 필요"}</dd>
        <dt>최근 실습 / 재검증</dt><dd>미실행 · 결과 수집 기능 미연결</dd></dl>
      <div className={styles.serviceActions}><Link className="vl-outline-button" href={`/services?connected=${encodeURIComponent(service.id)}`} aria-current={selectedId === service.id ? "page" : undefined}>서비스 선택 및 배포 연결</Link><form action={removeService}><input type="hidden" name="connectionId" value={service.id}/><button className={`vl-outline-button ${styles.deleteButton}`} type="submit">서비스 삭제</button></form></div>
    </article>)}
  </section>;
}
