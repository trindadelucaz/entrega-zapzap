export async function request(cfg,path,body,fetcher=fetch){
 const response=await fetcher(`${cfg.evolutionUrl}${path}/${encodeURIComponent(cfg.instance)}`,{method:body===undefined?'GET':'POST',headers:{apikey:cfg.evolutionKey,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('evolution_http_'+response.status);
 return response.json();
}
export async function connection(cfg,fetcher=fetch){
 if(cfg.provider!=='evolution')return {provider:'meta',state:'not_checked'};
 if(!cfg.evolutionUrl||!cfg.instance||!cfg.evolutionKey)return {provider:'evolution',state:'not_configured'};
 try{const data=await request(cfg,'/instance/connectionState',undefined,fetcher);return {provider:'evolution',state:data.instance?.state==='open'?'connected':'disconnected'};}catch{return {provider:'evolution',state:'unavailable'};}
}
export function text(row,cfg){
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
