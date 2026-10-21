const BASE='http://127.0.0.1:8765';
const URLS={gemini:'https://gemini.google.com/app',grok:'https://grok.com/'};
let socket=null,heartbeat=null,connecting=false;const tasks=new Map();
const send=m=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(m));};
async function state(text){await chrome.storage.local.set({status:text});}
async function probe(){
  const providers={};for(const provider of Object.keys(URLS)){
    const tabs=await chrome.tabs.query({url:provider==='gemini'?'https://gemini.google.com/*':'https://grok.com/*'});let status={status:'login_required',message:'같은 Chrome 프로필에서 웹 로그인을 완료하세요.'};
    for(const tab of tabs){try{const r=await chrome.tabs.sendMessage(tab.id,{type:'probe'});if(r?.status==='ready'){status=r;break;}if(r)status=r;}catch{}}
    providers[provider]=status;
  }send({type:'capabilities',providers});
}
async function connect(){
  if(connecting||socket?.readyState===WebSocket.OPEN)return;connecting=true;
  const {token}=await chrome.storage.local.get('token');if(!token){connecting=false;await state('집필실에서 연결 코드를 만들어 입력하세요.');return;}
  socket=new WebSocket('ws://127.0.0.1:8765/bridge');
  socket.onopen=()=>{connecting=false;send({type:'hello',token});};
  socket.onmessage=async ev=>{let m;try{m=JSON.parse(ev.data);}catch{return;}
    if(m.type==='connected'){await state('집필실에 연결됨');await probe();clearInterval(heartbeat);heartbeat=setInterval(()=>{send({type:'ping'});probe().catch(()=>{});},20000);}
    if(m.type==='task')run(m).catch(e=>send({type:'failure',taskId:m.taskId,code:'web_error',message:e.message}));
    if(m.type==='cancel'){const task=tasks.get(m.taskId);tasks.delete(m.taskId);await saveTasks();if(task)chrome.tabs.sendMessage(task.tabId,{type:'cancel',taskId:m.taskId}).catch(()=>{});}
  };
  socket.onerror=()=>{};socket.onclose=()=>{connecting=false;clearInterval(heartbeat);for(const [taskId,t] of tasks)chrome.tabs.sendMessage(t.tabId,{type:'cancel',taskId}).catch(()=>{});tasks.clear();saveTasks();state('연결이 끊겼습니다. 서버와 연결 코드를 확인하세요.');};
}
async function saveTasks(){await chrome.storage.session.set({tasks:Object.fromEntries(tasks)});}
async function run(task){
  if(!URLS[task.provider]||typeof task.prompt!=='string')throw new Error('지원하지 않는 웹 작업입니다.');
  const tab=await chrome.tabs.create({url:URLS[task.provider],active:false});tasks.set(task.taskId,{tabId:tab.id,provider:task.provider});await saveTasks();
  send({type:'progress',taskId:task.taskId,message:'새 웹 대화를 열고 있어요'});
  for(let i=0;i<60;i++){
    if(!tasks.has(task.taskId))return;
    try{const p=await chrome.tabs.sendMessage(tab.id,{type:'probe'});if(p?.status==='ready'){await chrome.tabs.sendMessage(tab.id,{type:'run',taskId:task.taskId,prompt:task.prompt});return;}if(p?.status==='auth_required'){send({type:'failure',taskId:task.taskId,code:p.status,message:p.message});tasks.delete(task.taskId);await saveTasks();return;}}catch{}
    await new Promise(r=>setTimeout(r,1000));
  }
  send({type:'failure',taskId:task.taskId,code:'login_required',message:'로그인 또는 입력창 확인이 필요합니다. 열린 웹 탭을 확인하세요.'});tasks.delete(task.taskId);await saveTasks();
}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
  if(sender.tab){
    const task=tasks.get(m.taskId);if(!task||task.tabId!==sender.tab.id||!['progress','result','failure'].includes(m.type))return;
    send(m);if(['result','failure'].includes(m.type)){tasks.delete(m.taskId);saveTasks();}return;
  }
  if(m.type==='pair'){(async()=>{try{const r=await fetch(BASE+'/api/extension/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:m.code})});const data=await r.json();if(!r.ok)throw new Error(data.error);await chrome.storage.local.set({token:data.token});socket?.close();socket=null;await connect();respond({ok:true});}catch(e){respond({error:e.message});}})();return true;}
  if(m.type==='refresh'){connect().then(probe).then(()=>respond({ok:true})).catch(e=>respond({error:e.message}));return true;}
  if(m.type==='open'&&URLS[m.provider])chrome.tabs.create({url:URLS[m.provider]});
});
chrome.tabs.onRemoved.addListener(tabId=>{for(const [taskId,t] of tasks)if(t.tabId===tabId){send({type:'failure',taskId,code:'tab_closed',message:'웹 대화 탭이 닫혔습니다. 자동 재전송하지 않습니다.'});tasks.delete(taskId);saveTasks();}});
chrome.alarms.create('reconnect',{periodInMinutes:0.5});chrome.alarms.onAlarm.addListener(()=>connect());
connect();
