(()=>{
'use strict';
const q=new URLSearchParams(location.search),game=q.get('game')==='schulte'?'schulte':'dots';
const $=id=>document.getElementById(id),board=$('board'),status=$('status');let size=3,next=1,count=0,startedAt=0,timer=null,active=false,voiceToken=0,voiceWatch=null,currentUtterance=null;
const words=game==='dots'?'把手抬起来，在圆圈里面点点点！':'从小到大，一个一个点！';
$('title').textContent=game==='dots'?'打点 · 悬肘打点点触版':'找数字 · 舒尔特方格';$('instruction').textContent=game==='dots'?'点中 8 个圆圈，大小会变化。':'从 1 开始，按顺序找到数字。';
const backQuery=new URLSearchParams(q);backQuery.delete('game');$('back').href='joey.html?'+backQuery;
$('options').hidden=game!=='schulte';
function stop(){voiceToken++;Voice.stop();}
function speak(text){stop();const token=voiceToken,hint=$('voice-hint');hint.textContent='';Voice.unlock();
 Voice.play(text,null,{gesture:true,ignoreMuted:true,onStart:()=>{if(token!==voiceToken)return;hint.textContent='';$('speak').classList.remove('needs-voice');},onFailure:()=>{if(token!==voiceToken)return;hint.textContent='还没播出声音，点“听玩法”再试一次。';$('speak').classList.add('needs-voice');}});}
$('speak').onclick=()=>speak(words);
function exit(){stop();clearInterval(timer);if(window.parent!==window)parent.postMessage({type:'xb-games-exit'},location.origin);else location.href='../index.html?transport=lan#/joey';}
$('exit').onclick=exit;
$('back').onclick=()=>{stop();clearInterval(timer);};window.addEventListener('pagehide',()=>{stop();clearInterval(timer);});
function finish(text){active=false;clearInterval(timer);status.textContent=text;speak(text);$('again').textContent='再玩一轮';}
function dots(){
 count=0;board.className='';board.replaceChildren();status.textContent='点中 0 / 8';$('timer').hidden=true;
 const sizes=[300,240,200,270,180,230,190,160],circle=document.createElement('button');circle.className='dot-target';circle.type='button';circle.setAttribute('aria-label','第1个圆圈');circle.dataset.testid='dot-target';
 const paint=()=>{circle.style.width='min(70vw,'+sizes[Math.min(count,7)]+'px)';circle.setAttribute('aria-label','第'+(count+1)+'个圆圈');};
 const add=()=>{if(!active||count>=8)return;count++;if(count===8){circle.classList.add('done');circle.disabled=true;circle.textContent='✓';circle.setAttribute('aria-label','八个圆圈完成');finish('点中了 8 个！真棒，可以休息一下。');}else{status.textContent='点中 '+count+' / 8';paint();}};
 circle.addEventListener('pointerdown',e=>{if(e.isPrimary===false||e.button>0||!active)return;e.preventDefault();const r=circle.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*100,y=(e.clientY-r.top)/r.height*100;if(Math.hypot(x-50,y-50)>47){status.textContent='点在圆圈里面，再试一次。';return;}add();});
 circle.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();add();}});paint();board.append(circle);
}
function numbers(){
 next=1;board.className='grid';board.style.setProperty('--size',size);board.replaceChildren();status.textContent='先找 1';$('timer').hidden=false;startedAt=Date.now();$('timer').textContent='用时 0 秒';timer=setInterval(()=>$('timer').textContent='用时 '+Math.floor((Date.now()-startedAt)/1000)+' 秒',250);
 const values=Array.from({length:size*size},(_,i)=>i+1);for(let i=values.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[values[i],values[j]]=[values[j],values[i]];}
 for(const value of values){const button=document.createElement('button');button.type='button';button.className='number';button.textContent=value;button.dataset.number=value;button.setAttribute('aria-label','数字 '+value);button.onclick=()=>{if(!active)return;if(value!==next){status.textContent='再看一看，找 '+next;button.classList.remove('wrong');void button.offsetWidth;button.classList.add('wrong');return;}button.classList.add('found');button.disabled=true;next++;if(next>size*size){$('timer').textContent='用时 '+Math.floor((Date.now()-startedAt)/1000)+' 秒';finish('都找到了！真棒！');if(size===3)document.querySelector('[data-size="4"]').disabled=false;}else status.textContent='接着找 '+next;};board.append(button);}
}
function reset(){stop();clearInterval(timer);active=false;board.replaceChildren();status.textContent='点“开始”，听玩法再玩。';$('timer').hidden=true;$('start').hidden=false;$('again').hidden=true;}
$('start').onclick=()=>{active=true;$('start').hidden=true;$('again').hidden=false;speak(words);game==='dots'?dots():numbers();};
$('again').onclick=reset;document.querySelector('[data-size="4"]').disabled=true;
document.querySelectorAll('[data-size]').forEach(button=>button.onclick=()=>{size=Number(button.dataset.size);document.querySelectorAll('[data-size]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));reset();});reset();
// A future book-page background can be added to #board without changing the hit or number rules.
})();
