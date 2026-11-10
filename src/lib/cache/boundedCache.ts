/** Process-local LRU. Budget is serialized UTF-8 bytes, not V8 heap/RSS. */
export class BoundedCache<T> {
  private entries = new Map<string, { value:T; bytes:number; expires:number }>();
  private used=0;
  hits=0; misses=0; evictions=0;
  constructor(readonly maxBytes:number,readonly maxEntries:number,readonly ttlMs:number,private clock=Date.now) {}
  get(key:string):T|undefined {
    const item=this.entries.get(key);
    if(!item){this.misses++;return;}
    if(item.expires<=this.clock()){this.delete(key);this.misses++;return;}
    this.entries.delete(key);this.entries.set(key,item);this.hits++;return item.value;
  }
  set(key:string,value:T):boolean {
    const bytes=Buffer.byteLength(JSON.stringify(value),"utf8");this.delete(key);
    if(bytes>this.maxBytes) return false;
    for(const [id,item] of this.entries) if(item.expires<=this.clock()) this.delete(id);
    while(this.used+bytes>this.maxBytes||this.entries.size>=this.maxEntries){this.delete(this.entries.keys().next().value!);this.evictions++;}
    this.entries.set(key,{value,bytes,expires:this.clock()+this.ttlMs});this.used+=bytes;return true;
  }
  delete(key:string){const item=this.entries.get(key);if(item){this.used-=item.bytes;this.entries.delete(key);}}
  deletePrefix(prefix:string){for(const key of this.entries.keys())if(key.startsWith(prefix))this.delete(key);}
  keys(){return [...this.entries.keys()];}
  clear(){this.entries.clear();this.used=0;this.hits=0;this.misses=0;this.evictions=0;}
  stats(){return {entries:this.entries.size,serializedBytes:this.used,maxBytes:this.maxBytes,maxEntries:this.maxEntries,hits:this.hits,misses:this.misses,evictions:this.evictions};}
}
