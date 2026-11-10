import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import type { RepositoryEntryPoint } from "@/types/analysis";
import type { FunctionControlFlow } from "@/types/controlFlow";
import type { DatabaseAnalysis } from "@/types/database";
import type { ResponseCreation, ResponseDataSource, ResponseReturn, ServerResponseAnalysis } from "@/types/response";
import type { HttpValueEvidence } from "@/types/http";
import { createResponseMutationCheck, definitionBeforeUse, localConst, numericStatus, responseContext, responseEvidence, responseId, unwrapResponseValue } from "./responseValues";

function constructorProof(node:Node):HttpValueEvidence[]|undefined {
  node=unwrapResponseValue(node);
  if(Node.isIdentifier(node)&&node.getText()==="Response"&&!(node.getSymbol()?.getDeclarations()??[]).some(item=>!item.getSourceFile().isDeclarationFile())) return [responseEvidence(node)];
  if(Node.isIdentifier(node)) {
    const declaration=(node.getSymbol()?.getDeclarations()??[]).find(item=>Node.isImportSpecifier(item)&&item.getName()==="NextResponse"&&!item.isTypeOnly()
      &&!item.getFirstAncestorByKind(SyntaxKind.ImportClause)?.isTypeOnly()&&item.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue()==="next/server");
    if(declaration) return [responseEvidence(declaration),responseEvidence(node)];
  }
  return undefined;
}
function creationSyntax(node:Node) {
  if(Node.isCallExpression(node)) {
    const expression=node.getExpression();
    if(!Node.isPropertyAccessExpression(expression)||expression.getName()!=="json") return;
    const receiver=expression.getExpression(),proof=constructorProof(receiver);
    if(!proof&&!/^(NextResponse|Response)$/.test(receiver.getText())) return;
    return {pattern:receiver.getText()==="Response"?"response-json" as const:"next-json" as const,proof:node.hasQuestionDotToken()||expression.hasQuestionDotToken()?undefined:proof,args:node.getArguments()};
  }
  if(Node.isNewExpression(node)) {
    const receiver=node.getExpression(),proof=constructorProof(receiver);
    if(!proof&&receiver.getText()!=="Response") return;
    // NextResponse extends Response, but only new Response is in this version's contract.
    if(receiver.getText()!=="Response") return;
    return {pattern:"response-constructor" as const,proof,args:node.getArguments()};
  }
}
function statusOf(options:Node|undefined):Pick<ResponseCreation,"statusCode"|"statusResolution"|"statusEvidence"> {
  if(!options) return {statusCode:200,statusResolution:"default",statusEvidence:[]};
  options=unwrapResponseValue(options);
  if(!Node.isObjectLiteralExpression(options)) return {statusResolution:"unresolved",statusEvidence:[responseEvidence(options)]};
  let status:Node|undefined;
  for(const property of options.getProperties()) {
    if(Node.isSpreadAssignment(property)||Node.isComputedPropertyName(property.getNameNode())) return {statusResolution:"unresolved",statusEvidence:[responseEvidence(options)]};
    const name=property.getNameNode(),key=Node.isStringLiteral(name)?name.getLiteralValue():name.getText();
    if(key!=="status") continue;
    if(Node.isPropertyAssignment(property)) status=property.getInitializer();
    else if(Node.isShorthandPropertyAssignment(property)) status=property.getNameNode();
    else return {statusResolution:"unresolved",statusEvidence:[responseEvidence(property)]};
  }
  if(!status) return {statusCode:200,statusResolution:"default",statusEvidence:[]};
  const value=numericStatus(status);
  return value&&Number.isInteger(value.value)&&value.value>=200&&value.value<=599
    ?{statusCode:value.value,statusResolution:"static",statusEvidence:value.evidence}:{statusResolution:"unresolved",statusEvidence:[responseEvidence(status)]};
}

export function collectServerResponses(sources:Array<{path:string;sourceFile:SourceFile}>,context:{
  entries:RepositoryEntryPoint[]; controlFlows:FunctionControlFlow[]; database:DatabaseAnalysis;
  resolveOwner:(node:Node)=>string|undefined;
}):ServerResponseAnalysis {
  const result:ServerResponseAnalysis={creations:[],returns:[],serverContexts:[],limitations:[
    {code:"static-response-only",message:"Creation and local return references do not establish runtime delivery, status, query success, or effective completion through finally."},
    {code:"local-lineage-only",message:"Only supported same-function const definitions and static object fields are traced. Mutable values, transforms, inter-function returns, wrapper responses and transaction results remain unresolved."},
  ]};
  const cfgs=new Map(context.controlFlows.map(cfg=>[cfg.ownerFunctionId,cfg]));
  const allNodes=sources.flatMap(item=>item.sourceFile.getDescendants()),mutated=createResponseMutationCheck(allNodes);
  const creations=new Map<Node,ResponseCreation>();
  const dbCalls=new Map(context.database.sites.map(site=>[JSON.stringify([site.location.filePath,site.location.startOffset,site.location.endOffset]),site]));
  for(const node of allNodes) {
    const syntax=creationSyntax(node);
    if(!syntax) continue;
    const owner=context.resolveOwner(node);
    if(!owner) continue;
    const site:ResponseCreation={id:responseId("response-creation",node),ownerFunctionId:owner,location:responseEvidence(node).location,sourceCode:node.getText(),
      pattern:syntax.pattern,constructorResolution:syntax.proof?"confirmed":"unresolved",constructorEvidence:syntax.proof??[],
      ...(syntax.proof?statusOf(syntax.args[1]):{statusResolution:"unresolved" as const,statusEvidence:[]}),context:responseContext(cfgs.get(owner),node),dataSources:[]};
    let count=0;
    function trace(expression:Node|undefined,path:string[],evidence:HttpValueEvidence[]=[],seen=new Set<Node>(),sourcePropertyPath:string[]=[]):ResponseDataSource[] {
      if(!expression) return [];
      const original=expression,proof=responseEvidence(original);
      const unknown=(reason:string):ResponseDataSource[]=>[{id:`response-source:${JSON.stringify([site.id,path,original.getStart(),sourcePropertyPath])}`,fieldPath:path,expression:proof,kind:"unknown",status:"unresolved",reason,evidence}];
      if(++count>128||seen.size>24||seen.has(expression)) return unknown("lineage-limit");
      const next=new Set(seen).add(expression); expression=unwrapResponseValue(expression);
      if(Node.isIdentifier(expression)) {
        const declaration=localConst(expression,owner!,context.resolveOwner);
        if(!declaration||mutated(declaration)) return unknown("mutable-or-nonlocal-value");
        if(!definitionBeforeUse(cfgs.get(owner!),declaration,original===node?node:original)) return unknown("definition-not-established-before-use");
        return trace(declaration.getInitializer(),path,[...evidence,proof,responseEvidence(declaration)],next,sourcePropertyPath);
      }
      if(Node.isAwaitExpression(expression)) {
        const operand=unwrapResponseValue(expression.getExpression()),location=responseEvidence(operand).location;
        const db=dbCalls.get(JSON.stringify([location.filePath,location.startOffset,location.endOffset]));
        if(db&&db.ownerFunctionId===owner&&db.operation!=="$transaction") return [{id:`response-source:${JSON.stringify([site.id,path,original.getStart(),sourcePropertyPath])}`,fieldPath:path,
          expression:proof,kind:"database-result",status:db.status==="confirmed"?"confirmed":"unresolved",reason:db.status==="confirmed"?undefined:"database-access-unverified",databaseSiteId:db.id,sourcePropertyPath,evidence:[...evidence,proof]}];
        return unknown("awaited-source-unresolved");
      }
      if(Node.isObjectLiteralExpression(expression)) {
        const properties=expression.getProperties(),keys:string[]=[];
        for(const property of properties) {
          if(Node.isSpreadAssignment(property)||Node.isComputedPropertyName(property.getNameNode())||(!Node.isPropertyAssignment(property)&&!Node.isShorthandPropertyAssignment(property))) return unknown("unsupported-object-shape");
          const name=property.getNameNode(); const key=Node.isStringLiteral(name)||Node.isNumericLiteral(name)?String(name.getLiteralValue()):name.getText();
          if(key==="__proto__"&&Node.isPropertyAssignment(property)) return unknown("prototype-setter-is-not-response-field");
          if(keys.includes(key)) return unknown("duplicate-object-key"); keys.push(key);
        }
        const selected=sourcePropertyPath.length?keys.indexOf(sourcePropertyPath[0]):-1;
        if(sourcePropertyPath.length&&selected<0) return unknown("object-field-unresolved");
        const value=(property:Node)=>Node.isPropertyAssignment(property)?property.getInitializer():Node.isShorthandPropertyAssignment(property)?property.getNameNode():undefined;
        if(sourcePropertyPath.length) return trace(value(properties[selected]),path,[...evidence,proof],next,sourcePropertyPath.slice(1));
        return properties.flatMap((property,index)=>trace(value(property),[...path,keys[index]],[...evidence,proof],next));
      }
      if(Node.isPropertyAccessExpression(expression)) return trace(expression.getExpression(),path,[...evidence,proof],next,[expression.getName(),...sourcePropertyPath]);
      if(Node.isStringLiteral(expression)||Node.isNoSubstitutionTemplateLiteral(expression)||Node.isNumericLiteral(expression)||[SyntaxKind.TrueKeyword,SyntaxKind.FalseKeyword,SyntaxKind.NullKeyword].includes(expression.getKind())) {
        if(sourcePropertyPath.length) return unknown("property-source-unresolved");
        return [{id:`response-source:${JSON.stringify([site.id,path,original.getStart()])}`,fieldPath:path,expression:proof,kind:"literal",status:"confirmed",evidence:[...evidence,proof]}];
      }
      return unknown(Node.isCallExpression(expression)?"call-result-or-transform-unresolved":"unsupported-value-expression");
    }
    site.dataSources=trace(syntax.args[0],[]);
    creations.set(node,site); result.creations.push(site);
  }
  const entryIds=new Set(context.entries.map(entry=>entry.nodeId));
  for(const entry of context.entries.filter(entry=>entry.kind==="api"&&entry.framework==="next-app")) {
    let visits=0;
    function visit(owner:string,callSiteIds:string[],stack:Set<string>) {
      if(stack.has(owner)||++visits>128||callSiteIds.length>12) {
        if(!result.limitations.some(item=>item.code==="server-traversal-limited")) result.limitations.push({code:"server-traversal-limited",message:"Cycles or the depth/visit budget exclude paths; missing response associations do not establish absence."});
        return;
      }
      result.serverContexts.push({id:`response-server:${JSON.stringify([entry,owner,callSiteIds])}`,ownerFunctionId:owner,entryPoint:{...entry},callSiteIds});
      const next=new Set(stack).add(owner);
      for(const call of cfgs.get(owner)?.callSites??[]) if(call.targetResolution==="resolved"&&call.targetNodeId&&!entryIds.has(call.targetNodeId)) visit(call.targetNodeId,[...callSiteIds,call.id],next);
    }
    visit(entry.nodeId,[],new Set());
  }
  const relevantOwners=new Set([...result.serverContexts.map(item=>item.ownerFunctionId),...result.creations.map(item=>item.ownerFunctionId)]);
  function responseReference(expression:Node|undefined,owner:string,use:Node,seen=new Set<Node>(),evidence:HttpValueEvidence[]=[]):{site?:ResponseCreation;evidence:HttpValueEvidence[];reason?:string} {
    if(!expression||seen.has(expression)||seen.size>24) return {evidence,reason:"return-value-unresolved"};
    const next=new Set(seen).add(expression); expression=unwrapResponseValue(expression);
    if(Node.isAwaitExpression(expression)) return responseReference(expression.getExpression(),owner,use,next,evidence);
    const creation=creations.get(expression);
    if(creation) return creation.constructorResolution==="confirmed"?{site:creation,evidence:[...evidence,responseEvidence(expression)]}:{evidence,reason:"response-constructor-unverified"};
    if(Node.isIdentifier(expression)) {
      const declaration=localConst(expression,owner,context.resolveOwner);
      if(!declaration||mutated(declaration)) return {evidence,reason:"mutable-or-nonlocal-response"};
      if(!definitionBeforeUse(cfgs.get(owner),declaration,use)) return {evidence,reason:"response-definition-not-established"};
      return responseReference(declaration.getInitializer(),owner,declaration,next,[...evidence,responseEvidence(expression),responseEvidence(declaration)]);
    }
    return {evidence,reason:"return-value-unresolved"};
  }
  for(const node of allNodes) {
    let expression:Node|undefined,implicit=false;
    if(Node.isReturnStatement(node)) expression=node.getExpression();
    else if(Node.isArrowFunction(node)&&!Node.isBlock(node.getBody())) { expression=node.getBody(); implicit=true; }
    else continue;
    const owner=context.resolveOwner(node); if(!owner||!relevantOwners.has(owner)) continue;
    const actualOwner=implicit?context.resolveOwner(expression!):owner;
    if(!actualOwner) continue;
    const use=implicit?expression!:node,resolved=responseReference(expression,actualOwner,use);
    const item:ResponseReturn={id:responseId("response-return",use),ownerFunctionId:actualOwner,location:responseEvidence(use).location,sourceCode:use.getText(),implicit,
      context:responseContext(cfgs.get(actualOwner),use),responseSiteId:resolved.site?.id,resolution:resolved.site?"confirmed":"unresolved",reason:resolved.reason,evidence:resolved.evidence};
    result.returns.push(item);
  }
  result.returns=result.returns.filter(item=>relevantOwners.has(item.ownerFunctionId));
  result.creations.sort((a,b)=>a.id.localeCompare(b.id)); result.returns.sort((a,b)=>a.id.localeCompare(b.id)); result.serverContexts.sort((a,b)=>a.id.localeCompare(b.id));
  return result;
}
