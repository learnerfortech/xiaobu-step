(()=>{
'use strict';
const M=ThinkingModel,$=id=>document.getElementById(id),q=new URLSearchParams(location.search),game=q.get('game')==='patterns'?'patterns':'rules';
let level=1,rounds=[],index=0,answered=false,epoch=0,lastWords='',started=0,corrections=0;
const texts={rules:'看上面的卡片。先找颜色一样的，再换成形状一样的，最后听口令切换。每次只按当前规则选。',patterns:'看一排图形怎么重复，选出接下来的一个。选错没关系，我们一起听一听规律。',color:'现在按颜色，选和上面卡片颜色一样的。',shape:'现在按形状，选和上面卡片形状一样的。',correct:'对啦！想好了再点下一题。',finish:'这一轮完成啦！你认真看了规则，也找到了规律。可以休息一下。'};
$('title').textContent=game==='rules'?'规则换换换':'下一个是什么';$('intro').textContent=texts[game];$('levels').hidden=game!=='rules';
$('back').href='joey.html?'+new URLSearchParams({embed:q.get('embed')||'1',mute:q.get('mute')||'0'});
function shape(t){const el=document.createElement('span');el.className='shape '+t.size;el.setAttribute('role','img');el.setAttribute('aria-label',M.name(t));const c=M.colors.find(c=>c.id===t.color).hex;el.innerHTML='<svg aria-hidden="true" viewBox="0 0 100 100">'+(t.shape==='circle'?`<circle cx="50" cy="50" r="44" fill="${c}"/>`:t.shape==='square'?`<rect x="8" y="8" width="84" height="84" rx="12" fill="${c}"/>`:`<path d="M50 5 97 92H3Z" fill="${c}"/>`)+'</svg>';return el;}
function speak(text,after){lastWords=text;const e=epoch;Voice.unlock();$('voice-hint').textContent='';Voice.play(text,()=>{if(e===epoch)after?.();},{gesture:true,ignoreMuted:true,onFailure:()=>{if(e!==epoch)return;$('voice-hint').textContent='声音没播出来，点“再听一次”；也可以按屏幕提示继续。';after?.();}});}
function stop(){epoch++;Voice.stop();}
function exit(){stop();if(parent!==window)parent.postMessage({type:'xb-games-exit'},location.origin);else location.href='../index.html?transport=lan#/joey';}
$('exit').onclick=exit;$('done').onclick=exit;$('back').onclick=stop;window.addEventListener('pagehide',stop);
function settings(){stop();$('setup').hidden=false;$('play').hidden=true;$('result').hidden=true;$('voice-hint').textContent='';$('length').textContent=game==='rules'?`${level===1?18:24} 小题 · 约 2～4 分钟，可随时返回`:'8 小题 · 四种规律，慢慢找';}
document.querySelectorAll('[data-level]').forEach(b=>b.onclick=()=>{level=Number(b.dataset.level);document.querySelectorAll('[data-level]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));settings();});
function draw(){
 stop();answered=false;$('feedback').textContent='';$('demo').hidden=true;$('demo').replaceChildren();$('next').hidden=true;
 const r=rounds[index];$('round').textContent=`第 ${index+1} / ${rounds.length} 题`;$('progress').max=rounds.length;$('progress').value=index;
 $('rule').textContent=game==='rules'?r.phase+' · '+(r.rule==='color'?'颜色一样':'形状一样'):'看看下一个';
 $('prompt').textContent=game==='rules'?texts[r.rule]:'按顺序看，接下来该放哪一个？';
 $('stimulus').replaceChildren();
 if(game==='rules'){const box=document.createElement('div');box.className='target-card';box.append(shape(r.target),'和这张比一比');$('stimulus').append(box);}else{r.items.forEach(t=>$('stimulus').append(shape(t)));const gap=document.createElement('span');gap.className='missing';gap.textContent='?';$('stimulus').append(gap);}
 $('choices').className=r.choices.length===2?'two':'';$('choices').replaceChildren();
 r.choices.forEach(t=>{const b=document.createElement('button');b.className='choice';b.dataset.key=t.key;b.setAttribute('aria-label',M.name(t));const label=document.createElement('small');label.textContent=M.name(t);b.append(shape(t),label);b.onclick=()=>choose(t,b);$('choices').append(b);});
 speak(game==='rules'?texts[r.rule]:'看看这一排，接下来该放哪一个？');
}
function choose(t,b){
 if(answered)return;const r=rounds[index];Voice.stop();
 if(t.key===r.answer){answered=true;b.classList.add('correct');document.querySelectorAll('.choice').forEach(x=>x.disabled=true);$('feedback').textContent='找对了！';$('demo').hidden=true;$('next').hidden=false;$('next').textContent=index===rounds.length-1?'完成这一轮':'下一题';speak(texts.correct);return;}
 corrections++;b.classList.add('retry');$('feedback').textContent='一起看看，再选一次。';
 const explanation=game==='patterns'?r.explain:r.rule==='color'?'这次只看颜色，先不看形状。找和上面卡片颜色一样的。':'这次只看形状，先不看颜色。找和上面卡片形状一样的。';
 $('demo').replaceChildren();const p=document.createElement('p');p.textContent=explanation;$('demo').append(p);$('demo').hidden=false;
 if(game==='patterns'){for(let i=0;i<r.items.length;i+=r.unit.length){const unit=document.createElement('span');unit.className='demo-unit';r.items.slice(i,i+r.unit.length).forEach(t=>unit.append(shape(t)));$('demo').append(unit);}const answer=document.createElement('span');answer.className='demo-unit';answer.append('接着 ',shape(r.answerToken));$('demo').append(answer);}
 speak(explanation);
}
$('instructions').onclick=()=>speak(texts[game]);
$('start').onclick=()=>{rounds=game==='rules'?M.rules(level):M.sequence();index=0;corrections=0;started=Date.now();$('setup').hidden=true;$('result').hidden=true;$('play').hidden=false;draw();};
$('hear').onclick=()=>speak(lastWords||texts[game]);
$('next').onclick=()=>{if(!answered)return;if(++index<rounds.length)return draw();stop();$('play').hidden=true;$('result').hidden=false;$('summary').textContent=`完成 ${rounds.length} 小题 · ${game==='rules'?'练习了颜色、形状和口令切换':'找过两两交替、成对重复、三个一组和大小交替'}。`;speak(texts.finish);};
$('again').onclick=settings;settings();
// Pinch lock never blocks a single finger's normal vertical scroll.
for(const event of ['gesturestart','gesturechange'])document.addEventListener(event,e=>e.preventDefault(),{passive:false});
document.addEventListener('touchmove',e=>{if(e.touches.length>1)e.preventDefault();},{passive:false});
})();
