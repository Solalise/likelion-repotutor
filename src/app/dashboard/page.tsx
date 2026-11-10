import Link from "next/link";
import { ArrowRight, BookOpen, Plus, Clock } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/layout/AppShell";
import { db } from "@/lib/db";
import { syncAllUserInstallations } from "@/lib/github/installations";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Do not expose persisted activity metadata when current GitHub access is unknown.
  await syncAllUserInstallations(session.user.id);
  const records = await db.learningRecord.findMany({
    where: { userId: session.user.id, repository: { users: { some: {
      userId: session.user.id, active: true, installation: { suspendedAt: null },
    } } } },
    include: { repository: { include: { users: {
      where: { userId: session.user.id, active: true, installation: { suspendedAt: null } }, select: { id: true },
    } } } },
    orderBy: { updatedAt: "desc" }, take: 6,
  });
  const latest = records[0];
  const href = (record: typeof records[number]) => {
    const id = record.repository.users[0]?.id;
    return id ? `/repository?${new URLSearchParams({ connected: id, selection: record.selectionId, selectionType: record.selectionType })}` : undefined;
  };
  return (
    <AppShell>
      <main id="main-content" className="tutor-main">
        <header className="page-heading">
          <span className="eyebrow">YOUR LEARNING SPACE</span>
          <h1>반가워요, <span className="greeting-name">{session.user.name || "학습자"}</span></h1>
          <p>코드의 흐름을 따라, 오늘도 한 걸음 더 이해해 보세요.</p>
        </header>
        <div className="home-cards">
          <section className="tutor-card continue-card">
            <div className="home-card-heading"><BookOpen size={21} /><h2>이어서 학습하기</h2></div>
            <div className="home-card-body">
            {latest ? <>
              <span className="card-kicker">{latest.repository.fullName}</span><h3>{latest.selectionName}</h3>
              <p>마지막 AI 학습 기록 · {latest.updatedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
              {!href(latest) && <p>저장소 연결 또는 접근 권한을 다시 확인해 주세요.</p>}
            </> : <>
              <h3>첫 번째 코드 학습을 시작해 보세요</h3>
              <p>저장소를 연결하고 AI 설명으로 학습하면 이곳에서 이어갈 수 있어요.</p>
            </>}
            </div>
            <div className="home-card-footer">
              {latest && href(latest) ? <Link className="primary-action" href={href(latest)!}>학습 이어가기 <ArrowRight size={16} /></Link>
                : <Link className="secondary-action" href="/repositories">{latest ? "연결 확인하기" : "연결된 저장소 확인하기"} <ArrowRight size={16} /></Link>}
            </div>
          </section>
          <section className="tutor-card">
            <div className="home-card-heading"><Plus size={21} /><h2>새 저장소 연결하기</h2></div>
            <div className="home-card-body">
              <h3>살펴보고 싶은 코드를 가져오세요</h3>
              <p>GitHub App을 설치하고 학습할 저장소를 허용해 주세요. 로그인과 저장소 접근 승인은 별개입니다.</p>
              <p className="card-note">이미 연결한 저장소는 <Link href="/repositories">내 저장소</Link>에서 관리할 수 있어요.</p>
            </div>
            <div className="home-card-footer"><Link className="primary-action" href="/api/github/installations/start">GitHub 저장소 연결 <ArrowRight size={16} /></Link></div>
          </section>
        </div>
        <section className="tutor-card activity-section">
          <div className="section-title"><Clock size={20} /><h2>최근 학습 활동</h2></div>
          <p>AI 설명으로 학습한 기능과 함수의 최근 기록입니다.</p>
          {records.length ? <ul className="activity-list">{records.map(record => <li key={record.id}>
            <div><strong>{record.selectionName}</strong><span>{record.repository.fullName}</span></div>
            <time dateTime={record.updatedAt.toISOString()}>{record.updatedAt.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</time>
            {href(record) ? <Link className="activity-action" href={href(record)!} aria-label={`${record.selectionName} 학습 열기`}>이어서 보기 <ArrowRight size={14} /></Link> : <span className="activity-action">연결 확인 필요</span>}
          </li>)}</ul> : <div className="quiet-empty">
            <BookOpen size={28} /><h3>아직 학습 활동이 없어요</h3><p>코드를 탐색하고 AI 설명을 요청하면 실제 학습 기록이 표시됩니다.</p>
          </div>}
        </section>
      </main>
    </AppShell>
  );
}
