import { Node, SyntaxKind, VariableDeclarationKind } from "ts-morph";
import type { FunctionControlFlow } from "@/types/controlFlow";
import type { ResponseContext } from "@/types/response";
import type { HttpValueEvidence } from "@/types/http";
import { requestLocation } from "./staticRequestValues";

export const responseEvidence = (node: Node): HttpValueEvidence => ({location:requestLocation(node),sourceCode:node.getText()});
export const responseId = (kind:string,node:Node) => `${kind}:${JSON.stringify([requestLocation(node).filePath,node.getStart(),node.getEnd()])}`;
export function unwrapResponseValue(node:Node):Node {
  return Node.isParenthesizedExpression(node)||Node.isAsExpression(node)||Node.isSatisfiesExpression(node)||Node.isNonNullExpression(node) ? unwrapResponseValue(node.getExpression()) : node;
}
export function valueDeclaration(node:Node):Node|undefined {
  const symbol=node.getSymbol();
  const declarations=symbol?.getDeclarations()??[];
  if(declarations.some(item=>(Node.isImportSpecifier(item)&&item.isTypeOnly())||(Node.isImportClause(item)&&item.isTypeOnly())||item.getFirstAncestorByKind(SyntaxKind.ImportClause)?.isTypeOnly())) return;
  let items=(symbol?.getAliasedSymbol()??symbol)?.getDeclarations()??[];
  if(items.length===1&&Node.isShorthandPropertyAssignment(items[0])) items=items[0].getValueSymbol()?.getDeclarations()??[];
  return items.length===1?items[0]:undefined;
}
export function localConst(node:Node,owner:string,resolveOwner:(node:Node)=>string|undefined) {
  const declaration=valueDeclaration(node);
  return declaration&&Node.isVariableDeclaration(declaration)&&declaration.getVariableStatement()?.getDeclarationKind()===VariableDeclarationKind.Const
    &&resolveOwner(declaration)===owner ? declaration:undefined;
}
export function responseContext(cfg:FunctionControlFlow|undefined,node:Node):ResponseContext|undefined {
  const statement=cfg?.statements.filter(item=>item.location.startOffset<=node.getStart()&&item.location.endOffset>=node.getEnd())
    .sort((a,b)=>(a.location.endOffset-a.location.startOffset)-(b.location.endOffset-b.location.startOffset))[0];
  if(!cfg||!statement) return;
  const call=cfg.callSites.find(item=>item.location.startOffset===node.getStart()&&item.location.endOffset===node.getEnd());
  return {controlFlowId:cfg.id,statementId:statement.id,callSiteId:call?.id,
    graphNodeIds:cfg.nodes.filter(item=>item.statementId===statement.id).map(item=>item.id),branchPath:statement.branchPath.map(item=>({...item})),
    reachability:statement.reachability,inUnsupportedRegion:statement.kind==="unsupported"||call?.inUnsupportedRegion===true,execution:"not-established"};
}
/** Structural dominance only. Unknown/unsupported/dead regions never establish a value definition. */
export function definitionBeforeUse(cfg:FunctionControlFlow|undefined,definition:Node,use:Node):boolean {
  const from=responseContext(cfg,definition),to=responseContext(cfg,use);
  if(!cfg||!from||!to||from.inUnsupportedRegion||to.inUnsupportedRegion||from.reachability!=="reachable-in-model"||to.reachability!=="reachable-in-model"||definition.getEnd()>use.getStart()) return false;
  if(from.statementId===to.statementId) return false; // complex same-statement expressions are intentionally excluded
  const blocked=new Set(from.graphNodeIds),targets=new Set(to.graphNodeIds),seen=new Set<string>(),queue=[cfg.entryNodeId];
  for(let index=0;index<queue.length;index++) {
    const id=queue[index]; if(seen.has(id)||blocked.has(id)) continue; seen.add(id);
    if(targets.has(id)) return false;
    queue.push(...cfg.edges.filter(edge=>edge.source===id).map(edge=>edge.target));
  }
  return true;
}
export function createResponseMutationCheck(nodes:Node[]) {
  const writes:Node[]=[];
  for(const node of nodes) {
    if(Node.isBinaryExpression(node)&&/^(?:=|\+=|-=|\*=|\/=|\?\?=|&&=|\|\|=|\*\*=|%=|&=|\|=|\^=|<<=|>>=|>>>=)$/.test(node.getOperatorToken().getText())) writes.push(node.getLeft());
    if((Node.isPrefixUnaryExpression(node)||Node.isPostfixUnaryExpression(node))&&[SyntaxKind.PlusPlusToken,SyntaxKind.MinusMinusToken].includes(node.getOperatorToken())) writes.push(node.getOperand());
    if(Node.isDeleteExpression(node)) writes.push(node.getExpression());
  }
  return (declaration:Node) => writes.some(write=>{
    let root=unwrapResponseValue(write);
    while(Node.isPropertyAccessExpression(root)||Node.isElementAccessExpression(root)) root=unwrapResponseValue(root.getExpression());
    const seen=new Set<Node>();
    function aliases(node:Node):boolean {
      if(seen.has(node)||seen.size>24) return false; seen.add(node);
      node=unwrapResponseValue(node);
      if(!Node.isIdentifier(node)) return false;
      const item=valueDeclaration(node);
      return item===declaration||Boolean(item&&Node.isVariableDeclaration(item)&&item.getInitializer()&&aliases(item.getInitializer()!));
    }
    return aliases(root);
  });
}
export function numericStatus(node:Node|undefined,seen=new Set<Node>()):{value:number;evidence:HttpValueEvidence[]}|undefined {
  if(!node||seen.has(node)||seen.size>24) return;
  const next=new Set(seen).add(node); node=unwrapResponseValue(node);
  if(Node.isNumericLiteral(node)) return {value:node.getLiteralValue(),evidence:[responseEvidence(node)]};
  if(Node.isIdentifier(node)) {
    const declaration=valueDeclaration(node);
    if(declaration&&Node.isVariableDeclaration(declaration)&&declaration.getVariableStatement()?.getDeclarationKind()===VariableDeclarationKind.Const) {
      const resolved=numericStatus(declaration.getInitializer(),next);
      if(resolved) return {value:resolved.value,evidence:[responseEvidence(node),responseEvidence(declaration),...resolved.evidence]};
    }
  }
}
