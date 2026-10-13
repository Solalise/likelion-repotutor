import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RepoTutor — 코드 흐름을 이해하는 가장 빠른 방법",
  description: "Repository의 구조와 실행 흐름을 시각적으로 탐색하는 코드 학습 도구",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
