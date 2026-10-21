import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PROVIDERS } from './context.mjs';

const exec=promisify(execFile);
export async function findCLI(name) {
  const candidates=name==='claude' ? [join(process.env.USERPROFILE||'','.local','bin','claude.exe'),join(process.env.LOCALAPPDATA||'','Microsoft','WinGet','Links','claude.exe')] : [];
  for(const p of candidates) if(existsSync(p)) return p;
  try { const {stdout}=await exec(process.platform==='win32'?'where.exe':'which',[name],{windowsHide:true,timeout:5000}); return stdout.trim().split(/\r?\n/).find(p=>!p.endsWith('.cmd')&&!p.endsWith('.bat')) || null; } catch { return null; }
}
export async function cliStatus(name) {
  const path=await findCLI(name);
  if(!path) return {installed:false,ready:false,status:'not_installed',message:name==='claude'?'Claude Code를 설치하고 claude auth login을 실행하세요.':'Codex CLI를 설치하세요.'};
  try {
    const {stdout,stderr}=await exec(path,name==='codex'?['login','status']:['auth','status'],{windowsHide:true,timeout:12000});
    const text=stdout+'\n'+stderr;
    const ready=name==='codex'? /Logged in using ChatGPT/i.test(text) : (()=>{try{const j=JSON.parse(stdout);return j.loggedIn===true && ['claude.ai','oauth_token'].includes(j.authMethod);}catch{return false;}})();
    return {installed:true,ready,status:ready?'ready':'login_required',message:ready?'구독 로그인 준비됨':`${name} 구독 로그인을 확인하세요.`,path};
  } catch { return {installed:true,ready:false,status:'login_required',message:`${name} 로그인 또는 CLI 버전 확인이 필요합니다.`,path}; }
}
export async function runCLI(provider,prompt,signal,dataDir,onProgress=()=>{}) {
  const status=await cliStatus(provider); if(!status.ready) throw new Error(status.message);
  signal.throwIfAborted();
  const cwd=join(dataDir,'runs',provider); mkdirSync(cwd,{recursive:true});
  const env={...process.env}; for(const k of ['OPENAI_API_KEY','CODEX_API_KEY','ANTHROPIC_API_KEY','CLAUDECODE']) delete env[k];
  const args=provider==='codex'
    ? ['exec','--ignore-user-config','--sandbox','read-only','--skip-git-repo-check','--ephemeral','--json','-']
    : ['--safe-mode','-p','--output-format','json','--tools','','--disallowedTools','mcp__*','--no-session-persistence'];
  return new Promise((resolve,reject)=>{
    let output='',stderr='',buffer='',last='',settled=false,turnFailed=false;
    const child=spawn(status.path,args,{cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    const finish=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);err?reject(err):resolve(value);};
    const kill=()=>{if(process.platform==='win32' && child.pid) { const p=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});p.on('error',()=>{}); }else child.kill('SIGTERM');};
    const abort=()=>{kill();finish(signal.reason||new Error('취소됨'));};
    const timer=setTimeout(()=>{kill();finish(new Error('AI 응답 시간이 10분을 넘었습니다.'));},600000);
    signal.addEventListener('abort',abort,{once:true});
    child.on('error',e=>finish(e)); child.stdin.on('error',()=>{});
    child.stderr.on('data',d=>{stderr=(stderr+d.toString()).slice(-4000);});
    child.stdout.on('data',d=>{
      const text=d.toString(); output+=text;
      if(output.length>4_000_000){kill();finish(new Error('AI 출력 크기 한도 초과'));return;}
      if(provider==='codex'){
        buffer+=text;let idx;
        while((idx=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,idx);buffer=buffer.slice(idx+1);try{
          const ev=JSON.parse(line);
          if(ev.type==='item.completed'&&ev.item?.type==='agent_message')last=ev.item.text;
          if(ev.type==='turn.failed'||ev.type==='error'){turnFailed=true;stderr=ev.error?.message||ev.message||'Codex 실행 실패';}
          if(ev.type==='turn.started')onProgress('작성 중');
        }catch{}}
      }
    });
    child.on('close',code=>{
      if(settled)return;
      if(code!==0||turnFailed)return finish(new Error(stderr||`CLI 실행 실패 (${code})`));
      if(provider==='claude'){try{const j=JSON.parse(output);if(j.is_error||j.subtype?.startsWith('error'))return finish(new Error(j.result||'Claude 실행 실패'));last=j.result;}catch{return finish(new Error('Claude 응답 JSON을 해석하지 못했습니다.'));}}
      if(!last?.trim())return finish(new Error('AI의 최종 응답이 없습니다.'));
      finish(null,last.trim());
    });
    child.stdin.end(prompt);
  });
}

export class Providers {
  constructor(dataDir) { this.dataDir=dataDir;this.queues=new Map();this.webTasks=new Map();this.bridge=null;this.capabilities={}; }
  attachBridge(ws) { this.bridge=ws;this.capabilities={};ws.on('close',()=>{if(this.bridge===ws){this.bridge=null;this.capabilities={};for(const task of this.webTasks.values())task.reject(Object.assign(new Error('확장 연결이 끊겼습니다. 전송 여부를 확인한 뒤 웹에서 이어하세요.'),{code:'interrupted'}));}}); }
  async status() {
    const [codex,claude]=await Promise.all([cliStatus('codex'),cliStatus('claude')]);
    return {codex,claude,...Object.fromEntries(['gemini','grok'].map(id=>[id,{installed:!!this.bridge,ready:!!this.bridge&&this.capabilities[id]?.status==='ready',status:this.bridge?(this.capabilities[id]?.status||'checking'):'extension_required',message:this.bridge?(this.capabilities[id]?.message||'웹 로그인 상태 확인 중'):'Chrome 확장 등록과 연결이 필요합니다.',web:true,url:PROVIDERS[id].url}]))};
  }
  receive(message) {
    if(message.type==='capabilities'){this.capabilities=message.providers||{};return;}
    const t=this.webTasks.get(message.taskId);if(!t)return;
    if(message.type==='progress')t.progress(message.message);
    if(message.type==='result')t.resolve(String(message.text||''));
    if(message.type==='failure')t.reject(Object.assign(new Error(message.message||'웹 수집 실패'),{code:message.code||'web_error'}));
  }
  run(id,prompt,signal,onProgress=()=>{}) {
    if(!PROVIDERS[id]) return Promise.reject(new Error('알 수 없는 AI입니다.'));
    const previous=this.queues.get(id)||Promise.resolve();
    const next=previous.catch(()=>{}).then(()=>{signal.throwIfAborted();return PROVIDERS[id].web?this.web(id,prompt,signal,onProgress):runCLI(id,prompt,signal,this.dataDir,onProgress);});
    this.queues.set(id,next); next.finally(()=>{if(this.queues.get(id)===next)this.queues.delete(id);}).catch(()=>{});return next;
  }
  web(provider,prompt,signal,progress) {
    if(!this.bridge||this.bridge.readyState!==1)return Promise.reject(Object.assign(new Error('Chrome 확장을 연결하고 웹에서 로그인하세요.'),{code:'extension_required'}));
    const taskId=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const done=(fn,v)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);this.webTasks.delete(taskId);fn(v);};
      const abort=()=>{this.bridge?.send(JSON.stringify({type:'cancel',taskId}));done(reject,signal.reason||new Error('취소됨'));};
      const timer=setTimeout(()=>{this.bridge?.send(JSON.stringify({type:'cancel',taskId}));done(reject,Object.assign(new Error('웹 응답 시간이 초과됐습니다. 대화에서 확인 후 답변을 가져오세요.'),{code:'timeout'}));},600000);
      this.webTasks.set(taskId,{resolve:text=>text.trim()?done(resolve,text):done(reject,new Error('빈 웹 응답입니다.')),reject:e=>done(reject,e),progress});
      signal.addEventListener('abort',abort,{once:true});
      this.bridge.send(JSON.stringify({type:'task',taskId,provider,prompt}));
    });
  }
}
