import { Node, SyntaxKind } from "ts-morph";
export type RelationKind = "native-tag" | "builtin" | "react-hook" | "external-library" | "internal-unresolved";
const tags = new Set("a article aside audio b body br button canvas circle clipPath code defs div ellipse em fieldset footer foreignObject form g h1 h2 h3 head header hr html i iframe image img input label li line linearGradient link main mask nav ol option p path pattern polygon polyline pre rect section select small span stop strong style sub sup svg symbol table tbody td text textarea th thead title tr tspan ul use video".split(" "));
const globals = new Set(["Math", "JSON", "Object", "Array", "String", "Number", "Boolean", "Date", "Promise", "RegExp", "Map", "Set", "console", "document", "window", "fetch", "parseInt", "parseFloat", "encodeURIComponent", "decodeURIComponent", "setTimeout", "clearTimeout"]);
export function relationKind(expression: Node, component = false): RelationKind {
  if (component && tags.has(expression.getText())) return "native-tag";
  let root = expression;
  while (Node.isPropertyAccessExpression(root)) root = root.getExpression();
  const definitions = root.getSymbol()?.getDeclarations() ?? [];
  for (const definition of definitions) {
    const statement = definition.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
    const source = statement?.getModuleSpecifierValue();
    if (source && !source.startsWith(".") && !source.startsWith("@/")) return source === "react" && /^use[A-Z]/.test(expression.getText()) ? "react-hook" : "external-library";
  }
  if (globals.has(root.getText()) && definitions.every(d => d.getSourceFile().isDeclarationFile())) return "builtin";
  return "internal-unresolved";
}
