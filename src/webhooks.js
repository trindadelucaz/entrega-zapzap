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
 const transactionId=text(payload.transaction_id,100),sellfluxProductIds=[text(payload.product_id,160),text(payload.offer_id,160),...(Array.isArray(payload.itens)?payload.itens.map(item=>text(item?.id||item?.product_id,160)):[])].filter(Boolean);
 if(transactionId&&(payload.phone||payload.email||payload.name)&&sellfluxProductIds.length){
  const status=text(payload.status,40).toLowerCase();const paid=['compra-realizada','paid','approved','aprovado','pago'].includes(status);
  return {format:'sellflux_v1',eventId:transactionId,paymentId:transactionId,status,paid,customer:{name:text(payload.name),email:text(payload.email,254),phone:text(payload.phone,80)},productIds:[...new Set(sellfluxProductIds)],raw:payload};
 }
 return null;
}

export function canonicalSalePayload(event){
 if(!event)return null;
 return {payment:{id:event.paymentId,status:event.paid?'paid':event.status},customer:{name:event.customer.name,email:event.customer.email,mobile_phone:event.customer.phone},products:event.productIds.map(id=>({id})),checkout:{orderbump:[]}};
}
