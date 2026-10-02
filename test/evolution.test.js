import test from 'node:test';
import assert from 'node:assert/strict';
import {send} from '../src/core.js';
import {statuses,connection} from '../src/evolution.js';
import {store} from '../src/store.js';
const cfg={provider:'evolution',dry:false,evolutionUrl:'https://example.com',instance:'test',evolutionKey:'fake-key',productsAccessToken:'fake-access'};
const row={id:'order',phone:'5579999990000',kind:'combo'};
const response=data=>({ok:true,json:async()=>data});
test('Evolution verifica conexão e número antes de enviar combo',async()=>{
 const calls=[];const mock=async(url,options)=>{calls.push([url,options]);if(url.includes('connectionState'))return response({instance:{state:'open'}});if(url.includes('whatsappNumbers'))return response([{exists:true}]);return response({key:{id:'message-id'}});};
 assert.deepEqual(await send(row,cfg,mock),{state:'accepted',mid:'message-id'});assert.equal(calls.length,3);const body=JSON.parse(calls[2][1].body);assert.equal(body.number,row.phone);assert.match(body.text,/fake-access/);assert.match(body.text,/precocerto-gilt/);assert.equal(calls[2][1].headers.apikey,'fake-key');
});
test('número sem WhatsApp falha sem POST de mensagem; desconexão aguarda',async()=>{
 let n=0;assert.equal((await send(row,cfg,async url=>{n++;return response(url.includes('connectionState')?{instance:{state:'open'}}:[{exists:false}]);})).error,'whatsapp_not_found');assert.equal(n,2);
 assert.equal((await send(row,cfg,async()=>response({instance:{state:'close'}}))).state,'retry');
 assert.equal((await send(row,{...cfg,dry:true},()=>{throw Error('não chamar');})).state,'simulated');
});
test('timeout após POST é incerto, consulta inválida não envia',async()=>{
 const mock=async url=>{if(url.includes('connectionState'))return response({instance:{state:'open'}});if(url.includes('whatsappNumbers'))return response([{exists:true}]);throw Error('timeout');};assert.equal((await send(row,cfg,mock)).state,'uncertain');
 assert.equal((await send(row,cfg,async url=>response(url.includes('connectionState')?{instance:{state:'open'}}:{}))).state,'retry');
 assert.equal((await connection(cfg,async()=>{throw Error();})).state,'unavailable');
});
test('callback antecipado Evolution é reaplicado e não regride leitura',()=>{
 const st=store(':memory:');st.add({...row,name:'Teste',email:'test@example.com'});const r=st.next();
 const p={event:'messages.update',data:{keyId:'mid',fromMe:true,status:'DELIVERY_ACK'}};for(const s of statuses(p))st.status(s);st.finish(r,{state:'accepted',mid:'mid'});assert.equal(st.list()[0].state,'delivered');
 for(const s of statuses({...p,data:{...p.data,status:'READ'}}))st.status(s);for(const s of statuses(p))st.status(s);assert.equal(st.list()[0].state,'read');assert.equal(statuses({...p,data:{...p.data,fromMe:false}}).length,0);st.db.close();
});
