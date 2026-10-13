import { login } from "../../services/auth";

export default function LoginPage() {
  const handleLogin = async () => {
    await login({
      email: "learner@repotutor.dev",
      password: "repotutor",
    });
  };

  return <button onClick={handleLogin}>로그인</button>;
}
