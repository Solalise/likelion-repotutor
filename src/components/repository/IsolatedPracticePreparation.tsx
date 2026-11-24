import Link from "next/link";

/** Navigation and preparation only. Never registers a target or grants execution. */
export function IsolatedPracticePreparation({ id, repository, commitSha, codeLocation }: { id?: string; repository?: string; commitSha?: string; codeLocation?: string }) {
  return <section id={id} tabIndex={id ? -1 : undefined} aria-label="격리된 실습 환경 준비">
    <h3>격리된 실습 환경 준비</h3>
    {repository && <p>분석 저장소: {repository}{commitSha && <> · 커밋: <code>{commitSha}</code></>}{codeLocation && <> · 코드 위치: <code>{codeLocation}</code></>}</p>}
    <p>분석 결과를 참고해 합성 데이터가 있는 로컬·격리 환경을 준비하세요. 준비 화면 확인은 실제 실행 승인이 아닙니다.</p>
    <ol><li>검토할 후보와 관련 코드를 확인합니다.</li><li>운영 데이터·인증정보와 분리된 환경과 테스트 계정을 준비합니다.</li><li>예제 실습 또는 기존 로컬 실행기에서 대상·허용 범위·실행 조건을 확인합니다.</li></ol>
    <div className="vl-actions"><Link className="secondary-action" href="/practice">예제 사이트 실습</Link><Link className="secondary-action" href="/security-lab/project">로컬 실행기 준비 안내</Link></div>
    <p>이 화면은 요청을 전송하지 않습니다. 외부 배포 사이트 실행은 비활성 상태이며, 각 실습의 기존 환경 확인과 승인 조건은 그대로 적용됩니다.</p>
  </section>;
}
