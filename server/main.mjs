import http from 'node:http';
import { WebSocketServer } from 'ws';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, extname } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Store } from './store.mjs';
import { Providers } from './providers.mjs';
import { Jobs, publicJob } from './jobs.mjs';
import { configOf, DEFAULT_CONFIG } from './context.mjs';

export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function restoreAssets(root=ROOT) {
  for(const [source,target] of [['icons-b64','icons'],['img-b64','img']]){
    const {readdirSync}=process.getBuiltinModule('node:fs');mkdirSync(join(root,target),{recursive:true});
    for(const name of readdirSync(join(root,source)))if(name.endsWith('.b64')){
      const dest=join(root,target,name.slice(0,-4));if(!existsSync(dest))writeFileSync(dest,Buffer.from(readFileSync(join(root,source,name),'utf8'),'base64'));
    }
  }
}
export function createApp({port=8765,dataDir=process.env.JIPILSIL_DATA_DIR||join(process.env.LOCALAPPDATA||process.env.HOME||ROOT,'Jipilsil'),providers:injected}={}) {
  restoreAssets();const store=new Store(dataDir);const providers=injected||new Providers(dataDir);const jobs=new Jobs(store,providers);
  const session=randomBytes(32).toString('hex');const origin=`http://127.0.0.1:${port}`;let pair=null,capCache=null,capAt=0;
  const wsServer=new WebSocketServer({noServer:true,maxPayload:4*1024*1024});
  const send=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  const equal=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
  const body=async req=>{let bytes=0;const limit=req.url==='/api/restore'?250:30;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>limit*1024*1024)throw new Error(`요청 크기 한도 ${limit}MB를 넘었습니다.`);chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');};
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,origin);const p=url.pathname;
      if(req.headers.host!==`127.0.0.1:${port}`){send(res,403,{error:'호스트가 허용되지 않습니다.'});return;}
      const requestOrigin=req.headers.origin;
      const extOrigin=typeof requestOrigin==='string'&&/^chrome-extension:\/\/[a-p]{32}$/.test(requestOrigin);
      if(requestOrigin&&requestOrigin!==origin&&!(p==='/api/extension/pair'&&extOrigin)){send(res,403,{error:'요청 출처가 허용되지 않습니다.'});return;}
      if(p==='/api/session'&&req.method==='GET'){
        if(req.headers['sec-fetch-site']==='cross-site'){send(res,403,{error:'다른 사이트에서 연결할 수 없습니다.'});return;}
        send(res,200,{token:session});return;
      }
      if(p==='/api/extension/pair'&&req.method==='POST'){
        if(!extOrigin){send(res,403,{error:'Chrome 확장에서 연결하세요.'});return;}
        const b=await body(req);if(!pair||Date.now()>pair.expires||pair.attempts++>=10||!equal(String(b.code||''),pair.code)){send(res,403,{error:'연결 코드가 틀렸거나 만료되었습니다.'});return;}
        const token=randomBytes(32).toString('hex');store.put('secret','extension',{token,origin:requestOrigin});pair=null;
        providers.bridge?.close();send(res,200,{token});return;
      }
      if(p.startsWith('/api/')){
        if(!equal(req.headers['x-jipilsil-token'],session)){send(res,401,{error:'앱 연결이 만료되었습니다. 새로고침하세요.'});return;}
        if(p==='/api/health'&&req.method==='GET'){
          if(!capCache||Date.now()-capAt>15000){capCache=await providers.status();capAt=Date.now();}
          send(res,200,{app:'jipilsil-ai',version:1,providers:capCache,dataDir,extensionDir:join(ROOT,'extension')});return;
        }
        if(p==='/api/extension/code'&&req.method==='POST'){
          pair={code:String(Math.floor(10000000+Math.random()*90000000)),expires:Date.now()+300000,attempts:0};send(res,200,{code:pair.code,expires:pair.expires});return;
        }
        if(p==='/api/extension/revoke'&&req.method==='POST'){store.put('secret','extension',{});providers.bridge?.close();capAt=0;send(res,200,{ok:true});return;}
        if(p==='/api/backup'&&req.method==='GET'){send(res,200,store.export());return;}
        if(p==='/api/restore'&&req.method==='POST'){send(res,200,{count:store.restore(await body(req))});return;}
        const work=p.match(/^\/api\/works\/([^/]+)\/(config|history)$/);
        if(work){const id=decodeURIComponent(work[1]);if(work[2]==='config'){
          if(req.method==='GET'){send(res,200,store.get('config',id)||DEFAULT_CONFIG);return;}
          if(req.method==='PUT'){send(res,200,store.put('config',id,configOf(await body(req))));return;}
        }else if(req.method==='GET'){send(res,200,store.all('job').filter(j=>j.workId===id).map(publicJob).sort((a,b)=>b.createdAt-a.createdAt));return;}}
        if(p==='/api/jobs'&&req.method==='POST'){send(res,202,publicJob(jobs.create(await body(req))));return;}
        const route=p.match(/^\/api\/jobs\/([^/]+)(?:\/(events|cancel|manual|draft))?$/);
        if(route){const id=route[1],action=route[2];const j=store.get('job',id);if(!j){send(res,404,{error:'작업이 없습니다.'});return;}
          if(action==='events'&&req.method==='GET'){
            res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Content-Type-Options':'nosniff'});
            const emit=value=>res.write(`data: ${JSON.stringify(value)}\n\n`);emit(publicJob(j));jobs.on(id,emit);
            const timer=setInterval(()=>res.write(': heartbeat\n\n'),20000);req.on('close',()=>{clearInterval(timer);jobs.off(id,emit);});return;
          }
          if(action==='cancel'&&req.method==='POST'){jobs.cancel(id);send(res,200,{ok:true});return;}
          if(action==='manual'&&req.method==='POST'){const b=await body(req);send(res,200,publicJob(jobs.manual(id,b.provider,String(b.text||''))));return;}
          if(action==='draft'&&req.method==='PUT'){
            if(j.kind!=='draft'||jobs.controllers.has(id))throw new Error('완료된 초안만 수정할 수 있습니다.');
            const b=await body(req);if(typeof b.text!=='string'||!b.text.trim()||b.text.length>1_000_000)throw new Error('초안 내용을 확인하세요.');
            const r=j.results.find(r=>['completed','manual'].includes(r.status));if(!r)throw new Error('저장할 초안이 없습니다.');
            r.originalText??=r.text;r.text=b.text;jobs.save(j);send(res,200,publicJob(j));return;
          }
          if(!action&&req.method==='GET'){send(res,200,{...publicJob(j),snapshot:j.snapshot});return;}
        }
        send(res,404,{error:'API를 찾지 못했습니다.'});return;
      }
      if(!['GET','HEAD'].includes(req.method)){send(res,405,{error:'허용되지 않는 요청입니다.'});return;}
      const path=decodeURIComponent(p==='/'?'/index.html':p);
      if(!/^\/(index\.html|config\.js|manifest\.webmanifest|sw\.js|AI_SETUP\.md|css\/[\w.-]+|js\/[\w.-]+|icons\/[\w.-]+|img\/[\w.-]+)$/.test(path)){send(res,404,{error:'파일이 없습니다.'});return;}
      const file=join(ROOT,path);if(!existsSync(file)){send(res,404,{error:'파일이 없습니다.'});return;}
      const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.webmanifest':'application/manifest+json','.md':'text/plain'};
      res.writeHead(200,{'Content-Type':(mime[extname(file)]||'application/octet-stream')+'; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});res.end(req.method==='HEAD'?null:readFileSync(file));
    }catch(e){if(!res.headersSent)send(res,400,{error:e.message});else res.end();}
  });
  server.on('upgrade',(req,socket,head)=>{
    const auth=store.get('secret','extension');
    if(req.url!=='/bridge'||req.headers.host!==`127.0.0.1:${port}`||!auth?.origin||req.headers.origin!==auth.origin){socket.destroy();return;}
    wsServer.handleUpgrade(req,socket,head,ws=>{
      let authed=false;const timer=setTimeout(()=>ws.close(),5000);
      ws.on('message',raw=>{try{const m=JSON.parse(raw.toString());if(!authed){if(m.type!=='hello'||!equal(m.token,auth.token)){ws.close();return;}authed=true;clearTimeout(timer);providers.bridge?.close();providers.attachBridge(ws);capAt=0;ws.send(JSON.stringify({type:'connected'}));return;}if(m.type==='ping'){ws.send(JSON.stringify({type:'pong'}));return;}providers.receive(m);capAt=0;}catch{ws.close();}});
      ws.on('error',()=>{});ws.on('close',()=>clearTimeout(timer));
    });
  });
  return {server,store,providers,jobs,close:async()=>{for(const ctrl of jobs.controllers.values())ctrl.abort(new Error('서버 종료'));providers.bridge?.close();wsServer.close();await new Promise(r=>server.close(r));store.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const app=createApp();app.server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'8765 포트가 사용 중입니다. 기존 집필실 서버를 종료한 뒤 다시 실행하세요.':e.message);process.exitCode=1;app.store.close();});
  app.server.listen(8765,'127.0.0.1',()=>console.log('집필실 AI 실행: http://127.0.0.1:8765/'));
}
