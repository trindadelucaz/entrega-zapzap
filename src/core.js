import {sendEvolution} from './evolution.js';
import {timingSafeEqual,createHmac} from 'node:crypto';
export const CARNE='6a692b0b3d15a61538172466';
export const PROPRIOS='6a72457d1b13df5c3c53b2f3';
export const DEFAULT_PRODUCTS=[
 {key:'carne',name:'Calculadora de Precificação de Carnes',externalIds:[CARNE],active:true,autoWrapper:true,position:10,accessUrl:'https://calculadoradacarne.vercel.app/',tutorialUrl:'https://acessoscalculadora.lovable.app/',accessToken:'',template:'🥩 *CALCULADORA DE PRECIFICAÇÃO DE CARNES*\n\n🎥 *Tutoriais e primeiros passos:*\n{{link_tutoriais}}\n\n🔗 *Acessar a Calculadora de Carnes:*\n{{link_acesso}}\n\nPara entrar, utilize o mesmo e-mail informado no momento da compra.'},
 {key:'proprios',name:'Calculadora de Produtos Próprios',externalIds:[PROPRIOS],active:true,autoWrapper:true,position:20,accessUrl:'https://precocerto-gilt.vercel.app/',tutorialUrl:'',accessToken:'',template:'🍢 *CALCULADORA DE PRODUTOS PRÓPRIOS*\n\nPara calcular produtos produzidos no seu comércio, como espetinhos, hambúrgueres, temperados e outros.\n\n🔗 *Acessar a Calculadora de Produtos Próprios:*\n{{link_acesso}}\n\n*Token de acesso:* {{token_acesso}}'}
];
export function equal(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);}
export function signature(raw,secret,header){return equal('sha256='+createHmac('sha256',secret).update(raw).digest('hex'),header);}
export function phone(raw){let s=String(raw||'').replace(/\D/g,'');if(s.length===10||s.length===11)s='55'+s;if(!/^55[1-9]\d{9,10}$/.test(s))throw Error('invalid_phone');return s;}
const clean=value=>String(value??'').slice(0,4000);
export function renderBlock(product,customer={}){
 const values={nome_cliente:clean(customer.name),email_cliente:clean(customer.email),nome_produto:clean(product.name),link_acesso:clean(product.accessUrl),link_tutoriais:clean(product.tutorialUrl),token_acesso:clean(product.accessToken)};
 return clean(product.template).replace(/{{\s*([a-z_]+)\s*}}/g,(all,key)=>Object.hasOwn(values,key)?values[key]:all).replace(/\n{3,}/g,'\n\n').trim();
}
export function renderDeliveryMessage(products,customer={}){
 if(!Array.isArray(products)||!products.length)throw Error('products_required');
 const blocks=products.map(p=>renderBlock(p,customer)).join('\n\n—————————————\n\n');
 if(!products.some(p=>p.autoWrapper!==false))return blocks;
 const intro=products.length===1?`Olá! Seu acesso à ${products[0].name} já está liberado. 😊`:`Olá! Seus acessos já estão liberados. 😊\n\nVocê adquiriu ${products.length} ferramentas. Abaixo estão os acessos de cada uma:`;
 return `${intro}\n\n${blocks}\n\nQualquer dúvida, é só chamar. Estamos à disposição! 🤝`;
}
export function sale(body,matchedProducts){
 if(body?.payment?.status!=='paid')return null;
 let products=matchedProducts;
 if(products===undefined){const ids=new Set((body.products||[]).map(p=>p.id));if(!ids.has(CARNE))return null;products=DEFAULT_PRODUCTS.filter(p=>p.key==='carne'||(p.key==='proprios'&&ids.has(PROPRIOS)));}
 if(!Array.isArray(products)||!products.length)return null;
 if(typeof body.payment.id!=='string'||!body.payment.id||body.payment.id.length>100)throw Error('invalid_payment_id');
 const raw_phone=String(body.customer?.mobile_phone||'').slice(0,80);
 let normalized='',error=null;try{normalized=phone(raw_phone);}catch{error='invalid_phone';}
 const customer={name:String(body.customer?.name||'').slice(0,200),email:String(body.customer?.email||'').slice(0,254)};
 const keys=products.map(p=>p.key);const legacy=keys.length===1&&keys[0]==='carne'?'carne':keys.includes('carne')&&keys.includes('proprios')&&keys.length===2?'combo':'catalog';
 return {id:body.payment.id,phone:normalized,raw_phone,name:customer.name,email:customer.email,error,kind:legacy,product_keys:JSON.stringify(keys),access_label:products.map(p=>p.name).join(' + '),message_text:renderDeliveryMessage(products,customer)};
}
export function message(row,cfg){return {messaging_product:'whatsapp',to:row.phone,type:'template',biz_opaque_callback_data:row.id,template:{name:row.kind==='combo'?cfg.combo:cfg.carne,language:{code:'pt_BR'}}};}
export async function send(row,cfg,fetcher=fetch){
 if(cfg.dry)return {state:'simulated'};
 if(cfg.provider==='evolution')return sendEvolution(row,cfg,fetcher);
 let response;
 try{response=await fetcher(`https://graph.facebook.com/${cfg.version}/${cfg.number}/messages`,{method:'POST',headers:{authorization:`Bearer ${cfg.token}`,'content-type':'application/json'},body:JSON.stringify(message(row,cfg)),signal:AbortSignal.timeout(15000)});}catch{return {state:'uncertain',error:'network_or_timeout'};}
 let data;try{data=await response.json();}catch{return {state:'uncertain',error:'invalid_response'};}
 if(response.ok&&data.messages?.[0]?.id)return {state:'accepted',mid:data.messages[0].id};
 if(response.status===429)return {state:'retry',error:'meta_rate_limit'};
 if(response.status>=500)return {state:'uncertain',error:'meta_server_error'};
 return {state:'failed',error:`meta_${data.error?.code||response.status}`};
}
