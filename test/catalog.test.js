import test from 'node:test';
import assert from 'node:assert/strict';
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

test('novo produto pode ser configurado, combinado e pausado sem alterar código',()=>{
 const st=store(':memory:');const product=st.saveProduct({key:'lucro_producao',name:'Lucro na Produção',externalIds:['wiapy-lucro'],accessUrl:'https://produto.example.com/',tutorialUrl:'https://tutorial.example.com/',accessToken:'abc123',template:'📦 *{{nome_produto}}*\n\nAcesso: {{link_acesso}}\nTutoriais: {{link_tutoriais}}\nToken: {{token_acesso}}',active:true,position:30});
 assert.equal(product.active,true);assert.equal(product.autoWrapper,false);assert.equal(renderDeliveryMessage([product],{name:'Cliente'}).startsWith('📦'),true);assert.doesNotMatch(renderDeliveryMessage([product],{name:'Cliente'}),/Qualquer dúvida/);const p=payload([CARNE,'wiapy-lucro']);const row=sale(p,st.matchProducts(p));assert.deepEqual(JSON.parse(row.product_keys),['carne','lucro_producao']);assert.match(row.message_text,/Lucro na Produção/);assert.match(row.message_text,/abc123/);
 st.saveProduct({...product,externalIds:product.externalIds,active:false,expectedUpdated:product.updated});assert.deepEqual(st.matchProducts(payload(['wiapy-lucro'])),[]);st.db.close();
});

test('protege IDs duplicados, variáveis desconhecidas e snapshot da mensagem',()=>{
 const st=store(':memory:');assert.throws(()=>st.saveProduct({key:'duplicado',name:'Produto Duplicado',externalIds:[CARNE],template:'Mensagem válida do produto',active:true}),/duplicate_external_id/);assert.throws(()=>st.saveProduct({key:'variavel',name:'Produto Variável',externalIds:['new-id'],template:'Mensagem {{segredo_interno}}',active:true}),/invalid_variable/);
 const carne=st.products().find(p=>p.key==='carne');const original=renderDeliveryMessage([carne],{name:'Cliente'});const row=sale(payload([CARNE]),[carne]);st.saveProduct({...carne,externalIds:carne.externalIds,template:'Mensagem nova com tamanho válido',expectedUpdated:carne.updated});assert.equal(row.message_text,original);st.db.close();
});
