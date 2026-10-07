const form=document.querySelector('#login-form');
const password=document.querySelector('#password');
const toggle=document.querySelector('#toggle-password');
const submit=document.querySelector('#login-submit');
const notice=document.querySelector('#login-notice');

if(new URLSearchParams(location.search).get('expired')==='1')notice.textContent='Sua sessão expirou. Entre novamente para continuar.';

toggle.addEventListener('click',()=>{
 const visible=password.type==='text';password.type=visible?'password':'text';toggle.textContent=visible?'Mostrar':'Ocultar';toggle.setAttribute('aria-label',visible?'Mostrar senha':'Ocultar senha');password.focus();
});

form.addEventListener('submit',async event=>{
 event.preventDefault();submit.disabled=true;notice.textContent='Entrando…';
 try{
  const response=await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:password.value,remember:form.elements.remember.checked})});
  const data=await response.json();
  if(response.status===429)throw Error('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  if(!response.ok)throw Error('Senha incorreta. Confira e tente novamente.');
  const next=new URLSearchParams(location.search).get('next');location.replace(next&&next.startsWith('/admin')?next:'/admin');
 }catch(error){notice.textContent=error instanceof TypeError?'Não foi possível conectar ao servidor. Tente novamente.':error.message;password.select();submit.disabled=false;}
});
