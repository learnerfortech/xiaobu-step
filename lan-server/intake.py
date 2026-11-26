"""Local, parent-confirmed intake. No external model, migrations or automatic task writes."""
import hashlib,json,re,sqlite3,time,threading,os,tempfile
from pathlib import Path
from datetime import date,datetime
from urllib.parse import urlsplit,parse_qs,unquote
from notebook import Notebook,canonical,SUBJECTS

class Invalid(ValueError):pass

def check(ok,message='请核对输入内容。'):
    if not ok:raise Invalid(message)
def string(v,limit,required=False):
    check(isinstance(v,str) and len(v)<=limit and (not required or v.strip()),'文字为空或超过长度限制。');return v

JOEY_MODULES = ('思维城堡', '文化传承', '魔法王国', 'Big English')


# Explicit OCR gaps take precedence over guessed page and question numbers.
UNCLEAR = r'[?？□�＿_]+'
PAGE_LOCATION = re.compile(
    rf'(?<![A-Za-z0-9])[pP][ \t]*[:：]?[ \t]*(?:\d{{1,4}}(?:{UNCLEAR}|[A-Za-z]+)(?![A-Za-z0-9])|{UNCLEAR})'
    rf'|第[ \t]*\d{{0,4}}{UNCLEAR}\d{{0,4}}[ \t]*页'
    rf'|页码[：:]?[ \t]*\d{{0,4}}{UNCLEAR}\d{{0,4}}'
)
QUESTION_LOCATION = re.compile(
    rf'第[ \t]*(?:\d{{0,4}}{UNCLEAR}\d{{0,4}})[ \t]*(?:小?题)'
    rf'|题号[：:]?[ \t]*(?:\d{{0,4}}{UNCLEAR}\d{{0,4}})'
)
INTAKE_MARKERS = re.compile(r'〔(?:页码|题号)待核对〕')


def mark_locations(line):
    # Annotate in place. A punctuation mark elsewhere isn't a missing number.
    line = QUESTION_LOCATION.sub(lambda match: match[0] + '〔题号待核对〕', line)
    spans = list(QUESTION_LOCATION.finditer(line))
    return PAGE_LOCATION.sub(
        lambda match: match[0] if any(p.start() <= match.start() < p.end() for p in spans)
        else match[0] + '〔页码待核对〕', line)


def organize_sources(sources, rules, child=None, sheet=False):
    labels = [['语文','语文'],['数学','数学'],['英语','英语'],['语','语文'],['数','数学'],['英','英语']] + rules.get('subjects',[])
    if child == 'child_b':
        labels = [[name,name] for name in JOEY_MODULES] + labels
    labels = sorted(labels, key=lambda pair: len(pair[0]), reverse=True)
    groups, review, ignored, seen = {}, [], [], set()
    for source in sources:
        identity = source.get('token') or source['id']
        if identity in seen:
            continue
        seen.add(identity)
        current = ''
        prior_subject = None
        for index, original_line in enumerate(source['text'].splitlines()):
            if not original_line.strip():
                continue
            for segment in re.findall(r'[^；;]+[；;]?|[；;]', original_line):
                raw = segment.strip()
                probe = raw.rstrip('；;').strip()
                if re.fullmatch(r'(学校作业|今日作业|家庭作业|作业|记事本|作业记录)[：:]?', probe):
                    ignored.append(raw)
                    current = ''
                    continue
                if not any(c.isalnum() for c in probe) and not (current and re.search(UNCLEAR, probe)):
                    ignored.append(raw)
                    continue
                if re.fullmatch(r'(收到[，,！!。\s]*(谢谢老师)?|谢谢老师[！!。]?|\d{1,2}:\d{2}|返回|微信|聊天信息)', probe):
                    ignored.append(raw)
                    continue
                body = raw
                matched = False
                for label, subject in labels:
                    delimiter = (r'(?=$|[\s:：、.．·；;])' if child == 'child_b' and label in JOEY_MODULES
                                 else r'(?=$|[\s:：、.．·；;]|[\u3400-\u9fff]|[Pp](?=\d|[?？]))')
                    hit = re.match('^' + re.escape(label) + delimiter, body, re.I)
                    if not hit:
                        continue
                    rest = body[hit.end():]
                    if re.match(r'[A-Za-z]', rest) and not re.match(r'[Pp](?:\d|[?？])', rest):
                        continue
                    if re.match(r'(老师|课代表|文老师)', rest):
                        continue
                    current, matched = subject, True
                    body = re.sub(r'^[\s:：、.．·]+', '', rest)
                    break
                if matched and (not re.search(r'[\w?？□�]', body) or
                                body.rstrip('：:；;').strip() in {current, current+'作业', '作业'}):
                    continue
                if not matched:
                    # Unknown subject headings break attribution. Ordinary sublabels
                    # such as “朗读：” and “另：”, including indented continuations, stay together.
                    unknown = re.match(r'^(?:科学|道法|体育|美术|音乐|其他|待核对)(?=$|[：:])', body)
                    code = re.match(r'^[A-Za-z](?=$|[：:])', body)
                    if sheet:
                        if unknown or (code and not re.match(r'^[Pp][：:]', body)):
                            current = ''
                    elif (re.match(r'^[A-Za-z](?=$|[\s:：、.．]|[\u3400-\u9fff]|[Pp]\d)',body)
                          or re.match(r'^[A-Za-z\u3400-\u9fff][^\s：:；;]{0,11}[：:]',body)
                          or re.fullmatch(r'(科学|道法|体育|美术|音乐|其他|待核对)[：:]?',body)):
                        current = ''
                if not current:
                    review.append({'source_id':source['id'], 'source_name':source['name'], 'text':raw})
                    continue
                draft = groups.setdefault(current, dict(subject=current, title='', first_step='', original_requirement='',
                    source_ids=[], task_kind='reading', home_group='学校作业', photo_required=False, warnings=[], materials=[]))
                same_line = sheet and prior_subject == (index,current)
                join = ' ' if same_line else '\n'
                text = mark_locations(body) if sheet else body
                draft['first_step'] += (join if draft['first_step'] else '') + text
                draft['original_requirement'] += (join if draft['original_requirement'] else '') + raw
                prior_subject = index,current
                if source['id'] not in draft['source_ids']:
                    draft['source_ids'].append(source['id'])
                if re.search(r'练习册|练册|写|做.*题|计算|口算|习题', body):
                    draft['task_kind'] = 'paper'
                if not sheet and re.search(r'[?？□�]|\bP\s*\d+[A-Za-z]', body, re.I):
                    draft['warnings'].append('页码、题号或缺字需要对照原图核对')
                if re.search(r'明天|后天|下周|截止|提交|上传|交到', body):
                    draft['warnings'].append('请核对老师的截止时间和提交要求；任务日期未自动推算')
                if not sheet and source.get('kind') == 'image' and child != 'child_b':
                    draft['warnings'].append('图片识别可能有错漏，请对照原图核对')
                if re.search(r'(听|群).*(音频|录音)|音频.*(听|群)', body):
                    draft['audio_required'] = True
    for draft in groups.values():
        draft['title'] = draft['subject'] + ' · ' + re.sub(r'\s+', ' ', draft['first_step'])[:60]
        draft['warnings'] = list(dict.fromkeys(draft['warnings']))
        if draft.get('audio_required'):
            draft['materials'] = [dict(name='对应学习材料', text='', items=[], audio_required=True)]
    for source in sources:
        if source['kind'] == 'image' and not source['text'].strip():
            review.append(dict(source_id=source['id'], source_name=source['name'],
                text='这张图片尚未识别清楚，请对照原图手动填写要求。', **({'unreadable':True} if sheet else {})))
    return dict(drafts=list(groups.values()), review=review, ignored=ignored, provider='local-rules')


class Intake(Notebook):
    def __init__(self,tasks,root,*,validate_fields):
        super().__init__(tasks,root)
        self.validate_fields=validate_fields
        self.assets=tasks.db.parent/'intake-assets';self.guard=threading.Lock();self.calls={}
    def rate(self,key,limit):
        now=time.monotonic()
        with self.guard:
            recent=[t for t in self.calls.get(key,[]) if now-t<60]
            if len(recent)>=limit:return False
            self.calls[key]=recent+[now];return True
    def asset_path(self,token):
        check(isinstance(token,str) and re.fullmatch(r'[a-f0-9]{64}\.(png|jpg|webp|mp3|wav|ogg|m4a|pdf)',token),'附件标识无效。')
        p=self.assets/token;check(p.is_file(),'附件尚未上传成功或已不可用。');return p
    def asset(self,token):
        p=self.asset_path(token)
        m={'png':'image/png','jpg':'image/jpeg','webp':'image/webp','mp3':'audio/mpeg','wav':'audio/wav','ogg':'audio/ogg','m4a':'audio/mp4','pdf':'application/pdf'}
        return p,m[p.suffix[1:]]
    def upload(self,raw,ctype):
        try:
            check(0<len(raw)<=25*1024*1024,'单个附件不能超过25兆。')
            ext=None
            if ctype=='image/png' and raw.startswith(b'\x89PNG\r\n\x1a\n'):ext='png'
            elif ctype=='image/jpeg' and raw.startswith(b'\xff\xd8\xff'):ext='jpg'
            elif ctype=='image/webp' and raw[:4]==b'RIFF' and raw[8:12]==b'WEBP':ext='webp'
            elif ctype in {'audio/wav','audio/x-wav'} and raw[:4]==b'RIFF' and raw[8:12]==b'WAVE':ext='wav'
            elif ctype=='audio/mpeg' and (raw.startswith(b'ID3') or (len(raw)>2 and raw[0]==255 and raw[1]&224==224)):ext='mp3'
            elif ctype=='audio/ogg' and raw.startswith(b'OggS'):ext='ogg'
            elif ctype in {'audio/mp4','audio/x-m4a'} and raw[4:8]==b'ftyp':ext='m4a'
            elif ctype=='application/pdf' and raw.startswith(b'%PDF-'):ext='pdf'
            check(ext,'文件格式不支持，请选图片、PDF或常用音频文件。')
            check(not ctype.startswith('image/') or len(raw)<=8*1024*1024,'图片不能超过8兆。')
            token=hashlib.sha256(raw).hexdigest()+'.'+ext
            self.assets.mkdir(parents=True,exist_ok=True,mode=0o700)
            target=self.assets/token
            if not target.exists():
                if not self.rate('upload',40):return 429,{'message':'上传较频繁，请稍后重试。'}
                # Content-addressed, atomically published; retries never expose partial assets.
                fd,tmp=tempfile.mkstemp(prefix='.upload-',dir=self.assets)
                try:
                    with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
                    os.replace(tmp,target)
                finally:
                    if os.path.exists(tmp):os.unlink(tmp)
            return 200,{'token':token,'url':'/lan/notebook/asset?token='+token,'kind':'image' if ext in {'png','jpg','webp'} else 'document' if ext=='pdf' else 'audio','size':len(raw)}
        except (Invalid,OSError) as e:return 400 if isinstance(e,Invalid) else 503,{'message':str(e) if isinstance(e,Invalid) else '附件未保存，请重试。'}
    def ocr(self,body):
        p=self.asset_path(body.get('token'));check(p.suffix in {'.png','.jpg','.webp'},'这里只识别图片。')
        cache=p.with_suffix(p.suffix+'.ocr.json')
        if cache.exists():return 200,json.loads(cache.read_text())
        if not self.lock.acquire(blocking=False):return 429,{'message':'电脑正在识别另一张图片，请稍后重试。'}
        try:
            if cache.exists():return 200,json.loads(cache.read_text())
            if not self.rate('ocr',8):return 429,{'message':'识别较频繁，请稍后重试。'}
            text,engine=self.read_text(p)
            result={'text':text,'recognized':bool(text.strip()),'engine':engine,'token':body['token'],'message':'请对照原图校对，识别可能有错漏。' if text.strip() else '图片没认清，可对照原图手动填写，也可重试。'}
            if text.strip():
                fd,tmp=tempfile.mkstemp(prefix='.ocr-',dir=self.assets)
                try:
                    with os.fdopen(fd,'w') as f:json.dump(result,f,ensure_ascii=False)
                    os.replace(tmp,cache)
                finally:
                    if os.path.exists(tmp):os.unlink(tmp)
            return 200,result
        finally:self.lock.release()
    def sources(self,values,allow_empty=False):
        check(isinstance(values,list) and (0 if allow_empty else 1)<=len(values)<=12,'一次最多放入十二份来源。')
        out=[];ids=set();total=0
        for s in values:
            check(isinstance(s,dict));sid=string(s.get('id'),100,True);check(sid not in ids,'来源重复，请核对。');ids.add(sid)
            kind=s.get('kind');check(kind in {'text','image'})
            text=string(s.get('text',''),12000);original=string(s.get('original_text',text),12000)
            total+=len(text)+len(original);check(total<=96000,'这次内容较多，请分批添加。')
            token=s.get('token','')
            if kind=='image':check(self.asset_path(token).suffix in {'.png','.jpg','.webp'})
            else:check(not token)
            out.append({'id':sid,'name':string(s.get('name','来源'),120,True),'kind':kind,'text':text,'original_text':original,'token':token})
        return out
    def materials(self,values):
        check(isinstance(values,list) and len(values)<=12,'每项最多十二组材料。');out=[]
        for g in values:
            check(isinstance(g,dict));name=string(g.get('name'),120,True);text=string(g.get('text',''),12000)
            check(type(g.get('audio_required',False)) is bool)
            items=g.get('items',[]);check(isinstance(items,list) and len(items)<=20)
            clean=[]
            for a in items:
                check(isinstance(a,dict));kind=a.get('kind');name_a=string(a.get('name'),120,True)
                if kind=='link':
                    url=string(a.get('url'),2000,True);u=urlsplit(url)
                    if not u.scheme and not u.netloc:
                        target=(self.root/unquote(u.path)).resolve()
                        check(u.path.startswith('assets/') and target.is_relative_to((self.root/'assets').resolve()) and target.is_file() and target.suffix.lower() in {'.html','.pdf','.docx','.png','.jpg','.jpeg','.webp','.mp3','.wav','.ogg'},'本机材料路径无效或文件不存在。')
                    else:check(u.scheme in {'https','http'} and u.hostname and not u.username and not u.password,'外链请使用完整的 http 或 https 地址。')
                    clean.append({'kind':'link','name':name_a,'url':url})
                else:
                    token=a.get('token');p,mime=self.asset(token)
                    expected='image' if mime.startswith('image/') else 'audio' if mime.startswith('audio/') else 'document'
                    check(kind==expected,'附件类型与上传结果不一致。')
                    clean.append({'kind':kind,'name':name_a,'token':token,'url':'/lan/notebook/asset?token='+token})
            out.append({'name':name,'text':text,'items':clean,'audio_required':g.get('audio_required',False)})
        return out
    def status(self,body):
        op=string(body.get('operation_id'),100,True);check(re.fullmatch(r'[a-zA-Z0-9_-]+',op))
        with self.tasks.connect() as con:
            row=con.execute('SELECT request FROM operations WHERE id=?',('intake:'+op,)).fetchone()
            if not row:return {'state':'not_saved','tasks':[]}
            previous=json.loads(row[0]);child=previous['child_id'];check(body.get('child_id')==child,'请使用原来选择的孩子查询。')
            seed=hashlib.sha256(op.encode()).hexdigest()[:20]
            found=[]
            for i,d in enumerate(previous['drafts']):
                tid=previous.get('task_id') or 'intake-'+seed+'-'+str(i)
                t=con.execute('SELECT payload FROM tasks WHERE id=?',(tid,)).fetchone()
                check(t is not None,'保存状态需要核对，请勿重复添加。');found.append(json.loads(t[0]))
            return {'state':'saved','dataset':'lan','child_id':child,'tasks':found}
    def prepare(self,body):
        check(body.get('confirmed') is True,'请先核对再确认添加。')
        child=body.get('child_id');check(child in {'child_a','child_b'})
        op=string(body.get('operation_id'),100,True);check(re.fullmatch(r'[a-zA-Z0-9_-]+',op))
        sources=self.sources(body.get('sources'),allow_empty=True);sids={s['id'] for s in sources}
        drafts=body.get('drafts');check(isinstance(drafts,list) and 1<=len(drafts)<=20,'每次请添加一至二十项作业。')
        check(body.get('review_resolved') is True,'还有内容待核对。')
        new=[];seed=hashlib.sha256(op.encode()).hexdigest()[:20]
        for i,d in enumerate(drafts):
            check(isinstance(d,dict));subject=d.get('subject')
            check(subject in SUBJECTS or (child == 'child_b' and subject in JOEY_MODULES),'请明确选择科目。')
            day=d.get('day');check(isinstance(day,str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}',day));check(date.fromisoformat(day).isoformat()==day)
            title=string(d.get('title'),100,True).strip();step=string(d.get('first_step'),4000,True).strip()
            check(not INTAKE_MARKERS.search(step) and not INTAKE_MARKERS.search(title),
                  '请对照原图补全标出的页码与题号。')
            original=string(d.get('original_requirement',''),24000)
            kind=d.get('task_kind');group=d.get('home_group');check(kind in {'paper','reading','audio','itinerary'} and group in {'学校作业','英语作业','高途','itinerary','课外'})
            check(type(d.get('photo_required')) is bool);photo=child=='child_a' and d['photo_required']
            if kind=='itinerary' or group=='itinerary':kind,group,photo='itinerary','itinerary',False
            refs=d.get('source_ids',[]);check(isinstance(refs,list) and all(s in sids for s in refs))
            check(not d.get('warnings') or d.get('reviewed') is True,'请先核对标出的疑问。')
            mats=self.materials(d.get('materials',[]))
            missing=any(g['audio_required'] and not any(a['kind']=='audio' for a in g['items']) for g in mats)
            check(not missing or body.get('allow_missing_audio') is True,'音频待补，请确认先添加还是先补音频。')
            new.append(dict(id='intake-'+seed+'-'+str(i),day=day,child_id=child,subject=subject,title=title,first_step=step,original_requirement=original,source_ids=refs,sources=[s for s in sources if s['id'] in refs],source_original='\n\n'.join(s['original_text'] for s in sources),source_text='\n\n'.join(s['text'] for s in sources),materials=mats,material_url='',audio_url='',task_kind=kind,home_group=group,photo_required=photo,itinerary=kind=='itinerary',status='todo',assignment_state='verified',parent_note=string(d.get('parent_note','家长已核对并确认添加。'),4000),version=1,updated_at=datetime.now().astimezone().isoformat(timespec='seconds')))
        for t in new:
            t.update(self.validate_fields(t))
            if body.get('sheet') is True:
                t['intake_sheet'] = True
        check(len({(t['day'],t['title']) for t in new})==len(new),'同一天有重复标题，请先合并或修改。')
        return new
    def confirm(self,body):
        new=self.prepare(body);child=body['child_id'];op=body['operation_id']
        request=canonical(body)
        with self.tasks.connect() as con:
            con.execute('BEGIN IMMEDIATE')
            prior=con.execute('SELECT request FROM operations WHERE id=?',('intake:'+op,)).fetchone()
            if prior:
                if prior[0]!=request:return 409,{'message':'这次保存已经处理，内容有变化。请先查询保存结果。'}
            else:
                for t in new:
                    exists=con.execute("SELECT id FROM tasks WHERE day=? AND child=? AND json_extract(payload,'$.title')=?",(t['day'],child,t['title'])).fetchone()
                    if exists:con.rollback();return 409,{'message':'同一天已有同名作业，请先查看已添加任务。'}
                    con.execute('INSERT INTO tasks VALUES(?,?,?,?,?)',(t['id'],t['day'],child,1,canonical(t)))
                con.execute('INSERT INTO operations VALUES(?,?)',('intake:'+op,request))
            saved=[json.loads(con.execute('SELECT payload FROM tasks WHERE id=?',(t['id'],)).fetchone()[0]) for t in new]
        return 200,{'state':'saved','dataset':'lan','child_id':child,'tasks':saved}
    def update_materials(self,body):
        check(body.get('confirmed') is True)
        child=body.get('child_id');check(child in {'child_a','child_b'})
        task_id=string(body.get('task_id'),100,True);version=body.get('expected_version');check(type(version) is int)
        op=string(body.get('operation_id'),100,True);check(re.fullmatch(r'[a-zA-Z0-9_-]+',op))
        drafts=body.get('drafts');check(isinstance(drafts,list) and len(drafts)==1)
        materials=self.materials(drafts[0].get('materials',[]))
        missing=any(g['audio_required'] and not any(a['kind']=='audio' for a in g['items']) for g in materials)
        check(not missing or body.get('allow_missing_audio') is True,'音频尚待补充，请确认。')
        req=canonical(body)
        with self.tasks.connect() as con:
            con.execute('BEGIN IMMEDIATE')
            old=con.execute('SELECT payload FROM tasks WHERE id=? AND child=?',(task_id,child)).fetchone();check(old,'没有找到这项作业。')
            task=json.loads(old[0]);check('materials' in task,'旧材料仍用原来的编辑方式。')
            prior=con.execute('SELECT request FROM operations WHERE id=?',('intake:'+op,)).fetchone()
            if prior:
                if prior[0]!=req:return 409,{'message':'这次材料保存已处理，请先查询结果。'}
            else:
                if task['version']!=version:return 409,{'message':'这项作业已被修改，请关闭并重新打开材料编辑。'}
                task['materials']=materials;task['version']+=1;task['updated_at']=datetime.now().astimezone().isoformat(timespec='seconds')
                con.execute('UPDATE tasks SET payload=?,version=? WHERE id=?',(canonical(task),task['version'],task_id))
                con.execute('INSERT INTO operations VALUES(?,?)',('intake:'+op,req))
        return 200,{'state':'saved','dataset':'lan','child_id':child,'tasks':[task]}
    def request(self,action,body):
        try:
            check(isinstance(body,dict))
            if action=='ocr':return self.ocr(body)
            if action=='organize':
                check(self.rate('organize',30),'整理较频繁，请稍后重试。')
                sources=self.sources(body.get('sources'));code,result=self.rules_request({'child_id':body.get('child_id')});check(code==200)
                organized=organize_sources(sources,result['rules'],body['child_id'],sheet=body.get('sheet') is True)
                for d in organized['drafts']:d['photo_required']=body['child_id']=='child_a' and d['task_kind']=='paper'
                return 200,organized
            if action=='status':return 200,self.status(body)
            if action=='publish':return self.confirm(body)
            if action=='update-materials':return self.update_materials(body)
            return super().request(action,body)
        except Invalid as e:return 400,{'message':str(e)}
        except (ValueError,TypeError,KeyError,AttributeError):return 400,{'message':'请核对来源、草稿、日期及附件；内容仍保留。'}
        except (OSError,sqlite3.Error):return 503,{'message':'电脑暂时没有保存成功，请保留草稿并查询或重试。'}
