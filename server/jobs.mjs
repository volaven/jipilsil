import { EventEmitter } from 'node:events';
import { hash, chars, validateSnapshot, configOf, prepareContext, promptFor, PROVIDERS } from './context.mjs';
const terminal=new Set(['completed','failed','cancelled','manual','interrupted']);
export function publicJob(job) { const {snapshot,...out}=job; return {...out,context:job.context?{mode:job.context.mode,coverage:job.context.coverage}:null}; }
export class Jobs extends EventEmitter {
  constructor(store,providers) {
    super();this.store=store;this.providers=providers;this.controllers=new Map();
    for(const j of store.all('job')) if(!['completed','failed','cancelled','restored','partial'].includes(j.status)) { j.status='interrupted';for(const r of j.results)if(!terminal.has(r.status))r.status='interrupted';this.save(j); }
  }
  save(j) {j.updatedAt=Date.now();this.store.put('job',j.id,j);this.emit(j.id,publicJob(j));}
  create(input) {
    validateSnapshot(input.snapshot);
    if(!['council','draft','summarize'].includes(input.kind))throw new Error('지원하지 않는 작업입니다.');
    const ids=[...new Set(input.providers||[])];
    if(!ids.length||ids.some(id=>!PROVIDERS[id])||(input.kind!=='council'&&ids.length!==1))throw new Error('AI 선택을 확인하세요.');
    const config=configOf(input.config);const request=String(input.request||'다음 회차의 전개를 제안해 주세요.');
    if(chars(request)>10000)throw new Error('집필 요청은 10,000자 이내로 작성하세요.');
    const selected=Array.isArray(input.selected)?input.selected.map(String):[];
    if(input.kind==='draft'&&!selected.some(t=>t.trim()))throw new Error('채택한 의견 또는 추가 지시를 입력하세요.');
    const j={id:crypto.randomUUID(),workId:input.snapshot.workId,kind:input.kind,status:'preparing',createdAt:Date.now(),snapshot:input.snapshot,sourceHash:hash(input.snapshot),config,request,selected,targetLength:Math.max(100,Math.min(30000,Number(input.targetLength)||5000)),parentId:input.parentId||null,results:ids.map(provider=>({provider,status:'queued',text:'',error:'',prompt:''}))};
    this.save(j);const ctrl=new AbortController();this.controllers.set(j.id,ctrl);
    this.execute(j,ctrl).finally(()=>this.controllers.delete(j.id));return j;
  }
  async execute(j,ctrl) {
    const signal=ctrl.signal;
    try {
      const extra=chars(j.request)+chars(j.selected.join('\n'));
      if(extra>j.config.inputLimit-8000)throw new Error('선택한 의견과 지시가 너무 깁니다. 내용을 줄이세요.');
      j.context=await prepareContext(j.snapshot,{...j.config,inputLimit:j.config.inputLimit-extra},this.store,(p,t,s)=>this.providers.run(p,t,s,msg=>{j.message=msg;this.save(j);}),signal,msg=>{j.message=msg;this.save(j);});
      signal.throwIfAborted();
      if(j.kind==='summarize'){j.results[0]={...j.results[0],status:'completed',text:j.context.text};j.status='completed';this.save(j);return;}
      j.status='running';j.message='AI별 의견을 받고 있어요';this.save(j);
      await Promise.all(j.results.map(async r=>{
        r.prompt=promptFor(j,r.provider);
        if(chars(r.prompt)>j.config.inputLimit){r.status='failed';r.error='입력 한도를 넘었습니다. 참고 범위를 조정하세요.';this.save(j);return;}
        try {
          signal.throwIfAborted();r.status='running';this.save(j);
          const text=await this.providers.run(r.provider,r.prompt,signal,msg=>{if(signal.aborted)return;r.message=msg;this.save(j);});
          signal.throwIfAborted();if(r.status==='manual')return;r.text=text;r.status='completed';
        } catch(e) { if(r.status!=='manual'){r.status=signal.aborted?'cancelled':(e.code==='interrupted'?'interrupted':'failed');r.error=e.message;r.code=e.code||'provider_error';} }
        this.save(j);
      }));
      if(signal.aborted)j.status='cancelled';
      else {const success=j.results.filter(r=>['completed','manual'].includes(r.status)).length;j.status=success===j.results.length?'completed':success?'partial':'failed';}
      j.message=j.status==='completed'?'결과가 저장됐어요. 검토 후 다음 단계로 진행하세요.':j.status==='partial'?'완료된 결과는 보관했어요. 연결이 필요한 AI는 설정 후 새로 요청할 수 있어요.':'요청이 종료됐어요. 연결 상태와 오류 내용을 확인하세요.';
    } catch(e) {j.status=signal.aborted?'cancelled':'failed';j.error=e.message;j.code=e.code;for(const r of j.results)if(!terminal.has(r.status))r.status=signal.aborted?'cancelled':'failed';}
    this.save(j);
  }
  cancel(id) {const j=this.store.get('job',id);if(!j)throw new Error('작업을 찾지 못했습니다.');this.controllers.get(id)?.abort(new Error('사용자가 작업을 취소했습니다.'));return j;}
  manual(id,provider,text) {
    if(this.controllers.has(id))throw new Error('실행 중인 작업은 먼저 취소한 뒤 답변을 가져오세요.');
    const j=this.store.get('job',id);const r=j?.results.find(r=>r.provider===provider);
    if(!r||!text?.trim()||text.length>1_000_000)throw new Error('가져올 답변을 확인하세요.');
    if(['completed','manual'].includes(r.status))throw new Error('이미 저장된 답변입니다. 새 요청에서 다시 작성하세요.');
    r.status='manual';r.text=text;r.error='';r.manual=true;j.status=j.results.every(r=>['completed','manual'].includes(r.status))?'completed':'partial';this.save(j);return j;
  }
}
