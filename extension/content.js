// Only visible, new assistant messages are read. No cookie/private endpoint access.
(()=>{
  const gemini=location.hostname==='gemini.google.com';let active=null;
  const editors=gemini?['rich-textarea [contenteditable="true"]','.ql-editor[contenteditable="true"]']:['textarea','[contenteditable="true"][role="textbox"]','.tiptap[contenteditable="true"]'];
  const replies=gemini?['model-response .markdown','model-response message-content','model-response']:['[data-message-role="assistant"]','[data-testid="assistant-message"]','.response-content-markdown'];
  const visible=e=>e&&e.getClientRects().length&&!e.closest('[hidden],[aria-hidden="true"]');
  const first=selectors=>{for(const q of selectors){const e=[...document.querySelectorAll(q)].find(visible);if(e)return e;}return null;};
  function probe(){const text=document.body.innerText;if(/verify you are human|確認您是真人|로봇이 아님|보안 문자|captcha/i.test(text))return {status:'auth_required',message:'웹에서 인증 화면을 직접 완료하세요.'};if(first(editors))return {status:'ready',message:'웹 입력창 준비됨 · 실제 실행 시 로그인·한도 확인'};return {status:'login_required',message:'웹 로그인 또는 입력창 확인이 필요합니다.'};}
  function answers(){for(const q of replies){const a=[...document.querySelectorAll(q)].filter(visible);if(a.length)return a;}return [];}
  function control(pattern){return [...document.querySelectorAll('button')].find(b=>visible(b)&&pattern.test(((b.getAttribute('aria-label')||'')+' '+(b.getAttribute('data-testid')||'')+' '+b.innerText+' '+(b.getAttribute('type')||'')).trim()));}
  const send=(type,data)=>chrome.runtime.sendMessage({type,taskId:active?.taskId,...data}).catch(()=>{});
  function stop(){if(!active)return;clearInterval(active.timer);active=null;}
  async function run(m){
    if(active)throw new Error('이 탭에 실행 중인 집필 요청이 있습니다.');
    const editor=first(editors);if(!editor)throw new Error('입력창을 찾지 못했습니다. 웹에서 로그인하세요.');
    const initial=answers().map(e=>e.innerText);active={taskId:m.taskId,last:'',changed:Date.now(),started:Date.now(),timer:null,sent:false};
    editor.focus();
    if(editor.tagName==='TEXTAREA'||editor.tagName==='INPUT'){const prototype=editor.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(editor,m.prompt);editor.dispatchEvent(new Event('input',{bubbles:true}));}
    else{const selection=getSelection(),range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);document.execCommand('insertText',false,m.prompt);editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:null}));}
    if((editor.value??editor.innerText).trim()!==m.prompt.trim()){stop();throw new Error('질문 입력을 확인하지 못했습니다. 자동 전송하지 않았습니다.');}
    await new Promise(r=>setTimeout(r,500));if(!active)return;
    const button=control(/send message|send prompt|^send$|전송|보내기|메시지 보내기|submit|send-button/i);
    if(!button||button.disabled){stop();throw new Error('전송 버튼을 찾지 못했습니다. 입력된 질문을 웹에서 확인하세요.');}
    button.click();active.sent=true;send('progress',{message:'질문을 전송했습니다. 새 답변을 기다려요'});
    active.timer=setInterval(()=>{
      if(!active)return;
      const text=document.body.innerText;
      if(/usage limit|limit reached|사용 한도|한도에 도달|too many requests|메시지 한도/i.test(text)){send('failure',{code:'quota',message:'웹 사용 한도에 도달했습니다.'});stop();return;}
      if(probe().status==='auth_required'){send('failure',{code:'auth_required',message:'웹 인증 화면을 확인하세요.'});stop();return;}
      const nodes=answers(),latest=nodes.at(-1)?.innerText?.trim();
      if(latest&&(nodes.length>initial.length||!initial.includes(latest))){
        if(latest!==active.last){active.last=latest;active.changed=Date.now();}
        const busy=control(/stop generating|stop response|응답 중지|생성 중지|답변 중지|stop-button/i);
        if(!busy&&Date.now()-active.changed>12000){send('result',{text:latest});stop();return;}
      }
      if(Date.now()-active.started>540000){send('failure',{code:'timeout',message:'답변 완료를 확인하지 못했습니다. 열린 대화에서 확인 후 직접 가져오세요.'});stop();}
    },1000);
  }
  chrome.runtime.onMessage.addListener((m,sender,respond)=>{
    if(m.type==='probe'){respond(probe());return;}
    if(m.type==='cancel'&&active?.taskId===m.taskId){control(/stop generating|stop response|생성 중지|응답 중지/i)?.click();stop();respond({ok:true});return;}
    if(m.type==='run'){run(m).catch(e=>{chrome.runtime.sendMessage({type:'failure',taskId:m.taskId,code:'adapter_error',message:e.message}).catch(()=>{});stop();});respond({accepted:true});}
  });
})();
