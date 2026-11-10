import type { ReactEventBinding } from "@/types/analysis";

// A deliberate React DOM subset. Other props remain findings, never invented events.
const EVENTS = new Map<string, { type: NonNullable<ReactEventBinding["eventType"]>; phase: "bubble" | "capture" }>([
  ["onClick", { type: "click", phase: "bubble" }], ["onClickCapture", { type: "click", phase: "capture" }],
  ["onSubmit", { type: "submit", phase: "bubble" }], ["onSubmitCapture", { type: "submit", phase: "capture" }],
  ["onChange", { type: "change", phase: "bubble" }], ["onChangeCapture", { type: "change", phase: "capture" }],
]);
const DOM_TAGS = new Set(("a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup "
  + "data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html "
  + "i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p picture pre progress "
  + "q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead "
  + "time title tr track u ul var video wbr svg g path circle ellipse line polygon polyline rect text tspan defs symbol use foreignObject").split(" "));

export function reactEventDescriptor(name: string) { return EVENTS.get(name); }
export function reactElementKind(name: string): ReactEventBinding["element"]["kind"] {
  if (DOM_TAGS.has(name)) return "intrinsic";
  if (name.includes(":")) return "namespaced";
  if (name.includes("-")) return "custom-element";
  if (/^[A-Z]/.test(name) || name.includes(".")) return "component";
  return "unknown";
}

