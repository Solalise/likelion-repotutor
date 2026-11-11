import http from 'node:http';
import { fileURLToPath } from 'node:url';

export async function createDemoServer(listenPort = 4320) {
  const seen = [];
  const orders = { '101': { id: 101, ownerId: 'A', item: '가상 올리브 노트' }, '102': { id: 102, ownerId: 'B', item: '가상 크림 머그' } };
  const server = http.createServer((req,res) => {
    // Only account label and path; never record Authorization values.
    const account = req.headers.authorization === 'Bearer lab-token-a' ? 'A' : req.headers.authorization === 'Bearer lab-token-b' ? 'B' : undefined;
    seen.push({ account, path: req.url });
    const send = (status, value) => { res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store' }); res.end(JSON.stringify(value)); };
    if (req.method !== 'GET') return send(405, { error: 'METHOD_NOT_ALLOWED' });
    if (!account) return send(401, { error: 'UNAUTHORIZED' });
    if (req.url === '/me') return send(200, { user: { id: account } });
    if (req.url === '/same-me') return send(200, { user: { id: 'A' } });
    const match = req.url.match(/^\/(vulnerable|fixed|unclear|suspected|error-leak|unstructured-leak|redirect)\/orders\/(101|102)$/);
    if (!match) return send(404,{error:'NOT_FOUND'});
    const [,mode,id]=match,order=orders[id];
    if (mode === 'redirect') { res.writeHead(302,{Location:'http://example.com/'}); res.end(); return; }
    if (mode === 'fixed' && order.ownerId !== account) return send(403,{error:'FORBIDDEN'});
    if (mode === 'unclear') return send(200,{order:{id:order.id,item:order.item}});
    if (mode === 'suspected' && order.ownerId !== account) return send(200,{order:{id:order.id,item:'식별 불가'}});
    if (mode === 'error-leak' && order.ownerId !== account) return send(403,{order});
    if (mode === 'unstructured-leak' && order.ownerId !== account) return send(403,{order:{id:{value:102},ownerId:{value:'B'},item:{value:'보호 데이터'}}});
    return send(200,{order});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(listenPort,'127.0.0.1',resolve);});
  return { port:server.address().port,seen,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));} };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const demo=await createDemoServer();console.log(`가상 데이터 전용 예제: http://127.0.0.1:${demo.port}\nGET /me, /vulnerable/orders/{resourceId}, /fixed/orders/{resourceId}\n가상 테스트 계정 설정은 README와 로컬 관리 화면을 참고하세요.`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await demo.close();process.exit(0);});
}
