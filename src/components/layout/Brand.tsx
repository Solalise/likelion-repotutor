import Link from "next/link";
import { site } from "@/lib/ui/site";

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label={`${site.name} 홈`}>
      <span className="brand-mark">{site.mark}</span>
      <span>{site.name}</span>
    </Link>
  );
}
