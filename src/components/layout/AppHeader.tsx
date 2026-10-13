import Link from "next/link";
import { Github } from "lucide-react";
import { Brand } from "./Brand";

export function AppHeader() {
  return (
    <header className="app-header">
      <Brand />
      <nav className="header-nav" aria-label="주 메뉴">
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/repository">Code map</Link>
        <button className="github-button" disabled title="다음 개발 단계에서 연결됩니다">
          <Github size={16} /> GitHub 연결 예정
        </button>
      </nav>
    </header>
  );
}
