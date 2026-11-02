/* Pinyin practice: existing local recordings only; no live pronunciation synthesis. */
(()=>{
'use strict';
const items=[{"id": "bo1", "level": "bpmf", "py": "bō", "parts": ["b", "o"], "word": "波浪", "emoji": "🌊"}, {"id": "bi3", "level": "bpmf", "py": "bǐ", "parts": ["b", "i"], "word": "铅笔", "emoji": "✏️"}, {"id": "pao3", "level": "bpmf", "py": "pǎo", "parts": ["p", "ao"], "word": "跑步", "emoji": "🏃"}, {"id": "pai2", "level": "bpmf", "py": "pái", "parts": ["p", "ai"], "word": "排队", "emoji": "🧍🧍"}, {"id": "ma1", "level": "bpmf", "py": "mā", "parts": ["m", "a"], "word": "妈妈", "emoji": "👩"}, {"id": "mi3", "level": "bpmf", "py": "mǐ", "parts": ["m", "i"], "word": "大米", "emoji": "🍚"}, {"id": "fei1", "level": "bpmf", "py": "fēi", "parts": ["f", "ei"], "word": "飞机", "emoji": "✈️"}, {"id": "fan4", "level": "bpmf", "py": "fàn", "parts": ["f", "an"], "word": "米饭", "emoji": "🍚"}, {"id": "da3", "level": "dtnl", "py": "dǎ", "parts": ["d", "a"], "word": "打扫", "emoji": "🧹"}, {"id": "di4", "level": "dtnl", "py": "dì", "parts": ["d", "i"], "word": "土地", "emoji": "🌱"}, {"id": "ta1", "level": "dtnl", "py": "tā", "parts": ["t", "a"], "word": "他们", "emoji": "👬"}, {"id": "tu4", "level": "dtnl", "py": "tù", "parts": ["t", "u"], "word": "兔子", "emoji": "🐇"}, {"id": "nai3", "level": "dtnl", "py": "nǎi", "parts": ["n", "ai"], "word": "牛奶", "emoji": "🥛"}, {"id": "ni2", "level": "dtnl", "py": "ní", "parts": ["n", "i"], "word": "泥土", "emoji": "🌱"}, {"id": "la3", "level": "dtnl", "py": "lǎ", "parts": ["l", "a"], "word": "喇叭", "emoji": "📯"}, {"id": "lu4", "level": "dtnl", "py": "lù", "parts": ["l", "u"], "word": "马路", "emoji": "🛣️"}, {"id": "hua1", "level": "triple", "py": "huā", "parts": ["h", "u", "a"], "word": "花朵", "emoji": "🌸"}, {"id": "guo3", "level": "triple", "py": "guǒ", "parts": ["g", "u", "o"], "word": "水果", "emoji": "🍎"}, {"id": "xiong2", "level": "triple", "py": "xióng", "parts": ["x", "i", "ong"], "word": "熊猫", "emoji": "🐼"}, {"id": "liang2", "level": "triple", "py": "liáng", "parts": ["l", "i", "ang"], "word": "凉水", "emoji": "💧"}];
const rules={rounds:6};
const levels=[{id:'bpmf',name:'声母一组',label:'b p m f'},{id:'dtnl',name:'声母二组',label:'d t n l'},{id:'triple',name:'三拼音节',label:'花 · 果 · 熊 · 凉'}];
const shuffle=(values,rng=Math.random)=>{const a=[...values];for(let i=a.length-1;i>0;i--){const n=Math.floor(rng()*(i+1));[a[i],a[n]]=[a[n],a[i]];}return a;};
function session(level,rng=Math.random){
 const pool=shuffle(items.filter(q=>q.level===level),rng);if(!pool.length)throw Error('Unknown pinyin level');
 const out=[];while(out.length<rules.rounds){for(const q of shuffle(pool,rng)){if(out.length===rules.rounds)break;if(out.at(-1)?.id===q.id&&pool.length>1)continue;out.push(q);}}return out;
}
function choices(q,step,rng=Math.random){
 const target=q.parts[step];let pool;
 if(step===0)pool=items.filter(x=>x.level===q.level).map(x=>x.parts[0]);
 else if(q.parts.length===3&&step===1)pool=['i','u'];
 else pool=items.filter(x=>x.level===q.level).map(x=>x.parts.at(-1));
 const wrong=shuffle([...new Set(pool)].filter(x=>x!==target),rng).slice(0,2);
 return shuffle([target,...wrong],rng);
}
window.PinyinCourse={items,rules,levels,session,choices};
let dispose=null;
function stop(){dispose?.();dispose=null;}
function open(root,options={}){
 stop();let alive=true,epoch=0,attempt=0,round=0,step=0,level=options.level||'bpmf',rounds=[],message='',chosen=[];
 let page=null;const active=()=>alive&&page?.isConnected;
 const soundKey=(q,i)=>'py:'+(i===0?'initial:':'final:')+q.parts[i];
 function play(parts){
  const current=++attempt;Voice.unlock();
  Voice.play(parts,()=>{if(!active()||current!==attempt)return;const s=page.querySelector('[data-testid=py-voice-status]');if(s)s.textContent='录音已播完';},{gesture:true,ignoreMuted:true,gapMs:190,recordedOnly:true,
   onStart:()=>{if(!active()||current!==attempt)return;const s=page.querySelector('[data-testid=py-voice-status]');if(s)s.textContent='正在播放录音';},
   onFailure:()=>{if(!active()||current!==attempt)return;const s=page.querySelector('[data-testid=py-voice-status]');if(s)s.textContent='声音还没播出，点“再听目标音”重试。';},
   onStop:()=>{if(!active()||current!==attempt)return;const s=page.querySelector('[data-testid=py-voice-status]');if(s)s.textContent='';}
  });
 }
 function button(text,click,attrs={}){const b=document.createElement('button');b.type='button';b.textContent=text;for(const [k,v] of Object.entries(attrs))b.setAttribute(k,v);b.onclick=click;return b;}
 function target(){const q=rounds[round];play(['py:full:'+q.id,'py:word:'+q.id]);}
 function chooseLevel(value){level=value;options.onLevelChange?.(value);rounds=session(value);round=0;startRound();}
 function chooser(){
  epoch++;attempt++;Voice.stop();page=document.createElement('div');page.className='stage py-stage';
  const title=document.createElement('h1');title.textContent='拼一拼';page.append(title);
  const intro=document.createElement('p');intro.textContent='选一组 · 每局 6 轮';page.append(intro);
  const grid=document.createElement('div');grid.className='py-levels';
  for(const l of levels){const b=button(l.label,()=>chooseLevel(l.id),{'data-level':l.id,'aria-label':l.name+'，'+l.label+'，六轮'});const small=document.createElement('small');small.textContent=l.name; b.append(small);if(l.id===level)b.classList.add('preferred');grid.append(b);}
  page.append(grid);root.replaceChildren(page);
 }
 function startRound(){epoch++;attempt++;Voice.stop();step=0;chosen=[];message='听一听，先找声母';paint();target();}
 function pick(value){
  const q=rounds[round];if(step>=q.parts.length)return;
  const clip='py:'+(step===0?'initial:':'final:')+value;
  if(value!==q.parts[step]){message='再试一试，点喇叭听目标音';paint();play([clip]);return;}
  chosen.push(value);step++;message=step===q.parts.length?'拼好了！听整音节和例词':q.parts.length===3&&step===1?'找到中间的 i 或 u':'再找后面的韵母';paint();
  if(step===q.parts.length)play([clip,'py:full:'+q.id,'py:word:'+q.id]);else play([clip]);
 }
 function paint(){
  const q=rounds[round],complete=step===q.parts.length;
  page=document.createElement('div');page.className='stage py-stage';page.dataset.step=step;page.dataset.round=round+1;
  const head=document.createElement('div');head.className='py-header';
  head.append(button('换一组',chooser,{'aria-label':'换一组拼音'}));const status=document.createElement('strong');status.textContent=levels.find(l=>l.id===level).name+' · '+(round+1)+' / '+rules.rounds;head.append(status);page.append(head);
  const clue=document.createElement('div');clue.className='py-clue';const picture=document.createElement('span');picture.className='py-emoji';picture.textContent=q.emoji;picture.setAttribute('aria-hidden','true');clue.append(picture,button(complete?'再拼一遍':'再听目标音',()=>complete?play(q.parts.map((_,i)=>soundKey(q,i)).concat(['py:full:'+q.id,'py:word:'+q.id])):target(),{'aria-label':complete?'再拼一遍':'再听目标音'}));page.append(clue);
  const hint=document.createElement('p');hint.className='py-instruction';hint.textContent=message;hint.setAttribute('role','status');page.append(hint);
  const slots=document.createElement('div');slots.className='py-slots';
  q.parts.forEach((_,i)=>{const cell=document.createElement('span');cell.className='py-cell'+(i===step?' current':'');cell.textContent=chosen[i]||'·';cell.setAttribute('aria-label',chosen[i]||'第'+(i+1)+'个位置');slots.append(cell);});page.append(slots);
  if(complete){
   const result=document.createElement('div');result.className='py-result';result.dataset.testid='py-result';const pinyin=document.createElement('strong');pinyin.textContent=q.py;const word=document.createElement('span');word.textContent=q.word;result.append(pinyin,word);page.append(result);
   page.append(button(round===rules.rounds-1?'这一局完成':'下一轮',()=>{attempt++;Voice.stop();if(round+1===rules.rounds){page.querySelector('[data-testid=py-next]').disabled=true;options.onFinish?.(level,rules.rounds);return;}round++;startRound();},{'data-testid':'py-next',class:'py-next'}));
  }else{
   const tray=document.createElement('div');tray.className='py-choices';
   for(const value of choices(q,step))tray.append(button(value,()=>pick(value),{'data-choice':value,'data-correct':String(value===q.parts[step]),'aria-label':value,class:'py-letter'}));page.append(tray);
  }
  const voice=document.createElement('p');voice.className='py-voice-status';voice.dataset.testid='py-voice-status';voice.setAttribute('role','status');page.append(voice);
  root.replaceChildren(page);
 }
 dispose=()=>{alive=false;epoch++;attempt++;Voice.stop();};chooser();
 return {stop,chooseLevel};
}
window.PinyinGame={open,stop};
})();
