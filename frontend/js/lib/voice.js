/* Recorded phrases first. One cancellable queue, one sound owner across frames. */
(()=>{
'use strict';
const clips=window.VO_CLIPS||{},norm=t=>String(t).replace(/\s+/g,'').trim();
const el=new Audio();el.preload='auto';el.setAttribute('playsinline','');
const focus=window.SoundFocus,owner={},missing=new Set(),listeners={start:[],end:[],fail:[],ok:[]};
let token=0,cancel=null,cur=null,status='idle',muted=false,last=null,lastOptions={},voices=[];
const emit=(key,arg)=>(listeners[key]||[]).forEach(fn=>{try{fn(arg);}catch(_){}});
function loadVoices(){try{voices=window.speechSynthesis?.getVoices()||[];}catch(_){}}
loadVoices();window.speechSynthesis?.addEventListener('voiceschanged',loadVoices);
function stop(){
 token++;const finish=cancel;cancel=null;finish?.(false);el.pause();
 // Cancel only our utterance; stopping an idle iframe must not cancel the parent's new speech.
 if(cur?.utterance)try{speechSynthesis.cancel();}catch(_){}
 const interrupted=cur;cur=null;status='idle';focus?.release(owner);if(interrupted){emit('end');interrupted.onStop?.();}
}
focus?.register(owner,stop);window.addEventListener('pagehide',()=>{stop();focus?.remove(owner);});
function unlock(){try{if(window.speechSynthesis?.paused)speechSynthesis.resume();}catch(_){} }
function segment(text,clip,tk,options){return new Promise(resolve=>{
 let done=false,started=false,watch=null,timeout=null,u=null;
 const cleanup=()=>{clearTimeout(watch);clearTimeout(timeout);el.removeEventListener('playing',onStart);el.removeEventListener('ended',onEnd);el.removeEventListener('error',onError);if(u)u.onstart=u.onend=u.onerror=null;};
 const finish=ok=>{if(done)return;done=true;cleanup();if(cancel===finish)cancel=null;resolve(ok);};
 const warn=()=>{if(done||tk!==token)return;status='blocked';emit('fail');options.onFailure?.();};
 const onStart=()=>{if(done||tk!==token||started)return;started=true;clearTimeout(watch);status='ok';emit('start',cur);emit('ok');options.onStart?.();};
 const onError=()=>{warn();finish(false);};
 const onEnd=()=>{if(!started)return onError();finish(true);};
 cancel=finish;
 watch=setTimeout(()=>{if(!started)warn();},options.startTimeoutMs||1000);
 if(clip){
  cur={clip,el,onStop:options.onStop};el.src=clip.f;
  el.addEventListener('playing',onStart);el.addEventListener('ended',onEnd);el.addEventListener('error',onError);
  timeout=setTimeout(onError,Math.max(10000,((clip.d||30)+5)*1000));
  try{el.play()?.catch(onError);}catch(_){onError();}
 }else{
  if(!window.speechSynthesis||!window.SpeechSynthesisUtterance)return onError();
  loadVoices();u=new SpeechSynthesisUtterance(String(text));u.lang='zh-CN';u.rate=.88;u.pitch=1;u.volume=1;
  const voice=voices.find(v=>v.localService&&/zh[-_]CN/i.test(v.lang))||voices.find(v=>/^zh/i.test(v.lang));if(voice)u.voice=voice;
  cur={utterance:u,onStop:options.onStop,est:Math.max(800,String(text).length*330)};
  u.onstart=onStart;u.onend=onEnd;u.onerror=onError;
  timeout=setTimeout(onError,Math.max(15000,String(text).length*500+10000));
  try{speechSynthesis.speak(u);if(speechSynthesis.paused)speechSynthesis.resume();}catch(_){onError();}
 }
});}
function pauseGap(ms,tk){return new Promise(resolve=>{const timer=setTimeout(()=>{if(cancel===finish)cancel=null;resolve(tk===token);},ms);const finish=()=>{clearTimeout(timer);resolve(false);};cancel=finish;});}
async function play(parts,onend,options={}){
 stop();parts=Array.isArray(parts)?parts:[parts];last=parts.slice();lastOptions={...options};
 if(muted&&!options.ignoreMuted)return;
 focus?.claim(owner);const tk=++token;status='pending';
 for(let i=0;i<parts.length;i++){
  if(tk!==token)return;
  const text=String(parts[i]),clip=options.audioUrl?{f:options.audioUrl,d:300}:clips[norm(text)];if(!clip)missing.add(norm(text));
  let ok=await segment(text,clip,tk,options);
  if(!ok && tk===token && options.audioUrl && options.fallbackSpeech){el.pause();cur=null;ok=await segment(text,null,tk,options);}
  if(tk!==token)return;
  if(!ok){const utterance=cur?.utterance;el.pause();if(utterance)try{speechSynthesis.cancel();}catch(_){}cur=null;focus?.release(owner);emit('end');return;}
  if(i<parts.length-1&&!(await pauseGap(options.gapMs??160,tk)))return;
 }
 if(tk===token){cur=null;status='ok';focus?.release(owner);emit('end');onend?.();}
}
function level(){if(!cur)return 0;if(!cur.clip)return null;const e=cur.clip.e||'',i=Math.floor((el.currentTime||0)*25);return i<e.length?Number(e[i])/9:0;}
window.Voice={play,stop,unlock,level,el,has:t=>!!clips[norm(t)],replay:cb=>last&&play(last,cb,lastOptions),on:(k,f)=>listeners[k]?.push(f),
 set muted(v){if(muted===!!v)return;muted=!!v;if(muted)stop();},get muted(){return muted;},get status(){return status;},get speaking(){return !!cur;},get missing(){return [...missing];}};
})();
