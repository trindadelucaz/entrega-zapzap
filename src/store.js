import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {DEFAULT_PRODUCTS} from './core.js';
const arrays=value=>{try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}};
const productRow=row=>row&&({...row,active:!!row.active,externalIds:arrays(row.external_ids),accessUrl:row.access_url||'',tutorialUrl:row.tutorial_url||'',accessToken:row.access_token||'',template:row.template||''});
export function store(path,options={}){
 mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
 CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,phone TEXT,kind TEXT,state TEXT,mid TEXT,attempts INTEGER DEFAULT 0,due INTEGER DEFAULT 0,error TEXT,created INTEGER);
 CREATE TABLE IF NOT EXISTS events(mid TEXT,status TEXT,timestamp INTEGER,PRIMARY KEY(mid,status,timestamp));`);
 db.exec(`CREATE TABLE IF NOT EXISTS delivery_history(seq INTEGER PRIMARY KEY,id TEXT,phone TEXT,mid TEXT,state TEXT,error TEXT,attempts INTEGER,created INTEGER);
 CREATE TABLE IF NOT EXISTS admin_actions(request_id TEXT PRIMARY KEY,delivery_id TEXT);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE IF NOT EXISTS products(key TEXT PRIMARY KEY,name TEXT NOT NULL,external_ids TEXT NOT NULL DEFAULT '[]',access_url TEXT NOT NULL DEFAULT '',tutorial_url TEXT NOT NULL DEFAULT '',access_token TEXT NOT NULL DEFAULT '',template TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,position INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL);`);
 const eventColumns=new Set(db.prepare('PRAGMA table_info(events)').all().map(c=>c.name));
 if(!eventColumns.has('error'))db.exec('ALTER TABLE events ADD COLUMN error TEXT');
 const columns=new Set(db.prepare('PRAGMA table_info(deliveries)').all().map(c=>c.name));
 for(const [name,type] of [['name','TEXT'],['email','TEXT'],['raw_phone','TEXT'],['updated','INTEGER'],['resolved','INTEGER DEFAULT 0'],['product_keys','TEXT'],['access_label','TEXT'],['message_text','TEXT']])if(!columns.has(name))db.exec(`ALTER TABLE deliveries ADD COLUMN ${name} ${type}`);
 const now=Date.now();
 for(const item of DEFAULT_PRODUCTS){const token=item.key==='proprios'?(options.productsAccessToken||item.accessToken):item.accessToken;db.prepare('INSERT OR IGNORE INTO products(key,name,external_ids,access_url,tutorial_url,access_token,template,active,position,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(item.key,item.name,JSON.stringify(item.externalIds),item.accessUrl,item.tutorialUrl,token,item.template,item.active?1:0,item.position,now,now);}
 if(options.productsAccessToken)db.prepare("UPDATE products SET access_token=? WHERE key='proprios' AND access_token='' ").run(options.productsAccessToken);
 db.exec("UPDATE deliveries SET product_keys=CASE WHEN kind='combo' THEN '[\"carne\",\"proprios\"]' ELSE '[\"carne\"]' END WHERE product_keys IS NULL; UPDATE deliveries SET access_label=CASE WHEN kind='combo' THEN 'Calculadora de Precificação de Carnes + Calculadora de Produtos Próprios' ELSE 'Calculadora de Precificação de Carnes' END WHERE access_label IS NULL;");
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
 add(r){const now=Date.now();return db.prepare('INSERT OR IGNORE INTO deliveries(id,phone,raw_phone,name,email,kind,product_keys,access_label,message_text,state,error,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(r.id,r.phone,r.raw_phone||r.phone,r.name||'',r.email||'',r.kind,r.product_keys||null,r.access_label||null,r.message_text||null,r.error?'failed':'queued',r.error||null,now,now).changes;},
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
 products(includeInactive=true){const rows=db.prepare(`SELECT * FROM products${includeInactive?'':' WHERE active=1'} ORDER BY position,name`).all();return rows.map(productRow);},
 productsByKeys(keys,includeInactive=false){const wanted=new Set(Array.isArray(keys)?keys:[]);return this.products(true).filter(p=>wanted.has(p.key)&&(includeInactive||p.active));},
 matchProducts(payload){const ids=new Set([...(payload?.products||[]).map(x=>String(x?.id||'')),...(payload?.checkout?.orderbump||[]).map(x=>String(x?.id||''))].filter(Boolean));return this.products(false).filter(p=>p.externalIds.some(id=>ids.has(id)));},
 saveProduct(input){
  const now=Date.now();const key=String(input.key||'').trim();const name=String(input.name||'').trim();const template=String(input.template||'').trim();const externalIds=[...new Set((Array.isArray(input.externalIds)?input.externalIds:[]).map(x=>String(x).trim()).filter(Boolean))];
  if(!/^[a-z0-9][a-z0-9_-]{1,49}$/.test(key)||name.length<3||name.length>120||!externalIds.length||externalIds.some(x=>x.length>120)||template.length<10||template.length>4000)throw Error('invalid_product');
  const allowed=new Set(['nome_cliente','email_cliente','nome_produto','link_acesso','link_tutoriais','token_acesso']);for(const match of template.matchAll(/{{\s*([a-z_]+)\s*}}/g))if(!allowed.has(match[1]))throw Error('invalid_variable');
  const url=value=>{const v=String(value||'').trim();if(v&&!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:[/?#][^\s]*)?$/.test(v))throw Error('invalid_url');return v.slice(0,500);};
  for(const p of this.products(true))if(p.key!==key&&p.externalIds.some(id=>externalIds.includes(id)))throw Error('duplicate_external_id');
  const old=db.prepare('SELECT * FROM products WHERE key=?').get(key);if(old&&Number.isSafeInteger(input.expectedUpdated)&&old.updated!==input.expectedUpdated)throw Error('state_changed');
  const values=[name,JSON.stringify(externalIds),url(input.accessUrl),url(input.tutorialUrl),String(input.accessToken||'').slice(0,500),template,input.active===false?0:1,Math.max(0,Math.min(9999,Number(input.position)||100)),now];
  if(old)db.prepare('UPDATE products SET name=?,external_ids=?,access_url=?,tutorial_url=?,access_token=?,template=?,active=?,position=?,updated=? WHERE key=?').run(...values,key);else db.prepare('INSERT INTO products(name,external_ids,access_url,tutorial_url,access_token,template,active,position,updated,key,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...values,key,now);
  return productRow(db.prepare('SELECT * FROM products WHERE key=?').get(key));
 },
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
