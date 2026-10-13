import { FileCode2, Folder, FolderOpen } from "lucide-react";
import type { FileAnalysis } from "@/types/analysis";

interface RepositoryTreeProps {
  files: FileAnalysis[];
  selectedPath?: string;
  rootName?: string;
}

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  file?: FileAnalysis;
}

function buildTree(files: FileAnalysis[], rootName: string): TreeNode {
  const root: TreeNode = { name: rootName, path: "", children: new Map() };
  for (const file of files) {
    let cursor = root;
    for (const part of file.path.split("/")) {
      const childPath = cursor.path ? `${cursor.path}/${part}` : part;
      if (!cursor.children.has(part)) cursor.children.set(part, { name: part, path: childPath, children: new Map() });
      cursor = cursor.children.get(part)!;
    }
    cursor.file = file;
  }
  return root;
}

function TreeBranch({ node, selectedPath, depth = 0 }: { node: TreeNode; selectedPath?: string; depth?: number }) {
  const isFile = Boolean(node.file);
  return (
    <li>
      <div className={`tree-row ${selectedPath === node.path ? "selected" : ""}`} style={{ paddingLeft: `${depth * 14 + 8}px` }}>
        {isFile ? <FileCode2 size={14} /> : depth === 0 ? <FolderOpen size={14} /> : <Folder size={14} />}
        <span>{node.name}</span>
      </div>
      {node.children.size > 0 && (
        <ul>{[...node.children.values()].map((child) => <TreeBranch key={child.path} node={child} selectedPath={selectedPath} depth={depth + 1} />)}</ul>
      )}
    </li>
  );
}

export function RepositoryTree({ files, selectedPath, rootName = "sample-repository" }: RepositoryTreeProps) {
  return <ul className="repository-tree"><TreeBranch node={buildTree(files, rootName)} selectedPath={selectedPath} /></ul>;
}
