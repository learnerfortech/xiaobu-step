/* 小步 · Tidy Steps — 彩纸（自绘 canvas，离线、无依赖）
   Confetti.burst({x,y,count,power}) 从一点炸开；Confetti.rain(ms) 从顶部飘落。
   形状：彩带（翻转）、圆点、星星、小弯条；颜色 = tokens 主色。 */
(function(){
const COLORS=['#1E9BFF','#FF6236','#8257FF','#2CC55A','#FFC414','#FF5E78','#7CC7FF'];
let cv,ctx,P=[],raf=0,dpr=1;
const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
function ensure(){ if(cv&&cv.isConnected) return; cv=document.createElement('canvas'); cv.className='confetti-layer';
 Object.assign(cv.style,{position:'fixed',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:60}); document.body.appendChild(cv); ctx=cv.getContext('2d'); resize(); addEventListener('resize',resize); }
function resize(){ dpr=Math.min(2,devicePixelRatio||1); cv.width=innerWidth*dpr; cv.height=innerHeight*dpr; }
function make(x,y,vx,vy){ const s=Math.random(); return {x,y,vx,vy,rot:Math.random()*6.28,vr:(Math.random()-.5)*14,tilt:Math.random()*6.28,vt:6+Math.random()*10,
 w:9+Math.random()*7,h:14+Math.random()*10,c:COLORS[(Math.random()*COLORS.length)|0],shape:s<.45?'ribbon':s<.7?'dot':s<.88?'star':'squig',life:0,max:2.4+Math.random()*1.2,wob:Math.random()*6.28}; }
function burst(o={}){ if(RM) return; ensure(); const x=o.x??innerWidth/2, y=o.y??innerHeight*.45, n=o.count??90, pw=o.power??1;
 for(let i=0;i<n;i++){ const a=-Math.PI/2+(Math.random()-.5)*Math.PI*1.25, sp=(520+Math.random()*680)*pw*Math.min(1.3,innerWidth/700+.4);
  P.push(make(x,y,Math.cos(a)*sp,Math.sin(a)*sp)); } loop(); }
function rain(ms=1600){ if(RM) return; ensure(); const t0=performance.now(); const tick=()=>{ for(let i=0;i<4;i++) P.push(make(Math.random()*innerWidth,-20,(Math.random()-.5)*120,100+Math.random()*200)); if(performance.now()-t0<ms) setTimeout(tick,40); }; tick(); loop(); }
function star(r){ ctx.beginPath(); for(let i=0;i<10;i++){ const a=i*Math.PI/5-Math.PI/2, rr=i%2?r*.45:r; ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr);} ctx.closePath(); ctx.fill(); }
let last=0;
function loop(){ if(raf) return; last=performance.now(); raf=requestAnimationFrame(step); }
function step(now){ const dt=Math.min(.033,(now-last)/1000); last=now; ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,innerWidth,innerHeight);
 P=P.filter(p=>p.life<p.max && p.y<innerHeight+60);
 for(const p of P){ p.life+=dt; p.vy+=1500*dt; const drag=Math.pow(.18,dt); p.vx*=drag; p.vy=p.vy*drag+ (1-drag)*260; // 末速度 ≈ 飘落
  p.wob+=dt*5; p.x+=(p.vx+Math.sin(p.wob)*40)*dt; p.y+=p.vy*dt; p.rot+=p.vr*dt; p.tilt+=p.vt*dt;
  const fade=Math.min(1,(p.max-p.life)/.5); ctx.globalAlpha=fade; ctx.fillStyle=p.c; ctx.strokeStyle=p.c; ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
  if(p.shape==='ribbon'){ const f=Math.cos(p.tilt); ctx.scale(1,f); ctx.beginPath(); ctx.roundRect? ctx.roundRect(-p.w/2,-p.h/2,p.w,p.h,3):ctx.rect(-p.w/2,-p.h/2,p.w,p.h); ctx.fill();
   ctx.globalAlpha=fade*.35*Math.max(0,f); ctx.fillStyle='#fff'; ctx.fillRect(-p.w/2,-p.h/2,p.w*.35,p.h); }
  else if(p.shape==='dot'){ ctx.scale(1,.6+.4*Math.abs(Math.cos(p.tilt))); ctx.beginPath(); ctx.arc(0,0,p.w*.55,0,6.28); ctx.fill(); }
  else if(p.shape==='star'){ ctx.scale(Math.abs(Math.cos(p.tilt))*.6+.4,1); star(p.w*.9); }
  else { ctx.lineWidth=4; ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(-10,0); ctx.quadraticCurveTo(-5,-8,0,0); ctx.quadraticCurveTo(5,8,10,0); ctx.stroke(); }
  ctx.restore(); }
 ctx.globalAlpha=1;
 if(P.length){ raf=requestAnimationFrame(step);} else { raf=0; ctx.clearRect(0,0,innerWidth,innerHeight); } }
window.Confetti={burst,rain};
})();
