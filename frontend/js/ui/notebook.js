/* Local parent intake: sources → editable drafts → paired materials → explicit publication. */
(()=>{
const {h}=UI,clone=x=>structuredClone(x),uid=()=>API.uuid();
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.keys(v).sort().reduce((o,k)=>(o[k]=v[k],o),{}):v);
const MIME={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',m4a:'audio/mp4',pdf:'application/pdf'};
async function request(action,body,raw=false){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),action==='ocr'?85000:45000);
 try{const r=await fetch('/lan/notebook/'+action,{method:'POST',headers:{'Content-Type':raw?(body.type||'application/octet-stream'):'application/json'},body:raw?body:JSON.stringify(body),signal:controller.signal,cache:'no-store'});const data=await r.json();if(!r.ok){const e=Error(data.message||'这一步未完成，内容仍保留，请稍后重试。');e.status=r.status;throw e;}return data;}finally{clearTimeout(timer);}
}
let dbPromise;
function draftDB(){return dbPromise||(dbPromise=new Promise((resolve,reject)=>{const q=indexedDB.open('xb-intake-private',1);q.onupgradeneeded=()=>q.result.createObjectStore('drafts');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);}));}
async function localDraft(key,action,value){const db=await draftDB();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts',action==='get'?'readonly':'readwrite'),st=tx.objectStore('drafts'),q=action==='get'?st.get(key):action==='put'?st.put(value,key):st.delete(key);tx.oncomplete=()=>resolve(q.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
function mount(day,onSaved,options={}){
 const editing=options.editTask;
 const key=editing?'intake-materials:'+editing.id:'intake-v2:active',kids=APP_CONFIG.CHILDREN;
 let state={version:2,child:options.child||'child_a',day,sources:[],drafts:[],review:[],review_resolved:false,allow_missing_audio:false,operation:null,result:null},busy=false,persistTimer,urls=new Map();
 if(editing)state={...state,sources:clone(editing.sources||[]),review_resolved:true,drafts:[{...clone(editing),id:uid(),materials:clone(editing.materials||[]),source_ids:editing.source_ids||[],original_requirement:editing.original_requirement||'',warnings:[],reviewed:true}]};
 const root=h('section.p-card.notebook-intake'+(editing?'':'.intake-sheet-page'),{'data-testid':'parent-intake'}),body=h('div'),status=h('p.notebook-status',{role:'status','aria-live':'polite'}),retention=h('p.notebook-retention',{});
 root.append(h('h2',{},editing?'补充对应材料':'添加作业'),retention,body,status);
 const replaceBody=(...nodes)=>{body.querySelectorAll('audio').forEach(a=>a.pause());body.replaceChildren(...nodes.filter(n=>n!=null));};
 const message=s=>status.textContent=s;
 function cachedUrl(blob){if(!urls.has(blob))urls.set(blob,URL.createObjectURL(blob));return urls.get(blob);}
 function persist(){if(state.result)return;const snapshot=clone(state);localDraft(key,'put',snapshot).then(()=>{if(!state.result)retention.textContent='草稿已暂存在此浏览器，刷新可恢复。已上传附件保存在家里 Mac。';}).catch(()=>{retention.textContent='此浏览器暂存失败，请勿刷新；当前内容仍在页面，可继续保存。';});}
 function change(){if(state.result)return;persist();summary();}
 function controls(){body.querySelectorAll('input,textarea,select,button').forEach(el=>{el.disabled=busy||!!state.operation||!!state.result;});body.querySelectorAll('[data-safe]').forEach(el=>el.disabled=busy);}
 async function run(fn){if(busy)return;busy=true;controls();try{await fn();}catch(e){message(e.name==='AbortError'?'等待超时，输入和材料仍保留，可以查询结果或重试。':e.message||'暂未完成，内容仍保留。');}finally{busy=false;draw();persist();}}
 function input(label,value,set,{area=false,type='text',max=4000}={}){const el=h(area?'textarea':'input',{'aria-label':label,type:area?null:type,maxlength:max,value:area?null:(value??''),oninput:e=>{set(e.target.value);change();}},area?value||'':null);return h('label.p-field',{},label,el);}
 function select(label,value,items,set){return h('label.p-field',{},label,h('select.p-input',{'aria-label':label,onchange:e=>{set(e.target.value);change();draw();}},...items.map(([v,t])=>h('option',{value:v,selected:v===value},t))));}
 const btn=(label,fn,safe=false)=>h('button.p-btn',{type:'button','data-safe':safe?'yes':null,onclick:fn},label);
 function order(list,i){return h('div.intake-order',{},btn('上移',()=>{if(i){[list[i-1],list[i]]=[list[i],list[i-1]];change();draw();}}),btn('下移',()=>{if(i+1<list.length){[list[i+1],list[i]]=[list[i],list[i+1]];change();draw();}}));}
 const taskFields=['subject','title','first_step','original_requirement','source_ids','task_kind','home_group','photo_required','warnings','reviewed','day'];
 const cleanSources=()=>state.sources.map(s=>({id:s.id,name:s.name,kind:s.kind,text:s.text||'',original_text:s.original_text??s.text??'',token:s.token||''}));
 function cleanDraft(d){const out={};taskFields.forEach(k=>{if(d[k]!==undefined)out[k]=d[k];});out.materials=(d.materials||[]).map(g=>({name:g.name,text:g.text||'',audio_required:!!g.audio_required,items:g.items.map(a=>{if(a.error||!a.url)throw Error('有附件尚未上传成功，请先重试或移除。');return {name:a.name,kind:a.kind,...(a.kind==='link'?{url:a.url}:{token:a.token})};})}));return out;}
 function summary(){const el=body.querySelector('[data-testid=intake-summary]');if(el)el.textContent='将添加给 '+(kids[state.child]?.name||'请选择孩子')+'：'+state.drafts.length+' 项；日期：'+[...new Set(state.drafts.map(d=>d.day))].join('、');}
 async function upload(a){
  if(a.token)return;
  if(!a.blob)throw Error('附件文件不可用，请重新选择。');
  a.error='';try{const r=await request('upload',a.blob,true);Object.assign(a,r);persist();}catch(e){a.error='上传未完成';persist();throw e;}
 }
 async function addFiles(files,target,source=false){
  for(const f of files){
   if((source&&state.sources.length>=12)||(!source&&target.length>=20))throw Error(source?'一次最多十二份来源。':'每组最多二十个附件。');
   const type=MIME[f.name.split('.').pop().toLowerCase()]||f.type;
   if(source&&!type.startsWith('image/'))throw Error('作业来源请选择 JPG、PNG 或 WebP 图片。PDF可放在任务材料里。');
   if(!Object.values(MIME).includes(type))throw Error('暂不支持这个文件格式，请选图片、PDF或常用音频。');
   if(f.size>(type.startsWith('image/')?8:25)*1024*1024)throw Error(type.startsWith('image/')?'图片超过8兆，请压缩后选择。':'音频或文件超过25兆。');
   const blob=f.slice(0,f.size,type),a={id:uid(),name:f.name,kind:source?'image':type.startsWith('image/')?'image':type.startsWith('audio/')?'audio':'document',blob,text:'',error:''};
   target.push(a);persist();draw();
   try{await upload(a);if(target.some(x=>x!==a&&x.token===a.token)){target.splice(target.indexOf(a),1);message('重复图片／附件已跳过，不会重复挂入。');}}catch(e){message(e.message);}
  }
 }
 function fileButton(label,target,source=false){const file=h('input',{type:'file',multiple:true,accept:source?'image/jpeg,image/png,image/webp':'image/jpeg,image/png,image/webp,audio/mpeg,audio/wav,audio/ogg,audio/mp4,.m4a,application/pdf','aria-label':label,onchange:e=>{const files=[...e.target.files];e.target.value='';run(()=>addFiles(files,target,source));}});return h('label.p-field',{},label,file);}
 async function recognize(s){await upload(s);message('正在家里电脑识别：'+s.name);const r=await request('ocr',{token:s.token});s.original_text=r.text;s.text=r.text;s.recognized=!!r.recognized;s.error=r.recognized?'':'图片没认清，请对照原图填写。';persist();message(r.message);}
 function sourceCard(s,i){return h('section.intake-source',{},input('来源名称',s.name,v=>s.name=v,{max:120}),s.kind==='image'?h('img.notebook-preview',{src:s.url||(s.blob?cachedUrl(s.blob):''),alt:s.name}):null,input('来源文字（可校对）',s.text,v=>{s.text=v;state.review_resolved=false;},{area:true,max:12000}),s.kind==='image'?h('div',{},btn(s.text?'重新识别此图':'识别此图',()=>{if(s.text&&!confirm('重新识别会替换这张图片的校对文字，继续吗？'))return;run(()=>recognize(s));}),s.error?h('p.p-warn',{},s.error):null):null,h('div.intake-order',{},order(state.sources,i),btn('移除此来源',()=>{state.sources.splice(i,1);state.drafts.forEach(d=>d.source_ids=d.source_ids.filter(id=>id!==s.id));change();draw();})));}
 function groupCard(d,g,i){return h('section.intake-material-group',{},input('材料组名称',g.name,v=>g.name=v,{max:120}),input('文字材料',g.text,v=>g.text=v,{area:true,max:12000}),h('label.p-switch',{},h('input',{type:'checkbox',checked:g.audio_required,onchange:e=>{g.audio_required=e.target.checked;change();draw();}}),'这组需要配套音频'),...g.items.map((a,j)=>h('div.intake-attachment',{},input('附件名称',a.name,v=>a.name=v,{max:120}),h('p',{},a.kind==='audio'?'音频':a.kind==='image'?'图片':a.kind==='link'?'外链':'文件'),a.kind==='link'?input('外链地址',a.url,v=>a.url=v,{max:2000}):a.url?h('span',{},'已上传到家里电脑'):h('span.p-warn',{},'尚未上传成功'),a.kind==='image'&&(a.url||a.blob)?h('img.notebook-preview',{src:a.url||cachedUrl(a.blob),alt:a.name}):null,a.kind==='audio'&&(a.url||a.blob)?Media.AudioPlayer(a.url||cachedUrl(a.blob)).el:null,a.error?btn('重试上传',()=>run(()=>upload(a))):null,order(g.items,j),btn('移除附件',()=>{g.items.splice(j,1);change();draw();}))),fileButton('添加图片、音频或PDF',g.items),btn('添加外链',()=>{g.items.push({kind:'link',name:'学习网站',url:''});change();draw();}),g.audio_required&&!g.items.some(a=>a.kind==='audio'&&a.token)?h('p.p-warn',{},'待补音频：还没有可用的配套音频文件。'):null,order(d.materials,i),btn('删除材料组',()=>{if(!confirm('移除这组草稿材料？已保存的任务不会改变。'))return;d.materials.splice(i,1);change();draw();}));}
 function draftCard(d,i,compact=false){return h('section.notebook-draft',{},compact?null:h('h3',{},'作业 '+(i+1)),
  compact?null:select('科目',d.subject,[['','待选择'],...(state.child==='child_b'?['思维城堡','文化传承','魔法王国','Big English','语文','数学','英语','其他']:['语文','数学','英语','其他']).map(s=>[s,s])],v=>d.subject=v),input('任务标题',d.title,v=>{d.title=v;d.autoTitle=false;},{max:100}),compact?null:input('具体要求',d.first_step,v=>d.first_step=v,{area:true}),input('这项作业日期',d.day,v=>d.day=v,{type:'date'}),
  h('details',{},h('summary',{},'对照原文与原图'),h('pre.intake-original',{},d.original_requirement||'手动添加'),...state.sources.filter(s=>d.source_ids.includes(s.id)).map(s=>h('div',{},h('strong',{},s.name),s.kind==='image'?h('button.p-btn',{type:'button',onclick:()=>Media.openMaterial(s.url,s.name,{audience:'parent',backLabel:'返回校对'})},'查看原图'):null,h('pre.intake-original',{},s.original_text??s.text)))),
  d.warnings?.length?h('div.p-warn',{},...d.warnings.map(w=>h('p',{},w)),h('label.p-switch',{},h('input',{type:'checkbox',checked:d.reviewed,onchange:e=>{d.reviewed=e.target.checked;change();}}),'已对照原文核对')):null,
  select('分类',d.home_group,[['学校作业','学校作业'],['英语作业','英语作业'],['高途','脑王思维'],['itinerary','兴趣班'],['课外','课外／其他']],v=>{d.home_group=v;if(v==='itinerary'){d.task_kind='itinerary';d.photo_required=false;}}),
  select('完成方式',d.task_kind,[['reading','直接完成'],['paper','纸笔，等家长检查'],['audio','朗读录音'],['itinerary','兴趣班']],v=>{d.task_kind=v;d.photo_required=state.child==='child_a'&&v==='paper';if(v==='itinerary'){d.home_group='itinerary';d.photo_required=false;}}),state.child==='child_a'&&d.task_kind!=='itinerary'?h('label.p-switch',{},h('input',{type:'checkbox',checked:d.photo_required,onchange:e=>{d.photo_required=e.target.checked;change();}}),'需要拍照检查'):null,
  h('h4',{},'对应材料（按组展示）'),...d.materials.map((g,j)=>groupCard(d,g,j)),btn('＋添加材料组',()=>{d.materials.push({name:'材料 '+(d.materials.length+1),text:'',items:[],audio_required:false});change();draw();}),
  h('details',{},h('summary',{},'拆分或合并'),h('p',{},'拆分后请分别编辑要求并分配材料；原始要求仍可对照。'),btn('拆出一项空草稿',()=>{state.drafts.splice(i+1,0,{...clone(d),id:uid(),title:d.subject+' · 新拆分作业',first_step:'',materials:[],warnings:[],reviewed:false});change();draw();}),select('合并到另一项','',[['','选择目标'],...state.drafts.filter(x=>x!==d).map(x=>[x.id,x.title])],id=>{const t=state.drafts.find(x=>x.id===id);if(!t||t===d)return;if(t.day!==d.day||t.subject!==d.subject){message('请先把两项科目和日期核对一致再合并。');return;}t.first_step+='\n'+d.first_step;t.original_requirement+='\n'+d.original_requirement;t.source_ids=[...new Set([...t.source_ids,...d.source_ids])];t.materials.push(...d.materials);t.warnings=[...new Set([...(t.warnings||[]),...(d.warnings||[])])];t.reviewed=false;state.drafts.splice(i,1);}),),order(state.drafts,i),btn('移除这项草稿',()=>{if(!confirm('只移除此草稿，原始来源仍保留，继续吗？'))return;state.drafts.splice(i,1);change();draw();}));}
 async function organize(){
  if(state.drafts.length&&!confirm('重新整理会替换当前草稿及材料对应关系；来源保留。继续吗？'))return;
  if(!state.sources.length)throw Error('先放入文字或图片。');
  if(!state.child)throw Error('请先选择孩子。');
  for(const s of state.sources)if(s.kind==='image'){if(!s.token)await upload(s);if(!s.text.trim())try{await recognize(s);}catch(e){s.error=e.message;}}
  state.sources.forEach(s=>{if(s.original_text===undefined)s.original_text=s.text;});
  const r=await request('organize',{child_id:state.child,sources:cleanSources(),sheet:true});
  state.drafts=[...r.drafts.map(d=>newRow(d)),...reviewEdits(r.review)];
  state.review=[];state.review_resolved=true;state.allow_missing_audio=false;
  message(state.drafts.length?'已整理，请对照原图核对。':'未找到可分科的作业，可以手动填写。');
 }
 function verify(r,p){
  if(r.state!=='saved'||r.child_id!==p.child_id||r.tasks?.length!==p.drafts.length)throw Error('保存结果尚未核对一致，请查询保存结果。');
  for(let i=0;i<p.drafts.length;i++){const t=r.tasks[i],d=p.drafts[i];for(const k of ['title','first_step','day','subject','home_group','task_kind','original_requirement'])if(t[k]!==(['title','first_step'].includes(k)?d[k].trim():d[k]))throw Error('保存结果尚未核对一致，请查询保存结果。');if(t.child_id!==p.child_id||stable(t.materials)!==stable(d.materials.map(g=>({...g,items:g.items.map(a=>a.kind==='link'?a:{...a,url:'/lan/notebook/asset?token='+a.token})}))))throw Error('材料关联尚未核对一致，请查询保存结果。');}
 }
 async function publish(){
  let p=state.operation?.payload;
  if(!p){if(!state.child||!state.drafts.length)throw Error('请选择孩子，并核对至少一项作业。');if(state.review.length&&!state.review_resolved)throw Error('请先处理待选科目。');
   if(!editing)for(const d of state.drafts){
    if(marker.test(d.first_step)||marker.test(d.title))throw Error('请对照原图补全标出的页码与题号。');
    if(d.autoTitle&&d.subject)d.title=makeTitle(d.subject,d.first_step);
    d.reviewed=true;
   }
   p={...(editing?{task_id:editing.id,expected_version:editing.version}:{}),child_id:state.child,sheet:!editing,sources:cleanSources(),drafts:state.drafts.map(cleanDraft),review_resolved:state.review_resolved||!state.review.length,allow_missing_audio:state.allow_missing_audio,confirmed:true,operation_id:uid()};
   for(const d of p.drafts){if(!d.subject||!d.title.trim()||!d.first_step.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(d.day)||d.warnings?.length&&!d.reviewed)throw Error('请核对每项科目、标题、要求、日期和标出的疑问。');if(d.materials.some(g=>g.audio_required&&!g.items.some(a=>a.kind==='audio'))&&!p.allow_missing_audio)throw Error('有音频待补，请先补文件或勾选稍后补齐。');}
   state.operation={payload:p};try{clearTimeout(persistTimer);await localDraft(key,'put',clone(state));}catch(e){state.operation=null;throw Error('草稿暂存失败，暂未发送保存。请保留页面并释放浏览器空间后重试。');}
  }
  message('正在保存并读回核对…');let r;try{r=await request(editing?'update-materials':'publish',p);}catch(e){if(e.status===400)state.operation=null;else if(e.status===409){const q=await request('status',{operation_id:p.operation_id,child_id:p.child_id});if(q.state==='not_saved')state.operation=null;}throw e;}verify(r,p);state.result=r;state.operation=null;await localDraft(key,'delete');onSaved?.();message(editing?'材料已保存并读回核对。':'已确认添加 '+r.tasks.length+' 项。');
 }
 async function query(){if(!state.operation)return;const r=await request('status',{operation_id:state.operation.payload.operation_id,child_id:state.operation.payload.child_id});if(r.state==='saved'){verify(r,state.operation.payload);state.result=r;state.operation=null;await localDraft(key,'delete');onSaved?.();message('已查到保存结果，不会重复添加。');}else{message('尚未查到已保存记录。可安全重试同一次保存。');}}
 const subjectChoices=()=>[
  ['', '待选科目'], ...['语文','数学','英语',...(state.child==='child_b'?['思维城堡','文化传承','魔法王国','Big English']:[]),'其他'].map(x=>[x,x])
 ];
 const marker=/〔(?:页码|题号)待核对〕/;
 const makeTitle=(subject,value)=>subject+' · '+value.replace(/\s+/g,' ').trim().slice(0,60);
 function sortDrafts(a,b){
  const order=subjectChoices().map(([value])=>value);
  const rank=subject=>subject?order.indexOf(subject):order.length+1;
  return rank(a.subject)-rank(b.subject);
 }
 function newRow(values={}){
  return {id:uid(),day:state.day,subject:'',title:'',first_step:'',original_requirement:'',source_ids:[],
   task_kind:'reading',home_group:'学校作业',photo_required:false,materials:[],warnings:[],reviewed:true,autoTitle:true,...values};
 }
 function reviewEdits(entries) {
  return entries.map(entry=>newRow({first_step:entry.unreadable?'':entry.text,
   original_requirement:entry.unreadable?'':entry.text,source_ids:[entry.source_id]}));
 }
 function moveSubject(d,subject) {
  d.subject=subject;
  if(d.autoTitle&&subject)d.title=makeTitle(subject,d.first_step);
  // Whole groups can change subject. Keep every line and its source when the
  // destination already has homework with the same date and category.
  const target=subject&&state.drafts.find(other=>other!==d&&other.subject===subject&&
   other.day===d.day&&other.home_group===d.home_group);
  if(target){
   const items=[target,d].sort((a,b)=>state.drafts.indexOf(a)-state.drafts.indexOf(b));
   target.first_step=items.map(item=>item.first_step).filter(Boolean).join('\n');
   target.original_requirement=items.map(item=>item.original_requirement).filter(Boolean).join('\n');
   target.source_ids=[...new Set(items.flatMap(item=>item.source_ids))];
   target.materials=items.flatMap(item=>item.materials);
   target.warnings=[...new Set(items.flatMap(item=>item.warnings||[]))];
   if(d.task_kind==='paper')target.task_kind='paper';
   target.photo_required=state.child==='child_a'&&target.task_kind==='paper'&&Boolean(target.photo_required||d.photo_required);
   if(target.autoTitle)target.title=makeTitle(subject,target.first_step);
   state.drafts.splice(state.drafts.indexOf(d),1);
  }
  change();draw();
 }
 function sheetRow(d){
  const subjects=subjectChoices();
  if(d.subject&&!subjects.some(([v])=>v===d.subject))subjects.push([d.subject,d.subject]);
  const warn=h('span.intake-inline-warn',{role:'status',hidden:!marker.test(d.first_step)},'请在标注处补全');
  const area=h('textarea',{'data-testid':'intake-sheet-text','aria-label':(d.subject||'待选科目')+'作业文字',
   rows:Math.min(10,Math.max(2,d.first_step.split('\n').length+1)),maxlength:4000,
   placeholder:'直接输入或核对作业',oninput:e=>{
    d.first_step=e.target.value;
    if(d.autoTitle&&d.subject)d.title=makeTitle(d.subject,d.first_step);
    warn.hidden=!marker.test(d.first_step);change();
   }},d.first_step);
  const title=h('select.p-input',{'aria-label':'科目','data-testid':'intake-sheet-subject',
   onchange:e=>moveSubject(d,e.target.value)},...subjects.map(([v,label])=>h('option',{value:v,selected:v===d.subject},label)));
  // Advanced controls stay available for older custom homework and attachments.
  return h('section.intake-sheet-row',{'data-testid':'intake-sheet-row','data-subject':d.subject},
   h('header',{},title,warn),area,
   h('details.intake-sheet-more',{},h('summary',{},'更多操作'),draftCard(d,state.drafts.indexOf(d),true)));
 }
 const primary=(label,fn)=>h('button.p-btn.primary.intake-primary',{type:'button','data-safe':'yes',
  'data-testid':'intake-step-primary',onclick:fn},label);
 function fullSource(s,index){
  if(s.kind!=='image')return null;
  const src=s.blob?cachedUrl(s.blob):s.url;
  return h('figure.intake-full-source',{},h('img',{'data-testid':'intake-full-source',src,alt:'完整原图 '+(index+1)}),
   state.sources.length>1?h('figcaption',{},s.name):null,s.error?h('p.p-warn',{},s.error):null);
 }
 function drawSheet() {
  const hasDrafts=state.drafts.length>0;
  const sources=state.sources.map(fullSource).filter(Boolean);
  const addPhoto=fileButton('选作业照片',state.sources,true);
  const sheet=h('section.intake-work-sheet',{'data-testid':'intake-work-sheet'},h('h3',{},'作业单'),
   ...state.drafts.slice().sort(sortDrafts).map(sheetRow),
   hasDrafts?h('details.intake-sheet-more',{},h('summary',{},'作业单选项'),
    btn('手动补一项',()=>{state.drafts.push(newRow());change();draw();}),
    state.drafts.some(d=>d.materials.some(g=>g.audio_required&&!g.items.some(a=>a.kind==='audio'&&a.token)))?
     h('label.p-switch',{},h('input',{type:'checkbox',checked:state.allow_missing_audio,onchange:e=>{state.allow_missing_audio=e.target.checked;change();}}),'缺少音频时先添加，保留待补提示'):null):null,
   !hasDrafts?h('p.intake-sheet-empty',{},'识别后在这里校对。'):null);
  const sourcePane=h('section.intake-source-pane',{'aria-label':'原图'},h('h3',{},'原图'),
   ...sources, !sources.length?addPhoto:null,
   h('details.intake-sheet-more',{},h('summary',{},'原图与录入选项'),
    sources.length?addPhoto:null,...state.sources.map(sourceCard),btn('粘贴文字',()=>{
     state.sources.push({id:uid(),name:'文字来源 '+(state.sources.length+1),kind:'text',text:''});change();draw();
    }),hasDrafts?btn('重新识别',()=>run(organize)):null,
    !hasDrafts?btn('手动填写',()=>{state.drafts.push(newRow());change();draw();}):null,
    btn('清除草稿',clearDraft,true)));
  replaceBody(
   h('div.intake-sheet-settings',{},
    select('孩子',state.child,[['','请选择孩子'],...Object.entries(kids).map(([id,k])=>[id,k.name])],
     v=>{state.child=v;state.drafts.forEach(d=>d.photo_required=v==='child_a'&&d.task_kind==='paper');}),
    input('作业日期',state.day,v=>{const old=state.day;state.day=v;state.drafts.forEach(d=>{if(d.day===old)d.day=v;});},{type:'date'})),
   h('div.intake-sheet-split',{},sourcePane,sheet),
   state.operation?h('p.p-warn',{},'上次保存结果待确认。可重试同一次保存。'):null,
   h('div.intake-sheet-footer',{},
    hasDrafts?h('small',{'data-testid':'intake-summary'}):null,
    primary(state.operation?'重试保存':hasDrafts?'确认添加':'一键识别',()=>run(hasDrafts?publish:organize)),
    state.operation?btn('查询结果',()=>run(query),true):null));
  summary();controls();
 }
 async function clearDraft(){
  if(state.operation){message('请先确认上次保存结果，再清除草稿。');return;}
  if(!confirm('清除这批未保存草稿？已添加的任务和附件会保留。'))return;
  clearTimeout(persistTimer);await localDraft(key,'delete');
  urls.forEach(url=>URL.revokeObjectURL(url));urls.clear();
  state={version:2,child:state.child,day:state.day,sources:[],drafts:[],review:[],operation:null,result:null};
  draw();message('草稿已清除。');
 }
 function draw(){
  if(state.result){replaceBody(h('h3',{},editing?'已保存的材料':'已添加的作业'),...state.result.tasks.map(t=>h('section.notebook-draft',{},h('h4',{},t.title),h('p',{},kids[t.child_id].name+' · '+t.day),h('pre.intake-original',{},t.first_step),Media.materialGroups(t,{audience:'parent'}).el)),editing?null:primary('继续添加',()=>{state={version:2,child:state.child,day:state.day,sources:[],drafts:[],review:[],review_resolved:false,allow_missing_audio:false,operation:null,result:null};message('可以继续添加。');draw();persist();},true));retention.textContent='这批任务已保存到家里 Mac；此批浏览器草稿已清除。';return;}
  if(editing){const d=state.drafts[0];replaceBody(h('h3',{},editing.title),h('p',{},kids[state.child].name+' · '+editing.day),...d.materials.map((g,i)=>groupCard(d,g,i)),btn('＋添加材料组',()=>{d.materials.push({name:'材料 '+(d.materials.length+1),text:'',items:[],audio_required:false});change();draw();}),h('label.p-switch',{},h('input',{type:'checkbox',checked:state.allow_missing_audio,onchange:e=>{state.allow_missing_audio=e.target.checked;change();}}),'缺少的音频稍后再补，继续显示待补提示'),btn(state.operation?'重试这次保存':'保存材料',()=>run(publish),true),state.operation?btn('查询保存结果',()=>run(query),true):null);controls();return;}
  drawSheet();
 }
 root.addEventListener('play',e=>{if(e.target.tagName==='AUDIO'){window.Voice?.stop();root.querySelectorAll('audio').forEach(a=>{if(a!==e.target)a.pause();});}},true);
 draw();busy=true;controls();localDraft(key,'get').then(saved=>{if(saved?.version===2){state=saved;if(!editing&&!state.operation&&state.review?.length&&!state.review_resolved){
    state.drafts.push(...reviewEdits(state.review));state.review=[];state.review_resolved=true;persist();
   }message('已恢复未保存的草稿。');}retention.textContent='草稿暂存在此浏览器；图片和附件只到家里电脑。';}).catch(()=>{retention.textContent='浏览器暂存不可用，刷新前请先完成保存。';}).finally(()=>{busy=false;draw();});
 return root;
}
function rulesPage(child){
 const kids=APP_CONFIG.CHILDREN,box=h('section.p-card',{}),host=h('div');
 const selected=h('select.p-input',{'aria-label':'简写适用孩子'},...Object.entries(kids).map(([v,k])=>h('option',{value:v,selected:v===child},k.name)));
 async function load(){const ch=selected.value;host.textContent='正在读取…';try{const call=async body=>{const r=await fetch('/lan/notebook/rules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({child_id:ch,...body})});if(!r.ok)throw Error('规则尚未保存，可能已被另一页修改，请重开再试。');return r.json();};const current=await call({});if(selected.value!==ch)return;host.replaceChildren(NotebookRules.editor(current.rules,async rules=>{const r=await call({save:true,confirmed:true,revision:current.revision,rules});current.revision=r.revision;},kids[ch].name));}catch(e){host.textContent=e.message;}}
 selected.onchange=load;box.append(h('label.p-field',{},'适用孩子',selected),host);load();return box;
}
window.Notebook={mount,rulesPage,editMaterials:(task,onSaved)=>mount(task.day,onSaved,{child:task.child_id,editTask:task})};
})();
