/** Error-only marker. No boolean predicates, SQL statements, delays or extraction. */
export const safeSqliProbe = {
  id: "quote-marker-v1",
  value: "vulnlab-probe'",
  label: "고정 따옴표 마커 · 오류 관찰용",
} as const;

/** The baseline is plain synthetic lookup text; arbitrary SQL is never accepted. */
export function isSafeSqliPair(baseline: string, test: string): boolean {
  return /^[A-Za-z0-9_]{1,128}$/.test(baseline) && test === safeSqliProbe.value;
}
