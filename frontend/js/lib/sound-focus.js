/* One audio focus shared by same-origin parent and game frames. No background sound. */
(()=>{
'use strict';
let host=window;try{while(host.parent!==host){void host.parent.document;host=host.parent;}}catch(_){}
if(!host.__xiaobuSoundFocus){
 const owners=new Map();let active=null;
 host.__xiaobuSoundFocus={
  register(id,stop){owners.set(id,stop);},
  claim(id){for(const [other,stop] of owners)if(other!==id){try{stop();}catch(_){}}active=id;},
  release(id){if(active===id)active=null;},
  remove(id){try{owners.get(id)?.();}catch(_){}owners.delete(id);if(active===id)active=null;},
  stopAll(){for(const stop of owners.values())try{stop();}catch(_){}active=null;},
  get active(){return active;}
 };
}
const focus=window.SoundFocus=Object.create(host.__xiaobuSoundFocus),own=new Map();
// Includes native controls used by materials and the parent detail view.
function bind(media){
 if(own.has(media))return own.get(media);
 const id={media};own.set(media,id);focus.register(id,()=>media.pause());
 media.addEventListener('play',()=>focus.claim(id));
 for(const event of ['pause','ended','error'])media.addEventListener(event,()=>focus.release(id));
 return id;
}
focus.trackMedia=function(media){return bind(media);};
document.addEventListener('play',e=>{if(e.target instanceof HTMLMediaElement)focus.claim(bind(e.target));},true);
window.addEventListener('pagehide',()=>{for(const id of own.values())focus.remove(id);own.clear();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)focus.stopAll();});
})();
