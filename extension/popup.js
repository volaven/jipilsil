const status=document.querySelector('#status');
async function refresh(){const s=await chrome.storage.local.get('status');status.textContent=s.status||'연결 전';}
document.querySelector('#pair').onclick=async()=>{const r=await chrome.runtime.sendMessage({type:'pair',code:document.querySelector('#code').value.trim()});status.textContent=r.error||'연결 요청을 보냈습니다.';};
document.querySelector('#refresh').onclick=async()=>{await chrome.runtime.sendMessage({type:'refresh'});await refresh();};
for(const provider of ['gemini','grok'])document.querySelector('#'+provider).onclick=()=>chrome.runtime.sendMessage({type:'open',provider});
chrome.storage.onChanged.addListener(refresh);refresh();
