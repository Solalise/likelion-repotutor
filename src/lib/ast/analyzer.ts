import path from "node:path";
import { Node, Project, ScriptTarget, SyntaxKind, type SourceFile } from "ts-morph";
import type { FileAnalysis, FunctionInfo, RepositoryAnalysis, SourceInput } from "@/types/analysis";
import { analyzeCallbackReferences, analyzeCalls, analyzeComponentReferences } from "./callAnalyzer";
import { buildGraph } from "./graphBuilder";
import { analyzeImport } from "./importAnalyzer";
import { normalizePath, symbolNodeId } from "./pathUtils";

function classify(name: string, filePath: string, bodyText: string): FunctionInfo["nodeType"] {
  if (/^(GET|POST|PUT|PATCH|DELETE)$/.test(name) && /(?:^|\/)route\.[jt]s$/.test(filePath)) return "api";
  if (/^[A-Z]/.test(name) && (bodyText.includes("<") || /(?:^|\/)page\.tsx$/.test(filePath))) return "component";
  return "function";
}

function functionInfo(
  name: string,
  filePath: string,
  line: number,
  kind: FunctionInfo["kind"],
  node: Node,
  parentId?: string,
): FunctionInfo {
  return {
    id: symbolNodeId(filePath, name),
    name,
    filePath,
    line,
    kind,
    nodeType: classify(name, filePath, node.getText()),
    calls: analyzeCalls(node),
    componentReferences: analyzeComponentReferences(node),
    callbackReferences: analyzeCallbackReferences(node),
    sourceCode: node.getText(),
    endLine: node.getEndLineNumber(),
    parentId,
  };
}

function getFunctionName(node: Node): string | undefined {
  if (Node.isFunctionDeclaration(node)) return node.getName() ?? (node.isDefaultExport() ? "default" : undefined);
  if (Node.isMethodDeclaration(node)) return node.getName();
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    const declaration = node.getParentIfKind(SyntaxKind.VariableDeclaration);
    return declaration?.getName();
  }
  return undefined;
}

function analyzeFunctions(sourceFile: SourceFile, filePath: string): FunctionInfo[] {
  const results: FunctionInfo[] = [];

  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    const name = declaration.getName() ?? (declaration.isDefaultExport() ? "default" : "anonymous");
    const parentFunction = declaration.getFirstAncestor((ancestor) =>
      Node.isFunctionDeclaration(ancestor)
      || Node.isArrowFunction(ancestor)
      || Node.isFunctionExpression(ancestor)
      || Node.isMethodDeclaration(ancestor),
    );
    const parentName = parentFunction ? getFunctionName(parentFunction) : undefined;
    results.push(functionInfo(
      name,
      filePath,
      declaration.getStartLineNumber(),
      "function",
      declaration,
      parentName ? symbolNodeId(filePath, parentName) : undefined,
    ));
  }

  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const wrappedFunction = Node.isCallExpression(initializer) && initializer.getExpression().getText() === "useCallback"
      ? initializer.getArguments().find((argument) => Node.isArrowFunction(argument) || Node.isFunctionExpression(argument))
      : undefined;
    const functionNode = Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)
      ? initializer
      : wrappedFunction;
    if (!functionNode || (!Node.isArrowFunction(functionNode) && !Node.isFunctionExpression(functionNode))) continue;
    const parentFunction = functionNode.getFirstAncestor((ancestor) =>
      Node.isFunctionDeclaration(ancestor)
      || Node.isArrowFunction(ancestor)
      || Node.isFunctionExpression(ancestor)
      || Node.isMethodDeclaration(ancestor),
    );
    const parentName = parentFunction ? getFunctionName(parentFunction) : undefined;
    results.push(functionInfo(
      declaration.getName(),
      filePath,
      declaration.getStartLineNumber(),
      "arrow",
      functionNode,
      parentName ? symbolNodeId(filePath, parentName) : undefined,
    ));
  }

  for (const method of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
    results.push(functionInfo(method.getName(), filePath, method.getStartLineNumber(), "method", method));
  }

  return results;
}

export function analyzeSourceFiles(inputs: SourceInput[], repository = "sample-repository"): RepositoryAnalysis {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { allowJs: true, jsx: 2, target: ScriptTarget.ESNext },
    skipAddingFilesFromTsConfig: true,
  });

  const sourceFiles = inputs
    .filter((input) => /\.(?:tsx?|jsx?)$/.test(input.path))
    .map((input) => {
      const normalizedPath = normalizePath(input.path);
      return { path: normalizedPath, sourceFile: project.createSourceFile(normalizedPath, input.content, { overwrite: true }) };
    });

  project.resolveSourceFileDependencies();

  const files: FileAnalysis[] = sourceFiles.map(({ path: filePath, sourceFile }) => ({
    path: filePath,
    name: path.posix.basename(filePath),
    sourceCode: sourceFile.getFullText(),
    imports: sourceFile.getImportDeclarations().map(analyzeImport),
    functions: analyzeFunctions(sourceFile, filePath),
  }));
  const graph = buildGraph(files);

  return {
    repository,
    files,
    ...graph,
    stats: { files: files.length, functions: files.flatMap((file) => file.functions).length, relations: graph.edges.length },
  };
}
