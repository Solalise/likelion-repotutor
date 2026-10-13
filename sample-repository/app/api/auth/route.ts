import { findUser } from "../../../repositories/userRepository";

interface LoginRequest {
  email: string;
  password: string;
}

export async function POST(request: Request) {
  const input = await request.json() as LoginRequest;
  const user = findUser(input.email);

  if (!user) {
    return Response.json({ ok: false, message: "사용자를 찾을 수 없습니다." }, { status: 401 });
  }

  return Response.json({ ok: true, user });
}
