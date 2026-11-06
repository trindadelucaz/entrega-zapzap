const text=(value,max=200)=>String(value??'').trim().slice(0,max);

// Converte formatos de checkout reconhecidos para um contrato interno estável.
// Novos adaptadores podem ser adicionados sem alterar produtos, mensagens ou envios.
export function normalizeWebhookPayload(payload){
 if(!payload||typeof payload!=='object')return null;
 if(payload.payment&&payload.customer&&(Array.isArray(payload.products)||Array.isArray(payload.checkout?.orderbump))){
  const paymentId=text(payload.payment.id,100);
  const status=text(payload.payment.status,40).toLowerCase();
  const productIds=[...(payload.products||[]).map(item=>text(item?.id,160)),...(payload.checkout?.orderbump||[]).map(item=>text(item?.id,160))].filter(Boolean);
  if(!paymentId)return null;
  return {format:'checkout_v1',eventId:paymentId,paymentId,status,paid:status==='paid',customer:{name:text(payload.customer.name),email:text(payload.customer.email,254),phone:text(payload.customer.mobile_phone||payload.customer.phone,80)},productIds,raw:payload};
 }
 return null;
}

export function canonicalSalePayload(event){
 if(!event)return null;
 return {payment:{id:event.paymentId,status:event.paid?'paid':event.status},customer:{name:event.customer.name,email:event.customer.email,mobile_phone:event.customer.phone},products:event.productIds.map(id=>({id})),checkout:{orderbump:[]}};
}
