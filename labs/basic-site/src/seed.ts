import { passwordRecord } from "./auth.ts";
import type { Post, UserRecord } from "./types.ts";

/** Public fictional credentials for this local lab only. Never reuse real passwords. */
export function createSeed(): { users: readonly UserRecord[]; posts: readonly Readonly<Post>[] } {
  const users: UserRecord[] = [
    { id: "user-a", name: "사용자 A", role: "user", ...passwordRecord("practice-a") },
    { id: "user-b", name: "사용자 B", role: "user", ...passwordRecord("practice-b") },
    { id: "admin", name: "관리자", role: "admin", ...passwordRecord("practice-admin") },
  ];
  const createdAt = "2026-01-01T00:00:00.000Z";
  const posts: Post[] = [
    { id: 101, ownerId: "user-a", title: "A의 개인 여행 메모", body: "사용자 A만 읽을 수 있는 가상 여행 계획입니다.", visibility: "private", createdAt },
    { id: 102, ownerId: "user-b", title: "B의 개인 독서 메모", body: "사용자 B만 읽을 수 있는 가상 독서 기록입니다.", visibility: "private", createdAt },
    { id: 103, ownerId: "admin", title: "관리자의 개인 메모", body: "관리자 계정 소유의 가상 비공개 기록입니다.", visibility: "private", createdAt },
    { id: 201, ownerId: "user-a", title: "동네 산책 코스를 소개합니다", body: "강변을 따라 걷는 산책 코스를 공유합니다. 모든 내용은 실습용 가상 데이터입니다.", visibility: "public", createdAt },
    { id: 202, ownerId: "user-b", title: "함께 읽고 싶은 책", body: "이번 주에는 짧은 소설을 읽어보려고 합니다. 여러분의 추천도 궁금합니다.", visibility: "public", createdAt },
  ];
  return { users: users.map(user => Object.freeze(user)), posts: posts.map(post => Object.freeze(post)) };
}
