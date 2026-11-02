/* 小步 · Tidy Steps — 共享原创插画（v4 明亮配色）。全部内联 SVG，无外部图片。 */
let UID=0;const uid=()=>'u'+(++UID);
const ICON={
 door:`<svg viewBox="0 0 32 32"><rect x="6" y="3" width="20" height="27" rx="5" fill="#FF8A63"/><rect x="9.5" y="6.5" width="13" height="23.5" rx="3" fill="#FF6236"/><rect x="9.5" y="6.5" width="13" height="5" rx="2.5" fill="#fff" opacity=".25"/><circle cx="19" cy="18.5" r="2" fill="#FFE066"/></svg>`,
 help:`<svg viewBox="0 0 32 32"><path d="M9 17 V9 a2 2 0 0 1 4 0 V15 V6 a2 2 0 0 1 4 0 V15 V7 a2 2 0 0 1 4 0 V16 V11 a2 2 0 0 1 4 0 V20 C25 26 21 30 16 30 C12 30 9.5 28 7.5 25 L4.5 20 a2 2 0 0 1 3.4 -2 Z" fill="#FFC414" stroke="#E59400" stroke-width="1.6" stroke-linejoin="round"/><path d="M11 9.5 V14 M15 6.5 V13" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".6"/></svg>`,
 sound:`<svg viewBox="0 0 32 32"><path d="M5 12h5l7-6v20l-7-6H5z" fill="#1E9BFF" stroke="#1E9BFF" stroke-width="1.5" stroke-linejoin="round"/><path d="M21 11q4 5 0 10M24.5 8q7 8 0 16" stroke="#1E9BFF" stroke-width="2.8" fill="none" stroke-linecap="round"/></svg>`,
 mute:`<svg viewBox="0 0 32 32"><path d="M5 12h5l7-6v20l-7-6H5z" fill="#BDB7CC" stroke="#BDB7CC" stroke-width="1.5" stroke-linejoin="round"/><path d="M21 12l7 8M28 12l-7 8" stroke="#BDB7CC" stroke-width="2.8" stroke-linecap="round"/></svg>`,
 next:`<svg viewBox="0 0 40 40"><path d="M13 8 L31 20 L13 32 Z" fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round"/></svg>`,
 hand:`<svg viewBox="0 0 80 80" style="overflow:visible"><circle class="ripple" cx="35" cy="14" r="14" fill="none" stroke="#fff" stroke-width="4"/><path d="M30 74 C20 64 16 54 18 46 L22 40 C24 37 28 38 29 41 L30 44 V16 a5 5 0 0 1 10 0 V36 a5 5 0 0 1 9 -2 a5 5 0 0 1 9 1 a5 5 0 0 1 9 2 V54 C67 64 62 72 56 74 Z" fill="#fff" stroke="#2A2342" stroke-width="3.5" stroke-linejoin="round"/><path d="M33 20 V32" stroke="#CFEAFF" stroke-width="3" stroke-linecap="round"/></svg>`
};
// 字母角色：胖方块 + 表情 + 厚度 + 顶部高光（颜色 = --ts-letter-*）
const LC={b:['#5CB8FF','#1E9BFF','#0A6AD6'],a:['#FF8A63','#FF6236','#DB3E14'],o:['#FFE066','#FFC414','#E59400'],i:['#6BE08A','#2CC55A','#139440'],u:['#A98BFF','#8257FF','#5B2FE0']};
function letter(ch,mood){const c=LC[ch],g=uid(),h=uid();return `<svg viewBox="0 0 120 132"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset=".7" stop-color="${c[1]}"/></linearGradient>
 <linearGradient id="${h}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
 <rect x="6" y="16" width="108" height="112" rx="32" fill="${c[2]}"/><rect x="6" y="6" width="108" height="112" rx="32" fill="url(#${g})"/>
 <rect x="20" y="11" width="56" height="16" rx="8" fill="url(#${h})"/>
 ${mood==='sing'?`<path d="M36 38 Q44 30 52 38 M68 38 Q76 30 84 38" stroke="#2A2342" stroke-width="5" fill="none" stroke-linecap="round"/><ellipse cx="60" cy="50" rx="6" ry="7" fill="#6B1F2A"/>`
 :`<ellipse cx="44" cy="36" rx="6.5" ry="7.5" fill="#2A2342"/><ellipse cx="76" cy="36" rx="6.5" ry="7.5" fill="#2A2342"/><circle cx="46.5" cy="33" r="2.5" fill="#fff"/><circle cx="78.5" cy="33" r="2.5" fill="#fff"/><path d="M53 47 Q60 53 67 47" stroke="#2A2342" stroke-width="3.5" fill="none" stroke-linecap="round"/>`}
 <ellipse cx="32" cy="48" rx="7" ry="4.5" fill="#FF5E78" opacity=".35"/><ellipse cx="88" cy="48" rx="7" ry="4.5" fill="#FF5E78" opacity=".35"/>
 <text x="60" y="110" text-anchor="middle" font-family="'TS Baloo','Baloo 2',ui-rounded,sans-serif" font-weight="800" font-size="74" fill="${c[2]}" opacity=".35">${ch}</text>
 <text x="60" y="106" text-anchor="middle" font-family="'TS Baloo','Baloo 2',ui-rounded,sans-serif" font-weight="800" font-size="74" fill="#fff">${ch}</text></svg>`}

// 拼完会活过来的东西
const PIC={
 bus:`<svg viewBox="0 0 240 170"><ellipse cx="120" cy="160" rx="100" ry="8" fill="#000" opacity=".08"/>
  <rect x="20" y="40" width="200" height="100" rx="26" fill="#FFAA00"/><rect x="20" y="40" width="200" height="88" rx="26" fill="#FFC414"/>
  <rect x="36" y="56" width="40" height="34" rx="10" fill="#CFEAFF"/><rect x="84" y="56" width="40" height="34" rx="10" fill="#CFEAFF"/><rect x="132" y="56" width="40" height="34" rx="10" fill="#CFEAFF"/>
  <rect x="180" y="56" width="28" height="58" rx="8" fill="#7CC7FF"/><rect x="20" y="104" width="200" height="8" fill="#FF6236"/>
  <circle cx="62" cy="140" r="18" fill="#2A2342"/><circle cx="62" cy="140" r="7" fill="#C9B8A8"/><circle cx="176" cy="140" r="18" fill="#2A2342"/><circle cx="176" cy="140" r="7" fill="#C9B8A8"/>
  <circle cx="214" cy="118" r="6" fill="#FFF3B0"/><ellipse cx="60" cy="48" rx="26" ry="5" fill="#fff" opacity=".45"/></svg>`,
 pineapple:`<svg viewBox="0 0 240 190"><ellipse cx="120" cy="182" rx="56" ry="7" fill="#000" opacity=".08"/>
  <path d="M120 60 C100 30 92 20 104 8 C112 24 116 30 120 40 C124 30 128 24 136 8 C148 20 140 30 120 60Z" fill="#139440"/><path d="M120 58 C108 38 96 36 90 26 C104 26 114 36 120 46 C126 36 136 26 150 26 C144 36 132 38 120 58Z" fill="#2CC55A"/>
  <ellipse cx="120" cy="118" rx="52" ry="64" fill="#FFAA00"/><ellipse cx="120" cy="114" rx="48" ry="58" fill="#FFC414"/>
  <g stroke="#E59400" stroke-width="3" opacity=".7"><path d="M82 90 L150 160M96 70 L164 140M78 120 L128 172M158 90 L90 160M144 70 L76 138M162 120 L112 172" /></g>
  <circle cx="104" cy="112" r="6" fill="#2A2342"/><circle cx="136" cy="112" r="6" fill="#2A2342"/><circle cx="106" cy="110" r="2" fill="#fff"/><circle cx="138" cy="110" r="2" fill="#fff"/>
  <path d="M110 126 Q120 134 130 126" stroke="#2A2342" stroke-width="3.5" fill="none" stroke-linecap="round"/><ellipse cx="96" cy="126" rx="7" ry="4" fill="#FF5E78" opacity=".5"/><ellipse cx="144" cy="126" rx="7" ry="4" fill="#FF5E78" opacity=".5"/></svg>`,
 pencil:`<svg viewBox="0 0 240 170"><path class="drawline" d="M30 150 C70 110 110 160 150 120 S210 110 226 130" stroke="#1E9BFF" stroke-width="7" fill="none" stroke-linecap="round" stroke-dasharray="260" stroke-dashoffset="260"><animate attributeName="stroke-dashoffset" from="260" to="0" dur="1.4s" fill="freeze"/></path>
  <g transform="rotate(-35 120 80)"><rect x="40" y="62" width="130" height="34" rx="6" fill="#FF6236"/><rect x="40" y="62" width="130" height="12" rx="6" fill="#FF8A63"/>
  <rect x="26" y="62" width="22" height="34" rx="6" fill="#FFB3C1"/><rect x="44" y="62" width="10" height="34" fill="#C9B8A8"/>
  <path d="M170 62 L204 79 L170 96Z" fill="#FFE7CF"/><path d="M194 74 L204 79 L194 84Z" fill="#2A2342"/>
  <circle cx="110" cy="76" r="4.5" fill="#2A2342"/><circle cx="130" cy="76" r="4.5" fill="#2A2342"/><path d="M114 86 Q120 90 126 86" stroke="#2A2342" stroke-width="3" fill="none" stroke-linecap="round"/></g></svg>`,
 steps:`<svg viewBox="0 0 240 170">${[[40,130,-10],[80,96,10],[122,120,-10],[164,84,10],[204,108,-10]].map(([x,y,r],i)=>`<g transform="rotate(${r} ${x} ${y})" opacity="0"><animate attributeName="opacity" from="0" to="1" begin="${i*.28}s" dur=".2s" fill="freeze"/><ellipse cx="${x}" cy="${y}" rx="15" ry="22" fill="#2CC55A"/><circle cx="${x-9}" cy="${y-27}" r="5" fill="#2CC55A"/><circle cx="${x}" cy="${y-30}" r="5.5" fill="#2CC55A"/><circle cx="${x+9}" cy="${y-27}" r="5" fill="#2CC55A"/></g>`).join('')}</svg>`
};
// 绘本道具
function cup(face,fill){fill=fill==null?1:fill;const cc=uid();const y=40+ (1-fill)*70;return `<g>
 <rect x="-34" y="-8" width="68" height="20" rx="8" fill="#FF6236"/><rect x="-34" y="-8" width="68" height="8" rx="4" fill="#FF8A63"/>
 <path d="M-40 12 H40 L33 118 Q32 126 24 126 H-24 Q-32 126 -33 118 Z" fill="#E6F5FF" stroke="#7CC7FF" stroke-width="3"/>
 <clipPath id="${cc}"><path d="M-40 12 H40 L33 118 Q32 126 24 126 H-24 Q-32 126 -33 118 Z"/></clipPath>
 <rect class="water" x="-45" y="${y}" width="90" height="100" fill="#1E9BFF" clip-path="url(#${cc})" style="transition:y .9s ease"/>
 <path d="M-26 22 L-22 100" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".7"/>
 ${face==='sleep'?`<path d="M-18 56 q6 5 12 0 M6 56 q6 5 12 0" stroke="#2A2342" stroke-width="3.5" fill="none" stroke-linecap="round"/>`
 :`<circle cx="-12" cy="56" r="5.5" fill="#2A2342"/><circle cx="12" cy="56" r="5.5" fill="#2A2342"/><circle cx="-10" cy="54" r="2" fill="#fff"/><circle cx="14" cy="54" r="2" fill="#fff"/>`}
 <path d="M-7 70 Q0 ${face==='sleep'?72:77} 7 70" stroke="#2A2342" stroke-width="3.5" fill="none" stroke-linecap="round"/>
 <ellipse cx="-24" cy="70" rx="6" ry="4" fill="#FF5E78" opacity=".5"/><ellipse cx="24" cy="70" rx="6" ry="4" fill="#FF5E78" opacity=".5"/></g>`}
function bag(open){return `<g>
 <path d="M-38 -60 Q0 -110 38 -60" stroke="#B8320E" stroke-width="12" fill="none" stroke-linecap="round"/>
 <rect x="-78" y="-64" width="156" height="170" rx="44" fill="#E8481C"/><rect x="-78" y="-70" width="156" height="166" rx="44" fill="#FF6236"/>
 <ellipse cx="-36" cy="-48" rx="26" ry="8" fill="#fff" opacity=".3"/>
 ${open?`<path d="M-60 -40 Q0 ${open==='wide'?10:-14} 60 -40 Q0 -64 -60 -40Z" fill="#6B1F2A"/>`:`<path d="M-62 -36 Q0 -24 62 -36" stroke="#B8320E" stroke-width="5" fill="none" stroke-linecap="round"/>`}
 <rect x="-54" y="30" width="108" height="56" rx="18" fill="#E8481C"/><rect x="-54" y="30" width="108" height="10" rx="5" fill="#B8320E" opacity=".5"/>
 <circle cx="-24" cy="${open?6:-6}" r="7" fill="#2A2342"/><circle cx="24" cy="${open?6:-6}" r="7" fill="#2A2342"/><circle cx="-21" cy="${open?3:-9}" r="2.4" fill="#fff"/><circle cx="27" cy="${open?3:-9}" r="2.4" fill="#fff"/>
 <ellipse cx="-44" cy="${open?18:6}" rx="9" ry="5" fill="#FFB3A0" opacity=".7"/><ellipse cx="44" cy="${open?18:6}" rx="9" ry="5" fill="#FFB3A0" opacity=".7"/></g>`}
function room(){return `<rect width="800" height="600" fill="#FFF6E3"/><rect y="420" width="800" height="180" fill="#FFDDB0"/>
 <rect x="520" y="70" width="210" height="200" rx="24" fill="#CFEAFF" stroke="#fff" stroke-width="14"/><path d="M625 70 V270 M520 170 H730" stroke="#fff" stroke-width="10"/>
 <circle class="sun" cx="590" cy="130" r="34" fill="#FFC414"/><ellipse cx="680" cy="210" rx="34" ry="14" fill="#fff" opacity=".9"/>
 <ellipse cx="420" cy="530" rx="330" ry="46" fill="#FFCB8E"/><ellipse cx="420" cy="530" rx="280" ry="34" fill="#FFE3BF"/><rect x="120" y="96" width="120" height="96" rx="14" fill="#fff"/><rect x="132" y="108" width="96" height="72" rx="8" fill="#CFEFD5"/><path d="M150 168 l20 -30 l16 22 l10 -12 l18 20z" fill="#2CC55A"/><circle cx="208" cy="128" r="9" fill="#FFC414"/><g transform="translate(748 420)"><rect x="-30" y="-10" width="60" height="64" rx="12" fill="#FF8A63"/><path d="M0 -10 C-40 -60 -50 -100 -20 -120 C-10 -80 0 -60 0 -10Z M0 -10 C30 -70 50 -90 34 -128 C10 -100 4 -60 0 -10Z" fill="#2CC55A"/></g><rect x="70" y="380" width="380" height="26" rx="13" fill="#D98C4E"/><rect x="100" y="406" width="20" height="120" rx="8" fill="#BF7438"/><rect x="400" y="406" width="20" height="120" rx="8" fill="#BF7438"/>`}
// 数一数的原创小精灵
function critter(kind,id){id=uid();
 const face=`<circle cx="-14" cy="6" r="6" fill="#2A2342"/><circle cx="14" cy="6" r="6" fill="#2A2342"/><circle cx="-12" cy="4" r="2.2" fill="#fff"/><circle cx="16" cy="4" r="2.2" fill="#fff"/><path d="M-7 18 Q0 25 7 18" stroke="#2A2342" stroke-width="3.5" fill="none" stroke-linecap="round"/><ellipse cx="-26" cy="16" rx="7" ry="4.5" fill="#FF5E78" opacity=".5"/><ellipse cx="26" cy="16" rx="7" ry="4.5" fill="#FF5E78" opacity=".5"/>`;
 let body='';
 if(kind==='drop') body=`<defs><radialGradient id="g${id}" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#BFE4FF"/><stop offset="1" stop-color="#1E8BF0"/></radialGradient></defs><path d="M0 -62 C-26 -24 -44 -6 -44 18 a44 44 0 0 0 88 0 C44 -6 26 -24 0 -62Z" fill="url(#g${id})"/><ellipse cx="-18" cy="-8" rx="7" ry="13" fill="#fff" opacity=".55"/>`;
 if(kind==='cloud') body=`<defs><radialGradient id="g${id}" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D9E8F7"/></radialGradient></defs><path d="M-46 40 a26 26 0 0 1 -4 -50 a30 30 0 0 1 52 -22 a28 28 0 0 1 48 24 a24 24 0 0 1 -2 48 Z" fill="url(#g${id})" stroke="#C5D9EE" stroke-width="3"/>`;
 if(kind==='sprout') body=`<defs><radialGradient id="g${id}" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#B5F5C4"/><stop offset="1" stop-color="#22B550"/></radialGradient></defs><path d="M0 -40 Q-4 -60 0 -70" stroke="#139440" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M0 -66 C-20 -84 -36 -66 -22 -58 C-14 -54 -6 -60 0 -66Z" fill="#2CC55A"/><path d="M0 -66 C20 -84 36 -66 22 -58 C14 -54 6 -60 0 -66Z" fill="#139440"/><ellipse cx="0" cy="10" rx="48" ry="46" fill="url(#g${id})"/><ellipse cx="-18" cy="-16" rx="12" ry="7" fill="#fff" opacity=".5"/>`;
 return `<svg viewBox="-60 -80 120 140">${body}${face}</svg>`;}
const BUSH=`<svg viewBox="0 0 200 100" preserveAspectRatio="none"><path d="M0 100 Q0 40 40 44 Q50 4 92 20 Q120 -6 150 26 Q196 22 200 70 V100Z" fill="#139440"/><path d="M8 100 Q10 54 44 56 Q56 22 92 34 Q120 12 146 38 Q186 36 192 78 V100Z" fill="#22B550"/><circle cx="60" cy="60" r="5" fill="#FFC414"/><circle cx="140" cy="54" r="5" fill="#FF8A63"/></svg>`;
const MEADOW=`<svg class="bg" viewBox="0 0 800 680" preserveAspectRatio="xMidYMax slice"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#CDEBFF"/><stop offset=".55" stop-color="#EAF7FF"/><stop offset="1" stop-color="#EAF7FF"/></linearGradient></defs>
 <rect width="800" height="680" fill="url(#sky)"/><circle cx="600" cy="120" r="58" fill="#FFE066"/><circle cx="600" cy="120" r="40" fill="#FFC414"/>
 <ellipse cx="260" cy="130" rx="70" ry="24" fill="#fff"/><ellipse cx="300" cy="114" rx="40" ry="24" fill="#fff"/>
 <path d="M0 360 Q200 300 400 350 T800 330 V680 H0Z" fill="#9BE59E"/><path d="M0 430 Q220 380 420 430 T800 410 V680 H0Z" fill="#6FD67A"/></svg>`;
function doorArt(k){
 if(k==='pinyin')return `<svg viewBox="0 0 140 140"><g transform="translate(6 18) scale(.56)">${letter('b').replace('<svg viewBox="0 0 120 132">','<g>').replace('</svg>','</g>')}</g><g transform="translate(72 30) scale(.52)">${letter('a').replace('<svg viewBox="0 0 120 132">','<g>').replace('</svg>','</g>')}</g></svg>`;
 if(k==='book')return `<svg viewBox="0 0 140 140"><path d="M10 30 Q40 18 70 32 Q100 18 130 30 V118 Q100 106 70 120 Q40 106 10 118Z" fill="#fff"/><path d="M70 32 V120" stroke="#E6EEF8" stroke-width="3"/><g transform="translate(100 66) scale(.42)">${cup('awake',.8)}</g><g transform="translate(40 80) scale(.3)">${bag('wide')}</g></svg>`;
 return `<svg viewBox="0 0 140 140"><g transform="translate(44 80) scale(.62)">${critter('drop','d1').replace(/<svg[^>]*>/,'<g>').replace('</svg>','</g>')}</g><g transform="translate(100 88) scale(.5)">${critter('sprout','d2').replace(/<svg[^>]*>/,'<g>').replace('</svg>','</g>')}</g></svg>`;}
