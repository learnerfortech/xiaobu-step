"""Local daily pledges. Own database; never alters the existing task schema."""
import datetime
import json
import os
import sqlite3
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

ITEMS = ['认真完成作业', '认真抄记事', '书包整理好', '桌洞整理好', '认真听讲', '书写认真', '不要在书本上乱涂乱画']
RULES = {'three_stars': 20, 'two_stars': 15, 'streak_days': 3, 'light_day': 12, 'region_thresholds': [0, 40, 80, 120], 'task_exp': 3, 'itinerary_exp': 1, 'pledge_bonus_per_star': 1, 'max_task_exp': 50, 'form_thresholds': {'terastal': 300, 'stellar': 600}}
PLEDGE_STAR_RULES = {'three_stars': 12, 'two_stars': 8}
REGIONS = ['第一区域', '第二区域', '第三区域', '第四区域']
FORM_NAMES = {'normal': '普通形态', 'terastal': '太晶形态', 'stellar': '星晶形态'}
BUDDY_DEFAULTS = {'child_a': 'terapagos', 'child_b': 'charizard', 'muted': True}
# Per-child morph thresholds (Jared 300/600; Joey 300/600). Same form ids: normal→terastal→stellar.
FORM_THRESHOLDS_BY_CHILD = {
    'child_a': {'terastal': 300, 'stellar': 600},
    'child_b': {'terastal': 300, 'stellar': 600},
}

def form_thresholds_for(child):
    return dict(FORM_THRESHOLDS_BY_CHILD.get(child) or FORM_THRESHOLDS_BY_CHILD['child_a'])

def form_for_lifetime(lifetime, child='child_a'):
    form_th = form_thresholds_for(child)
    if lifetime >= form_th['stellar']:
        return 'stellar'
    if lifetime >= form_th['terastal']:
        return 'terastal'
    return 'normal'

def score(values):
    rated = [v for v in values if type(v) is int]
    total = sum(rated)
    stars = 3 if total >= PLEDGE_STAR_RULES['three_stars'] else 2 if total >= PLEDGE_STAR_RULES['two_stars'] else 1 if total > 0 else 0
    return {'score': total, 'rated': len(rated), 'applicable': sum(v != 'na' for v in values), 'stars': stars}

class Pledges:
    def __init__(self, db):
        self.db = Path(db)
        self.progress_db = self.db.with_name(self.db.stem + '_progress.sqlite3')
    def connect(self):
        c = sqlite3.connect(self.db.resolve().as_uri()+'?mode=rw', uri=True, timeout=5)
        c.execute('PRAGMA synchronous=FULL')
        try:
            c.execute('ATTACH DATABASE ? AS progress', (self.progress_db.resolve().as_uri()+'?mode=rw',))
            c.execute('PRAGMA progress.synchronous=FULL')
        except Exception:
            c.close(); raise
        return c
    def initialize(self):
        if not self.progress_db.exists():
            fd = os.open(self.progress_db, os.O_CREAT|os.O_EXCL|os.O_WRONLY, 0o600); os.close(fd)
            with sqlite3.connect(self.progress_db) as c:
                c.executescript('CREATE TABLE pledge_progress(key TEXT PRIMARY KEY, version INTEGER NOT NULL, payload TEXT NOT NULL); PRAGMA user_version=1;')
                c.execute('INSERT INTO pledge_progress VALUES(?,?,?)', ('buddyPrefs',1,json.dumps(BUDDY_DEFAULTS)))
        else:
            with sqlite3.connect(self.progress_db.resolve().as_uri()+'?mode=rw',uri=True) as c:
                if c.execute('PRAGMA user_version').fetchone()[0] != 1: raise RuntimeError('pledge_progress_version_mismatch')
                c.execute('SELECT key, version, payload FROM pledge_progress LIMIT 0')
        if self.db.exists():
            with self.connect() as c:
                if c.execute('PRAGMA user_version').fetchone()[0] != 1: raise RuntimeError('pledge_version_mismatch')
                c.execute('SELECT child, day, version, payload FROM pledges LIMIT 0')
            return
        fd = os.open(self.db, os.O_CREAT|os.O_EXCL|os.O_WRONLY, 0o600); os.close(fd)
        with sqlite3.connect(self.db) as c:
            c.executescript('CREATE TABLE pledges(child TEXT NOT NULL, day TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(child,day)); PRAGMA user_version=1;')
    def week(self, c, day):
        d=datetime.date.fromisoformat(day); start=d-datetime.timedelta(days=d.weekday()); end=start+datetime.timedelta(days=6)
        records=[]
        for row in c.execute('SELECT payload FROM pledges WHERE child=? AND day BETWEEN ? AND ? ORDER BY day',('child_a',start.isoformat(),end.isoformat())):
            r=json.loads(row[0]); r.update(score(r['values'])); records.append(r)
        streak=0; badge=False
        for r in records:
            if not r['rated']: continue
            streak=streak+1 if r['score']>=PLEDGE_STAR_RULES['three_stars'] else 0
            badge=badge or streak>=RULES['streak_days']
        return {'dataset':'lan','child_id':'child_a','day':day,'start':start.isoformat(),'end':end.isoformat(),'items':ITEMS,'rules':dict(RULES, **PLEDGE_STAR_RULES),'records':records,'week_score':sum(r['score'] for r in records),'streak_badge':badge}

    def progress(self, c, day, child):
        d=datetime.date.fromisoformat(day); start=d-datetime.timedelta(days=d.weekday())
        days={ (start+datetime.timedelta(days=i)).isoformat():{'task_exp':0,'task_count':0,'pledge_exp':0,'pledge_rated':0,'rated':False} for i in range(7) }
        for (payload,) in c.execute('SELECT payload FROM progress.pledge_progress WHERE key LIKE ?',('task:'+child+':%',)):
            record=json.loads(payload)
            if record.get('reversed'):
                continue
            if record['day'] in days:
                days[record['day']]['task_exp']+=record['points'];days[record['day']]['task_count']+=1;days[record['day']]['rated']=True
        if child=='child_a':
            for (payload,) in c.execute('SELECT payload FROM pledges WHERE child=? AND day BETWEEN ? AND ?', (child,start.isoformat(),(start+datetime.timedelta(days=6)).isoformat())):
                record=json.loads(payload);s=score(record['values']);days[record['day']]['pledge_exp']=s['score'];days[record['day']]['pledge_rated']=s['rated'];days[record['day']]['rated']=days[record['day']]['rated'] or s['rated']>0
        records=[]
        for date,row in days.items():
            row=dict(row,day=date)
            # Adventure EXP is driven by tasks. Pledge raw scores (0-14) stay visible as
            # pledge_exp, but only star-tier bonus (0-3) joins the adventure meter —
            # otherwise one good pledge day alone fills the daily bar and two days unlock region 2.
            pledge_stars = 3 if row['pledge_exp'] >= PLEDGE_STAR_RULES['three_stars'] else 2 if row['pledge_exp'] >= PLEDGE_STAR_RULES['two_stars'] else 1 if row['pledge_exp'] > 0 else 0
            if not row['pledge_rated']:
                pledge_stars = 0
            row['pledge_bonus'] = pledge_stars * RULES['pledge_bonus_per_star']
            row['exp'] = row['task_exp'] + row['pledge_bonus']
            row['lit'] = row['exp'] >= RULES['light_day']
            row['stars'] = 3 if row['exp'] >= RULES['three_stars'] else 2 if row['exp'] >= RULES['two_stars'] else 1 if row['exp'] >= RULES['light_day'] else 0
            records.append(row)
        total=sum(r['exp'] for r in records);index=max(i for i,n in enumerate(RULES['region_thresholds']) if total>=n)
        # Lifetime task EXP drives buddy forms (does not reset each week). Thresholds differ by child.
        lifetime=0
        for (payload,) in c.execute('SELECT payload FROM progress.pledge_progress WHERE key LIKE ?',('task:'+child+':%',)):
            lifetime += int(json.loads(payload).get('points') or 0)
        form_th=form_thresholds_for(child)
        form_id=form_for_lifetime(lifetime, child)
        next_form=None; next_need=0
        if form_id=='normal':
            next_form='terastal'; next_need=max(0, form_th['terastal']-lifetime)
        elif form_id=='terastal':
            next_form='stellar'; next_need=max(0, form_th['stellar']-lifetime)
        row=c.execute("SELECT version,payload FROM progress.pledge_progress WHERE key='buddyPrefs'").fetchone()
        if not row:raise sqlite3.DatabaseError('missing_buddy_prefs')
        current=next(r for r in records if r['day']==day)
        rules=dict(RULES); rules['form_thresholds']=form_th
        return {'dataset':'lan','child_id':child,'day':day,'start':start.isoformat(),'records':records,'today':current,'today_exp':current['exp'],'week_exp':total,'lifetime_exp':lifetime,'form_id':form_id,'form_name':FORM_NAMES[form_id],'form_next':next_form,'form_next_name':FORM_NAMES.get(next_form) if next_form else None,'form_need':next_need,'region_index':index,'region_name':REGIONS[index],'regions':REGIONS,'rules':rules,'buddyPrefs':json.loads(row[1]),'buddy_version':row[0]}

    def request(self, method, path, body=None):
        try:
            url=urlsplit(path); parts=url.path.split('/')
            if len(parts)!=5 or parts[:3]!=['','lan','family'] or parts[3] not in ('child','parent') or parts[4] not in ('pledge','pledge_progress','progress'): return 404,{'error':'not_found'}
            q=parse_qs(url.query,keep_blank_values=True)
            if method=='GET':
                if set(q)!={'day','child'} or any(len(v)!=1 for v in q.values()) or q['child'][0] not in ('child_a','child_b'): return 400,{'error':'invalid_input'}
                day=q['day'][0]; datetime.date.fromisoformat(day)
                with self.connect() as c:
                    if parts[4] in ('progress','pledge_progress'):return 200,self.progress(c,day,q['child'][0])
                    if q['child'][0]!='child_a':return 400,{'error':'invalid_child'}
                    return 200,self.week(c,day)
            if method!='POST' or parts[3]!='child' or url.query: return 405,{'error':'operation_not_available'}
            if type(body)!=dict or body.get('child_id') not in ('child_a','child_b'): return 400,{'error':'invalid_input'}
            day=body['day']; d=datetime.date.fromisoformat(day)
            # A week may be reviewed and revised, but no scoring future days.
            today=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date()
            if d>today: return 400,{'error':'future_day'}
            if parts[4] in ('pledge_progress','progress'):
                buddy=body.get('buddy'); expected=body.get('expected_version')
                if buddy not in ('terapagos','miraidon','charizard','none') or type(expected)is not int: return 400,{'error':'invalid_buddy'}
                with self.connect() as c:
                    c.execute('BEGIN IMMEDIATE')
                    row=c.execute("SELECT version,payload FROM progress.pledge_progress WHERE key='buddyPrefs'").fetchone()
                    if not row: return 503,{'error':'storage_unavailable'}
                    prefs=json.loads(row[1])
                    if prefs[body['child_id']]!=buddy:
                        if expected!=row[0]: return 409,{'error':'conflict'}
                        prefs[body['child_id']]=buddy; prefs['muted']=True
                        c.execute("UPDATE progress.pledge_progress SET version=?,payload=? WHERE key='buddyPrefs'",(row[0]+1,json.dumps(prefs)))
                    result=self.progress(c,day,body['child_id'])
                return 200,result
            if body['child_id']!='child_a':return 400,{'error':'invalid_child'}
            values=body['values']; note=body.get('note',''); expected=body['expected_version']
            if type(values)!=list or len(values)!=7 or any(not(v is None or v=='na' or (type(v)is int and v in (0,1,2))) for v in values): return 400,{'error':'invalid_scores'}
            if type(note)!=str or len(note)>500 or type(expected)is not int or expected<0: return 400,{'error':'invalid_input'}
            with self.connect() as c:
                c.execute('BEGIN IMMEDIATE')
                row=c.execute('SELECT payload FROM pledges WHERE child=? AND day=?',('child_a',day)).fetchone()
                old=json.loads(row[0]) if row else {'version':0,'celebrated':False}
                # A repeated identical save is safe after an uncertain response.
                if row and old['values']==values and old['note']==note:
                    result=self.week(c,day); result['celebrate_now']=False; return 200,result
                if expected!=old['version']: return 409,{'error':'conflict'}
                celebrate=score(values)['stars']==3 and not old['celebrated']
                record={'child_id':'child_a','day':day,'version':old['version']+1,'values':values,'note':note,'celebrated':old['celebrated'] or celebrate}
                c.execute('INSERT INTO pledges VALUES(?,?,?,?) ON CONFLICT(child,day) DO UPDATE SET version=excluded.version,payload=excluded.payload',('child_a',day,record['version'],json.dumps(record,ensure_ascii=False)))
                result=self.week(c,day); result['celebrate_now']=celebrate
                # The source scores remain the pledge ledger; the platform combines them with task awards.
                summary=self.progress(c,day,'child_a')
                c.execute('INSERT INTO progress.pledge_progress VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET version=pledge_progress.version+1,payload=excluded.payload',('platform:child_a:'+result['start'],1,json.dumps(summary,ensure_ascii=False)))
            return 200,result
        except (ValueError,TypeError,KeyError): return 400,{'error':'invalid_input'}
        except (sqlite3.Error,OSError): return 503,{'error':'storage_unavailable'}
