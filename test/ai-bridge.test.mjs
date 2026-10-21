import test from 'node:test';import assert from 'node:assert/strict';import { once } from 'node:events';import { mkdtempSync } from 'node:fs';import { tmpdir } from 'node:os';import { join } from 'node:path';import { WebSocket } from 'ws';import { createApp } from '../server/main.mjs';
test('확장 일회용 연결·인증·웹 작업 결과·연결 해제',async()=>{
  const port=18766,base=`http://127.0.0.1:${port}`,ext='chrome-extension://'+'a'.repeat(32);
  const app=createApp({port,dataDir:mkdtempSync(join(tmpdir(),'jipilsil-bridge-'))});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));let ws;
  try{
    const {token}=await(await fetch(base+'/api/session')).json();const headers={'X-Jipilsil-Token':token,'Content-Type':'application/json'};
    const {code}=await(await fetch(base+'/api/extension/code',{method:'POST',headers,body:'{}'})).json();
    const pair=()=>fetch(base+'/api/extension/pair',{method:'POST',headers:{'Content-Type':'application/json',Origin:ext},body:JSON.stringify({code})});
    const paired=await pair();assert.equal(paired.status,200);const bridgeToken=(await paired.json()).token;assert.equal((await pair()).status,403);
    ws=new WebSocket(`ws://127.0.0.1:${port}/bridge`,{origin:ext});await once(ws,'open');const connected=once(ws,'message');ws.send(JSON.stringify({type:'hello',token:bridgeToken}));assert.equal(JSON.parse((await connected)[0]).type,'connected');
    ws.send(JSON.stringify({type:'capabilities',providers:{gemini:{status:'ready'}}}));
    const request=once(ws,'message');const result=app.providers.run('gemini','한국어 질문',new AbortController().signal);const message=JSON.parse((await request)[0]);assert.equal(message.prompt,'한국어 질문');
    ws.send(JSON.stringify({type:'result',taskId:message.taskId,text:'새로운 답변\n\n문단'}));assert.equal(await result,'새로운 답변\n\n문단');
    const backup=await(await fetch(base+'/api/backup',{headers})).json();assert.ok(!JSON.stringify(backup).includes(bridgeToken));
    const closed=once(ws,'close');await fetch(base+'/api/extension/revoke',{method:'POST',headers,body:'{}'});await closed;assert.equal(app.providers.bridge,null);
  }finally{ws?.terminate();await app.close();}
});
