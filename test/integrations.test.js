import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {store} from '../src/store.js';
import {normalizeWebhookPayload,canonicalSalePayload} from '../src/webhooks.js';
import {CARNE} from '../src/core.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const payload=(id,productId=CARNE,status='paid')=>({payment:{id,status},customer:{name:'Cliente Integração',email:'integracao@example.com',mobile_phone:'(79) 99999-0000'},products:[{id:productId}],checkout:{orderbump:[]}});

test('integrações isolam tokens e IDs externos por checkout',()=>{
 const secret='s'.repeat(32),st=store(':memory:',{legacyIntegration:{key:'checkout_principal',name:'Checkout principal',tokenHash:hash(secret),tokenHint:'ssss',legacyPath:'/webhooks/wiapy'}});
 const legacy=st.integration('checkout_principal');assert.equal(legacy.name,'Checkout principal');assert.ok(legacy.mappings.some(item=>item.productKey==='carne'&&item.externalId===CARNE));
 st.saveIntegration({key:'checkout_novo_12345678',name:'Checkout novo',tokenHash:hash('n'.repeat(32)),tokenOrigin:'gateway',tokenHint:'nnnn',mappings:[{productKey:'carne',externalIds:[CARNE,'carne-novo']}]});
 assert.deepEqual(st.resolveIntegrationProducts('checkout_novo_12345678',['carne-novo']).matched.map(item=>item.key),['carne']);
 assert.throws(()=>st.saveIntegrationMappings('checkout_novo_12345678',[{productKey:'carne',externalIds:['duplicado']},{productKey:'proprios',externalIds:['duplicado']}]),/duplicate_external_id/);
 st.observeIntegration('checkout_novo_12345678','queued');assert.equal(st.integration('checkout_novo_12345678').receivedCount,1);assert.equal(st.integration('checkout_novo_12345678').lastResult,'queued');st.db.close();
});

test('salvamento da integração é atômico e respeita estado pausado',()=>{
 const st=store(':memory:');const originalToken=hash('o'.repeat(32));st.saveIntegration({key:'checkout_atomico_1234',name:'Checkout atômico',tokenHash:originalToken,tokenOrigin:'gateway',tokenHint:'oooo',active:false,mappings:[{productKey:'carne',externalIds:['carne-1']}]});
 const created=st.integration('checkout_atomico_1234');assert.equal(created.active,false);assert.equal(st.integrationSecret(created.key),originalToken);
 assert.throws(()=>st.saveIntegration({key:created.key,name:'Nome que não deve persistir',tokenHash:hash('x'.repeat(32)),tokenOrigin:'gateway',tokenHint:'xxxx',active:true,expectedUpdated:created.updated,mappings:[{productKey:'carne',externalIds:['duplicado']},{productKey:'proprios',externalIds:['duplicado']}]}),/duplicate_external_id/);
 const after=st.integration(created.key);assert.equal(after.name,'Checkout atômico');assert.equal(after.active,false);assert.equal(st.integrationSecret(created.key),originalToken);assert.deepEqual(after.mappings.map(item=>({...item})),[{productKey:'carne',externalId:'carne-1'}]);st.db.close();
});

test('migração legada não recria vínculo removido após reiniciar',()=>{
 const dir=mkdtempSync(join(tmpdir(),'legacy-integration-')),dbPath=join(dir,'db.sqlite'),secret=hash('s'.repeat(32)),options={legacyIntegration:{key:'checkout_principal',name:'Checkout principal',tokenHash:secret,tokenHint:'ssss',legacyPath:'/webhooks/wiapy'}};
 const first=store(dbPath,options);assert.ok(first.integrationMappings('checkout_principal').some(item=>item.externalId===CARNE));first.saveIntegrationMappings('checkout_principal',[]);first.db.close();
 const second=store(dbPath,options);assert.deepEqual(second.integrationMappings('checkout_principal'),[]);second.db.close();rmSync(dir,{recursive:true,force:true});
});

test('normalizador só aceita contrato conhecido e não aprova status pendente',()=>{
 const paid=normalizeWebhookPayload(payload('pedido-1'));assert.equal(paid.paid,true);assert.equal(paid.paymentId,'pedido-1');assert.deepEqual(paid.productIds,[CARNE]);assert.equal(canonicalSalePayload(paid).customer.mobile_phone,'(79) 99999-0000');
 assert.equal(normalizeWebhookPayload(payload('pedido-2',CARNE,'waiting')).paid,false);assert.equal(normalizeWebhookPayload({sale:{id:'desconhecido'}}),null);
});

test('normaliza o formato SellFlux usado por gateways compatíveis',()=>{
 const event=normalizeWebhookPayload({name:'Cliente Wiven',email:'cliente@example.com',phone:'(79) 99999-0000',transaction_id:123456,offer_id:'oferta-1',product_id:'produto-1',status:'compra-realizada',itens:[{id:'item-1'}]});
 assert.equal(event.format,'sellflux_v1');assert.equal(event.paymentId,'123456');assert.equal(event.paid,true);assert.deepEqual(event.productIds,['produto-1','oferta-1','item-1']);assert.equal(event.customer.phone,'(79) 99999-0000');
 assert.equal(normalizeWebhookPayload({name:'Cliente',phone:'5579999990000',transaction_id:'pendente-1',product_id:'produto-1',status:'aguardando-pagamento'}).paid,false);
});

test('HTTP: cria integrações, protege tokens e separa pedidos iguais por origem',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'integration-http-')),secret='w'.repeat(32),admin='a'.repeat(32);
 const child=spawn(process.execPath,['src/server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',WIAPY_SECRET:secret,ADMIN_TOKEN:admin,DB_PATH:join(dir,'db.sqlite'),DELIVERY_ENABLED:'false',DRY_RUN:'false',WHATSAPP_PROVIDER:'evolution',EVOLUTION_URL:'https://example.com',EVOLUTION_INSTANCE:'test',EVOLUTION_API_KEY:'fake-key',PRODUCTS_ACCESS_TOKEN:'fake-access'}});
 t.after(async()=>{child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));rmSync(dir,{recursive:true,force:true});});
 const port=await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(Error('server timeout')),10000);child.stdout.on('data',data=>{output+=data;const match=output.match(/"port":(\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});child.once('error',reject);child.once('exit',()=>reject(Error('server exited')));});const base='http://127.0.0.1:'+port;
 const adminHeaders={authorization:'Bearer '+admin,'content-type':'application/json','x-admin-action':'save-integration','x-forwarded-proto':'http'};
 const create=async body=>{const response=await fetch(base+'/admin/integrations',{method:'POST',headers:adminHeaders,body:JSON.stringify(body)});assert.equal(response.status,201);return response.json();};
 const generated=await create({name:'Checkout gerado',tokenOrigin:'entrega_zap',mappings:[{productKey:'carne',externalIds:['produto-gerado']}]});assert.ok(generated.token.length>=32);assert.doesNotMatch(JSON.stringify(generated.integration),new RegExp(generated.token));
 const gatewayToken='12345678',gateway=await create({name:'Checkout gateway',tokenOrigin:'gateway',token:gatewayToken,mappings:[{productKey:'carne',externalIds:['produto-gateway']}]});assert.equal(gateway.token,undefined);
 const send=async(url,body,token,header='authorization')=>fetch(url,{method:'POST',headers:{'content-type':'application/json',[header]:token},body:JSON.stringify(body)});
 assert.equal((await send(generated.integration.webhookUrl,payload('mesmo-id','produto-gerado'),'errado')).status,401);
 assert.equal((await send(generated.integration.webhookUrl,payload('mesmo-id','produto-gerado'),generated.token,'x-webhook-token')).status,200);
 assert.equal((await send(gateway.integration.webhookUrl,payload('mesmo-id','produto-gateway'),'Bearer '+gatewayToken)).status,200);
 assert.equal((await send(gateway.integration.webhookUrl,payload('mesmo-id','produto-gateway'),gatewayToken,'token')).status,200);
 assert.equal((await send(gateway.integration.webhookUrl,payload('mesmo-id','produto-gateway'),gatewayToken,'x-api-key')).status,200);
 const report=await (await fetch(base+'/admin/deliveries?source=sales',{headers:{authorization:'Bearer '+admin}})).json();assert.equal(report.total,2);assert.equal(new Set(report.rows.map(row=>row.integration_name)).size,2);
 const beforeRotate=await (await fetch(base+'/admin/integrations',{headers:{authorization:'Bearer '+admin}})).json();const current=beforeRotate.rows.find(item=>item.key===generated.integration.key);const rotatedResponse=await fetch(base+'/admin/integrations',{method:'POST',headers:adminHeaders,body:JSON.stringify({key:current.key,name:current.name,tokenOrigin:'entrega_zap',rotateToken:true,active:true,expectedUpdated:current.updated,mappings:[{productKey:'carne',externalIds:['produto-gerado']}]})});assert.equal(rotatedResponse.status,200);const rotated=await rotatedResponse.json();assert.notEqual(rotated.token,generated.token);assert.equal((await send(generated.integration.webhookUrl,payload('token-antigo','produto-gerado'),generated.token)).status,401);assert.equal((await send(generated.integration.webhookUrl,payload('token-novo','produto-gerado'),rotated.token)).status,200);
 assert.equal((await (await send(gateway.integration.webhookUrl,payload('produto-ausente','id-nao-vinculado'),gatewayToken)).json()).reason,'product_not_mapped');const afterUnmapped=await (await fetch(base+'/admin/integrations',{headers:{authorization:'Bearer '+admin}})).json();const gatewayAfterUnmapped=afterUnmapped.rows.find(item=>item.key===gateway.integration.key);assert.equal(gatewayAfterUnmapped.lastResult,'unmapped');assert.match(gatewayAfterUnmapped.lastError,/id-nao-vinculado/);
 assert.equal((await (await send(gateway.integration.webhookUrl,{formato:'desconhecido'},'Bearer '+gatewayToken)).json()).reason,'unsupported_payload');
 const integrations=await (await fetch(base+'/admin/integrations',{headers:{authorization:'Bearer '+admin}})).json();assert.equal(integrations.rows.find(item=>item.key===gateway.integration.key).lastResult,'unsupported');
});
