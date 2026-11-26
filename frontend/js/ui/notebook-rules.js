/* Subject aggregation only; preserve source wording, no OCR guesses or automatic publication. */
(()=>{
const example={subjects:[['M','数学'],['C','语文'],['E','英语']]};
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function validate(r){for(const key of ['subjects']){if(!Array.isArray(r[key])||r[key].length>20)throw Error('每类最多二十条规则。');const seen=new Set();for(const [a,b]of r[key]){if(!a.trim()||!b.trim()||a.length>16||b.length>50)throw Error('请填完整简称与含义。');const k=a.trim().toUpperCase();if(seen.has(k))throw Error('同一简称重复或含义冲突，请只保留一条。');seen.add(k);}}return r;}
function parse(text,r={subjects:[]}){
 const labels=[['语文','语文'],['数学','数学'],['英语','英语'],['语','语文'],['数','数学'],['英','英语'],...(r.subjects||[])].sort((a,b)=>b[0].length-a[0].length);
 const groups=new Map(),ignored=[],review=[];
 let current='';
 // OCR boxes are lines, not tasks. Only explicit subject sections establish ownership.
 // Keep separators and numbering in each subject's requirement; never expand book/page shorthand.
 for(const fragment of text.match(/[^\n；;]+[；;]?/g)||[]){
  const raw=fragment.trim();if(!raw)continue;
  const probe=raw.replace(/[；;]$/,'').trim();
  if(/^(学校作业|今日作业|家庭作业|作业|记事本|作业记录)[：:]?$/.test(probe)){
   ignored.push(raw);current='';continue;
  }
  if(/^[\p{P}\p{S}\s]+$/u.test(probe)||/^(收到[，,！!。\s]*(谢谢老师)?|谢谢老师[！!。]?|\d{1,2}:\d{2}|返回|微信|聊天信息)$/.test(probe)){
   ignored.push(raw);continue;
  }
  let body=raw,matched=false;
  for(const [a,sub]of labels){
   const m=new RegExp('^'+esc(a)+'(?=$|[\\s:：、.．；;]|[\\u3400-\\u9fff]|[Pp]\\d)','i').exec(body);
   if(!m)continue;
   const after=body.slice(m[0].length);
   if(/^[A-Za-z]/.test(after)&&!/^P\d/i.test(after))continue;
   if(/^(老师|课代表|文老师)/.test(after))continue;
   current=sub;body=after.replace(/^[\s:：、.．]+/,'');matched=true;break;
  }
  if(matched&&(!body||/^[\p{P}\p{S}\s]+$/u.test(body)||[current,current+'作业','作业'].includes(body.replace(/[：:；;]$/,'').trim()))){ignored.push(raw);continue;}
  // Unknown section markers must not leak into the preceding known subject.
  if(!matched&&(/^[A-Za-z](?=$|[\s:：、.．]|[\u3400-\u9fff]|[Pp]\d)/.test(body)||/^[A-Za-z\u3400-\u9fff][^\s：:；;]{0,11}[：:]/.test(body)||/^(科学|道法|道德与法治|体育|美术|音乐|其他|待核对)[：:]?$/.test(body)))current='';
  if(!current){review.push(raw);continue;}
  let item=groups.get(current);
  if(!item){item={subject:current,title:'',first_step:'',source_text:'',task_kind:'reading',home_group:'学校作业',photo_required:false,warnings:[],reviewed:false};groups.set(current,item);}
  item.first_step+=(item.first_step?'\n':'')+body;
  item.source_text+=(item.source_text?'\n':'')+raw;
  const kind=/网球|上课|培训|兴趣班/.test(body)?'itinerary':/练习册|练册|写|做.*题|计算|口算|习题/.test(body)?'paper':'reading';
  const group=kind==='itinerary'?'itinerary':/带.*(笔|书|材料|衣服|服装)/.test(body)?'课外':'学校作业';
  if(item.source_text===raw){item.task_kind=kind;item.home_group=group;}
  else if(kind==='paper'&&item.task_kind==='reading')item.task_kind='paper';
  if(group!==item.home_group)item.warnings.push('同科包含不同安排，请核对类型和分类');
  if(/[?？□�]/.test(body)||/\bP\s*\d+[A-Za-z]/i.test(body))item.warnings.push('页码、题号或缺字需要对照原文核对');
  for(const m of body.matchAll(/(?:P|第)\s*(\d+)\s*[—–-]\s*(\d+)/gi))if(+m[1]>+m[2])item.warnings.push('页码范围起止需核对');
  if(/明天|后天|下周/.test(body))item.warnings.push('相对日期需按老师消息日期核对，未自动换算截止日');
 }
 const items=[...groups.values()];
 for(const item of items){
  item.title=item.subject+' · '+item.first_step.replace(/\s+/g,' ').slice(0,60);
  item.warnings=[...new Set(item.warnings)];
 }
 return {items,ignored,review};
}
function editor(initial,onSave,scope){
 const h=(tag,a={},...children)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(a)){if(k==='class')e.className=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(k==='value')e.value=v;else e.setAttribute(k,v);}children.flat().forEach(c=>e.append(c instanceof Node?c:String(c)));return e;};
 let r=JSON.parse(JSON.stringify(initial||{subjects:[],materials:[]}));const root=h('section',{class:'panel p-card notebook-intake'}),rows=h('div'),status=h('p',{role:'status'}),preview=h('p',{class:'hint'}),test=h('input',{value:'M 册 P26','aria-label':'简写预览',oninput:drawPreview});
 function drawPreview(){try{validate(r);const parsed=parse(test.value,r);preview.textContent=[...parsed.items.map(t=>t.subject+'｜'+t.first_step),...(parsed.review.length?['待核对｜'+parsed.review.join('；')]:[])].join('；')||'请输入简写查看预览';}catch(e){preview.textContent=e.message;}}
 function draw(){rows.replaceChildren();for(const[k,title]of [['subjects','科目代号']]){rows.append(h('h3',{},title));r[k].forEach((pair,i)=>{const a=h('input',{value:pair[0],'aria-label':title+'简称',oninput:e=>{pair[0]=e.target.value;drawPreview();}});let b;if(k==='subjects'){b=h('select',{'aria-label':'对应科目',onchange:e=>{pair[1]=e.target.value;drawPreview();}},...['语文','数学','英语','其他'].map(s=>h('option',{value:s},s)));b.value=pair[1];}else b=h('input',{value:pair[1],'aria-label':'完整名称',oninput:e=>{pair[1]=e.target.value;drawPreview();}});rows.append(h('div',{class:'rules-row'},a,b,h('button',{type:'button',class:'btn p-btn',onclick:()=>{r[k].splice(i,1);draw();}},'删除')));});rows.append(h('button',{type:'button',class:'btn p-btn',onclick:()=>{r[k].push(['',k==='subjects'?'语文':'']);draw();}},'＋添加'+title));}drawPreview();}
 const save=h('button',{type:'button',class:'btn primary p-btn',onclick:async()=>{try{validate(r);save.disabled=true;await onSave({subjects:JSON.parse(JSON.stringify(r.subjects))});status.textContent='已保存，只影响之后解析或主动重新生成的草稿。';}catch(e){status.textContent=e.message||'还没保存，请重试。';}finally{save.disabled=false;}}},'确认启用并保存规则');
 root.append(h('h2',{},'记事本简写'),h('p',{},'按确认的科目代号分科；页码、题号照原文保留。'),h('button',{type:'button',class:'btn p-btn',onclick:()=>{r=JSON.parse(JSON.stringify(example));draw();status.textContent='已填入示例，保存后启用。';}},'填入 M／C／E 示例'),rows,h('h3',{},'解析预览'),test,preview,save,status);draw();return root;
}
window.NotebookRules={parse,validate,editor,example};
})();
