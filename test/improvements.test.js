import test from 'node:test';
import assert from 'node:assert/strict';
import {store} from '../src/store.js';
import {suggestPhone} from '../src/evolution.js';
const sale={id:'purchase',phone:'551198765432',raw_phone:'(11) 9876-5432',name:'Comprador fictício',email:'test@example.com',kind:'carne'};
test('reenvio preserva histórico e original, é idempotente e ignora callback antigo',()=>{
 const st=store(':memory:');st.add(sale);const r=st.next();st.finish(r,{state:'failed',mid:'old-mid',error:'evolution_delivery_failed'});const failed=st.get(sale.id);
 const result=st.requeue(sale.id,'5511998765432','request',failed.updated,false);assert.equal(result.queued,true);assert.equal(st.history(sale.id)[0].mid,'old-mid');assert.equal(st.get(sale.id).raw_phone,sale.raw_phone);assert.equal(st.requeue(sale.id,'5511998765432','request',failed.updated,false).duplicate,true);
 const next=st.next();st.status({id:'old-mid',status:'delivered'});assert.equal(st.get(sale.id).state,'sending');assert.equal(st.history(sale.id)[0].state,'delivered');st.finish(next,{state:'accepted',mid:'new-mid'});st.status({id:'new-mid',status:'read'});assert.equal(st.get(sale.id).state,'read');assert.throws(()=>st.requeue(sale.id,sale.phone,'different',st.get(sale.id).updated,true),/state_changed/);st.db.close();
});
test('resultado incerto exige confirmação e alteração de status impede reenvio',()=>{
 const st=store(':memory:');st.add(sale);st.finish(st.next(),{state:'uncertain',error:'network_or_timeout'});const r=st.get(sale.id);
 assert.throws(()=>st.requeue(r.id,r.phone,'a',r.updated,false),/uncertain_requires_confirmation/);assert.throws(()=>st.requeue(r.id,r.phone,'a',-1,true),/state_changed/);assert.equal(st.history(r.id).length,0);assert.equal(st.requeue(r.id,r.phone,'a',r.updated,true).queued,true);st.db.close();
});
test('simulados podem ser reenfileirados e filtros separam testes de vendas',()=>{
 const st=store(':memory:');st.add(sale);st.finish(st.next(),{state:'simulated'});const r=st.get(sale.id);st.requeue(r.id,r.phone,'simulation',r.updated,false);st.addTest({...sale,id:'test:one'});
 assert.equal(st.list({source:'sales'}).total,1);assert.equal(st.list({source:'tests'}).total,1);assert.equal(st.list({source:'all'}).total,2);assert.equal(st.list({q:sale.phone}).total,2);st.db.close();
});
test('conexão mantém início observado durante indisponibilidade e limpa ao reconectar',()=>{
 const st=store(':memory:');const down=st.observeConnection({provider:'evolution',state:'disconnected'});assert.ok(down.disconnectedSince);assert.equal(st.observeConnection({provider:'evolution',state:'unavailable'}).disconnectedSince,down.disconnectedSince);const up=st.observeConnection({provider:'evolution',state:'connected'});assert.equal(up.disconnectedSince,null);assert.ok(up.lastConnectedAt);st.db.close();
});
test('sugere nono dígito somente se original não existe e candidato existe',async()=>{
 const cfg={evolutionUrl:'https://example.com',instance:'fake',evolutionKey:'fake'};const numbers=[];const mock=async(url,options)=>{assert.match(url,/whatsappNumbers/);const n=JSON.parse(options.body).numbers[0];numbers.push(n);return {ok:true,json:async()=>[{exists:n.length===13}]};};
 assert.equal((await suggestPhone(sale.phone,cfg,mock)).suggestion,'5511998765432');assert.equal(numbers.length,2);
 numbers.length=0;assert.equal((await suggestPhone('5511998765432',cfg,mock)).suggestion,null);assert.equal(numbers.length,0);
 assert.equal((await suggestPhone(sale.phone,cfg,async()=>({ok:true,json:async()=>[{exists:true}]}))).originalExists,true);
 assert.equal((await suggestPhone(sale.phone,cfg,async()=>({ok:true,json:async()=>[{exists:false}]}))).suggestion,null);
});
