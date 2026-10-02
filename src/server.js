import {connection,statuses,suggestPhone} from './evolution.js';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {equal,signature,sale,send,phone} from './core.js';
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
let connectionCache;let connectionChecked=0;let connectionPending;
async function connectionInfo(){if(connectionPending)return connectionPending;if(Date.now()-connectionChecked>30000||!connectionCache){connectionPending=connection(cfg).then(info=>{connectionCache=st.observeConnection(info);connectionChecked=Date.now();return connectionCache;}).finally(()=>{connectionPending=null;});return connectionPending;}return connectionCache;}
const assets=Object.fromEntries(['index.html','style.css','app.js'].map(name=>[name,readFileSync(new URL('./public/'+name,import.meta.url))]));
const st=store(env.DB_PATH||'./data/deliveries.sqlite');
const reply=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
async function body(req){let total=0;const parts=[];for await(const chunk of req){total+=chunk.length;if(total>262144)throw Error('too_large');parts.push(chunk);}return Buffer.concat(parts);}
const server=http.createServer(async(req,res)=>{try{
 res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
 res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 const url=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&url.pathname==='/health'){st.db.prepare('SELECT 1').get();return reply(res,200,{ok:true,mode:mode()});}
 if(url.pathname==='/admin'||url.pathname.startsWith('/admin/')){
 const auth=req.headers.authorization||'';
 const basic='Basic '+Buffer.from('admin:'+env.ADMIN_TOKEN).toString('base64');
 if(!equal(auth,basic)&&!equal(auth,`Bearer ${env.ADMIN_TOKEN}`)){res.setHeader('www-authenticate','Basic realm="Relatorio de entregas", charset="UTF-8"');return reply(res,401,{error:'unauthorized'});}
 if(req.method==='GET'&&(url.pathname==='/admin'||url.pathname==='/admin/')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(assets['index.html']);}
 const asset=url.pathname.slice('/admin/'.length);
 if(req.method==='GET'&&['style.css','app.js'].includes(asset)){res.writeHead(200,{'content-type':asset.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'});return res.end(assets[asset]);}
 if(url.pathname==='/admin/connection'&&req.method==='GET')return reply(res,200,await connectionInfo());
 if(url.pathname==='/admin/deliveries'&&req.method==='GET'){
 const filters={q:url.searchParams.get('q'),state:url.searchParams.get('state'),source:url.searchParams.get('source')||'sales',page:Math.floor(Number(url.searchParams.get('page')))||1};
 for(const k of ['from','to']){const d=url.searchParams.get(k);if(d){if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return reply(res,400,{error:'invalid_date'});const ms=Date.parse(d+'T00:00:00-03:00');if(!Number.isFinite(ms))return reply(res,400,{error:'invalid_date'});filters[k]=ms+(k==='to'?86400000:0);}}
 return reply(res,200,{...st.list(filters),mode:mode()});}
 if(url.pathname==='/admin/history'&&req.method==='GET')return reply(res,200,{rows:st.history(url.searchParams.get('id'))});
 if(url.pathname==='/admin/suggest-phone'&&req.method==='POST'){
 if(req.headers['x-admin-action']!=='suggest')return reply(res,403,{error:'invalid_action'});
 const p=JSON.parse((await body(req)).toString());const r=st.get(p.id);if(!r)return reply(res,404,{error:'not_found'});
 if(cfg.provider!=='evolution')return reply(res,409,{error:'evolution_not_configured'});
 try{return reply(res,200,await suggestPhone(phone(r.phone||r.raw_phone),cfg));}catch{return reply(res,409,{error:'evolution_number_check_failed'});}}
 if(url.pathname==='/admin/resend'&&req.method==='POST'){
 if(req.headers['x-admin-action']!=='resend')return reply(res,403,{error:'invalid_action'});
 if(mode()!=='live')return reply(res,409,{error:'live_required'});
 const p=JSON.parse((await body(req)).toString());
 if(typeof p.id!=='string'||typeof p.requestId!=='string'||!/^[-a-f0-9]{36}$/.test(p.requestId)||!Number.isSafeInteger(p.updated))return reply(res,400,{error:'invalid_payload'});
 let number;try{number=phone(p.phone);}catch{return reply(res,400,{error:'invalid_phone'});}
 try{return reply(res,200,st.requeue(p.id,number,p.requestId,p.updated,p.acknowledged===true));}catch(e){return reply(res,e.message==='not_found'?404:409,{error:['not_found','state_changed','uncertain_requires_confirmation'].includes(e.message)?e.message:'internal_error'});}}
 if(url.pathname==='/admin/test'&&req.method==='POST'){
 if(req.headers['x-admin-action']!=='test')return reply(res,403,{error:'invalid_action'});
 if(cfg.provider!=='evolution'||!cfg.evolutionUrl||!cfg.instance||!cfg.evolutionKey)return reply(res,409,{error:'evolution_not_configured'});
 const p=JSON.parse((await body(req)).toString());
 if(!['carne','combo'].includes(p.kind)||typeof p.requestId!=='string'||!/^[-a-f0-9]{36}$/.test(p.requestId))return reply(res,400,{error:'invalid_payload'});
 if(p.kind==='combo'&&!cfg.productsAccessToken)return reply(res,409,{error:'products_token_missing'});
 let normalized='',phoneError=null;try{normalized=phone(p.phone);}catch{phoneError='invalid_phone';}
 const r={id:'test:'+p.requestId,phone:normalized,error:phoneError,raw_phone:String(p.phone||'').slice(0,80),name:'Teste de entrega',email:'',kind:p.kind,attempts:0};
 if(!st.addTest(r))return reply(res,200,{duplicate:true,id:r.id});
 if(r.error)return reply(res,200,{id:r.id,state:'failed',error:r.error});
 const result=await send(r,{...cfg,dry:false});
 if(result.state==='retry')result.state='failed';st.finish(r,result);
 return reply(res,200,{id:r.id,...result});}
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
 const payload=JSON.parse((await body(req)).toString());const row=sale(payload);
 if(!row)return reply(res,200,{ignored:true});const inserted=st.add(row);return reply(res,200,{queued:!!inserted,duplicate:!inserted});}
 if(url.pathname==='/webhooks/evolution'&&req.method==='POST'){
 const p=JSON.parse((await body(req)).toString());
 if(!cfg.evolutionKey||!equal(p.apikey,cfg.evolutionKey)||p.instance!==cfg.instance)return reply(res,401,{error:'unauthorized'});
 for(const status of statuses(p))st.status(status);return reply(res,200,{ok:true});}
 if(url.pathname==='/webhooks/meta'&&req.method==='POST'){
 const raw=await body(req);if(!env.META_APP_SECRET||!signature(raw,env.META_APP_SECRET,req.headers['x-hub-signature-256']))return reply(res,401,{error:'signature_failed'});
 const p=JSON.parse(raw.toString());for(const e of p.entry||[])for(const c of e.changes||[]){if(env.META_WABA_ID&&String(e.id)!==env.META_WABA_ID)continue;if(env.META_PHONE_NUMBER_ID&&c.value?.metadata?.phone_number_id!==env.META_PHONE_NUMBER_ID)continue;for(const s of c.value?.statuses||[])st.status(s);}return reply(res,200,{ok:true});}
 return reply(res,404,{error:'not_found'});
 }catch(e){const expected=['invalid_phone','invalid_payment_id','too_large'];const status=e instanceof SyntaxError||expected.includes(e.message)?400:500;console.error(JSON.stringify({event:'request_error',code:status}));reply(res,status,{error:status===400?'invalid_payload':'internal_error'});}});
let busy=false;
const timer=setInterval(async()=>{if(busy||!enabled)return;busy=true;let row;try{row=st.next();if(row){const result=await send(row,cfg);if(result.state==='retry'&&row.attempts>=4)result.state='failed';st.finish(row,result);console.log(JSON.stringify({event:'delivery',id:row.id,state:result.state}));}}catch{console.error(JSON.stringify({event:'worker_error'}));}finally{busy=false;}},1000);
const connectionTimer=setInterval(()=>{connectionInfo().catch(()=>{});},30000);connectionTimer.unref();
if(enabled)connectionInfo().catch(()=>{});
server.listen(env.PORT===undefined?3000:Number(env.PORT),'0.0.0.0',()=>console.log(JSON.stringify({event:'ready',mode:mode(),port:server.address().port})));
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{clearInterval(timer);clearInterval(connectionTimer);server.close();setTimeout(()=>process.exit(0),20000).unref();});
