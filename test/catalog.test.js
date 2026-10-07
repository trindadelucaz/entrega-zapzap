import test from 'node:test';
import assert from 'node:assert/strict';
import {store} from '../src/store.js';
import {sale,renderDeliveryMessage,CARNE,PROPRIOS} from '../src/core.js';

const payload=(ids,id='catalog-order')=>({payment:{id,status:'paid'},customer:{name:'Cliente Catálogo',email:'cliente@example.com',mobile_phone:'(79) 99999-0000'},products:ids.map(productId=>({id:productId})),checkout:{orderbump:[]}});

test('catálogo nasce compatível com Carne e Produtos Próprios',()=>{
 const st=store(':memory:',{productsAccessToken:'token-seguro'});const products=st.products();assert.deepEqual(products.map(p=>p.key),['carne','proprios']);assert.equal(products.find(p=>p.key==='proprios').accessToken,'token-seguro');
 const matched=st.matchProducts(payload([CARNE,PROPRIOS]));const row=sale(payload([CARNE,PROPRIOS]),matched);assert.deepEqual(JSON.parse(row.product_keys),['carne','proprios']);assert.match(row.message_text,/token-seguro/);assert.match(row.access_label,/Produtos Próprios/);st.db.close();
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
