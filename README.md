# Entrega Wiapy → WhatsApp

Backend Node 24 com SQLite e painel privado de entregas. Sem dependências npm externas. Testado localmente com dados fictícios; ainda não validado com mensagens reais da Meta. Os envios começam **pausados** (`DELIVERY_ENABLED=false`).

## O que faz

- Recebe compras pagas da Wiapy e grava antes de responder, sem aguardar o envio da Meta.
- Usa o ID do pagamento para evitar duplicação do mesmo pedido.
- Carnes: produto `6a692b0b3d15a61538172466`; Carnes + Produtos Próprios: também contém `6a72457d1b13df5c3c53b2f3`.
- Bump WhatsApp e outros bumps não mudam a mensagem de Carnes. Produtos Próprios sozinho é ignorado.
- Telefone inválido vira falha no relatório, com nome, e-mail e telefone original para atendimento manual.
- Não cria usuários no Lovable. Mantenha o webhook atual que libera o acesso.
- Não envia alertas por e-mail e não realiza reenvio manual pelo painel.

## Painel

Abra `https://SEU-DOMINIO/admin`. Usuário: `admin`. Senha: valor de `ADMIN_TOKEN` (gere um segredo forte exclusivo, mínimo 24 caracteres). O navegador solicita a senha; use HTTPS em produção.

O relatório exibe nome, telefone, e-mail, ferramenta, status, horário, tentativas e código da falha. Tem busca, filtros de status/período, páginas de 50 registros e atualização a cada 30 segundos. “Precisam de atenção” reúne falhas/resultados incertos ainda não resolvidos. Marcar como resolvido registra atendimento manual e **não muda o status de entrega nem reenvia mensagem**.

“Aceita pela Meta” e “Enviada” não confirmam entrega. Só “Entregue” ou “Lida” confirmam. O erro 131026 não prova que o telefone não tem WhatsApp: há outras causas possíveis. O painel mostra essa limitação.

## Railway

1. Use os arquivos na raiz do repositório e conecte-o a um serviço Railway. O Dockerfile inicia Node 24.
2. Adicione um volume em `/data`; `DB_PATH=/data/deliveries.sqlite`. Use **uma única réplica** e configure backups.
3. Cadastre as variáveis de `.env.example` no Railway. Nunca envie `.env`, token Meta, segredo do app ou banco ao GitHub.
4. Gere `WIAPY_SECRET`, `ADMIN_TOKEN` e `META_VERIFY_TOKEN` diferentes com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
5. Preencha `META_TOKEN` com o token autorizado ao número/conta e `META_APP_SECRET` com o segredo do **aplicativo atual**. Confira acesso e validade do token na Meta.
6. Os IDs e nomes de modelo estão preenchidos em `.env.example`. Confirme que correspondem à conta real e aos modelos aprovados em `pt_BR`.
7. Gere o domínio público. `/health` deve responder `ok:true` e `mode:paused`. `/admin` deve pedir senha.
8. Cadastre o callback Meta `https://SEU-DOMINIO/webhooks/meta` e o valor de `META_VERIFY_TOKEN` no campo de verificação. Ele é um segredo próprio, diferente do token de acesso Meta. Assine o campo `messages` e confirme que o app está inscrito na WABA. Sem essa inscrição, os status não chegam.
9. Faça os testes controlados descritos abaixo antes de configurar vendas reais.

## Teste e ativação

- Com `DELIVERY_ENABLED=false`, compras válidas ficam na fila e nenhuma mensagem é enviada.
- Para simulação: `DELIVERY_ENABLED=true`, `DRY_RUN=true`. Use banco/ambiente de teste separado: pedidos simulados são consumidos e não se tornam envios reais ao mudar o modo.
- Para teste real: confirme os dois modelos aprovados e as credenciais, use o próprio telefone com autorização e IDs de compra fictícios, então configure `DELIVERY_ENABLED=true`, `DRY_RUN=false`.
- Confira mensagem no telefone e status `delivered` ou `read` no relatório para Carnes e combo. Teste pedido repetido, telefone inválido e webhook assinado.
- Conecte a Wiapy ao ambiente real somente após concluir a validação. Confira também se o acesso do comprador já está liberado no Lovable.

## Wiapy

Adicione **uma nova integração**, preservando a integração Lovable de criação de usuário:

- Evento: pagamento aprovado do checkout de Carnes.
- Método: POST.
- URL: `https://SEU-DOMINIO/webhooks/wiapy`.
- Header `authorization`: valor exato de `WIAPY_SECRET`, sem `Bearer`.
- Corpo: objeto de venda (conteúdo de `data` nos logs), não o envelope do log.

Use segredo novo, diferente do Lovable. Não reutilize credenciais compartilhadas em conversa. Não grave CPF, tracking ou payload completo: o banco armazena apenas os campos necessários ao envio e atendimento.

## Falhas e limites

HTTP 429 permite até cinco tentativas com espera crescente. Timeout, falha de rede, HTTP 5xx, resposta ambígua ou reinício durante envio ficam como resultado incerto: não são reenviados automaticamente, pois a Meta pode já ter aceitado. Falhas assíncronas aparecem pelo webhook. Status confirmados não regridem por callbacks atrasados.

Não há transação conjunta com o Lovable: a mensagem pode chegar antes da liberação se o outro webhook atrasar ou falhar. Esta versão depende da integração atual de acesso; valide com compra controlada antes de ativar.

`GET /admin/deliveries` também aceita `Authorization: Bearer ADMIN_TOKEN`, com filtros `q`, `state`, `from`, `to`, `page`. Datas usam o fuso UTC−3 e incluem todo o dia final. Todo endpoint administrativo requer autenticação e não permite cache.

## Local

Copie `.env.example` para `.env`, preencha os segredos, execute `npm test` e `npm start`. Node >=24. O banco padrão fica em `data/`.

## Referências

- Meta Cloud API: https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api
- Webhooks: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
- Railway volumes: https://docs.railway.com/volumes
