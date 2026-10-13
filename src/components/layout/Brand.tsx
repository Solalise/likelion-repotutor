import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="RepoTutor 홈">
      <span className="brand-mark">R</span>
      <span>RepoTutor</span>
    </Link>
  );
}
