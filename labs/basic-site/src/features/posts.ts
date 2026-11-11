import { HttpError } from "../http.ts";
import type { Store } from "../store.ts";
import type { Post, User } from "../types.ts";

export function canReadPost(user: User | undefined, post: Readonly<Post>) {
  return post.visibility === "public" || post.ownerId === user?.id;
}
export function listPosts(store: Store, user: User | undefined) {
  // Do not expose private titles, owner metadata or bodies through the list.
  return store.posts.filter(post => canReadPost(user, post)).map(post => ({
    id: post.id, ownerId: post.ownerId, title: post.title, visibility: post.visibility, createdAt: post.createdAt,
  }));
}
export function getPost(store: Store, user: User | undefined, id: number) {
  const post = store.posts.find(value => value.id === id);
  if (!post) throw new HttpError(404, "NOT_FOUND", "게시글을 찾을 수 없습니다.");
  if (!canReadPost(user, post)) {
    if (!user) throw new HttpError(401, "LOGIN_REQUIRED", "비공개 게시글은 로그인 후 조회할 수 있습니다.");
    throw new HttpError(403, "FORBIDDEN", "본인 소유의 비공개 게시글만 읽을 수 있습니다.");
  }
  return post;
}

/** Deliberate IDOR: the local lab route checks activation; ownership is omitted here. */
export function getVulnerablePost(store: Store, user: User | undefined, id: number) {
  if (!user) throw new HttpError(401, "LOGIN_REQUIRED", "실습 API는 로그인 후 사용할 수 있습니다.");
  const post = store.posts.find(value => value.id === id);
  if (!post) throw new HttpError(404, "NOT_FOUND", "게시글을 찾을 수 없습니다.");
  return post;
}
