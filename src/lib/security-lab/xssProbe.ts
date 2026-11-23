/** Inert punctuation marker: no tag name, executable code, handler or URL. */
export const safeXssProbe = { id: "xss-inert-marker-v1", baseline: "VULNLAB_XSS_CONTROL", value: "VULNLAB_XSS_V1_<>&\"'_END", label: "고정 비실행 HTML 인코딩 마커" } as const;
export const isSafeXssPair = (baseline: string, test: string) => baseline === safeXssProbe.baseline && test === safeXssProbe.value;
