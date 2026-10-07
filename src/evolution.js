export async function request(cfg,path,body,fetcher=fetch){
 const response=await fetcher(`${cfg.evolutionUrl}${path}/${encodeURIComponent(cfg.instance)}`,{method:body===undefined?'GET':'POST',headers:{apikey:cfg.evolutionKey,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('evolution_http_'+response.status);
 return response.json();
}
async function instanceRequest(cfg,action,method='GET',fetcher=fetch){
 if(!cfg.evolutionUrl||!cfg.instance||!cfg.evolutionKey)throw Error('evolution_not_configured');
 const response=await fetcher(`${cfg.evolutionUrl}/instance/${action}/${encodeURIComponent(cfg.instance)}`,{method,headers:{apikey:cfg.evolutionKey,'content-type':'application/json'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('evolution_http_'+response.status);
 const data=await response.json();if(data?.error===true)throw Error('evolution_action_failed');return data;
}
const qrValue=data=>{const value=data?.base64||data?.qrcode?.base64||data?.qrcode?.base64Qr||data?.qrCode?.base64;if(typeof value!=='string'||value.length<100)return null;return value.startsWith('data:image/')?value:`data:image/png;base64,${value}`;};
export async function createWhatsappInstance(cfg,{instanceName,token,callbackUrl},fetcher=fetch){
 if(!cfg.evolutionUrl||!cfg.evolutionKey)throw Error('evolution_not_configured');const response=await fetcher(`${cfg.evolutionUrl}/instance/create`,{method:'POST',headers:{apikey:cfg.evolutionKey,'content-type':'application/json'},body:JSON.stringify({instanceName,token,qrcode:true,integration:'WHATSAPP-BAILEYS',rejectCall:true,groupsIgnore:true,alwaysOnline:false,readMessages:false,readStatus:false,syncFullHistory:false,webhookUrl:callbackUrl,webhookByEvents:false,webhookBase64:false,webhookEvents:['MESSAGES_UPDATE']}),signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error([401,403].includes(response.status)?'evolution_permission_denied':response.status===409?'duplicate_connection':'evolution_http_'+response.status);const data=await response.json();return {qr:qrValue(data)};
}
export async function whatsappDetails(cfg,fetcher=fetch){
 const status=await connection(cfg,fetcher);let phone='',profileName='';
 if(status.state==='connected')try{const response=await fetcher(`${cfg.evolutionUrl}/instance/fetchInstances?instanceName=${encodeURIComponent(cfg.instance)}`,{headers:{apikey:cfg.evolutionKey,'content-type':'application/json'},signal:AbortSignal.timeout(15000)});if(response.ok){const rows=await response.json();const item=Array.isArray(rows)?rows.find(x=>x?.name===cfg.instance||x?.instance?.instanceName===cfg.instance)||rows[0]:null;phone=String(item?.ownerJid||item?.instance?.ownerJid||'').split('@')[0].replace(/\D/g,'');profileName=String(item?.profileName||item?.instance?.profileName||'').slice(0,100);}}catch{}
 return {...status,instance:cfg.instance||'',phone,profileName};
}
export async function connectWhatsapp(cfg,fetcher=fetch){
 const data=await instanceRequest(cfg,'connect','GET',fetcher);const state=data?.instance?.state==='open'||data?.instance?.status==='open'?'connected':'connecting';return {state,qr:qrValue(data)};
}
export async function logoutWhatsapp(cfg,fetcher=fetch){await instanceRequest(cfg,'logout','DELETE',fetcher);return {ok:true};}
export async function connection(cfg,fetcher=fetch){
 if(cfg.provider!=='evolution')return {provider:'meta',state:'not_checked'};
 if(!cfg.evolutionUrl||!cfg.instance||!cfg.evolutionKey)return {provider:'evolution',state:'not_configured'};
 try{const data=await request(cfg,'/instance/connectionState',undefined,fetcher);return {provider:'evolution',state:data.instance?.state==='open'?'connected':'disconnected'};}catch{return {provider:'evolution',state:'unavailable'};}
}
export function text(row,cfg){
 if(typeof row.message_text==='string'&&row.message_text.trim())return row.message_text;
 const base='Olá! Seu acesso à Calculadora de Precificação de Carnes já está liberado. 😊\n\n🥩 CALCULADORA DE PRECIFICAÇÃO DE CARNES\n\n🎥 Tutoriais e primeiros passos:\nhttps://acessoscalculadora.lovable.app/\n\n🔗 Acessar a Calculadora de Carnes:\nhttps://calculadoradacarne.vercel.app/\n\nPara entrar, utilize o mesmo e-mail informado no momento da compra.';
 if(row.kind==='combo'&&!cfg.productsAccessToken)throw Error('products_token_missing');
 return base+(row.kind==='combo'?'\n\n—————————————\n\n🍢 CALCULADORA DE PRODUTOS PRÓPRIOS\n\nPara calcular produtos como espetinhos, hambúrgueres, temperados e outros.\n\n🔗 Acessar:\nhttps://precocerto-gilt.vercel.app/\n\nToken de acesso: '+cfg.productsAccessToken:'')+'\n\nQualquer dúvida, é só chamar. Estamos à disposição! 🤝';
}
export async function sendEvolution(row,cfg,fetcher=fetch){
 let content;try{content=text(row,cfg);}catch{return {state:'failed',error:'products_token_missing'};}
 if((await connection(cfg,fetcher)).state!=='connected')return {state:'retry',error:'evolution_disconnected'};
 try{
 const numbers=await request(cfg,'/chat/whatsappNumbers',{numbers:[row.phone]},fetcher);
 if(!Array.isArray(numbers)||numbers.length!==1||typeof numbers[0].exists!=='boolean')return {state:'retry',error:'evolution_number_check_failed'};
 if(!numbers[0].exists)return {state:'failed',error:'whatsapp_not_found'};
 }catch{return {state:'retry',error:'evolution_number_check_failed'};}
 // Depois de iniciar o POST, uma resposta incerta nunca provoca reenvio automático.
 try{const data=await request(cfg,'/message/sendText',{number:row.phone,text:content,linkPreview:false},fetcher);
 if(data.key?.id)return {state:'accepted',mid:data.key.id};
 return {state:'uncertain',error:'invalid_response'};
 }catch{return {state:'uncertain',error:'network_or_timeout'};}
}
export function statuses(payload){
 if(String(payload.event).replace(/[.-]/g,'_').toUpperCase()!=='MESSAGES_UPDATE')return [];
 const map={SERVER_ACK:'sent',DELIVERY_ACK:'delivered',READ:'read',PLAYED:'read',ERROR:'failed'};
 return (Array.isArray(payload.data)?payload.data:[payload.data]).filter(x=>x?.fromMe===true&&typeof x.keyId==='string'&&map[x.status]).map(x=>({id:x.keyId,status:map[x.status],timestamp:0,error:x.status==='ERROR'?'evolution_delivery_failed':null}));
}

export async function suggestPhone(number,cfg,fetcher=fetch){
 // Candidato apenas para celular brasileiro com DDD + oito dígitos.
 if(!/^55[1-9]\d[6-9]\d{7}$/.test(number))return {suggestion:null};
 const candidate=number.slice(0,4)+'9'+number.slice(4);
 const check=async value=>{const data=await request(cfg,'/chat/whatsappNumbers',{numbers:[value]},fetcher);if(!Array.isArray(data)||data.length!==1||typeof data[0].exists!=='boolean')throw Error('number_check_failed');return data[0].exists;};
 if(await check(number))return {suggestion:null,originalExists:true};
 return {suggestion:await check(candidate)?candidate:null};
}
