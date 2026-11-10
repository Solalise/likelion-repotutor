const pending=new Map<string,Promise<unknown>>();
export class AnalysisCapacityError extends Error {}
/** Coalesce work, never authorization. Every caller checks its own access outside this function. */
export function coalesceAnalysis<T>(key:string,work:()=>T|Promise<T>):Promise<T> {
  const existing=pending.get(key);if(existing)return existing as Promise<T>;
  if(pending.size>=4)return Promise.reject(new AnalysisCapacityError("Analysis capacity reached"));
  const promise=Promise.resolve().then(work);pending.set(key,promise);
  void promise.finally(()=>{if(pending.get(key)===promise)pending.delete(key);}).catch(()=>{});
  return promise;
}
export const analysisWorkPending=(key:string)=>pending.has(key);
