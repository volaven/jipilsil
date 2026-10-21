import test from 'node:test';import assert from 'node:assert/strict';import { mkdtempSync } from 'node:fs';import { tmpdir } from 'node:os';import { join } from 'node:path';import { createApp } from '../server/main.mjs';
test('HTTP 인증·출처 차단·작품 이력·SSE·복원·정적 파일',async()=>{
  const port=18765;const app=createApp({port,dataDir:mkdtempSync(join(tmpdir(),'jipilsil-http-')),providers:{status:async()=>({codex:{ready:true}}),run:async()=> '테스트 의견\n\n새 장면'}});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));const base=`http://127.0.0.1:${port}`;
  try{
    assert.equal((await fetch(base+'/api/health')).status,401);assert.equal((await fetch(base+'/api/session',{headers:{Origin:'https://evil.example'}})).status,403);
    assert.equal((await fetch(base+'/.git/config')).status,404);assert.equal((await fetch(base+'/index.html')).status,200);assert.equal((await fetch(base+'/img/fighting.webp')).status,200);
    const {token}=await (await fetch(base+'/api/session')).json();const headers={'X-Jipilsil-Token':token,'Content-Type':'application/json'};
    const snapshot={workId:'A',title:'A',cast:[],notes:[],episodes:[{id:'e',title:'시작',text:'한글\n\n문단'}]};
    const r=await fetch(base+'/api/jobs',{method:'POST',headers,body:JSON.stringify({kind:'council',snapshot,providers:['codex']})});assert.equal(r.status,202);const job=await r.json();
    const stream=await fetch(base+`/api/jobs/${job.id}/events`,{headers});assert.ok(stream.headers.get('Content-Type').includes('text/event-stream'));const reader=stream.body.getReader();assert.ok(new TextDecoder().decode((await reader.read()).value).includes(job.id));await reader.cancel();
    const history=await(await fetch(base+'/api/works/A/history',{headers})).json();assert.equal(history.length,1);assert.equal(history[0].snapshot,undefined);
    assert.deepEqual(await(await fetch(base+'/api/works/B/history',{headers})).json(),[]);
    assert.equal((await fetch(base+'/api/jobs',{method:'POST',headers,body:'{}'})).status,400);
    const backup=await(await fetch(base+'/api/backup',{headers})).json();assert.equal((await fetch(base+'/api/restore',{method:'POST',headers,body:JSON.stringify(backup)})).status,200);
    assert.equal((await fetch(base+'/api/extension/pair',{method:'POST',headers,body:'{}'})).status,403);
  }finally{await app.close();}
});
