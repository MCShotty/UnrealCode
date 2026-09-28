const { parentPort, workerData, threadId } = require('node:worker_threads')
const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(workerData.path, { readOnly: workerData.reader === true })
db.exec('PRAGMA busy_timeout=2000; PRAGMA foreign_keys=ON;')
if(db.prepare('PRAGMA user_version').get().user_version>3)throw Error('History cache version is newer than this application')
if (!workerData.reader) {
  if (db.prepare('PRAGMA journal_mode=WAL').get().journal_mode !== 'wal') throw Error('History cache requires a local disk with SQLite WAL support')
  db.exec(`PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS sessions(project TEXT NOT NULL, session TEXT NOT NULL, metadata TEXT, cursor INTEGER NOT NULL DEFAULT 0, high INTEGER NOT NULL DEFAULT 0, synced TEXT, PRIMARY KEY(project,session));
    CREATE TABLE IF NOT EXISTS events(project TEXT NOT NULL, session TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, at TEXT, payload TEXT NOT NULL, text TEXT NOT NULL, original TEXT NOT NULL DEFAULT '', UNIQUE(project,session,seq));
    CREATE INDEX IF NOT EXISTS event_time ON events(project,at DESC);
    CREATE INDEX IF NOT EXISTS event_kind ON events(project,session,kind,seq);
    CREATE TABLE IF NOT EXISTS files(project TEXT NOT NULL, session TEXT NOT NULL, seq INTEGER NOT NULL, path TEXT NOT NULL, PRIMARY KEY(project,session,seq,path));
    CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(text, content='events', content_rowid='rowid', tokenize='trigram');
    CREATE TRIGGER IF NOT EXISTS event_insert AFTER INSERT ON events BEGIN INSERT INTO search(rowid,text) VALUES(new.rowid,new.text); END;
    CREATE TRIGGER IF NOT EXISTS event_delete AFTER DELETE ON events BEGIN INSERT INTO search(search,rowid,text) VALUES('delete',old.rowid,old.text); END;
    CREATE TRIGGER IF NOT EXISTS event_update AFTER UPDATE OF text ON events BEGIN INSERT INTO search(search,rowid,text) VALUES('delete',old.rowid,old.text); INSERT INTO search(rowid,text) VALUES(new.rowid,new.text); END;
    `)
  if(!db.prepare('PRAGMA table_info(events)').all().some(column=>column.name==='original'))db.exec("ALTER TABLE events ADD COLUMN original TEXT NOT NULL DEFAULT ''")
} else db.exec('PRAGMA query_only=ON')
const activityModule=require('./activity-projection.cjs')
if(!workerData.reader)activityModule.initialize(db)
const activity=activityModule.service(db)
if(!workerData.reader&&db.prepare('PRAGMA user_version').get().user_version<3){
 db.exec('BEGIN IMMEDIATE')
 try{for(const row of db.prepare('SELECT project,session FROM sessions').all())activity.project(row.project,row.session);db.exec('PRAGMA user_version=3; COMMIT')}catch(error){db.exec('ROLLBACK');throw error}
}
const get = (value,key) => value && typeof value === 'object' ? value[key] ?? value[key[0].toLowerCase()+key.slice(1)] : undefined
function searchable(event) {
  if(event.event === 'operation.update') { const s=get(event.payload,'State');return JSON.stringify({command:get(get(s,'Input'),'Command'),output:get(s,'Result'),stdout:get(s,'InlineOut'),stderr:get(s,'InlineErr'),error:get(s,'TerminalError')}) }
  if(event.event !== 'session.item')return ''
  const kind=get(event.payload,'Kind'),data=get(event.payload,'Data')
  if(kind==='input'&&get(data,'Kind')==='external'){const p=get(data,'Payload');return typeof p==='string'?p:String(get(p,'Prompt')||'')}
  if(kind==='model_response'){const output=get(get(data,'Response'),'Output');return Array.isArray(output)?output.filter(x=>get(x,'Type')==='message').map(x=>String(get(get(x,'Data'),'Text')||'')).join('\n'):''}
  return ''
}
const session = db.prepare('SELECT * FROM sessions WHERE project=? AND session=?')
const eventsAfter = db.prepare('SELECT seq FROM events WHERE project=? AND session=? AND seq>? ORDER BY seq')
const ensure = !workerData.reader && db.prepare('INSERT OR IGNORE INTO sessions(project,session) VALUES(?,?)')
function transaction(fn) { db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value}catch(error){db.exec('ROLLBACK');throw error} }
function status(project,id){const row=session.get(project,id);return {state:row?.synced&&row.cursor===row.high?'ready':'partial',cursor:row?.cursor||0,latest:row?.high||0,lastSyncedAt:row?.synced||undefined}}
function ingest(batch){return transaction(()=>{
  const insert=db.prepare('INSERT OR IGNORE INTO events(project,session,seq,kind,at,payload,text,original) VALUES(?,?,?,?,?,?,?,?)'),touched=new Map()
  for(const {project,event} of batch){
    if(!Number.isSafeInteger(event.seq)||event.seq<1)continue
    ensure.run(project,event.sessionId)
    const filenames=db.prepare('SELECT path FROM files WHERE project=? AND session=? AND seq=?').all(project,event.sessionId,event.seq).map(x=>x.path)
    const inserted=insert.run(project,event.sessionId,event.seq,event.event,event.recordedAt||null,JSON.stringify(event),[searchable(event),...filenames].join('\n').toLowerCase(),[searchable(event),...filenames].join('\n'))
    if(inserted.changes&&event.payload?.outcome?.state){const prior=session.get(project,event.sessionId);if(prior?.metadata){const meta=JSON.parse(prior.metadata);if(event.seq>(meta.outcomeSequence||0)){Object.assign(meta,{state:event.payload.outcome.state,outcome:event.payload.outcome,outcomeSequence:event.seq});db.prepare('UPDATE sessions SET metadata=? WHERE project=? AND session=?').run(JSON.stringify(meta),project,event.sessionId)}}}
    if(inserted.changes){const key=JSON.stringify([project,event.sessionId]),prior=touched.get(key);touched.set(key,[project,event.sessionId,Math.min(prior?.[2]??event.seq,event.seq)])}
  }
  for(const [project,id,earliest] of touched.values()){
    let cursor=session.get(project,id).cursor
    for(const row of eventsAfter.iterate(project,id,cursor)){if(row.seq!==cursor+1)break;cursor=row.seq}
    const high=db.prepare('SELECT MAX(seq) AS seq FROM events WHERE project=? AND session=?').get(project,id).seq||0
    db.prepare('UPDATE sessions SET cursor=?,high=? WHERE project=? AND session=?').run(cursor,high,project,id)
    activity.project(project,id,earliest)
  }
})}
function run(method,p){
  if(method==='work.view')return {...activity.view(p),connected:!!p.connected,cache:status(p.project,p.session)}
  if(method==='activity.page')return {...activity.page(p),connected:!!p.connected,cache:status(p.project,p.session)}
  if(method==='activity.detail')return activity.detail(p)
  if(method==='reindex')return transaction(()=>{
    // Rebuild only derived fields. Inactive isolated sessions and offline
    // projects retain their event bodies and metadata throughout the rebuild.
    const update=db.prepare('UPDATE events SET text=?,original=? WHERE rowid=?')
    for(const row of db.prepare('SELECT rowid,project,session,seq,payload FROM events').iterate()){
      const names=db.prepare('SELECT path FROM files WHERE project=? AND session=? AND seq=?').all(row.project,row.session,row.seq).map(item=>item.path)
      const original=[searchable(JSON.parse(row.payload)),...names].join('\n')
      update.run(original.toLowerCase(),original,row.rowid)
    }
    db.exec("INSERT INTO search(search) VALUES('rebuild'); UPDATE sessions SET synced=NULL")
  })
  if(method==='ingest')return ingest(p.batch)
  if(method==='sessions.put')return transaction(()=>{for(const item of p.sessions){ensure.run(p.project,item.id);db.prepare('UPDATE sessions SET metadata=? WHERE project=? AND session=?').run(JSON.stringify(item),p.project,item.id)}})
  if(method==='sessions.list')return db.prepare('SELECT metadata FROM sessions WHERE project=? AND metadata IS NOT NULL').all(p.project).map(x=>JSON.parse(x.metadata)).sort((a,b)=>b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))
  if(method==='projects.list')return db.prepare('SELECT DISTINCT project FROM sessions ORDER BY project').all().map(row=>row.project)
  if(method==='sync'){ensure.run(p.project,p.session);db.prepare('UPDATE sessions SET synced=? WHERE project=? AND session=? AND cursor=high').run(new Date().toISOString(),p.project,p.session);return status(p.project,p.session)}
  if(method==='status')return status(p.project,p.session)
  if(method==='checkpoint.files'){
    if(!p.messageIds.length||!p.paths.length)return
    const ids=JSON.stringify(p.messageIds)
    // Bind filenames to their own recorded turn, never to the latest unrelated
    // live event. This also reconstructs annotations after a cache rebuild.
    const completed=db.prepare(`SELECT e.seq FROM events e JOIN json_each(e.payload,'$.payload.messageIds') m
      WHERE e.project=? AND e.session=? AND e.kind='session.idle' AND m.value IN (SELECT value FROM json_each(?))
      ORDER BY e.seq DESC LIMIT 1`).get(p.project,p.session,ids)
    const input=completed||db.prepare(`SELECT seq FROM events WHERE project=? AND session=? AND kind='session.item'
      AND COALESCE(json_extract(payload,'$.payload.Data.ID'),json_extract(payload,'$.payload.data.id')) IN (SELECT value FROM json_each(?))
      ORDER BY seq LIMIT 1`).get(p.project,p.session,ids)
    if(input)return run('files',{...p,seq:input.seq})
    return
  }
  if(method==='files')return transaction(()=>{
    for(const path of p.paths)db.prepare('INSERT OR IGNORE INTO files VALUES(?,?,?,?)').run(p.project,p.session,p.seq,path)
    const row=db.prepare('SELECT rowid,payload FROM events WHERE project=? AND session=? AND seq=?').get(p.project,p.session,p.seq)
    if(row){const paths=db.prepare('SELECT path FROM files WHERE project=? AND session=? AND seq=?').all(p.project,p.session,p.seq).map(x=>x.path);db.prepare('UPDATE events SET text=?,original=? WHERE rowid=?').run([searchable(JSON.parse(row.payload)),...paths].join('\n').toLowerCase(),[searchable(JSON.parse(row.payload)),...paths].join('\n'),row.rowid)}
  })
  if(method==='page'){
    const limit=Math.min(1000,Math.max(1,p.limit||500)),before=p.before||Number.MAX_SAFE_INTEGER
    const rows=p.around?db.prepare('SELECT payload,seq FROM events WHERE project=? AND session=? AND seq>=? ORDER BY seq LIMIT ?').all(p.project,p.session,Math.max(1,p.around-100),limit):db.prepare('SELECT payload,seq FROM events WHERE project=? AND session=? AND seq<? ORDER BY seq DESC LIMIT ?').all(p.project,p.session,before,limit).reverse()
    const first=rows[0]?.seq,hasOlder=!!first&&!!db.prepare('SELECT 1 FROM events WHERE project=? AND session=? AND seq<? LIMIT 1').get(p.project,p.session,first)
    return {events:rows.map(x=>JSON.parse(x.payload)),before:first,hasOlder,cache:status(p.project,p.session)}
  }
  if(method==='search'){
    if(typeof p.query!=='string'||p.query.length>500)throw Error('Search query must be below 500 characters')
    const needle=p.query.trim().toLowerCase();if(!needle)return []
    const projects=p.projects||[p.project];if(!projects.length)return []
    const args=[...projects];let where=`e.project IN (${projects.map(()=>'?').join(',')})`
    if(p.session){where+=' AND e.session=?';args.push(p.session)}
    const indexed=[...needle].length>=3
    if(indexed){where+=' AND search MATCH ?';args.push('"'+needle.replaceAll('"','""')+'"')}
    where+=' AND instr(e.text,?)>0';args.push(needle)
    const rows=db.prepare(`SELECT e.* FROM events e ${indexed?'JOIN search ON search.rowid=e.rowid':''} WHERE ${where} ORDER BY e.at DESC,e.seq DESC LIMIT 200`).all(...args)
    return rows.map(row=>{const offset=row.text.indexOf(needle);return {project:row.project,sessionId:row.session,seq:row.seq,kind:row.kind,recordedAt:row.at||undefined,snippet:(row.original||row.text).slice(Math.max(0,offset-90),offset+needle.length+160)}})
  }
  if(method==='checkpoint'){db.exec('PRAGMA wal_checkpoint(PASSIVE)');return}
  if(method==='health')return {threadId,reader:workerData.reader===true,version:db.prepare('SELECT sqlite_version() v').get().v}
  if(method==='close'){db.close();return}
  throw Error('Unsupported cache request')
}
parentPort.on('message',({id,method,params,cancel})=>{let snapshot=false;try{if(cancel&&Atomics.load(cancel,0))throw Object.assign(Error('History query cancelled'),{code:'HISTORY_QUERY_CANCELLED'});if(workerData.reader&&method!=='close'){db.exec('BEGIN');snapshot=true}const value=run(method,params||{});if(snapshot){db.exec('COMMIT');snapshot=false}if(cancel&&Atomics.load(cancel,0))throw Object.assign(Error('History query cancelled'),{code:'HISTORY_QUERY_CANCELLED'});parentPort.postMessage({id,ok:true,value})}catch(error){if(snapshot)db.exec('ROLLBACK');parentPort.postMessage({id,ok:false,error:{message:error.message,code:error.code}})}})
parentPort.postMessage({ready:true,threadId})
