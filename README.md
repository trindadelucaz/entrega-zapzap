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


## Evolution

No serviço de entregas, configure `WHATSAPP_PROVIDER=evolution`, `EVOLUTION_URL` (HTTPS, sem `/manager`), `EVOLUTION_INSTANCE`, `EVOLUTION_API_KEY` (token da instância) e `PRODUCTS_ACCESS_TOKEN` (senha entregue ao comprador do combo). Conserve `DELIVERY_ENABLED=false` e `DRY_RUN=true` durante a configuração. As variáveis Meta podem permanecer; não são usadas para enviar quando o provedor é Evolution.

Na instância Evolution, habilite o webhook com URL `https://SEU-DOMINIO/webhooks/evolution`, evento `MESSAGES_UPDATE`, e desative **Webhook by Events**. O callback deve incluir `instance` e `apikey` da instância; callbacks sem autenticação ou de outra instância são rejeitados. Não exponha tokens em links.

O painel consulta a conexão a cada 30 segundos. Antes do envio, o sistema consulta se o telefone tem WhatsApp; um resultado negativo aparece como falha para atendimento pelo e-mail. Uma consulta indisponível causa tentativa posterior. Confirmação de envio não equivale à entrega: somente os eventos de entrega/leitura confirmam esses estados. Sem eventos, o registro permanece aceito pela API.

Timeout ou erro depois de iniciar o envio fica incerto, sem repetição automática. Reinício durante envio também fica incerto. Pedidos duplicados são ignorados pelo ID do pagamento. Os eventos recebidos antes da resposta do envio são reaplicados quando o ID da mensagem fica disponível.

Antes de habilitar envios reais, teste com comprador fictício e seu próprio telefone, confira o texto e os callbacks. Ativar `DELIVERY_ENABLED=true` processa todas as compras já na fila; revise a fila para evitar entregar novamente compras atendidas manualmente.

### Teste isolado no painel

O formulário “Testar entrega” faz um envio real ao telefone informado sem ativar a fila, mesmo com `DRY_RUN=true`. Exige autenticação de administrador, header de ação e configuração Evolution. Cada teste tem um ID independente, aparece como “Teste de entrega” e não é reenviado quando o mesmo pedido HTTP é repetido. Falhas de pré-consulta são registradas sem repetição automática neste teste. Para testar o outro texto, altere o campo de acesso.

### Atendimento e reenvio

O painel inicia em **Vendas reais**, com filtros para **Testes** e **Todos**. Números de teste têm ID `test:` e ficam fora dos totais de vendas.

Em registros com falha, resultado incerto ou simulação, **Corrigir / reenviar** permite confirmar um telefone e reenfileirar o acesso. Requer modo real ativado. Entregas aceitas, em andamento, entregues ou lidas não podem ser reenviadas por essa ação. Resultados incertos exigem confirmação explícita após conferir o WhatsApp. Cada ação tem chave de idempotência e verifica se o status mudou antes de reenfileirar.

O telefone original da compra permanece preservado. **Histórico** mostra os envios anteriores; callbacks de mensagens antigas atualizam o histórico sem alterar a tentativa atual. Reenvio de registro simulado fica disponível sem nova compra.

**Consultar possível nono dígito** consulta o número original e, quando aplicável, a versão brasileira com nono dígito. Só sugere se o original não for encontrado e o candidato for encontrado. A existência de WhatsApp não comprova identidade: o administrador confirma o telefone e o envio.

A conexão é consultada a cada 30 segundos. O painel mostra última consulta e o início **observado** de uma desconexão, persistido no banco; não é necessariamente a hora exata em que o WhatsApp desconectou. Falha de consulta é distinguida de desconexão confirmada.
