import {timingSafeEqual,createHmac} from 'node:crypto';
export const CARNE='6a692b0b3d15a61538172466';
export const PROPRIOS='6a72457d1b13df5c3c53b2f3';
export function equal(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);}
export function signature(raw,secret,header){return equal('sha256='+createHmac('sha256',secret).update(raw).digest('hex'),header);}
export function phone(raw){let s=String(raw||'').replace(/\D/g,'');if(s.length===10||s.length===11)s='55'+s;if(!/^55[1-9]\d{9,10}$/.test(s))throw Error('invalid_phone');return s;}
export function sale(body){
 if(body?.payment?.status!=='paid')return null;
 const ids=new Set((body.products||[]).map(p=>p.id));
 if(!ids.has(CARNE))return null;
 if(typeof body.payment.id!=='string'||!body.payment.id||body.payment.id.length>100)throw Error('invalid_payment_id');
 const raw_phone=String(body.customer?.mobile_phone||'').slice(0,80);
 let normalized='',error=null;try{normalized=phone(raw_phone);}catch{error='invalid_phone';}
 return {id:body.payment.id,phone:normalized,raw_phone,name:String(body.customer?.name||'').slice(0,200),email:String(body.customer?.email||'').slice(0,254),error,kind:ids.has(PROPRIOS)?'combo':'carne'};
}
export function message(row,cfg){return {messaging_product:'whatsapp',to:row.phone,type:'template',biz_opaque_callback_data:row.id,template:{name:row.kind==='combo'?cfg.combo:cfg.carne,language:{code:'pt_BR'}}};}
export async function send(row,cfg,fetcher=fetch){
 if(cfg.dry)return {state:'simulated'};
 let response;
 try{response=await fetcher(`https://graph.facebook.com/${cfg.version}/${cfg.number}/messages`,{method:'POST',headers:{authorization:`Bearer ${cfg.token}`,'content-type':'application/json'},body:JSON.stringify(message(row,cfg)),signal:AbortSignal.timeout(15000)});}catch{return {state:'uncertain',error:'network_or_timeout'};}
 let data;try{data=await response.json();}catch{return {state:'uncertain',error:'invalid_response'};}
 if(response.ok&&data.messages?.[0]?.id)return {state:'accepted',mid:data.messages[0].id};
 if(response.status===429)return {state:'retry',error:'meta_rate_limit'};
 if(response.status>=500)return {state:'uncertain',error:'meta_server_error'};
 return {state:'failed',error:`meta_${data.error?.code||response.status}`};
}
