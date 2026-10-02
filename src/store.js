import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export function store(path){
 mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
 CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,phone TEXT,kind TEXT,state TEXT,mid TEXT,attempts INTEGER DEFAULT 0,due INTEGER DEFAULT 0,error TEXT,created INTEGER);
 CREATE TABLE IF NOT EXISTS events(mid TEXT,status TEXT,timestamp INTEGER,PRIMARY KEY(mid,status,timestamp));`);
 db.exec(`CREATE TABLE IF NOT EXISTS delivery_history(seq INTEGER PRIMARY KEY,id TEXT,phone TEXT,mid TEXT,state TEXT,error TEXT,attempts INTEGER,created INTEGER);
 CREATE TABLE IF NOT EXISTS admin_actions(request_id TEXT PRIMARY KEY,delivery_id TEXT);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);`);
 const eventColumns=new Set(db.prepare('PRAGMA table_info(events)').all().map(c=>c.name));
 if(!eventColumns.has('error'))db.exec('ALTER TABLE events ADD COLUMN error TEXT');
 const columns=new Set(db.prepare('PRAGMA table_info(deliveries)').all().map(c=>c.name));
 for(const [name,type] of [['name','TEXT'],['email','TEXT'],['raw_phone','TEXT'],['updated','INTEGER'],['resolved','INTEGER DEFAULT 0']])if(!columns.has(name))db.exec(`ALTER TABLE deliveries ADD COLUMN ${name} ${type}`);
 db.exec(`CREATE INDEX IF NOT EXISTS deliveries_mid ON deliveries(mid); CREATE INDEX IF NOT EXISTS deliveries_created ON deliveries(created);
 UPDATE deliveries SET state='uncertain',error='restart_during_send',updated=${Date.now()} WHERE state='sending';`);
 return {db,
 get(id){return db.prepare('SELECT * FROM deliveries WHERE id=?').get(id);},
 history(id){return db.prepare('SELECT * FROM delivery_history WHERE id=? ORDER BY seq DESC').all(id);},
 requeue(id,newPhone,requestId,updated,acknowledged){
 db.exec('BEGIN IMMEDIATE');try{
 const previous=db.prepare('SELECT * FROM admin_actions WHERE request_id=?').get(requestId);
 if(previous){db.exec('COMMIT');return {duplicate:true,id:previous.delivery_id};}
 const r=this.get(id);if(!r)throw Error('not_found');
 if(!['failed','uncertain','simulated'].includes(r.state)||r.updated!==updated)throw Error('state_changed');
 if(r.state==='uncertain'&&!acknowledged)throw Error('uncertain_requires_confirmation');
 db.prepare('INSERT INTO delivery_history(id,phone,mid,state,error,attempts,created) VALUES(?,?,?,?,?,?,?)').run(id,r.phone,r.mid,r.state,r.error,r.attempts,Date.now());
 db.prepare("UPDATE deliveries SET phone=?,state='queued',mid=NULL,error=NULL,attempts=0,due=0,resolved=0,updated=? WHERE id=?").run(newPhone,Date.now(),id);
 db.prepare('INSERT INTO admin_actions VALUES(?,?)').run(requestId,id);db.exec('COMMIT');return {id,queued:true};
 }catch(e){db.exec('ROLLBACK');throw e;}
 },
 observeConnection(info){
 const old=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='connection'").get()?.value||'{}');const now=Date.now();
 const state=info.state;const outage=state==='disconnected'?(old.disconnectedSince||now):state==='connected'?null:(old.disconnectedSince||null);
 const value={...info,checkedAt:now,disconnectedSince:outage,lastConnectedAt:state==='connected'?now:old.lastConnectedAt||null};
 db.prepare("INSERT INTO settings VALUES('connection',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));return value;
 },
 add(r){const now=Date.now();return db.prepare('INSERT OR IGNORE INTO deliveries(id,phone,raw_phone,name,email,kind,state,error,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)').run(r.id,r.phone,r.raw_phone||r.phone,r.name||'',r.email||'',r.kind,r.error?'failed':'queued',r.error||null,now,now).changes;},
 addTest(r){db.exec('BEGIN IMMEDIATE');try{const added=this.add(r);if(added&&!r.error)db.prepare("UPDATE deliveries SET state='sending',attempts=1 WHERE id=?").run(r.id);db.exec('COMMIT');return added;}catch(e){db.exec('ROLLBACK');throw e;}},
 next(){const r=db.prepare("SELECT * FROM deliveries WHERE state IN ('queued','retry') AND due<=? ORDER BY created LIMIT 1").get(Date.now());if(r)db.prepare("UPDATE deliveries SET state='sending',attempts=attempts+1,updated=? WHERE id=?").run(Date.now(),r.id);return r;},
 finish(r,result){db.prepare("UPDATE deliveries SET state=?,mid=COALESCE(?,mid),error=?,due=?,updated=? WHERE id=? AND state='sending'").run(result.state,result.mid||null,result.error||null,Date.now()+60000*2**r.attempts,Date.now(),r.id);if(result.mid)for(const event of db.prepare('SELECT * FROM events WHERE mid=? ORDER BY timestamp').all(result.mid))this.status({id:event.mid,status:event.status,timestamp:event.timestamp,error:event.error});},
 status(s){if(!['sent','delivered','read','failed'].includes(s.status)||typeof s.id!=='string')return;
 db.prepare('INSERT OR IGNORE INTO events(mid,status,timestamp,error) VALUES(?,?,?,?)').run(s.id,s.status,Number(s.timestamp)||0,s.error||(s.status==='failed'?(s.error||`meta_${s.errors?.[0]?.code||'delivery_failed'}`):null));
 const archived=db.prepare('SELECT * FROM delivery_history WHERE mid=?').get(s.id);
 if(archived){const rank={sent:1,failed:1,delivered:2,read:3};if(!(archived.state==='failed'&&s.status==='sent')&&(rank[s.status]||0)>=(rank[archived.state]||0))db.prepare('UPDATE delivery_history SET state=?,error=? WHERE mid=?').run(s.status,s.status==='failed'?(s.error||'delivery_failed'):null,s.id);return;}
 const r=db.prepare('SELECT * FROM deliveries WHERE mid=? OR (id=? AND state IN (\'sending\',\'accepted\',\'uncertain\',\'sent\'))').get(s.id,s.biz_opaque_callback_data||'');if(!r)return;
 const ranks={accepted:0,sending:0,uncertain:0,sent:1,failed:1,delivered:2,read:3};
 // Falha é terminal, exceto quando a entrega/leitura é confirmada depois.
 if(r.state==='failed'&&s.status==='sent')return;
 if((ranks[s.status]||0)>=(ranks[r.state]||0))db.prepare('UPDATE deliveries SET state=?,mid=?,error=?,updated=? WHERE id=?').run(s.status,s.id,s.status==='failed'?(s.error||`meta_${s.errors?.[0]?.code||'delivery_failed'}`):null,Date.now(),r.id);
 },
 resolve(id,value){return db.prepare('UPDATE deliveries SET resolved=?,updated=? WHERE id=?').run(value?1:0,Date.now(),id).changes;},
 list(filters){if(!filters)return db.prepare('SELECT * FROM deliveries ORDER BY created DESC LIMIT 100').all();
 const clauses=[],args=[];
 if(filters.source==='sales')clauses.push("id NOT LIKE 'test:%'");
 if(filters.source==='tests')clauses.push("id LIKE 'test:%'");
 if(filters.q){clauses.push('(instr(lower(name),?)>0 OR instr(lower(email),?)>0 OR instr(raw_phone,?)>0 OR instr(id,?)>0 OR instr(phone,?)>0)');const q=String(filters.q).slice(0,200).toLowerCase();args.push(q,q,q,q,q);}
 if(filters.state==='attention'){clauses.push("state IN ('failed','uncertain') AND resolved=0");}else if(filters.state){clauses.push('state=?');args.push(filters.state);}
 for(const [key,operator] of [['from','>='],['to','<']])if(Number.isFinite(filters[key])){clauses.push(`created ${operator} ?`);args.push(filters[key]);}
 const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
 const total=db.prepare('SELECT COUNT(*) AS n FROM deliveries'+where).get(...args).n;
 const page=Math.max(1,Math.min(100000,Number(filters.page)||1));
 const rows=db.prepare('SELECT * FROM deliveries'+where+' ORDER BY created DESC LIMIT 50 OFFSET ?').all(...args,(page-1)*50);
 return {rows,total,page,summary:db.prepare('SELECT state,COUNT(*) AS n FROM deliveries'+where+' GROUP BY state').all(...args)};
 }
 };
}
