import { getLabOrder } from "@/lib/security-lab/orders";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return getLabOrder(request, "vulnerable"); }
