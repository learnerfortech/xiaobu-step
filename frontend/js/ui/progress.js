/* Platform learning progress. Pledge scores remain an independent source. */
(()=>{
'use strict';
const {h}=UI,C=APP_CONFIG,BUDDIES={terapagos:'太乐巴戈斯',miraidon:'密勒顿',charizard:'喷火龙',none:'不选伙伴'};
// Supplied character portraits: only for this private household LAN installation.
function buddyArt(id, formId){
 if(id==='none')return h('div.progress-solo',{'aria-label':'未选伙伴'},'✧');
 let src='assets/buddies/'+id+'.png', alt=BUDDIES[id]||id;
 // Charizard form artwork is pending; keep the supplied portrait and show the actual form label.
 if(id==='terapagos'&&formId&&formId!=='normal'){
  src='assets/buddies/terapagos-'+formId+'.png';
  alt=(formId==='terastal'?'太乐巴戈斯 · 太晶形态':formId==='stellar'?'太乐巴戈斯 · 星晶形态':alt);
 }
 return h('img.progress-portrait',{src,alt,width:180,height:180,decoding:'async'});
}
async function request(child,day,body,parent){
 if(C.TRANSPORT!=='lan')throw Error('闯关记录保存在家里共享模式。');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try{
  const path='/lan/family/'+(parent?'parent':'child')+'/progress';
  const r=await fetch(path+(body?'':'?day='+encodeURIComponent(day)+'&child='+child),{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
  if(r.status===409)throw Error('另一页刚改过伙伴，请重新读取后再选。');
  if(!r.ok)throw Error('进度暂未读到，请重试。');
  const data=await r.json();if(data.dataset!=='lan'||data.child_id!==child||data.day!==day||!Array.isArray(data.records))throw Error('进度返回不一致，请重试。');return data;
 }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw Error('没连上家里电脑，请稍后重试。');throw e;}finally{clearTimeout(timer);}
}
function card(child,day=C.today(),parent=false){
 const box=h('section.platform-progress'+(parent?'.p-card':''),{'data-testid':parent?'parent-progress-'+child:'platform-progress'});
 let data=null,busy=false,message='';const name=child==='child_a'?'Jared':'Joey';
 async function load(){busy=true;paint();try{data=await request(child,day,null,parent);message='';}catch(e){message=e.message;}finally{busy=false;if(box.isConnected)paint();}}
 async function choose(buddy){
  if(busy||!data)return;busy=true;message='正在保存伙伴…';paint();
  try{const written=await request(child,day,{day,child_id:child,buddy,expected_version:data.buddy_version},false);const read=await request(child,day,null,parent);if(read.buddyPrefs[child]!==buddy)throw Error('伙伴保存还没确认，请重新读取。');data=read;message='伙伴已保存。';}catch(e){message=e.message;}finally{busy=false;if(box.isConnected)paint();}
 }
 function paint(){
  const title=h('h2',{},(parent?name+' · ':'')+'闯关进度');
  if(!data){box.replaceChildren(...[title,h('p',{role:'status'},message||'正在读取…'),busy?null:h('button.c-btn',{onclick:load},'重新读取')].filter(Boolean));return;}
  const row=data.today,id=data.buddyPrefs[child],limit=data.rules.region_thresholds.at(-1),next=data.rules.region_thresholds[data.region_index+1];
  const formBuddy=((child==='child_a'&&id==='terapagos')||(child==='child_b'&&id==='charizard'));
  const formLine=formBuddy?(data.form_name+(data.form_next_name?(' · 再 '+data.form_need+' 经验→'+data.form_next_name):' · 已是最高形态')):'安静陪伴';
  const hero=h('div.progress-hero',{},parent?null:h('div.progress-buddy',{},buddyArt(id,formBuddy?data.form_id:null),h('strong',{},BUDDIES[id]),h('small',{},formLine)),
   h('div.progress-info',{},title,h('strong.progress-region',{'data-testid':'platform-region'},data.region_name),
    h('div.progress-numbers',{},h('span',{},day===C.today()?'今日经验':'所选日期经验',h('b',{'data-testid':'platform-today-exp'},String(data.today_exp))),h('span',{},'本周经验',h('b',{'data-testid':'platform-week-exp'},String(data.week_exp))),h('span',{},'累计经验',h('b',{'data-testid':'platform-lifetime-exp'},String(data.lifetime_exp||0)))),
    h('p.progress-stars',{},row.stars?'★'.repeat(row.stars)+(row.lit?' · 今日关已点亮':''):data.today_exp>0?'已经积累 '+data.today_exp+' 经验，再 '+Math.max(0,data.rules.light_day-data.today_exp)+' 点亮今日星':'今天还没记分，按自己的节奏来。'),
    meters(data),
    h('p',{},next?'本周再积累 '+Math.max(0,next-data.week_exp)+' 经验，解锁下一区域':'本周四个区域已全部点亮'),h('small',{},'今天：任务 '+row.task_exp+' 经验'+(row.pledge_bonus?(' · 约定加成 +'+row.pledge_bonus):'')+(child==='child_a'?' · 约定分 '+(row.pledge_rated?row.pledge_exp+'（不计满额进闯关）':'待评'):''))));
  const records=h('details.progress-records',{},h('summary',{},'本周记录 · '+data.start+' 起'),
   h('ul',{},...data.records.map(r=>h('li',{},h('span',{},r.day.slice(5)),h('b',{},r.rated?r.exp+' 经验':'尚未记录'),h('span',{},r.task_count+' 条任务'+(child==='child_a'?' · 约定 '+(r.pledge_rated?r.pledge_exp+' 分':'待评'):''))))),
   h('p',{},'每条作业按难度给经验（单项最多 '+(data.rules.max_task_exp??50)+'）；没单独标定时普通作业 +'+data.rules.task_exp+'、行程提醒 +'+(data.rules.itinerary_exp??1)+'。家长确认不重复加分。'),h('p',{},'每日约定按星级额外 +0～3 经验（不是把约定总分直接加进闯关）。待评不算 0。'),h('p',{},'今日满 '+data.rules.light_day+' 点亮，满 '+data.rules.three_stars+' 三星。'+(['child_a','child_b'].includes(child)?'累计经验满 '+data.rules.form_thresholds.terastal+' 解锁太晶形态、满 '+data.rules.form_thresholds.stellar+' 解锁星晶形态。':'')+'本周 '+data.rules.region_thresholds.slice(1).join(' / ')+' 解锁区域。不欠账、不惩罚。'));
  const choices=parent?null:h('details.progress-choice',{},h('summary',{},'伙伴：'+BUDDIES[id]+' · 更换 / 不选'),h('div.pledge-options',{},...Object.entries(BUDDIES).map(([value,label])=>h('button',{type:'button',disabled:busy,'aria-pressed':String(id===value),onclick:()=>choose(value)},label))));
  box.replaceChildren(...[hero,records,choices,message?h('p',{role:'status'},message):null,h('button.c-mini',{disabled:busy,onclick:load},busy?'正在读取…':'刷新进度')].filter(Boolean));
 }
 load();return box;
}
function meters(data){
 const max=data.rules.region_thresholds.at(-1),dayMax=data.rules.three_stars;
 const formTh=(data.rules.form_thresholds)||{terastal:300,stellar:600};
 const formLimit=data.form_id==='stellar'?formTh.stellar:(data.form_id==='terastal'?formTh.stellar:formTh.terastal);
 const formLabel=data.form_id==='stellar'?'形态进度（已满）':(data.form_next_name?('距'+data.form_next_name):'形态进度');
 const meter=(label,value,limit,key)=>h('div.reward-meter',{},h('div.reward-meter-label',{},h('span',{},label),h('b',{'data-testid':key+'-value'},value+' / '+limit)),h('div.progress-track',{role:'progressbar','aria-label':label,'data-testid':key,'aria-valuemin':0,'aria-valuemax':limit,'aria-valuenow':Math.min(value,limit)},h('i',{style:{width:Math.min(100,value/limit*100)+'%'}})));
 return h('div.reward-meters',{},meter('今日奖励进度',data.today_exp,dayMax,'today-reward-progress'),meter('本周奖励进度',data.week_exp,max,'week-reward-progress'),['child_a','child_b'].includes(data.child_id)?meter(formLabel,data.lifetime_exp||0,formLimit,'form-reward-progress'):null);
}
const seenCelebrations=new Set();
function formCelebration(reward,child,data){
 if(!['child_a','child_b'].includes(child)||!reward?.points||!reward.form_changed||!['terastal','stellar'].includes(reward.form_id))return null;
 const key='xb.formCelebrated.'+child+'.'+reward.form_id;
 let seen=seenCelebrations.has(key);try{seen=seen||sessionStorage.getItem(key)==='1';}catch(_){}
 if(seen)return null;
 seenCelebrations.add(key);try{sessionStorage.setItem(key,'1');}catch(_){}
 const name=reward.form_id==='stellar'?'星晶形态':'太晶形态';
 const buddy=child==='child_a'?'terapagos':'charizard', chosen=data.buddyPrefs[child]===buddy;
 // Text and a gentle image reveal only. No audio and no change to the chosen buddy.
 return h('section.form-celebrate',{'data-testid':'form-celebrate',role:'status'},
   chosen?buddyArt(buddy,data.form_id):null,
   h('strong',{},reward.celebrate || BUDDIES[buddy]+'的'+name+'解锁了！'),
   h('p',{},'累计达到 '+data.rules.form_thresholds[reward.form_id]+' 经验，解锁'+name+'！'),
   chosen?null:h('small',{},'你选的伙伴保持不变。'));
}
function compact(child,reward=null,{home=false}={}){
 const box=h('section.reward-compact'+(home?'.joey-main-progress':''),{'data-testid':'compact-progress'},h('p',{},'正在读取奖励进度…'));
 const load=()=>request(child,C.today(),null,false).then(d=>{
  if(!box.isConnected)return;
  const id=d.buddyPrefs[child],form=((child==='child_a'&&id==='terapagos')||(child==='child_b'&&id==='charizard'));
  const celebration=formCelebration(reward,child,d);
  const formHint=form?(d.form_name+(d.form_next_name?(' · 距'+d.form_next_name+'还差 '+d.form_need):' · 已是最高形态')):'';
  box.replaceChildren(...[celebration,
   reward&&form&&!celebration?h('div.reward-form',{},buddyArt(id,d.form_id),h('span',{},d.form_name)):null,
   home ? h('div.joey-progress-summary',{},buddyArt(id,form?d.form_id:null),h('div',{},h('strong',{},BUDDIES[id]+(form?' · '+d.form_name:'')),h('p',{},'今日 '+d.today_exp+' 经验 · '+('★'.repeat(d.today.stars)||'还没点亮')),formHint?h('p',{},'累计 '+d.lifetime_exp+' · '+formHint):h('p',{},'累计 '+d.lifetime_exp+' 经验'))) : h('strong',{},'今日 '+d.today_exp+' 经验 · 本周 '+d.week_exp+' 经验'),
   home ? null : h('p',{},'累计 '+d.lifetime_exp+' 经验'+(form&&d.form_next_name?' · 距'+d.form_next_name+'还差 '+d.form_need:'')),
   home ? h('details',{},h('summary',{},'查看经验和形态进度'),meters(d)) : meters(d)].filter(Boolean));
 }).catch(()=>{if(box.isConnected)box.replaceChildren(h('p',{},'奖励进度还没读到'),h('button.c-mini',{onclick:load},'重新读取'));});
 load();return box;
}
function receipt(reward,child){
 // Only a verified server receipt may claim a new award. A timeout is never +0.
 // N comes from server reward.points (= task exp_award); never hardcode 2.
 const valid=reward&&Number.isInteger(reward.points)&&reward.points>=0;
 let title,explanation;
 if(!valid){
  title='任务已保存，奖励还没核对';
  explanation='回首页刷新进度，确认后再看。';
 }else if(reward.points>0){
  title='＋'+reward.points+' 经验';
  explanation='本次奖励已记入家里共享库';
 }else if(reward.reason==='already_awarded'){
  title='已经记过了';
  explanation='这次不加分';
 }else{
  title='这次不加分';
  explanation='这次操作不计奖励';
 }
 const kids=[h('strong.reward-points',{'data-testid':'reward-points'},title),h('p',{},explanation)];
 kids.push(compact(child,reward));
 return h('section.reward-receipt',{'data-testid':'task-reward',role:'status','aria-live':'polite'},...kids);
}
function homeBuddy(child){
 /* Child home buddy card: left portrait + right stats — same layout for Jared and Joey. */
 const box=h('section.platform-progress.home-buddy-card',{'data-testid':'home-buddy-'+child},h('p',{},'正在读取伙伴…'));
 const load=()=>request(child,C.today(),null,false).then(d=>{
  if(!box.isConnected)return;
  const id=d.buddyPrefs[child];
  const form=((child==='child_a'&&id==='terapagos')||(child==='child_b'&&id==='charizard'));
  const formLine=form?(d.form_name+(d.form_next_name?(' · 再 '+d.form_need+' 经验→'+d.form_next_name):' · 已是最高形态')):'安静陪伴';
  const stars=d.today&&d.today.stars?('★'.repeat(d.today.stars)):('还没点亮');
  const hero=h('div.progress-hero',{},
   h('div.progress-buddy',{},buddyArt(id,form?d.form_id:null),h('strong',{},BUDDIES[id]||'伙伴'),h('small',{},formLine)),
   h('div.progress-info',{},
    h('h2',{},'闯关进度'),
    h('strong.progress-region',{},d.region_name||'今日'),
    h('div.progress-numbers',{},
     h('span',{},'今日经验',h('b',{},String(d.today_exp))),
     h('span',{},'本周经验',h('b',{},String(d.week_exp))),
     h('span',{},'累计经验',h('b',{},String(d.lifetime_exp||0)))),
    h('p.progress-stars',{},stars+' · 今日 '+d.today_exp+' 经验'),
    h('details',{},h('summary',{},'查看形态进度'),meters(d))));
  box.replaceChildren(hero);
 }).catch(()=>{if(box.isConnected)box.replaceChildren(h('p',{},'伙伴进度还没读到'),h('button.c-mini',{onclick:load},'重新读取'));});
 load();return box;
}
function companion(child, { hero = false } = {}){
 const box=h('figure.progress-companion'+(hero?'.progress-hero':''),{'data-testid':'quiet-companion-'+child});
 const paint=id=>{box.replaceChildren(...(id==='none'?[]:[buddyArt(id),h('figcaption',{},BUDDIES[id]) ]));};
 if(C.TRANSPORT==='lan')request(child,C.today(),null,false).then(data=>{const bid=data.buddyPrefs[child];const showForm=(bid==='terapagos'&&child==='child_a')||(bid==='charizard'&&child==='child_b');box.replaceChildren(...(bid==='none'?[]:[buddyArt(bid,showForm?data.form_id:null),h('figcaption',{},BUDDIES[bid]+(showForm&&data.form_name?(' · '+data.form_name):'')) ]));}).catch(()=>{});
 else paint(child==='child_a'?'terapagos':'charizard');
 return box;
}
window.Progress={card,homeBuddy,companion,compact,receipt};
})();
