import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {DEFAULT_PRODUCTS} from './core.js';
const arrays=value=>{try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}};
const productRow=row=>row&&({...row,active:!!row.active,autoWrapper:!!row.auto_wrapper,productType:row.product_type==='addon'?'addon':'primary',requiresKey:row.requires_key||'',connectionKey:row.connection_key||'',externalIds:arrays(row.external_ids),accessUrl:row.access_url||'',tutorialUrl:row.tutorial_url||'',accessToken:row.access_token||'',template:row.template||''});
const connectionRow=row=>row&&({key:row.key,name:row.name,instanceName:row.instance_name,profileName:row.profile_name||'',active:!!row.active,isDefault:!!row.is_default,webhookKeyHash:row.webhook_key_hash||'',phone:row.phone||'',state:row.state||'not_checked',checkedAt:row.checked_at||null,disconnectedSince:row.disconnected_since||null,lastConnectedAt:row.last_connected_at||null,created:row.created,updated:row.updated});
export function store(path,options={}){
 mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
 CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,phone TEXT,kind TEXT,state TEXT,mid TEXT,attempts INTEGER DEFAULT 0,due INTEGER DEFAULT 0,error TEXT,created INTEGER);
 CREATE TABLE IF NOT EXISTS events(mid TEXT,status TEXT,timestamp INTEGER,PRIMARY KEY(mid,status,timestamp));`);
 db.exec(`CREATE TABLE IF NOT EXISTS delivery_history(seq INTEGER PRIMARY KEY,id TEXT,phone TEXT,mid TEXT,state TEXT,error TEXT,attempts INTEGER,created INTEGER);
 CREATE TABLE IF NOT EXISTS admin_actions(request_id TEXT PRIMARY KEY,delivery_id TEXT);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE IF NOT EXISTS products(key TEXT PRIMARY KEY,name TEXT NOT NULL,external_ids TEXT NOT NULL DEFAULT '[]',access_url TEXT NOT NULL DEFAULT '',tutorial_url TEXT NOT NULL DEFAULT '',access_token TEXT NOT NULL DEFAULT '',template TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,auto_wrapper INTEGER NOT NULL DEFAULT 0,product_type TEXT NOT NULL DEFAULT 'primary',requires_key TEXT NOT NULL DEFAULT '',connection_key TEXT NOT NULL DEFAULT '',position INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS whatsapp_connections(key TEXT PRIMARY KEY,name TEXT NOT NULL,instance_name TEXT NOT NULL UNIQUE,phone TEXT NOT NULL DEFAULT '',profile_name TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,is_default INTEGER NOT NULL DEFAULT 0,webhook_key_hash TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'not_checked',checked_at INTEGER,disconnected_since INTEGER,last_connected_at INTEGER,created INTEGER NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS orders(payment_id TEXT PRIMARY KEY,created INTEGER NOT NULL);`);
 const eventColumns=new Set(db.prepare('PRAGMA table_info(events)').all().map(c=>c.name));
 if(!eventColumns.has('error'))db.exec('ALTER TABLE events ADD COLUMN error TEXT');
 const columns=new Set(db.prepare('PRAGMA table_info(deliveries)').all().map(c=>c.name));
 for(const [name,type] of [['name','TEXT'],['email','TEXT'],['raw_phone','TEXT'],['updated','INTEGER'],['resolved','INTEGER DEFAULT 0'],['product_keys','TEXT'],['access_label','TEXT'],['message_text','TEXT'],['payment_id','TEXT'],['connection_key','TEXT']])if(!columns.has(name))db.exec(`ALTER TABLE deliveries ADD COLUMN ${name} ${type}`);
 const productColumns=new Set(db.prepare('PRAGMA table_info(products)').all().map(c=>c.name));if(!productColumns.has('auto_wrapper')){db.exec('ALTER TABLE products ADD COLUMN auto_wrapper INTEGER NOT NULL DEFAULT 1');db.exec("UPDATE products SET auto_wrapper=0 WHERE key NOT IN ('carne','proprios')");}const needsProductType=!productColumns.has('product_type')||!productColumns.has('requires_key');if(!productColumns.has('product_type'))db.exec("ALTER TABLE products ADD COLUMN product_type TEXT NOT NULL DEFAULT 'primary'");if(!productColumns.has('requires_key'))db.exec("ALTER TABLE products ADD COLUMN requires_key TEXT NOT NULL DEFAULT ''");if(!productColumns.has('connection_key'))db.exec("ALTER TABLE products ADD COLUMN connection_key TEXT NOT NULL DEFAULT ''");if(needsProductType)db.exec("UPDATE products SET product_type='addon',requires_key='carne' WHERE key='proprios'");
 const now=Date.now();
 const defaultConnection=options.defaultConnection?.instanceName?{key:options.defaultConnection.key||'principal',name:options.defaultConnection.name||'Entregas principal',instanceName:options.defaultConnection.instanceName,webhookKeyHash:options.defaultConnection.webhookKeyHash||''}:null;
 if(defaultConnection)db.prepare('INSERT OR IGNORE INTO whatsapp_connections(key,name,instance_name,active,is_default,webhook_key_hash,created,updated) VALUES(?,?,?,1,1,?,?,?)').run(defaultConnection.key,defaultConnection.name,defaultConnection.instanceName,defaultConnection.webhookKeyHash,now,now);
 const defaultKey=defaultConnection?.key||db.prepare('SELECT key FROM whatsapp_connections WHERE is_default=1 ORDER BY created LIMIT 1').get()?.key||'';
 for(const item of DEFAULT_PRODUCTS){const token=item.key==='proprios'?(options.productsAccessToken||item.accessToken):item.accessToken;const connectionKey=item.productType==='addon'?'':defaultKey;db.prepare('INSERT OR IGNORE INTO products(key,name,external_ids,access_url,tutorial_url,access_token,template,active,auto_wrapper,product_type,requires_key,connection_key,position,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(item.key,item.name,JSON.stringify(item.externalIds),item.accessUrl,item.tutorialUrl,token,item.template,item.active?1:0,item.autoWrapper?1:0,item.productType,item.requiresKey,connectionKey,item.position,now,now);}
 if(defaultKey){db.prepare("UPDATE products SET connection_key=? WHERE connection_key='' AND product_type='primary'").run(defaultKey);db.prepare("UPDATE deliveries SET connection_key=? WHERE connection_key IS NULL OR connection_key='' ").run(defaultKey);}
 if(options.productsAccessToken)db.prepare("UPDATE products SET access_token=? WHERE key='proprios' AND access_token='' ").run(options.productsAccessToken);
 db.exec("UPDATE deliveries SET product_keys=CASE WHEN kind='combo' THEN '[\"carne\",\"proprios\"]' ELSE '[\"carne\"]' END WHERE product_keys IS NULL; UPDATE deliveries SET access_label=CASE WHEN kind='combo' THEN 'Calculadora de Precificação de Carnes + Calculadora de Produtos Próprios' ELSE 'Calculadora de Precificação de Carnes' END WHERE access_label IS NULL; UPDATE deliveries SET payment_id=id WHERE payment_id IS NULL;");
 db.exec("INSERT OR IGNORE INTO orders(payment_id,created) SELECT payment_id,created FROM deliveries WHERE id NOT LIKE 'test:%' AND payment_id IS NOT NULL;");
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
 connections(includeInactive=true){return db.prepare(`SELECT * FROM whatsapp_connections${includeInactive?'':' WHERE active=1'} ORDER BY is_default DESC,created,name`).all().map(connectionRow);},
 connection(key){return connectionRow(db.prepare('SELECT * FROM whatsapp_connections WHERE key=?').get(String(key||'')));},
 defaultConnection(){return connectionRow(db.prepare('SELECT * FROM whatsapp_connections WHERE active=1 ORDER BY is_default DESC,created LIMIT 1').get());},
 saveConnection(input){const key=String(input.key||'').trim();const name=String(input.name||'').trim();const instanceName=String(input.instanceName||'').trim();if(!/^[a-z0-9][a-z0-9_-]{2,49}$/.test(key)||name.length<3||name.length>80||!/^[a-zA-Z0-9_-]{3,100}$/.test(instanceName))throw Error('invalid_connection');const now=Date.now();if(input.isDefault)db.exec('UPDATE whatsapp_connections SET is_default=0');try{db.prepare('INSERT INTO whatsapp_connections(key,name,instance_name,active,is_default,webhook_key_hash,state,created,updated) VALUES(?,?,?,1,?,?,\'connecting\',?,?)').run(key,name,instanceName,input.isDefault?1:0,String(input.webhookKeyHash||''),now,now);}catch(e){if(String(e.message).includes('UNIQUE'))throw Error('duplicate_connection');throw e;}return this.connection(key);},
 deleteConnection(key){if(db.prepare('SELECT 1 FROM products WHERE connection_key=? LIMIT 1').get(key))throw Error('connection_in_use');return db.prepare('DELETE FROM whatsapp_connections WHERE key=? AND is_default=0').run(key).changes;},
 observeWhatsappConnection(key,info){const current=this.connection(key);if(!current)return null;const now=Date.now();const state=info.state||'unavailable';const disconnectedSince=state==='disconnected'?(current.disconnectedSince||now):state==='connected'?null:current.disconnectedSince;const lastConnectedAt=state==='connected'?now:current.lastConnectedAt;const phone=info.phone||current.phone||'';const profileName=info.profileName||current.profileName||'';db.prepare('UPDATE whatsapp_connections SET phone=?,profile_name=?,state=?,checked_at=?,disconnected_since=?,last_connected_at=?,updated=? WHERE key=?').run(phone,profileName,state,now,disconnectedSince,lastConnectedAt,now,key);return this.connection(key);},
 effectiveConnectionKey(product,catalog=this.products(true)){if(product.connectionKey)return product.connectionKey;if(product.productType==='addon'&&product.requiresKey)return catalog.find(p=>p.key===product.requiresKey)?.connectionKey||this.defaultConnection()?.key||'';return this.defaultConnection()?.key||'';},
 deliveryGroups(products){const available=this.connections(false);if(!available.length)return [{connection:{key:'',instanceName:''},products}];const catalog=this.products(true),groups=new Map();for(const product of products){const connectionKey=this.effectiveConnectionKey(product,catalog);const connection=this.connection(connectionKey);if(!connection?.active)throw Error('invalid_connection');if(!groups.has(connectionKey))groups.set(connectionKey,{connection,products:[]});groups.get(connectionKey).products.push(product);}return [...groups.values()];},
 add(r){const now=Date.now();return db.prepare('INSERT OR IGNORE INTO deliveries(id,payment_id,connection_key,phone,raw_phone,name,email,kind,product_keys,access_label,message_text,state,error,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(r.id,r.payment_id||r.id,r.connection_key||'',r.phone,r.raw_phone||r.phone,r.name||'',r.email||'',r.kind,r.product_keys||null,r.access_label||null,r.message_text||null,r.error?'failed':'queued',r.error||null,now,now).changes;},
 addSales(paymentId,rows){db.exec('BEGIN IMMEDIATE');try{if(!db.prepare('INSERT OR IGNORE INTO orders(payment_id,created) VALUES(?,?)').run(paymentId,Date.now()).changes){db.exec('COMMIT');return {duplicate:true,inserted:0};}let inserted=0;for(const row of rows)inserted+=this.add(row);db.exec('COMMIT');return {duplicate:false,inserted};}catch(e){db.exec('ROLLBACK');throw e;}},
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
 resolveProducts(payload){const ids=new Set([...(payload?.products||[]).map(x=>String(x?.id||'')),...(payload?.checkout?.orderbump||[]).map(x=>String(x?.id||''))].filter(Boolean));const matched=this.products(false).filter(p=>p.externalIds.some(id=>ids.has(id)));const keys=new Set(matched.map(p=>p.key));const missing=matched.filter(p=>p.productType==='addon'&&(!p.requiresKey||!keys.has(p.requiresKey)));return {matched,missing};},
 matchProducts(payload){const result=this.resolveProducts(payload);return result.missing.length?[]:result.matched;},
 saveProduct(input){
  const now=Date.now();const key=String(input.key||'').trim();const name=String(input.name||'').trim();const template=String(input.template||'').trim();const externalIds=[...new Set((Array.isArray(input.externalIds)?input.externalIds:[]).map(x=>String(x).trim()).filter(Boolean))];
  if(!/^[a-z0-9][a-z0-9_-]{1,49}$/.test(key)||name.length<3||name.length>120||!externalIds.length||externalIds.some(x=>x.length>120)||template.length<10||template.length>4000)throw Error('invalid_product');
  const allowed=new Set(['nome_cliente','email_cliente','nome_produto','link_acesso','link_tutoriais','token_acesso']);for(const match of template.matchAll(/{{\s*([a-z_]+)\s*}}/g))if(!allowed.has(match[1]))throw Error('invalid_variable');
  const url=value=>{const v=String(value||'').trim();if(v&&!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:[/?#][^\s]*)?$/.test(v))throw Error('invalid_url');return v.slice(0,500);};
  for(const p of this.products(true))if(p.key!==key&&p.externalIds.some(id=>externalIds.includes(id)))throw Error('duplicate_external_id');
  const old=db.prepare('SELECT * FROM products WHERE key=?').get(key);if(old&&Number.isSafeInteger(input.expectedUpdated)&&old.updated!==input.expectedUpdated)throw Error('state_changed');const productType=input.productType==='addon'?'addon':'primary';const requiresKey=productType==='addon'?String(input.requiresKey||'').trim():'';const catalog=this.products(true);if(productType==='addon'){const parent=catalog.find(p=>p.key===requiresKey);if(!parent||parent.key===key||parent.productType!=='primary')throw Error('invalid_parent');if(input.active!==false&&!parent.active)throw Error('inactive_parent');}if(old&&productType==='addon'&&catalog.some(p=>p.requiresKey===key))throw Error('product_has_dependents');if(old&&productType==='primary'&&input.active===false&&catalog.some(p=>p.active&&p.requiresKey===key))throw Error('product_has_active_dependents');const requestedConnection=String(input.connectionKey||'').trim();const connectionKey=productType==='addon'&&!requestedConnection?'':(requestedConnection||this.defaultConnection()?.key||'');const hasConnections=this.connections(true).length>0;if(hasConnections&&((connectionKey&&!this.connection(connectionKey)?.active)||(!connectionKey&&productType==='primary')))throw Error('invalid_connection');
  const values=[name,JSON.stringify(externalIds),url(input.accessUrl),url(input.tutorialUrl),String(input.accessToken||'').slice(0,500),template,input.active===false?0:1,input.autoWrapper===true?1:0,productType,requiresKey,connectionKey,Math.max(0,Math.min(9999,Number(input.position)||100)),now];
  if(old)db.prepare('UPDATE products SET name=?,external_ids=?,access_url=?,tutorial_url=?,access_token=?,template=?,active=?,auto_wrapper=?,product_type=?,requires_key=?,connection_key=?,position=?,updated=? WHERE key=?').run(...values,key);else db.prepare('INSERT INTO products(name,external_ids,access_url,tutorial_url,access_token,template,active,auto_wrapper,product_type,requires_key,connection_key,position,updated,key,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...values,key,now);
  return productRow(db.prepare('SELECT * FROM products WHERE key=?').get(key));
 },
 toggleProduct(key,active,expectedUpdated){const current=productRow(db.prepare('SELECT * FROM products WHERE key=?').get(String(key||'')));if(!current)throw Error('not_found');if(current.updated!==expectedUpdated)throw Error('state_changed');const catalog=this.products(true);if(active&&current.productType==='addon'){const parent=catalog.find(p=>p.key===current.requiresKey);if(!parent?.active)throw Error('inactive_parent');}if(!active&&current.productType==='primary'&&catalog.some(p=>p.active&&p.requiresKey===current.key))throw Error('product_has_active_dependents');const updated=Math.max(Date.now(),current.updated+1);db.prepare('UPDATE products SET active=?,updated=? WHERE key=?').run(active?1:0,updated,current.key);return productRow(db.prepare('SELECT * FROM products WHERE key=?').get(current.key));},
 list(filters){const enrich=rows=>{const connections=new Map(this.connections(true).map(c=>[c.key,c]));return rows.map(row=>({...row,connection_name:connections.get(row.connection_key)?.name||'',connection_phone:connections.get(row.connection_key)?.phone||''}));};if(!filters)return enrich(db.prepare('SELECT * FROM deliveries ORDER BY created DESC LIMIT 100').all());
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
 return {rows:enrich(rows),total,page,summary:db.prepare('SELECT state,COUNT(*) AS n FROM deliveries'+where+' GROUP BY state').all(...args)};
 }
 };
}
