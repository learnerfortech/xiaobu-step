/* 团团 Tuan — 小步 · Tidy Steps 的向导角色（可复用组件）
   分层 SVG + 弹簧骨骼（每个关节一个阻尼弹簧 → 自然的过冲与跟随），状态机驱动。
   用法：
     const t = new Tuan(hostEl, {state:'idle'});
     t.set('idle'|'happy'|'cheer'|'think'|'wave'|'point', opts)
     t.pointAt(elementOrNull)   // 侧身、伸手指向目标，眼睛跟过去
     t.talk(true/false) / t.talkFor(ms) / t.syllable()   // 嘴型同步
     t.play('cheer') → 播放一次后回到之前的基础状态
   只改 SVG transform / 少量属性；尊重 prefers-reduced-motion。 */
(function(){
const NS='http://www.w3.org/2000/svg';
let SEQ=0;
const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rnd=(a,b)=>a+Math.random()*(b-a);

function Spring(x,k,d){return {x,v:0,t:x,k:k||180,d:d||14};}

function svgMarkup(id){
 const g=n=>`tt${id}${n}`;
 return `<svg class="tuan" viewBox="-10 -30 220 250" aria-label="团团" role="img" style="overflow:visible">
 <defs>
  <radialGradient id="${g('b')}" cx="38%" cy="28%" r="78%"><stop offset="0" stop-color="#FFD9A8"/><stop offset=".45" stop-color="#FFAA5C"/><stop offset="1" stop-color="#F27A1E"/></radialGradient>
  <radialGradient id="${g('y')}" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#FFE7CF"/></radialGradient>
  <radialGradient id="${g('e')}" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#FFB27A"/><stop offset="1" stop-color="#F27A1E"/></radialGradient>
  <linearGradient id="${g('l')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7EEB97"/><stop offset="1" stop-color="#1FAE4E"/></linearGradient>
  <linearGradient id="${g('a')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF9F52"/><stop offset="1" stop-color="#F0771C"/></linearGradient>
 </defs>
 <ellipse class="t-shadow" cx="100" cy="210" rx="58" ry="8" fill="#E86A12" opacity=".22"/>
 <g class="t-root">
  <g class="t-feet"><ellipse cx="74" cy="199" rx="21" ry="12" fill="#E86A12"/><ellipse cx="126" cy="199" rx="21" ry="12" fill="#E86A12"/>
   <ellipse cx="70" cy="194" rx="9" ry="3.5" fill="#FFB27A" opacity=".8"/><ellipse cx="122" cy="194" rx="9" ry="3.5" fill="#FFB27A" opacity=".8"/></g>
  <g class="t-body">
   <g class="t-earL"><circle cx="50" cy="56" r="23" fill="url(#${g('e')})"/><circle cx="50" cy="56" r="11.5" fill="#FFC9A6"/></g>
   <g class="t-earR"><circle cx="150" cy="56" r="23" fill="url(#${g('e')})"/><circle cx="150" cy="56" r="11.5" fill="#FFC9A6"/></g>
   <circle cx="100" cy="116" r="78" fill="url(#${g('b')})"/>
   <path d="M34 150 A78 78 0 0 0 166 150" stroke="#FFD36B" stroke-width="7" fill="none" opacity=".45" stroke-linecap="round"/>
   <ellipse cx="100" cy="146" rx="48" ry="40" fill="url(#${g('y')})"/>
   <ellipse cx="68" cy="62" rx="24" ry="12" fill="#fff" opacity=".55" transform="rotate(-28 68 62)"/><circle cx="92" cy="48" r="4.5" fill="#fff" opacity=".7"/>
   <g class="t-leaf"><path d="M100 40 Q98 28 101 18" stroke="#139440" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M101 22 C110 2 138 4 134 22 C126 16 114 18 104 28Z" fill="url(#${g('l')})"/><path d="M106 22 Q118 14 128 16" stroke="#fff" stroke-width="2.4" fill="none" opacity=".55" stroke-linecap="round"/></g>
   <g class="t-face">
    <g class="t-brows" opacity="0"><path d="M64 84 Q76 76 88 82" stroke="#2A2342" stroke-width="4.5" fill="none" stroke-linecap="round"/><path d="M112 78 Q124 70 136 78" stroke="#2A2342" stroke-width="4.5" fill="none" stroke-linecap="round"/></g>
    <g class="t-eyes">
     <g class="t-eyeL"><ellipse cx="76" cy="104" rx="10.5" ry="13" fill="#2A2342"/><circle cx="80" cy="98.5" r="4.4" fill="#fff"/><circle cx="72.5" cy="109.5" r="1.9" fill="#fff"/></g>
     <g class="t-eyeR"><ellipse cx="124" cy="104" rx="10.5" ry="13" fill="#2A2342"/><circle cx="128" cy="98.5" r="4.4" fill="#fff"/><circle cx="120.5" cy="109.5" r="1.9" fill="#fff"/></g>
    </g>
    <g class="t-happy" opacity="0"><path d="M64 108 Q76 92 88 108" stroke="#2A2342" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M112 108 Q124 92 136 108" stroke="#2A2342" stroke-width="6" fill="none" stroke-linecap="round"/></g>
    <ellipse class="t-cheekL" cx="56" cy="128" rx="12" ry="7.5" fill="#FF5E78" opacity=".42"/><ellipse class="t-cheekR" cx="144" cy="128" rx="12" ry="7.5" fill="#FF5E78" opacity=".42"/>
    <path class="t-smile" d="M88 126 Q100 139 112 126" stroke="#2A2342" stroke-width="5" fill="none" stroke-linecap="round"/>
    <g class="t-open" opacity="0"><ellipse class="t-mo" cx="100" cy="130" rx="9" ry="6" fill="#6B1F2A"/><ellipse class="t-tg" cx="100" cy="134" rx="6" ry="3" fill="#FF7D8E"/></g>
    <g class="t-big" opacity="0"><path d="M80 122 Q100 160 120 122 Z" fill="#6B1F2A" stroke="#2A2342" stroke-width="3" stroke-linejoin="round"/><path d="M89 141 Q100 151 111 141 Q100 134 89 141Z" fill="#FF7D8E"/></g>
    <circle class="t-o" cx="107" cy="131" r="5" fill="#6B1F2A" opacity="0"/>
   </g>
   <g class="t-armL"><path d="M44 135 L44 171" stroke="#D9580C" stroke-width="25" stroke-linecap="round" opacity=".35"/><path d="M42 132 L42 168" stroke="#FF9A47" stroke-width="24" stroke-linecap="round"/><path d="M37 134 L37 160" stroke="#FFC48A" stroke-width="5" stroke-linecap="round" opacity=".8"/><circle cx="42" cy="172" r="13.5" fill="#FFA554"/><ellipse cx="38" cy="167" rx="5" ry="3.5" fill="#fff" opacity=".6"/></g>
   <g class="t-armR"><path d="M160 135 L160 171" stroke="#D9580C" stroke-width="25" stroke-linecap="round" opacity=".35"/><path d="M158 132 L158 168" stroke="#FF9A47" stroke-width="24" stroke-linecap="round"/><path d="M153 134 L153 160" stroke="#FFC48A" stroke-width="5" stroke-linecap="round" opacity=".8"/><g class="t-finger" opacity="0"><path d="M158 176 L158 194" stroke="#FFA554" stroke-width="10" stroke-linecap="round"/></g><circle cx="158" cy="172" r="13.5" fill="#FFA554"/><ellipse cx="154" cy="167" rx="5" ry="3.5" fill="#fff" opacity=".6"/></g>
    </g>
  <g class="t-dots" opacity="0"><circle class="t-d1" cx="168" cy="28" r="6" fill="#fff" stroke="#BDB7CC" stroke-width="2"/><circle class="t-d2" cx="184" cy="10" r="8" fill="#fff" stroke="#BDB7CC" stroke-width="2"/><circle class="t-d3" cx="196" cy="-14" r="11" fill="#fff" stroke="#BDB7CC" stroke-width="2"/></g>
 </g>
</svg>`;}

class Tuan{
 constructor(host,opts={}){
  this.host=host; this.id=++SEQ; host.innerHTML=svgMarkup(this.id);
  const q=s=>host.querySelector(s); this.el={svg:q('svg'),root:q('.t-root'),body:q('.t-body'),armL:q('.t-armL'),armR:q('.t-armR'),earL:q('.t-earL'),earR:q('.t-earR'),
   leaf:q('.t-leaf'),face:q('.t-face'),eyeL:q('.t-eyeL'),eyeR:q('.t-eyeR'),eyes:q('.t-eyes'),happy:q('.t-happy'),smile:q('.t-smile'),open:q('.t-open'),mo:q('.t-mo'),tg:q('.t-tg'),
   big:q('.t-big'),o:q('.t-o'),brows:q('.t-brows'),finger:q('.t-finger'),dots:q('.t-dots'),d:[q('.t-d1'),q('.t-d2'),q('.t-d3')],shadow:q('.t-shadow'),cheekL:q('.t-cheekL'),cheekR:q('.t-cheekR')};
  this.S={ x:Spring(0,120,14), y:Spring(0,260,18), lean:Spring(0,90,11), sx:Spring(1,320,13), sy:Spring(1,320,13),
   armL:Spring(24,140,11), armR:Spring(-24,140,11), earL:Spring(0,160,7), earR:Spring(0,160,7), leaf:Spring(0,70,4.5),
   lx:Spring(0,140,16), ly:Spring(0,140,16), mouth:Spring(0,900,40), brow:Spring(0,120,14), happy:Spring(0,200,20), big:Spring(0,300,24), o:Spring(0,200,20), dots:Spring(0,120,14), finger:Spring(0,200,18), reach:Spring(0,160,13), cheek:Spring(1,200,12) };
  this.base='idle'; this.state='idle'; this.token=0; this.jumpA=null; this.talking=false; this.talkUntil=0; this.syl={ph:0,amp:.8,rate:7};
  this.blinkAt=performance.now()+rnd(1200,3200); this.blinkT=-1; this.lookAt=performance.now()+rnd(3000,6000); this.target=null; this.t0=performance.now();
  this.last=performance.now(); this._tick=this._tick.bind(this); this.alive=true; requestAnimationFrame(this._tick);
  this.set(opts.state||'idle');
 }
 destroy(){this.alive=false;}
 /* ---------- 状态机 ---------- */
 set(state,opts={}){
  const S=this.S; this.state=state; const tk=++this.token; this.target=null;
  if(['idle','think','wave','point'].includes(state)) this.base=state;
  // 复位到中性姿势，再由各状态覆盖
  Object.assign(S.happy,{t:0}); S.big.t=0; S.o.t=0; S.brow.t=0; S.dots.t=0; S.finger.t=0; S.reach.t=0; S.lean.t=0; S.cheek.t=1;
  S.armL.t=24; S.armR.t=-24; S.lx.t=0; S.ly.t=0; S.sx.t=1; S.sy.t=1;
  if(state==='happy'){ S.happy.t=1; S.armL.t=38; S.armR.t=-38; S.cheek.t=1.35; this.jump(26,340); S.earL.v-=260; S.earR.v+=260;
   this._later(tk,1300,()=>this.set(this.base)); }
  if(state==='cheer'){ // 蓄力 → 起跳拉伸 → 落地压扁 → 再跳一次 → 回落
   S.sy.t=.8; S.sx.t=1.16; S.armL.t=12; S.armR.t=-12; S.y.t=4; S.happy.t=1; S.cheek.t=1.4;
   this._later(tk,150,()=>{S.sy.t=1; S.sx.t=1; S.y.t=0; S.big.t=1; S.armL.t=168; S.armR.t=-168; this.jump(RM?10:74,560);});
   this._later(tk,760,()=>{this.jump(RM?6:42,440);});
   this._later(tk,1300,()=>{S.armL.t=150; S.armR.t=-150;});
   this._later(tk,1750,()=>this.set(this.base)); }
  if(state==='think'){ S.lean.t=-7; S.armR.t=70; S.lx.t=5; S.ly.t=-6; S.brow.t=1; S.o.t=1; S.dots.t=1; }
  if(state==='wave'){ S.armR.t=-150; S.happy.t=.0; S.cheek.t=1.2; }
  if(state==='point'){ this.target=opts.target||null; S.finger.t=1; S.reach.t=1; }
  if(state==='idle'){ }
  return this;
 }
 play(state){ this.set(state); return this; }
 pointAt(el){ if(!el){ this.set('idle'); return this;} return this.set('point',{target:el}); }
 _later(tk,ms,fn){ setTimeout(()=>{ if(this.alive&&tk===this.token) fn(); },ms); }
 jump(h,dur){ this.jumpA={h,dur,start:performance.now()}; }
 /* ---------- 说话 ---------- */
 talk(on){ this.talking=on; if(on){this.talkUntil=Infinity;} else this.talkUntil=0; }
 talkFor(ms){ this.talking=true; this.talkUntil=performance.now()+ms; }
 syllable(){ this.syl.ph=0; this.syl.amp=1; }
 setLevelSource(fn){ this.levelFn=fn; }  // 真实音频的口型包络（0..1；返回 null 时用估算）
 /* ---------- 每帧 ---------- */
 _tick(now){
  if(!this.alive) return; requestAnimationFrame(this._tick);
  if(!this.host.isConnected){ this.alive=false; return; }
  let dt=Math.min(.05,(now-this.last)/1000); this.last=now; const S=this.S, t=(now-this.t0)/1000;
  // 说话：音节振荡器（onboundary 时重置相位 → 与真实语音对齐）
  if(this.talking && now>this.talkUntil) this.talking=false;
  const lv = (this.talking && this.levelFn) ? this.levelFn() : null;
  if(lv!=null){ S.mouth.t = lv>.04 ? .12+.88*lv : .02; }
  else if(this.talking){ this.syl.ph+=dt*this.syl.rate*Math.PI; if(this.syl.ph>Math.PI){ this.syl.ph-=Math.PI; this.syl.amp=rnd(.45,1); this.syl.rate=rnd(5.5,8.5); if(Math.random()<.12) this.syl.amp=.1; }
   S.mouth.t=.12+.88*Math.abs(Math.sin(this.syl.ph))*this.syl.amp; } else S.mouth.t=0;
  // 待机：呼吸 + 眨眼 + 偶尔东张西望
  const breath=RM?0:Math.sin(t*2.1);
  if(this.state==='idle' && now>this.lookAt){ this.lookAt=now+rnd(3500,7000); S.lx.t=rnd(-6,6); S.ly.t=rnd(-4,3); S.lean.t=S.lx.t*.6;
   setTimeout(()=>{ if(this.state==='idle'){S.lx.t=0;S.ly.t=0;S.lean.t=0;} },rnd(900,1600)); }
  if(now>this.blinkAt){ this.blinkT=now; this.blinkAt=now+rnd(2200,5200); if(Math.random()<.2) this.blinkAt=now+260; }
  let blink=1; if(this.blinkT>0){ const b=(now-this.blinkT)/150; blink= b<1? 1-Math.sin(b*Math.PI)*.92 : 1; }
  // 指向：根据目标元素实时计算手臂角度、身体前倾、视线
  let tap=0;
  if(this.state==='point' && this.target && this.target.isConnected){
   const r=this.el.svg.getBoundingClientRect(), tr=this.target.getBoundingClientRect(), k=r.width/220;
   const tx=tr.left+tr.width/2, ty=tr.top+tr.height/2, left = tx < r.left+(100+10)*k;
   const sx=r.left+((left?42:158)+10)*k, sy=r.top+(132+30)*k, dx=tx-sx, dy=ty-sy;
   let ang=Math.atan2(-dx,dy)*180/Math.PI;
   if(left){ ang=clamp(ang<0?179:ang,20,178); S.armL.t=ang; S.armR.t=-24; S.finger.t=0; }
   else { if(ang>0) ang=ang>90?-179:-20; ang=clamp(ang,-178,-20); S.armR.t=ang; S.finger.t=1; }
   this.pointLeft=left; S.lean.t=clamp(dx/40,-9,9); S.lx.t=clamp(dx/50,-7,7); S.ly.t=clamp(dy/70,-6,5);
   tap=RM?0:Math.sin(t*2*Math.PI*1.4)*7; }
  if(this.state==='wave'){ tap=Math.sin(t*2*Math.PI*1.8)*24; }
  // 跳跃（抛物线，不用弹簧）+ 速度驱动的拉伸，落地给弹簧一个压扁冲量
  let jy=0;
  if(this.jumpA){ const p=(now-this.jumpA.start)/this.jumpA.dur;
   if(p>=1){ S.sy.v-= RM?0:5.5; S.sx.v+= RM?0:4.5; S.earL.v+=320; S.earR.v-=320; S.leaf.v-=420; this.jumpA=null; }
   else { jy=-this.jumpA.h*4*p*(1-p); const vel=Math.abs(1-2*p); S.sy.x=1+.12*vel; S.sx.x=1-.08*vel; } }
  // 跟随动作：叶子和耳朵被身体速度带着晃
  S.leaf.t= -S.lean.x*1.4 - S.x.v*.05 + (RM?0:Math.sin(t*1.3)*3);
  S.earL.t= -S.lean.x*.6; S.earR.t= -S.lean.x*.6;
  for(const k in S){ const s=S[k]; const steps=Math.ceil(dt/0.008); const h=dt/steps; for(let i=0;i<steps;i++){ const a=s.k*(s.t-s.x)-s.d*s.v; s.v+=a*h; s.x+=s.v*h; } }
  // 应用
  const E=this.el, m=S.mouth.x;
  const sy=S.sy.x*(1+breath*.022)+m*.012, sx=S.sx.x*(1-breath*.014);
  E.root.setAttribute('transform',`translate(${S.x.x} ${S.y.x+jy}) rotate(${S.lean.x} 100 206)`);
  E.body.setAttribute('transform',`translate(100 206) scale(${sx} ${sy}) translate(-100 -206)`);
  const pl=this.state==='point'&&this.pointLeft;
  const off=(a,on)=>{const r=a*Math.PI/180, d=on?S.reach.x*24:0; return `translate(${(-Math.sin(r)*d).toFixed(2)} ${(Math.cos(r)*d).toFixed(2)}) `;};
  const aL=S.armL.x+(pl?-tap:0), aR=S.armR.x+(pl?0:tap);
  E.armL.setAttribute('transform',`${off(aL,pl)}rotate(${aL} 42 132)`);
  E.armR.setAttribute('transform',`${off(aR,!pl)}rotate(${aR} 158 132)`);
  E.earL.setAttribute('transform',`rotate(${S.earL.x} 62 72)`); E.earR.setAttribute('transform',`rotate(${S.earR.x} 138 72)`);
  E.leaf.setAttribute('transform',`rotate(${S.leaf.x} 100 40)`);
  E.face.setAttribute('transform',`translate(${S.lx.x} ${S.ly.x+m*1.5})`);
  const hp=clamp(S.happy.x,0,1); const eo=(1-hp);
  E.eyes.setAttribute('opacity',eo.toFixed(3)); E.happy.setAttribute('opacity',hp.toFixed(3));
  const bl=clamp(blink,0.06,1);
  E.eyeL.setAttribute('transform',`translate(76 104) scale(1 ${bl}) translate(-76 -104)`); E.eyeR.setAttribute('transform',`translate(124 104) scale(1 ${bl}) translate(-124 -104)`);
  const big=clamp(S.big.x,0,1), o=clamp(S.o.x,0,1)*(m<.05?1:0);
  const talkVis= m>.04 && big<.5;
  E.big.setAttribute('opacity',big.toFixed(3)); E.big.setAttribute('transform',`translate(100 122) scale(${.6+.4*big}) translate(-100 -122)`);
  E.open.setAttribute('opacity',talkVis?1:0); E.mo.setAttribute('ry',(2+12*m).toFixed(2)); E.mo.setAttribute('rx',(8+4*m).toFixed(2));
  E.tg.setAttribute('cy',(130+(2+12*m)*.45).toFixed(2)); E.tg.setAttribute('ry',(1+3.5*m).toFixed(2)); E.tg.setAttribute('rx',(4+3*m).toFixed(2));
  E.o.setAttribute('opacity',o.toFixed(3));
  E.smile.setAttribute('opacity',(talkVis||big>.5||o>.5)?0:1);
  E.brows.setAttribute('opacity',clamp(S.brow.x,0,1).toFixed(3)); E.brows.setAttribute('transform',`translate(0 ${-(S.brow.x)*3})`);
  const dts=clamp(S.dots.x,0,1); E.dots.setAttribute('opacity',dts.toFixed(3));
  E.d.forEach((c,i)=>{const s=dts*(.85+.15*Math.sin(t*4-i*.9)); c.setAttribute('transform',`translate(${[168,184,196][i]} ${[28,10,-14][i]}) scale(${s}) translate(${-[168,184,196][i]} ${-[28,10,-14][i]})`);});
  E.finger.setAttribute('opacity',clamp(S.finger.x,0,1).toFixed(3));
  const ck=S.cheek.x; E.cheekL.setAttribute('rx',(12*ck).toFixed(2)); E.cheekR.setAttribute('rx',(12*ck).toFixed(2));
  const lift=-(S.y.x+jy); const sc=clamp(1-lift/160,.45,1.1);
  E.shadow.setAttribute('transform',`translate(100 210) scale(${sc} ${sc}) translate(-100 -210)`); E.shadow.setAttribute('opacity',(.22*sc).toFixed(3));
 }
}
window.Tuan=Tuan;
})();
