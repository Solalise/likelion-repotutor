import type { ImportDeclaration } from "ts-morph";
import type { ImportInfo } from "@/types/analysis";

export function analyzeImport(declaration: ImportDeclaration): ImportInfo {
  const symbols = declaration.getNamedImports().map((item) => item.getAliasNode()?.getText() ?? item.getName());
  const defaultImport = declaration.getDefaultImport();
  const namespaceImport = declaration.getNamespaceImport();

  if (defaultImport) symbols.unshift(defaultImport.getText());
  if (namespaceImport) symbols.push(namespaceImport.getText());

  return {
    source: declaration.getModuleSpecifierValue(),
    symbols,
    line: declaration.getStartLineNumber(),
  };
}
