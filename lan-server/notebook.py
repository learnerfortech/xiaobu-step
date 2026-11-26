"""Local notebook OCR and parent-reviewed, atomic subject task creation. No migrations."""
import hashlib,json,re,sqlite3,subprocess,threading,os,tempfile
from collections import OrderedDict
from pathlib import Path
from datetime import date,datetime

SUBJECTS={'语文':'chinese','数学':'math','英语':'english','其他':'other'}
def canonical(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def split_subjects(text):
    # Explicit markers only; uncertain/unlabelled OCR is kept in the editable text, not guessed.
    marker=re.compile(r'(?m)(?:^|[\n；;])\s*(语文|数学|英语|语|数|英)(?=$|[\s：:、.．])\s*[：:、.．]?\s*',re.I)
    matches=list(marker.finditer(text)); groups={}
    names={'语':'语文','数':'数学','英':'英语','M':'数学','C':'语文','E':'英语'}
    for i,m in enumerate(matches):
        subject=names.get(m.group(1).upper(),m.group(1))
        step=text[m.end():matches[i+1].start() if i+1<len(matches) else len(text)].strip()
        if step:groups.setdefault(subject,[]).append(step)
    result = [dict(subject=s,title=s+' · '+('；'.join(parts))[:60],first_step='；'.join(parts),task_kind='paper') for s,parts in groups.items()]
    remainder = text[:matches[0].start()].strip() if matches else text.strip()
    if remainder: result.append(dict(subject='',title='',first_step=remainder,task_kind='reading'))
    return result

class Notebook:
    def __init__(self,tasks,root):
        self.tasks=tasks;self.root=Path(root);self.images=self.root/'assets/notebooks'
        self.binary=Path(__file__).with_name('notebook-ocr');self.lock=threading.Lock()
        self.recent_text = OrderedDict()
    def read_text(self, target):
        folder = Path(__file__).resolve().parent
        commands = (
            ('paddle', ['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)(deny network*)',
                        folder / '.paddle-venv/bin/python', folder / 'notebook_paddle.py', target], 45),
            ('vision', [self.binary, target], 30),
        )
        for engine, command, timeout in commands:
            try:
                result = subprocess.run(command, capture_output=True, timeout=timeout, check=True)
                text = json.loads(result.stdout)['text']
                if isinstance(text, str) and text.strip():
                    return text.strip()[:12000], engine
            except (OSError, KeyError, TypeError, ValueError, subprocess.SubprocessError):
                continue
        return '', None

    def recognize(self,raw,ctype):
        ext='jpg' if ctype=='image/jpeg' and raw.startswith(b'\xff\xd8\xff') else 'png' if ctype=='image/png' and raw.startswith(b'\x89PNG\r\n\x1a\n') else None
        if not ext or not 0<len(raw)<=8*1024*1024:return 400,{'error':'invalid_image'}
        token=hashlib.sha256(raw).hexdigest()+'.'+ext
        self.images.mkdir(parents=True,exist_ok=True,mode=0o700);target=self.images/token
        try:
            with target.open('xb') as f:f.write(raw)
        except FileExistsError:pass
        text, engine = '', None
        if self.lock.acquire(blocking=False):
            try:
                if token in self.recent_text:
                    text, engine = self.recent_text[token], 'paddle'
                    self.recent_text.move_to_end(token)
                else:
                    text, engine = self.read_text(target)
                    if engine == 'paddle':
                        self.recent_text[token] = text
                        if len(self.recent_text) > 16:
                            self.recent_text.popitem(last=False)
            finally:
                self.lock.release()
        return 200, dict(token=token, material_url='assets/notebooks/'+token, text=text,
                         drafts=split_subjects(text), recognized=bool(text), engine=engine)
    def request(self,action,body):
        try:
            if action=='rules': return self.rules_request(body)
            if action=='split':
                text=body.get('text');assert isinstance(text,str) and len(text)<=12000
                return 200,{'drafts':split_subjects(text)}
            assert action=='confirm' and body.get('confirmed') is True
            token=body.get('token') or ''
            assert isinstance(token,str)
            if token:
                assert re.fullmatch(r'[a-f0-9]{64}\.(jpg|png)',token) and (self.images/token).is_file()
            child=body.get('child_id','child_a');assert child in {'child_a','child_b'}
            day=body.get('day');assert isinstance(day,str) and date.fromisoformat(day).isoformat()==day
            op=body.get('operation_id');assert isinstance(op,str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',op)
            drafts=body.get('drafts');assert isinstance(drafts,list) and 1<=len(drafts)<=10
            subjects=set();new=[]
            for draft in drafts:
                subject=draft.get('subject');assert subject in SUBJECTS;subjects.add(subject)
                title=draft.get('title');step=draft.get('first_step');kind=draft.get('task_kind')
                assert isinstance(title,str) and 3<=len(title.strip())<=100
                assert isinstance(step,str) and 2<=len(step.strip())<=4000
                assert title.strip() not in {'记事本照片','手写照片'} and kind in {'paper','audio','reading','itinerary'}
                group=draft.get('home_group','学校作业');assert group in {'学校作业','英语作业','高途','itinerary','课外'}
                photo=draft.get('photo_required',child=='child_a' and kind=='paper');assert type(photo) is bool
                itinerary=kind=='itinerary' or group=='itinerary'
                if itinerary: kind,group,photo='itinerary','itinerary',False
                if child=='child_b': photo=False
                # New intake requests get a stable operation-scoped id; legacy photo requests keep their ids.
                seed=hashlib.sha256(op.encode()).hexdigest()[:16] if 'child_id' in body or not token else token[:16]
                suffix=str(len(new)) if 'child_id' in body or not token else SUBJECTS[subject]
                task_id=('jared-' if child=='child_a' else 'joey-')+day.replace('-','')+'-notebook-'+seed+'-'+suffix
                new.append(dict(id=task_id,day=day,child_id=child,subject=subject,home_group=group,title=title.strip(),first_step=step.strip(),task_kind=kind,photo_required=photo,itinerary=itinerary,status='todo',assignment_state='verified',version=1,material_url='assets/notebooks/'+token if token else '',audio_url='',parent_note='家长已校对作业要求。',notebook_source=token))
            for task,draft in zip(new,drafts):
                source=draft.get('source_text','');assert isinstance(source,str) and len(source)<=12000
                task['source_text']=source
            assert len({t['title'] for t in new})==len(new)
            original=body.get('source_text','');assert isinstance(original,str) and len(original)<=12000
            for task in new:task['source_original']=original
            request=canonical(body);op_id='notebook:'+op
            with self.tasks.connect() as con:
                con.execute('BEGIN IMMEDIATE')
                prior=con.execute('SELECT request FROM operations WHERE id=?',(op_id,)).fetchone()
                if prior and prior[0]!=request:return 409,{'error':'conflict'}
                if not prior:
                    for task in new:
                        row=con.execute('SELECT payload FROM tasks WHERE id=?',(task['id'],)).fetchone()
                        if row:
                            old=json.loads(row[0])
                            if any(old.get(k)!=task[k] for k in ['title','first_step','subject','task_kind','material_url','home_group','photo_required','itinerary']):
                                con.rollback();return 409,{'error':'task_exists'}
                            continue
                        same=con.execute("SELECT id FROM tasks WHERE day=? AND child=? AND json_extract(payload,'$.title')=?",(day,child,task['title'])).fetchone()
                        if same:con.rollback();return 409,{'error':'task_exists'}
                        task['updated_at']=datetime.now().astimezone().isoformat(timespec='seconds')
                        con.execute('INSERT INTO tasks VALUES(?,?,?,?,?)',(task['id'],day,child,1,canonical(task)))
                    con.execute('INSERT INTO operations(id,request) VALUES(?,?)',(op_id,request))
                # Include only read-back persisted tasks, never echo uncommitted drafts as success.
                saved=[json.loads(con.execute('SELECT payload FROM tasks WHERE id=?',(t['id'],)).fetchone()[0]) for t in new]
            return 200,{'dataset':'lan','day':day,'child_id':child,'tasks':saved}
        except (AssertionError,TypeError,ValueError,AttributeError,KeyError):return 400,{'error':'invalid_notebook'}
        except (sqlite3.Error,OSError):return 503,{'error':'storage_unavailable'}

    def rules_request(self,body):
        child=body.get('child_id');assert child in {'child_a','child_b'}
        path=self.tasks.db.with_name('notebook_rules.json')
        default={'subjects':[['M','数学'],['C','语文'],['E','英语']]}
        with self.lock:
            state=json.loads(path.read_text()) if path.exists() else {'revision':0,'children':{}}
            if body.get('save') is True:
                assert body.get('confirmed') is True
                if body.get('revision')!=state['revision']:return 409,{'error':'rules_changed'}
                rules=body.get('rules');assert isinstance(rules,dict)
                for key in ['subjects']:
                    pairs=rules.get(key);assert isinstance(pairs,list) and len(pairs)<=20
                    seen=set()
                    for pair in pairs:
                        assert isinstance(pair,list) and len(pair)==2
                        a,b=pair;assert isinstance(a,str) and isinstance(b,str) and 0<len(a.strip())<=16 and 0<len(b.strip())<=50
                        assert a.strip().upper() not in seen;seen.add(a.strip().upper())
                        if key=='subjects':assert b in {'语文','数学','英语','其他'}
                state['children'][child]={'subjects':rules['subjects']};state['revision']+=1
                fd,tmp=tempfile.mkstemp(prefix='.notebook-rules-',dir=path.parent)
                try:
                    with os.fdopen(fd,'w') as stream:json.dump(state,stream,ensure_ascii=False);stream.flush();os.fsync(stream.fileno())
                    os.replace(tmp,path)
                finally:
                    if os.path.exists(tmp):os.unlink(tmp)
            rules=state['children'].get(child,default if child=='child_a' else {'subjects':[],'materials':[]})
            return 200,{'child_id':child,'rules':rules,'revision':state['revision']}
