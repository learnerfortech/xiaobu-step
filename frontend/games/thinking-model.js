/* Pure round generation: no task state, rewards, network or timers. */
(()=>{
const colors=[{id:'red',name:'红色',hex:'#d85d55'},{id:'blue',name:'蓝色',hex:'#3d81c4'},{id:'gold',name:'黄色',hex:'#d5a131'}];
const shapes=[{id:'circle',name:'圆形'},{id:'square',name:'方形'},{id:'triangle',name:'三角形'}];
const shuffle=(items,rng=Math.random)=>{const a=items.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const token=(color,shape,size='normal')=>({color,shape,size,key:color+'-'+shape+'-'+size});
const name=t=>(t.size==='small'?'小':t.size==='large'?'大':'')+colors.find(c=>c.id===t.color).name+shapes.find(s=>s.id===t.shape).name;
function rules(level=1,rng=Math.random){
 const block=level===2?4:6,total=level===2?24:18,mixed=['color','shape','shape','color'];
 return Array.from({length:total},(_,i)=>{
  const color=colors[Math.floor(rng()*colors.length)].id,shape=shapes[Math.floor(rng()*shapes.length)].id;
  const otherColor=shuffle(colors.filter(c=>c.id!==color),rng)[0].id,otherShape=shuffle(shapes.filter(s=>s.id!==shape),rng)[0].id;
  const rule=i<block?'color':i<block*2?'shape':mixed[(i-block*2)%mixed.length];
  const target=token(color,shape),matchColor=token(color,otherShape),matchShape=token(otherColor,shape);
  const choices=[matchColor,matchShape];if(level===2)choices.push(token(otherColor,otherShape));
  return {rule,phase:i<block?'先按颜色':i<block*2?'换成形状':'听口令切换',target,choices:shuffle(choices,rng),answer:(rule==='color'?matchColor:matchShape).key};
 });
}
const patterns=[
 {type:'ABAB',unit:[token('red','circle'),token('blue','square')],length:6,explain:'红色圆形、蓝色方形，两个一组，反复排。接下来是红色圆形。'},
 {type:'AABB',unit:[token('red','circle'),token('red','circle'),token('blue','square'),token('blue','square')],length:6,explain:'两个红色圆形，再两个蓝色方形，四个一组。现在有两个红色圆形，接下来是蓝色方形。'},
 {type:'ABC',unit:[token('red','circle'),token('blue','square'),token('gold','triangle')],length:7,explain:'红色圆形、蓝色方形、黄色三角形，三个一组。最后是红色圆形，接下来是蓝色方形。'},
 {type:'大小交替',unit:[token('blue','circle','large'),token('blue','circle','small')],length:5,explain:'大圆、小圆，大圆、小圆，大小轮流出现。最后是大圆，接下来是小圆。'},
 {type:'ABAB',unit:[token('gold','triangle'),token('blue','circle')],length:5,explain:'黄色三角形、蓝色圆形，两个一组，反复排。最后是黄色三角形，接下来是蓝色圆形。'},
 {type:'AABB',unit:[token('blue','square'),token('blue','square'),token('gold','triangle'),token('gold','triangle')],length:5,explain:'两个蓝色方形，再两个黄色三角形，四个一组。最后才有一个蓝色方形，还要再接一个蓝色方形。'},
 {type:'ABC',unit:[token('gold','triangle'),token('red','circle'),token('blue','square')],length:6,explain:'黄色三角形、红色圆形、蓝色方形，三个一组。两组排完，接下来又是黄色三角形。'},
 {type:'大小交替',unit:[token('red','square','small'),token('red','square','large')],length:5,explain:'小方形、大方形，小方形、大方形，大小轮流出现。最后是小方形，接下来是大方形。'}
];
function sequence(rng=Math.random){return patterns.map(p=>{
 const items=Array.from({length:p.length},(_,i)=>p.unit[i%p.unit.length]),answer=p.unit[p.length%p.unit.length];
 const pool=p.type==='大小交替'?[token(answer.color,answer.shape,'small'),token(answer.color,answer.shape,'large'),token(answer.color,answer.shape,'normal')]:[...p.unit,token('red','circle'),token('blue','square'),token('gold','triangle'),token('blue','circle')];
 const unique=[...new Map(pool.map(t=>[t.key,t])).values()].filter(t=>t.key!==answer.key);
 return {...p,items,answer:answer.key,answerToken:answer,choices:shuffle([answer,...shuffle(unique,rng).slice(0,2)],rng)};
});}
window.ThinkingModel={colors,shapes,token,name,rules,sequence,patterns};
})();
