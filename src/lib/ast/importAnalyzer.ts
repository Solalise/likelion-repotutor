import type { ImportDeclaration } from "ts-morph";
import type { ImportInfo } from "@/types/analysis";

export function analyzeImport(declaration: ImportDeclaration): ImportInfo {
  const bindings = declaration.getNamedImports().map((item) => ({
    local: item.getAliasNode()?.getText() ?? item.getName(),
    imported: item.getName(),
  }));
  const symbols = bindings.map((item) => item.local);
  const defaultImport = declaration.getDefaultImport();
  const namespaceImport = declaration.getNamespaceImport();

  if (defaultImport) { symbols.unshift(defaultImport.getText()); bindings.unshift({ local: defaultImport.getText(), imported: "default" }); }
  if (namespaceImport) { symbols.push(namespaceImport.getText()); bindings.push({ local: namespaceImport.getText(), imported: "*" }); }

  return {
    source: declaration.getModuleSpecifierValue(),
    symbols,
    bindings,
    line: declaration.getStartLineNumber(),
  };
}
