/* Daily agreement: LAN-only records, independent from homework and browser archives. */
(()=>{
'use strict';
const {h}=UI,C=APP_CONFIG;
const LABELS=['认真完成作业','认真抄记事','书包整理好','桌洞整理好','认真听讲','书写认真','不要在书本上乱涂乱画'];
const today=()=>C.today();
const dateAdd=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const stats=(values,rules)=>{const rated=values.filter(v=>Number.isInteger(v)),score=rated.reduce((a,b)=>a+b,0);return {score,rated:rated.length,applicable:values.filter(v=>v!=='na').length,stars:score>=rules.three_stars?3:score>=rules.two_stars?2:score>0?1:0};};
const describe=s=>!s.rated?'待评':s.stars?'★'.repeat(s.stars)+(s.stars===3?' 太棒了！':''):'今日需加油';
async function request(day,body,role='child'){
 if(C.TRANSPORT!=='lan')throw Error('约定保存在家里共享模式，请回共享入口打开。');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try{
  const url='/lan/family/'+role+'/pledge'+(body?'':'?day='+encodeURIComponent(day)+'&child=child_a');
  const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
  if(r.status===409){const e=Error('另一页已修改，未覆盖。请先重新读取，再评分。');e.conflict=true;throw e;}
  if(!r.ok)throw Error('暂时没有存取成功，请稍后重试。');
  const data=await r.json();
  if(data.dataset!=='lan'||data.child_id!=='child_a'||data.day!==day||!Array.isArray(data.records))throw Error('返回记录不一致，请重新读取。');
  return data;
 }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw Error('没连上家里电脑；保存结果还没确认，请重试。');throw e;}finally{clearTimeout(timer);}
}
function entry(){
 const summary=h('span',{},'本周约定分 · 读取中');
 const box=h('section.pledge-entry',{},h('button.c-btn.primary',{'data-testid':'pledge-entry',onclick:()=>App.go('#/jared/pledge')},'☆ 每日约定'),summary);
 request(today()).then(d=>{const r=d.records.find(x=>x.day===today());summary.textContent=(r?.rated?'今日约定 '+r.score+' 分':'今天还没评分')+' · '+(d.records.some(x=>x.rated)?'本周约定 '+d.week_score+' 分':'本周待评');}).catch(()=>summary.textContent=C.TRANSPORT==='lan'?'积分暂未读到':'请在家里共享入口评分');return box;
}
function render(root){
 let data=null,day=today(),values=Array(7).fill(null),note='',version=0,busy=false,dirty=false,conflict=false,notice='',serial=0;
 const main=h('main.pledge-page',{'data-screen':'jared-pledge'});root.replaceChildren(main);
 const leave=()=>{if(!dirty||window.confirm('这一页还没保存，要先离开吗？'))App.go('#/jared');};
 function choose(d){day=d;const r=data.records.find(x=>x.day===day);values=r?r.values.slice():Array(7).fill(null);note=r?.note||'';version=r?.version||0;dirty=false;conflict=false;}
 async function load(){const token=++serial;busy=true;paint();try{const d=await request(day);if(token!==serial||!main.isConnected)return;data=d;choose(day);notice='';}catch(e){notice=e.message;}finally{if(token===serial&&main.isConnected){busy=false;paint();}}}
 async function save(){
  if(busy||conflict)return;busy=true;notice='正在保存…';paint();
  const body={day,child_id:'child_a',values:values.slice(),note,expected_version:version};
  try{
   const written=await request(day,body);const read=await request(day);const r=read.records.find(x=>x.day===day);
   if(!r||JSON.stringify(r.values)!==JSON.stringify(body.values)||r.note!==body.note)throw Error('保存后发现另一页更新，请重新读取核对。');
   if(!main.isConnected)return;data=read;choose(day);notice='已保存到家里电脑';
   if(written.celebrate_now&&r.stars===3){window.Confetti?.burst({count:45});}
  }catch(e){notice=e.message;conflict=!!e.conflict;}finally{busy=false;if(main.isConnected)paint();}
 }
 function paint(){
  const top=h('header.pledge-top',{},h('button.c-mini',{onclick:leave},'← 回到作业'),h('h1',{},'每日约定'));
  const msg=h('p.pledge-message',{role:'status','aria-live':'polite','data-testid':'pledge-message'},notice);
  if(!data){main.replaceChildren(top,h('p',{},'家里共享 · 保存在 Mac'),msg,busy?h('p',{},'正在读取…'):h('button.c-btn',{onclick:load},'重新读取'));return;}
  const s=stats(values,data.rules),future=day>today();
  const week=h('nav.pledge-week',{'aria-label':'本周日期'},...Array.from({length:7},(_,i)=>{const d=dateAdd(data.start,i),r=data.records.find(x=>x.day===d);return h('button',{type:'button','aria-pressed':String(day===d),disabled:busy,onclick:()=>{if(d===day)return;if(dirty&&!window.confirm('还没保存，确定切换日期吗？'))return;choose(d);notice='';paint();}},['一','二','三','四','五','六','日'][i]+' '+d.slice(5)+'\n'+(r&&r.rated?r.score+'分':'待评'));}));
  const summary=h('section.pledge-summary',{},h('strong',{'data-testid':'pledge-score'},s.rated?`${s.score} 分 · ${describe(s)}`:'今天还没评分'),h('span',{},`已评 ${s.rated} / 适用 ${s.applicable} · 全适用满分 14`),dirty?h('span',{},'当前修改还没保存'):null);
  const choices=[[2,'2 自己做到'],[1,'1 提醒后 / 部分'],[0,'0 还没做到'],['na','不适用'],[null,'待评']];
  const rows=LABELS.map((label,i)=>h('fieldset.pledge-item',{},h('legend',{},label),h('div.pledge-options',{},...choices.map(([value,text])=>h('button',{type:'button','data-item':i,'data-value':value===null?'pending':String(value),'aria-pressed':String(values[i]===value),disabled:busy||future,onclick:()=>{values[i]=value;dirty=true;notice='';paint();}},text)))));
  const input=h('textarea',{'aria-label':'今天想记住的一件事',maxLength:500,rows:3,disabled:busy||future,placeholder:'选填，写一句也可以',oninput:e=>{note=e.target.value;dirty=true;}});input.value=note;
  main.replaceChildren(top,h('p',{},'家里共享 · '+day),summary,h('p.pledge-rule',{},'自己做到，主动求助也算。没选是待评，不算 0 分。'),...rows,h('label.pledge-note',{},'今天想记住的一件事（选填）',input),msg,future?h('p',{},'这一天还没到，到了再评。'):h('div.pledge-actions',{},h('button.c-btn.primary',{disabled:busy||conflict,'data-testid':'pledge-save',onclick:save},busy?'正在保存…':'保存这一天'),h('button.c-mini',{disabled:busy,onclick:()=>{if(!dirty||window.confirm('重新读取会放下未保存的修改，继续吗？'))load();}},'重新读取')),h('section.pledge-journal',{},h('h2',{},'本周记录'),h('p',{},'点日期回看或修改；待评不算 0 分。'),week));
 }
 load();
}
function parentCard(day){
 const box=h('section.p-card.pledge-parent',{'data-testid':'parent-pledge'},h('h2',{},'Jared · 每日约定'),h('p',{},'正在读取…'));
 const load=async()=>{try{const d=await request(day,null,'parent'),r=d.records.find(x=>x.day===day);
 box.replaceChildren(...[h('h2',{},'Jared · 每日约定'),h('p',{},day+' · '+(r&&r.rated?r.score+' 分 · '+describe(r):'未评分')),h('p',{},d.records.some(x=>x.rated)?'本周约定分 '+d.week_score:'本周待评'),r&&r.rated&&r.score<d.rules.two_stars?h('p',{},'建议：今天一起对一对'):null,r?.note?h('p.pledge-rule',{},'孩子记下：'+r.note):null,h('details',{},h('summary',{},'查看本周每日评分'),...Array.from({length:7},(_,i)=>{const date=dateAdd(d.start,i),item=d.records.find(x=>x.day===date);return h('section.pledge-history',{},h('h3',{},date+' · '+(item&&item.rated?item.score+' 分':'未评分')),item?h('ul',{},...LABELS.map((label,n)=>h('li',{},label+'：'+(item.values[n]===null?'待评':item.values[n]==='na'?'不适用':item.values[n]+'分')))):null,item?.note?h('p',{},item.note):null);})),h('button.p-btn',{onclick:load},'刷新约定分数')].filter(x=>x!=null));
 }catch(e){box.replaceChildren(h('h2',{},'Jared · 每日约定'),h('p',{},e.message),h('button.p-btn',{onclick:load},'重新读取'));}};load();return box;
}
window.Pledge={entry,render,parentCard};
})();
