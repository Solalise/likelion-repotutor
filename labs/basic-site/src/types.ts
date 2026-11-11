export type User = { id: string; name: string; role: "user" | "admin" };
export type UserRecord = User & { salt: string; passwordHash: string };
export type Post = {
  id: number;
  ownerId: string;
  title: string;
  body: string;
  visibility: "public" | "private";
  createdAt: string;
};
