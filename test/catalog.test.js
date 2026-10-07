import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {store} from '../src/store.js';
import {sale,renderDeliveryMessage,CARNE,PROPRIOS} from '../src/core.js';

const payload=(ids,id='catalog-order')=>({payment:{id,status:'paid'},customer:{name:'Cliente Catálogo',email:'cliente@example.com',mobile_phone:'(79) 99999-0000'},products:ids.map(productId=>({id:productId})),checkout:{orderbump:[]}});

test('catálogo nasce compatível com Carne e Produtos Próprios',()=>{
 const st=store(':memory:',{productsAccessToken:'token-seguro'});const products=st.products();assert.deepEqual(products.map(p=>p.key),['carne','proprios']);const proprios=products.find(p=>p.key==='proprios');assert.equal(proprios.accessToken,'token-seguro');assert.equal(proprios.productType,'addon');assert.equal(proprios.requiresKey,'carne');
 const matched=st.matchProducts(payload([CARNE,PROPRIOS]));const row=sale(payload([CARNE,PROPRIOS]),matched);assert.deepEqual(JSON.parse(row.product_keys),['carne','proprios']);assert.match(row.message_text,/token-seguro/);assert.match(row.access_label,/Produtos Próprios/);st.db.close();
});

test('complemento exige o produto principal no webhook real',()=>{
 const st=store(':memory:');const orphan=st.resolveProducts(payload([PROPRIOS],'addon-sem-principal'));assert.deepEqual(orphan.matched.map(p=>p.key),['proprios']);assert.deepEqual(orphan.missing.map(p=>p.key),['proprios']);const failed=sale(payload([PROPRIOS],'addon-sem-principal'),orphan.matched,'missing_required_product');assert.equal(failed.error,'missing_required_product');st.add(failed);assert.equal(st.get('addon-sem-principal').state,'failed');
 const comboPayload=payload([CARNE],'combo-orderbump');comboPayload.checkout.orderbump=[{id:PROPRIOS}];const combo=st.resolveProducts(comboPayload);assert.deepEqual(combo.missing,[]);assert.deepEqual(combo.matched.map(p=>p.key),['carne','proprios']);st.db.close();
});

test('chavinha protege dependências entre principal e complemento',()=>{
 const st=store(':memory:');let carne=st.products().find(p=>p.key==='carne');let proprios=st.products().find(p=>p.key==='proprios');assert.throws(()=>st.toggleProduct('carne',false,carne.updated),/product_has_active_dependents/);
 proprios=st.toggleProduct('proprios',false,proprios.updated);carne=st.toggleProduct('carne',false,carne.updated);assert.equal(carne.active,false);assert.throws(()=>st.toggleProduct('proprios',true,proprios.updated),/inactive_parent/);
 carne=st.toggleProduct('carne',true,carne.updated);proprios=st.toggleProduct('proprios',true,proprios.updated);assert.equal(carne.active,true);assert.equal(proprios.active,true);st.db.close();
});

test('cadastro de complemento valida o produto principal',()=>{
 const st=store(':memory:');const base={key:'bonus',name:'Bônus Especial',externalIds:['bonus-id'],template:'Mensagem válida para o bônus',active:true,productType:'addon'};assert.throws(()=>st.saveProduct({...base,requiresKey:'inexistente'}),/invalid_parent/);const saved=st.saveProduct({...base,requiresKey:'carne'});assert.equal(saved.productType,'addon');assert.equal(saved.requiresKey,'carne');st.db.close();
});

test('produtos podem usar conexões diferentes e o pedido é separado por número',()=>{
 const st=store(':memory:',{defaultConnection:{key:'principal',name:'Entregas Açougue',instanceName:'entrega-carnes',webhookKeyHash:'hash-principal'}});assert.equal(st.connections().length,1);assert.equal(st.products().find(p=>p.key==='carne').connectionKey,'principal');assert.equal(st.products().find(p=>p.key==='proprios').connectionKey,'');
 const bob=st.saveConnection({key:'bob_goods',name:'Entregas Bob Goods',instanceName:'entrega-bob-goods',webhookKeyHash:'hash-bob'});const product=st.saveProduct({key:'bob_kids',name:'Bob Goods Kids',externalIds:['bob-id'],template:'Acesso ao Bob Goods Kids disponível aqui.',active:true,productType:'primary',connectionKey:bob.key});const p=payload([CARNE,PROPRIOS,'bob-id'],'multi-number');const groups=st.deliveryGroups(st.resolveProducts(p).matched);assert.equal(groups.length,2);assert.deepEqual(groups.find(g=>g.connection.key==='principal').products.map(x=>x.key),['carne','proprios']);assert.deepEqual(groups.find(g=>g.connection.key==='bob_goods').products.map(x=>x.key),['bob_kids']);
 const rows=groups.map(group=>sale(p,group.products,null,{id:`multi-number:${group.connection.key}`,connectionKey:group.connection.key}));assert.deepEqual(st.addSales('multi-number',rows),{duplicate:false,inserted:2});assert.deepEqual(st.addSales('multi-number',rows),{duplicate:true,inserted:0});assert.equal(st.list({}).total,2);assert.equal(product.connectionKey,'bob_goods');st.db.close();
});

test('migração preserva entregas e vincula produtos antigos à conexão atual',()=>{
 const dir=mkdtempSync(join(tmpdir(),'catalog-migration-')),path=join(dir,'legacy.sqlite'),legacy=new DatabaseSync(path);legacy.exec("CREATE TABLE deliveries(id TEXT PRIMARY KEY,phone TEXT,kind TEXT,state TEXT,mid TEXT,attempts INTEGER DEFAULT 0,due INTEGER DEFAULT 0,error TEXT,created INTEGER,name TEXT,email TEXT,raw_phone TEXT,updated INTEGER,resolved INTEGER DEFAULT 0,product_keys TEXT,access_label TEXT,message_text TEXT); CREATE TABLE products(key TEXT PRIMARY KEY,name TEXT NOT NULL,external_ids TEXT NOT NULL DEFAULT '[]',access_url TEXT NOT NULL DEFAULT '',tutorial_url TEXT NOT NULL DEFAULT '',access_token TEXT NOT NULL DEFAULT '',template TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,auto_wrapper INTEGER NOT NULL DEFAULT 0,product_type TEXT NOT NULL DEFAULT 'primary',requires_key TEXT NOT NULL DEFAULT '',position INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL);");legacy.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('antigo','Produto Antigo','["old-id"]','','','', 'Mensagem antiga válida',1,0,'primary','',30,1,1);legacy.prepare('INSERT INTO deliveries(id,phone,kind,state,created) VALUES(?,?,?,?,?)').run('pagamento-antigo','5579999990000','catalog','delivered',1);legacy.close();
 const st=store(path,{defaultConnection:{key:'principal',name:'Entregas Açougue',instanceName:'entrega-carnes',webhookKeyHash:'hash'}});assert.equal(st.products().find(p=>p.key==='antigo').connectionKey,'principal');assert.equal(st.get('pagamento-antigo').connection_key,'principal');assert.equal(st.get('pagamento-antigo').payment_id,'pagamento-antigo');assert.deepEqual(st.addSales('pagamento-antigo',[]),{duplicate:true,inserted:0});st.db.close();rmSync(dir,{recursive:true,force:true});
});

test('novo produto pode ser configurado, combinado e pausado sem alterar código',()=>{
 const st=store(':memory:');const product=st.saveProduct({key:'lucro_producao',name:'Lucro na Produção',externalIds:['wiapy-lucro'],accessUrl:'https://produto.example.com/',tutorialUrl:'https://tutorial.example.com/',accessToken:'abc123',template:'📦 *{{nome_produto}}*\n\nAcesso: {{link_acesso}}\nTutoriais: {{link_tutoriais}}\nToken: {{token_acesso}}',active:true,position:30});
 assert.equal(product.active,true);assert.equal(product.autoWrapper,false);assert.equal(renderDeliveryMessage([product],{name:'Cliente'}).startsWith('📦'),true);assert.doesNotMatch(renderDeliveryMessage([product],{name:'Cliente'}),/Qualquer dúvida/);const p=payload([CARNE,'wiapy-lucro']);const row=sale(p,st.matchProducts(p));assert.deepEqual(JSON.parse(row.product_keys),['carne','lucro_producao']);assert.match(row.message_text,/Lucro na Produção/);assert.match(row.message_text,/abc123/);
 st.saveProduct({...product,externalIds:product.externalIds,active:false,expectedUpdated:product.updated});assert.deepEqual(st.matchProducts(payload(['wiapy-lucro'])),[]);st.db.close();
});

test('protege IDs duplicados, variáveis desconhecidas e snapshot da mensagem',()=>{
 const st=store(':memory:');assert.throws(()=>st.saveProduct({key:'duplicado',name:'Produto Duplicado',externalIds:[CARNE],template:'Mensagem válida do produto',active:true}),/duplicate_external_id/);assert.throws(()=>st.saveProduct({key:'variavel',name:'Produto Variável',externalIds:['new-id'],template:'Mensagem {{segredo_interno}}',active:true}),/invalid_variable/);
 const carne=st.products().find(p=>p.key==='carne');const original=renderDeliveryMessage([carne],{name:'Cliente'});const row=sale(payload([CARNE]),[carne]);st.saveProduct({...carne,externalIds:carne.externalIds,template:'Mensagem nova com tamanho válido',expectedUpdated:carne.updated});assert.equal(row.message_text,original);st.db.close();
});
