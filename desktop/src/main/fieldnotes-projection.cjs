// Executes only inside the history cache's existing writer/readers.
// Canonical Go receipts omit empty optional arrays. Normalize both live writes
// and older cached rows so transport shape cannot crash the renderer.
const receipt=value=>({...value,notes:Array.isArray(value.notes)?value.notes:[],omitted:Array.isArray(value.omitted)?value.omitted:[]})
exports.initialize = db => db.exec(`
 CREATE TABLE IF NOT EXISTS fieldnotes(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,enabled INTEGER NOT NULL,deleted INTEGER NOT NULL,project TEXT NOT NULL,session TEXT NOT NULL,updated TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,topics TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS fieldnotes_target ON fieldnotes(project,session,updated DESC);
 CREATE TABLE IF NOT EXISTS fieldnote_state(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL);
 INSERT OR IGNORE INTO fieldnote_state VALUES(1,0);
 CREATE VIRTUAL TABLE IF NOT EXISTS fieldnote_search USING fts5(title,body,topics,content='fieldnotes',content_rowid='rowid',tokenize='unicode61');
 CREATE TRIGGER IF NOT EXISTS fieldnote_insert AFTER INSERT ON fieldnotes BEGIN INSERT INTO fieldnote_search(rowid,title,body,topics) VALUES(new.rowid,new.title,new.body,new.topics); END;
 CREATE TRIGGER IF NOT EXISTS fieldnote_delete AFTER DELETE ON fieldnotes BEGIN INSERT INTO fieldnote_search(fieldnote_search,rowid,title,body,topics) VALUES('delete',old.rowid,old.title,old.body,old.topics); END;
 CREATE TRIGGER IF NOT EXISTS fieldnote_update AFTER UPDATE ON fieldnotes BEGIN INSERT INTO fieldnote_search(fieldnote_search,rowid,title,body,topics) VALUES('delete',old.rowid,old.title,old.body,old.topics); INSERT INTO fieldnote_search(rowid,title,body,topics) VALUES(new.rowid,new.title,new.body,new.topics); END;
 CREATE TABLE IF NOT EXISTS fieldnote_receipts(message TEXT PRIMARY KEY,project TEXT NOT NULL,session TEXT NOT NULL,created TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS fieldnote_receipt_owner ON fieldnote_receipts(project,session,created DESC);
`)
exports.run = (db, method, p) => {
 if(method==='fieldnotes.put'){
  if(!Array.isArray(p.notes)||p.notes.length>250)throw Error('Invalid note projection batch')
  db.exec('BEGIN IMMEDIATE')
  try{
   const put=db.prepare('INSERT INTO fieldnotes VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,enabled=excluded.enabled,deleted=excluded.deleted,project=excluded.project,session=excluded.session,updated=excluded.updated,title=excluded.title,body=excluded.body,topics=excluded.topics,payload=excluded.payload WHERE excluded.revision>=fieldnotes.revision')
   for(const n of p.notes)put.run(n.id,n.revision,n.enabled?1:0,n.deletedAt?1:0,n.pointer.projectPath,n.pointer.sessionId||'',n.updatedAt,n.title,n.deletedAt?'':n.body,n.interpretation?.revision===n.revision?n.interpretation.topics.join(' '):'',JSON.stringify(n))
   db.exec('UPDATE fieldnote_state SET generation=generation+1 WHERE id=1; COMMIT')
  }catch(error){db.exec('ROLLBACK');throw error}
  return
 }
 if(method==='fieldnotes.reset'){
  db.exec('BEGIN IMMEDIATE');try{db.exec('DELETE FROM fieldnotes; UPDATE fieldnote_state SET generation=generation+1 WHERE id=1; COMMIT')}catch(error){db.exec('ROLLBACK');throw error}return
 }
 if(method==='fieldnotes.receipt.put'){
  const r=receipt(p.receipt)
  db.prepare("INSERT INTO fieldnote_receipts VALUES(?,?,?,?,?) ON CONFLICT(message) DO UPDATE SET payload=CASE WHEN json_extract(fieldnote_receipts.payload,'$.state')='accepted' AND json_extract(excluded.payload,'$.state')='prepared' THEN fieldnote_receipts.payload ELSE excluded.payload END").run(r.messageId,r.project,r.sessionId,r.createdAt,JSON.stringify(r));return
 }
 if(method==='fieldnotes.receipts')return db.prepare('SELECT payload FROM fieldnote_receipts WHERE project=? AND session=? ORDER BY created DESC LIMIT 100').all(p.project,p.session).map(r=>receipt(JSON.parse(r.payload)))
 if(method!=='fieldnotes.search')throw Error('Unsupported note cache operation')
 const q=p.query||'',limit=Math.min(50,Math.max(1,p.limit||50))
 if(typeof q!=='string'||q.length>8000||!Number.isSafeInteger(limit))throw Error('Invalid note query')
 const generation=db.prepare('SELECT generation FROM fieldnote_state WHERE id=1').get().generation
 let offset=0
 if(p.cursor){let c;try{c=JSON.parse(Buffer.from(p.cursor,'base64url').toString())}catch{throw Error('Invalid note page')};if(c.generation!==generation||c.query!==q||c.disabled!==!!p.includeDisabled||!Number.isSafeInteger(c.offset)||c.offset<0||c.offset>10000)throw Error('The note library changed. Refresh the list.');offset=c.offset}
 const terms=[...new Set(q.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu)||[])].slice(0,24)
 const match=terms.map(t=>'"'+t.replaceAll('"','""')+'"*').join(' OR ')
 const args=[],clauses=['n.deleted=0']
 if(!p.includeDisabled)clauses.push('n.enabled=1')
 let join='',cte=''
 if(match){cte='WITH hits AS MATERIALIZED (SELECT rowid,bm25(fieldnote_search,4,1,2) AS rank FROM fieldnote_search WHERE fieldnote_search MATCH ?) ';join='LEFT JOIN hits ON hits.rowid=n.rowid';args.push(match);if(p.suggest){clauses.push('(hits.rowid IS NOT NULL OR n.project=?)');args.push(p.project||'')}else clauses.push('hits.rowid IS NOT NULL')}
 else if(p.suggest){clauses.push('n.project=?');args.push(p.project||'')}
 const where=clauses.join(' AND '),total=db.prepare(`${cte}SELECT count(*) AS count FROM fieldnotes n ${join} WHERE ${where}`).get(...args).count
 const order=p.suggest?'CASE WHEN n.project=? AND n.session=? AND n.session<>\'\' THEN 0 WHEN n.project=? THEN 1 ELSE 2 END,':''
 const orderArgs=p.suggest?[p.project||'',p.sessionId||'',p.project||'']:[]
 const rows=db.prepare(`${cte}SELECT n.payload FROM fieldnotes n ${join} WHERE ${where} ORDER BY ${order}${match?'coalesce(hits.rank,0),':''}n.updated DESC,n.id LIMIT ? OFFSET ?`).all(...args,...orderArgs,limit,offset)
 const next=offset+rows.length
 return {notes:rows.map(r=>JSON.parse(r.payload)),total,generation,nextCursor:next<total?Buffer.from(JSON.stringify({generation,offset:next,query:q,disabled:!!p.includeDisabled})).toString('base64url'):undefined}
}
