import {whatsappDetails,connectWhatsapp,logoutWhatsapp,createWhatsappInstance,statuses,suggestPhone} from './evolution.js';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {equal,signature,sale,send,phone,renderDeliveryMessage} from './core.js';
import {store} from './store.js';
const env=process.env;
for(const key of ['WIAPY_SECRET','ADMIN_TOKEN'])if(!env[key]||env[key].length<24)throw Error(`Configure ${key} com pelo menos 24 caracteres`);
const cfg={provider:env.WHATSAPP_PROVIDER||'meta',evolutionUrl:env.EVOLUTION_URL?.replace(/\/$/,''),instance:env.EVOLUTION_INSTANCE,evolutionKey:env.EVOLUTION_API_KEY,productsAccessToken:env.PRODUCTS_ACCESS_TOKEN,dry:env.DRY_RUN!=='false',token:env.META_TOKEN,number:env.META_PHONE_NUMBER_ID,version:env.META_GRAPH_VERSION,carne:env.TEMPLATE_CARNE||'acesso_calculadora_carnes',combo:env.TEMPLATE_COMBO||'acesso_combo_calculadoras'};
if(!['meta','evolution'].includes(cfg.provider))throw Error('WHATSAPP_PROVIDER inválido');
if(cfg.evolutionUrl&&!/^https:\/\//.test(cfg.evolutionUrl))throw Error('EVOLUTION_URL deve usar HTTPS');
if(!cfg.dry&&cfg.provider==='evolution')for(const key of ['EVOLUTION_URL','EVOLUTION_INSTANCE','EVOLUTION_API_KEY','PRODUCTS_ACCESS_TOKEN'])if(!env[key])throw Error(`Configure ${key}`);
if(!cfg.dry&&cfg.provider==='meta')for(const key of ['META_TOKEN','META_PHONE_NUMBER_ID','META_GRAPH_VERSION','META_APP_SECRET','META_VERIFY_TOKEN'])if(!env[key])throw Error(`Configure ${key}`);
if(!cfg.dry&&cfg.provider==='meta'&&!/^v\d+\.0$/.test(cfg.version))throw Error('Versão Graph inválida');
const enabled=env.DELIVERY_ENABLED==='true';
const mode=()=>!enabled?'paused':cfg.dry?'simulation':'live';
const hash=value=>createHash('sha256').update(String(value||'')).digest('hex');
let connectionCache;let connectionChecked=0;let connectionPending;let lastWhatsappAction=0;
const safeConnection=connection=>connection&&(({webhookKeyHash,...safe})=>safe)(connection);
const connectionCfg=connection=>({...cfg,instance:connection.instanceName});
const deliveryCfg=row=>{const connection=st.connection(row.connection_key)||st.defaultConnection();return connection?connectionCfg(connection):cfg;};
async function inspectConnection(connection,force=false){if(!connection)return {provider:'evolution',state:'not_configured'};if(!force&&connection.checkedAt&&Date.now()-connection.checkedAt<30000)return safeConnection(connection);const info=await whatsappDetails(connectionCfg(connection));return safeConnection(st.observeWhatsappConnection(connection.key,info));}
async function connectionInfo(force=false){if(connectionPending)return connectionPending;if(force||Date.now()-connectionChecked>30000||!connectionCache){connectionPending=inspectConnection(st.defaultConnection(),force).then(info=>{connectionCache=st.observeConnection(info);connectionChecked=Date.now();return info;}).finally(()=>{connectionPending=null;});return connectionPending;}return connectionCache;}
const assets=Object.fromEntries(['index.html','style.css','app.js'].map(name=>[name,readFileSync(new URL('./public/'+name,import.meta.url))]));
const st=store(env.DB_PATH||'./data/deliveries.sqlite',{productsAccessToken:cfg.productsAccessToken,defaultConnection:cfg.provider==='evolution'&&cfg.instance?{key:'principal',name:env.EVOLUTION_CONNECTION_NAME||'Entregas Açougue',instanceName:cfg.instance,webhookKeyHash:hash(cfg.evolutionKey)}:null});
const reply=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
async function body(req){let total=0;const parts=[];for await(const chunk of req){total+=chunk.length;if(total>262144)throw Error('too_large');parts.push(chunk);}return Buffer.concat(parts);}
const publicOrigin=req=>{if(env.PUBLIC_URL&&/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(env.PUBLIC_URL.replace(/\/$/,'')))return env.PUBLIC_URL.replace(/\/$/,'');const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();const proto=String(req.headers['x-forwarded-proto']||'https').split(',')[0].trim();if(!/^[A-Za-z0-9.-]+(?::\d+)?$/.test(host)||!['http','https'].includes(proto))throw Error('invalid_origin');return `${proto}://${host}`;};
const connectionKey=name=>{const base=String(name||'whatsapp').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,32)||'whatsapp';return `${base}_${randomBytes(3).toString('hex')}`;};
const server=http.createServer(async(req,res)=>{try{
 res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
 res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 const url=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&url.pathname==='/health'){st.db.prepare('SELECT 1').get();return reply(res,200,{ok:true,mode:mode()});}
 if(url.pathname==='/admin'||url.pathname.startsWith('/admin/')){
 const auth=req.headers.authorization||'';
 const basic='Basic '+Buffer.from('admin:'+env.ADMIN_TOKEN).toString('base64');
 if(!equal(auth,basic)&&!equal(auth,`Bearer ${env.ADMIN_TOKEN}`)){res.setHeader('www-authenticate','Basic realm="Relatorio de entregas", charset="UTF-8"');return reply(res,401,{error:'unauthorized'});}
 if(req.method==='GET'&&(url.pathname==='/admin'||url.pathname==='/admin/')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(assets['index.html']);}
 const asset=url.pathname.slice('/admin/'.length);
 if(req.method==='GET'&&['style.css','app.js'].includes(asset)){res.writeHead(200,{'content-type':asset.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'});return res.end(assets[asset]);}
 if(url.pathname==='/admin/connection'&&req.method==='GET')return reply(res,200,await connectionInfo(url.searchParams.get('refresh')==='1'));
 if(url.pathname==='/admin/whatsapp/connections'&&req.method==='GET'){
  const force=url.searchParams.get('refresh')==='1';const rows=await Promise.all(st.connections(false).map(item=>inspectConnection(item,force)));return reply(res,200,{rows,defaultKey:st.defaultConnection()?.key||''});}
 if(url.pathname==='/admin/whatsapp/connections'&&req.method==='POST'){
  if(req.headers['x-admin-action']!=='create-whatsapp')return reply(res,403,{error:'invalid_action'});if(cfg.provider!=='evolution'||!cfg.evolutionUrl||!cfg.evolutionKey)return reply(res,409,{error:'evolution_not_configured'});const p=JSON.parse((await body(req)).toString());const name=String(p.name||'').trim();if(name.length<3||name.length>80)return reply(res,400,{error:'invalid_connection'});if(Date.now()-lastWhatsappAction<3000)return reply(res,429,{error:'action_too_fast'});lastWhatsappAction=Date.now();const key=connectionKey(name),instanceName=`entrega-${key}`.slice(0,90),token=randomBytes(32).toString('hex');try{const created=await createWhatsappInstance(cfg,{instanceName,token,callbackUrl:publicOrigin(req)+'/webhooks/evolution'});const connection=st.saveConnection({key,name,instanceName,webhookKeyHash:hash(token),isDefault:!st.defaultConnection()});connectionChecked=0;return reply(res,201,{connection:safeConnection(connection),qr:created.qr});}catch(e){try{st.deleteConnection(key);}catch{}const known=['duplicate_connection','evolution_permission_denied','invalid_connection'];return reply(res,known.includes(e.message)?409:502,{error:known.includes(e.message)?e.message:'evolution_action_failed'});}}
 if(url.pathname==='/admin/whatsapp/connect'&&req.method==='POST'){
  if(req.headers['x-admin-action']!=='connect-whatsapp')return reply(res,403,{error:'invalid_action'});if(cfg.provider!=='evolution')return reply(res,409,{error:'evolution_not_configured'});const p=JSON.parse((await body(req)).toString());const connection=st.connection(p.key)||st.defaultConnection();if(!connection)return reply(res,404,{error:'connection_not_found'});if(Date.now()-lastWhatsappAction<3000)return reply(res,429,{error:'action_too_fast'});lastWhatsappAction=Date.now();try{const result=await connectWhatsapp(connectionCfg(connection));connectionChecked=0;return reply(res,200,{...result,key:connection.key});}catch{return reply(res,409,{error:'evolution_action_failed'});}}
 if(url.pathname==='/admin/whatsapp/logout'&&req.method==='POST'){
  if(req.headers['x-admin-action']!=='logout-whatsapp')return reply(res,403,{error:'invalid_action'});const p=JSON.parse((await body(req)).toString());if(p.confirm!=='TROCAR')return reply(res,400,{error:'confirmation_required'});if(cfg.provider!=='evolution')return reply(res,409,{error:'evolution_not_configured'});const connection=st.connection(p.key)||st.defaultConnection();if(!connection)return reply(res,404,{error:'connection_not_found'});if(Date.now()-lastWhatsappAction<3000)return reply(res,429,{error:'action_too_fast'});lastWhatsappAction=Date.now();try{await logoutWhatsapp(connectionCfg(connection));connectionChecked=0;st.observeWhatsappConnection(connection.key,{state:'disconnected'});return reply(res,200,{ok:true,key:connection.key});}catch{return reply(res,409,{error:'evolution_action_failed'});}}
 if(url.pathname==='/admin/products'&&req.method==='GET')return reply(res,200,{rows:st.products(true),connections:st.connections(false).map(safeConnection),defaultKey:st.defaultConnection()?.key||''});
 if(url.pathname==='/admin/products'&&req.method==='POST'){
  if(req.headers['x-admin-action']!=='save-product')return reply(res,403,{error:'invalid_action'});
  const p=JSON.parse((await body(req)).toString());try{return reply(res,200,{product:st.saveProduct(p)});}catch(e){const known=['invalid_product','invalid_variable','invalid_url','duplicate_external_id','state_changed','invalid_parent','product_has_dependents','inactive_parent','product_has_active_dependents','invalid_connection'];return reply(res,known.includes(e.message)?409:500,{error:known.includes(e.message)?e.message:'internal_error'});}}
 if(url.pathname==='/admin/products/toggle'&&req.method==='POST'){
  if(req.headers['x-admin-action']!=='toggle-product')return reply(res,403,{error:'invalid_action'});const p=JSON.parse((await body(req)).toString());if(typeof p.key!=='string'||typeof p.active!=='boolean'||!Number.isSafeInteger(p.expectedUpdated))return reply(res,400,{error:'invalid_payload'});try{return reply(res,200,{product:st.toggleProduct(p.key,p.active,p.expectedUpdated)});}catch(e){const known=['not_found','state_changed','inactive_parent','product_has_active_dependents'];return reply(res,e.message==='not_found'?404:409,{error:known.includes(e.message)?e.message:'internal_error'});}}
 if(url.pathname==='/admin/products/preview'&&req.method==='POST'){
  if(req.headers['x-admin-action']!=='preview-product')return reply(res,403,{error:'invalid_action'});
  const p=JSON.parse((await body(req)).toString());try{const product={name:String(p.name||'Produto de teste'),accessUrl:String(p.accessUrl||''),tutorialUrl:String(p.tutorialUrl||''),accessToken:String(p.accessToken||''),template:String(p.template||''),autoWrapper:p.autoWrapper===true};return reply(res,200,{text:renderDeliveryMessage([product],{name:'Cliente Teste',email:'cliente@exemplo.com'})});}catch{return reply(res,400,{error:'invalid_product'});}}
 if(url.pathname==='/admin/deliveries'&&req.method==='GET'){
 const filters={q:url.searchParams.get('q'),state:url.searchParams.get('state'),source:url.searchParams.get('source')||'sales',page:Math.floor(Number(url.searchParams.get('page')))||1};
 for(const k of ['from','to']){const d=url.searchParams.get(k);if(d){if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return reply(res,400,{error:'invalid_date'});const ms=Date.parse(d+'T00:00:00-03:00');if(!Number.isFinite(ms))return reply(res,400,{error:'invalid_date'});filters[k]=ms+(k==='to'?86400000:0);}}
 return reply(res,200,{...st.list(filters),mode:mode()});}
 if(url.pathname==='/admin/history'&&req.method==='GET')return reply(res,200,{rows:st.history(url.searchParams.get('id'))});
 if(url.pathname==='/admin/suggest-phone'&&req.method==='POST'){
 if(req.headers['x-admin-action']!=='suggest')return reply(res,403,{error:'invalid_action'});
 const p=JSON.parse((await body(req)).toString());const r=st.get(p.id);if(!r)return reply(res,404,{error:'not_found'});
 if(cfg.provider!=='evolution')return reply(res,409,{error:'evolution_not_configured'});
 try{return reply(res,200,await suggestPhone(phone(r.phone||r.raw_phone),deliveryCfg(r)));}catch{return reply(res,409,{error:'evolution_number_check_failed'});}}
 if(url.pathname==='/admin/resend'&&req.method==='POST'){
 if(req.headers['x-admin-action']!=='resend')return reply(res,403,{error:'invalid_action'});
 if(mode()!=='live')return reply(res,409,{error:'live_required'});
 const p=JSON.parse((await body(req)).toString());
 if(typeof p.id!=='string'||typeof p.requestId!=='string'||!/^[-a-f0-9]{36}$/.test(p.requestId)||!Number.isSafeInteger(p.updated))return reply(res,400,{error:'invalid_payload'});
 let number;try{number=phone(p.phone);}catch{return reply(res,400,{error:'invalid_phone'});}
 try{return reply(res,200,st.requeue(p.id,number,p.requestId,p.updated,p.acknowledged===true));}catch(e){return reply(res,e.message==='not_found'?404:409,{error:['not_found','state_changed','uncertain_requires_confirmation'].includes(e.message)?e.message:'internal_error'});}}
 if(url.pathname==='/admin/test'&&req.method==='POST'){
 if(req.headers['x-admin-action']!=='test')return reply(res,403,{error:'invalid_action'});
 if(cfg.provider!=='evolution'||!cfg.evolutionUrl||!cfg.evolutionKey||!st.connections(false).length)return reply(res,409,{error:'evolution_not_configured'});
 const p=JSON.parse((await body(req)).toString());
  if(typeof p.requestId!=='string'||!/^[-a-f0-9]{36}$/.test(p.requestId))return reply(res,400,{error:'invalid_payload'});
  const keys=Array.isArray(p.productKeys)?p.productKeys:(p.kind==='combo'?['carne','proprios']:p.kind==='carne'?['carne']:[]);const products=st.productsByKeys(keys);if(!products.length||products.length!==new Set(keys).size)return reply(res,400,{error:'invalid_product'});
 let normalized='',phoneError=null;try{normalized=phone(p.phone);}catch{phoneError='invalid_phone';}
  const customer={name:'Teste de entrega',email:''};let groups;try{groups=st.deliveryGroups(products);}catch{return reply(res,409,{error:'invalid_connection'});}const results=[];for(const group of groups){const id='test:'+p.requestId+(groups.length>1?':'+group.connection.key:'');const r={id,payment_id:'test:'+p.requestId,connection_key:group.connection.key,phone:normalized,error:phoneError,raw_phone:String(p.phone||'').slice(0,80),...customer,kind:group.products.length>1?'catalog':group.products[0].key,product_keys:JSON.stringify(group.products.map(x=>x.key)),access_label:group.products.map(x=>x.name).join(' + '),message_text:renderDeliveryMessage(group.products,customer),attempts:0};if(!st.addTest(r)){results.push({id,duplicate:true,connectionKey:group.connection.key});continue;}if(r.error){results.push({id,state:'failed',error:r.error,connectionKey:group.connection.key});continue;}const result=await send(r,{...connectionCfg(group.connection),dry:false});if(result.state==='retry')result.state='failed';st.finish(r,result);results.push({id,...result,connectionKey:group.connection.key});}const duplicate=results.every(x=>x.duplicate);const failed=results.find(x=>x.state==='failed'||x.state==='uncertain');const accepted=results.find(x=>x.state==='accepted'||x.state==='delivered'||x.state==='read');return reply(res,200,{id:results[0]?.id,duplicate,results,state:failed?.state||accepted?.state,error:failed?.error});}
 if(url.pathname==='/admin/resolve'&&req.method==='POST'){
 if(req.headers['x-admin-action']!=='resolve')return reply(res,403,{error:'invalid_action'});
 const p=JSON.parse((await body(req)).toString());if(typeof p.id!=='string'||typeof p.resolved!=='boolean')return reply(res,400,{error:'invalid_payload'});
 return reply(res,st.resolve(p.id,p.resolved)?200:404,{ok:true});}
 return reply(res,404,{error:'not_found'});
 }
 if(url.pathname==='/webhooks/meta'&&req.method==='GET'){
 if(env.META_VERIFY_TOKEN&&url.searchParams.get('hub.mode')==='subscribe'&&equal(url.searchParams.get('hub.verify_token'),env.META_VERIFY_TOKEN)){res.writeHead(200,{'content-type':'text/plain'});return res.end(url.searchParams.get('hub.challenge')||'');}return reply(res,403,{error:'verification_failed'});}
 if(url.pathname==='/webhooks/wiapy'&&req.method==='POST'){
 if(!equal(req.headers.authorization,env.WIAPY_SECRET))return reply(res,401,{error:'unauthorized'});
  if(String(req.headers['x-wiapy-test']||'').toLowerCase()==='true')return reply(res,200,{ignored:true,test:true});
  const payload=JSON.parse((await body(req)).toString());const resolved=st.resolveProducts(payload);if(!resolved.matched.length)return reply(res,200,{ignored:true});let groups;try{groups=st.deliveryGroups(resolved.matched);}catch{return reply(res,503,{error:'invalid_connection'});}const paymentId=payload.payment?.id;const rows=groups.map(group=>sale(payload,group.products,resolved.missing.length?'missing_required_product':null,{id:groups.length>1?`${paymentId}:${group.connection.key}`:paymentId,connectionKey:group.connection.key})).filter(Boolean);if(!rows.length)return reply(res,200,{ignored:true});const result=st.addSales(paymentId,rows);return reply(res,200,{queued:result.inserted>0,count:result.inserted,duplicate:result.duplicate});}
 if(url.pathname==='/webhooks/evolution'&&req.method==='POST'){
 const p=JSON.parse((await body(req)).toString());
 const connection=st.connections(true).find(item=>item.instanceName===p.instance);if(!connection||!p.apikey||!equal(hash(p.apikey),connection.webhookKeyHash))return reply(res,401,{error:'unauthorized'});
 for(const status of statuses(p))st.status(status);return reply(res,200,{ok:true});}
 if(url.pathname==='/webhooks/meta'&&req.method==='POST'){
 const raw=await body(req);if(!env.META_APP_SECRET||!signature(raw,env.META_APP_SECRET,req.headers['x-hub-signature-256']))return reply(res,401,{error:'signature_failed'});
 const p=JSON.parse(raw.toString());for(const e of p.entry||[])for(const c of e.changes||[]){if(env.META_WABA_ID&&String(e.id)!==env.META_WABA_ID)continue;if(env.META_PHONE_NUMBER_ID&&c.value?.metadata?.phone_number_id!==env.META_PHONE_NUMBER_ID)continue;for(const s of c.value?.statuses||[])st.status(s);}return reply(res,200,{ok:true});}
 return reply(res,404,{error:'not_found'});
 }catch(e){const expected=['invalid_phone','invalid_payment_id','too_large'];const status=e instanceof SyntaxError||expected.includes(e.message)?400:500;console.error(JSON.stringify({event:'request_error',code:status}));reply(res,status,{error:status===400?'invalid_payload':'internal_error'});}});
let busy=false;
const timer=setInterval(async()=>{if(busy||!enabled)return;busy=true;let row;try{row=st.next();if(row){const result=await send(row,deliveryCfg(row));if(result.state==='retry'&&row.attempts>=4)result.state='failed';st.finish(row,result);console.log(JSON.stringify({event:'delivery',id:row.id,state:result.state,connection:row.connection_key}));}}catch{console.error(JSON.stringify({event:'worker_error'}));}finally{busy=false;}},1000);
const checkConnections=()=>Promise.allSettled(st.connections(false).map(item=>inspectConnection(item,true)));
const connectionTimer=setInterval(()=>{checkConnections().catch(()=>{});},30000);connectionTimer.unref();
if(enabled)checkConnections().catch(()=>{});
server.listen(env.PORT===undefined?3000:Number(env.PORT),'0.0.0.0',()=>console.log(JSON.stringify({event:'ready',mode:mode(),port:server.address().port})));
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{clearInterval(timer);clearInterval(connectionTimer);server.close();setTimeout(()=>process.exit(0),20000).unref();});
