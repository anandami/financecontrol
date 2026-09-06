# Tasks: Bot de Controle de Despesas via Telegram

**Branch**: `bot-despesas-telegram` **Specs**: [spec.md](./spec.md) **Architecture**: [architecture.md](./architecture.md) **Status**: MVP funcionando de ponta a ponta (Fases 1-3 ✅) ⏰

## Phase 1: Setup ✅ (~1.5h)
- [x] T001 Iniciar o projeto Node local (`npm init -y`) e instalar `clasp` e `jest` como dependências de desenvolvimento, com scripts `push`/`open`/`test` em `package.json` — `package.json`
- [x] T002 [P] Criar `src/appsscript.json` com o manifesto mínimo do Apps Script (timeZone, `webapp: {executeAs, access}`) — `src/appsscript.json`
- [x] T003 [P] Criar um bot de desenvolvimento no Telegram via [@BotFather](https://t.me/BotFather) e uma chave de API do Gemini no Google AI Studio; anotar os valores num arquivo local ignorado pelo Git — `.gitignore`
- [x] T004 Criar `jest.config.js` e `tests/__mocks__/google-apps-script.js` com mocks mínimos de `SpreadsheetApp`, `UrlFetchApp`, `PropertiesService`, `CacheService`, `Utilities` — `jest.config.js`, `tests/__mocks__/google-apps-script.js` (depende de T001)

### Notas da Fase 1
Todas as tarefas concluídas. T001/T002/T004 feitos e verificados (`npx jest` carrega a config corretamente, mocks sem erro de sintaxe). T003: bot de desenvolvimento `@anandadespesas_dev_bot` criado via BotFather, chave do Gemini criada no AI Studio, e um `TELEGRAM_WEBHOOK_SECRET` aleatório gerado — os três valores estão em `.credentials.local.md` (confirmado como ignorado pelo Git via `git check-ignore`).

## Phase 2: Foundational ✅ (~3h)
⚠️ CRITICAL: blocks everything below — sem isso, nenhuma mensagem pode ser processada com segurança
- [x] T005 Implementar `src/config.js`: getters/setters sobre `PropertiesService` para `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`, `OWNER_TELEGRAM_ID`, incluindo `isOwner(fromId)` e `registerOwnerIfUnset(fromId)` — `src/config.js`
- [x] T006 [P] Implementar `src/state.js`: `savePendingDraft(draft)` (gera e retorna o token), `getPendingDraft(token)`, `clearPendingDraft(token)` sobre `CacheService` (TTL 15 min, token curto aleatório) — `src/state.js`
- [x] T007 [P] Implementar o núcleo de `src/telegram.js`: `sendMessage(chatId, text, options)`, `editMessageText`, `answerCallbackQuery`, `getFile(fileId)` — `src/telegram.js`
- [x] T008 Implementar `src/Code.js`: `doPost(e)` valida `e.parameter.secret` contra `TELEGRAM_WEBHOOK_SECRET`, faz parse do update, e roteia para um handler de mensagem que verifica/registra o dono (`config.isOwner`/`registerOwnerIfUnset`) e um stub de `callback_query` — `src/Code.js` (depende de T005, T007)

**Checkpoint**: ✋ Webhook responde, valida o segredo do Telegram, e só aceita mensagens do dono registrado — confirmado por teste de fumaça manual (ver notas)

### Notas da Fase 2
- **Correção de arquitetura durante a implementação**: pesquisa confirmou que `doPost(e)` do Apps Script não expõe headers HTTP customizados (limitação deliberada do Google desde 2023) nem permite definir o código de status HTTP da resposta (sempre 200). Isso invalidava a Decision original de validar `X-Telegram-Bot-Api-Secret-Token` via header. Corrigido em `architecture.md` (nova Decision 7) e `contracts.md`: o segredo agora trafega como parâmetro de query na própria URL do webhook (`?secret=...`), validado via `e.parameter.secret`. Mesmo nível de proteção (nenhum update é processado sem o segredo certo), só muda o mecanismo de transporte.
- **Pequeno desvio do plano**: `state.js` implementa `savePendingDraft(draft)` (sem receber o token, que é gerado internamente e retornado) em vez de `savePendingDraft(token, draft)` — mantém a geração do token encapsulada no módulo responsável pelo cache, evitando que o chamador precise conhecer o formato do token.
- Módulos escritos em formato "isomórfico" (funções globais simples, mais um bloco `if (typeof module !== 'undefined')` no final) para funcionar tanto dentro do Apps Script (sem sistema de módulos) quanto via `require()` nos testes Jest/Node.
- Validado com um teste de fumaça manual fora do Jest (mocks simples inline, não os mocks completos de `tests/__mocks__`): segredo errado não processa nada; primeira mensagem registra o dono; mensagens seguintes do dono seguem o fluxo normal; mensagens de outro remetente são recusadas. Os testes Jest "de verdade" começam na Fase 3, junto com a lógica de negócio (parsing, planilha).

## Phase 3: Lançamento por texto, com confirmação e categorização — US-001 / US-004 / US-007 (P1) ⏰ 🎯 MVP (~5h)
**Goal**: mandar um texto ao bot, ver o resumo com botões, confirmar, e ver a linha certa (com categoria correta) na planilha.
**Independent Test**: enviar "paguei 100 reais de faxina" ao bot de desenvolvimento, tocar "Confirmar", e checar a linha na planilha de teste.

### Tasks
- [x] T009 [P] [US-007] Escrever teste Jest para `sheets.getCategories()` (lê coluna C de "Despesas", ignora cabeçalho) — `tests/sheets.test.js` (deve falhar antes da implementação)
- [x] T010 [US-007] Implementar `sheets.getCategories()` em `src/sheets.js` para o teste T009 passar — `src/sheets.js`
- [x] T011 [P] [US-001] Escrever teste Jest para `ai.buildPrompt(text, categories)` e `ai.parseExpenseResponse(rawJson)` (parsing/validação do `ExpenseDraft`, incluindo fallback `SEM_CATEGORIA`) — `tests/ai.test.js` (deve falhar antes da implementação)
- [x] T012 [US-001] Implementar `ai.buildPrompt`, `ai.callGemini` (via `UrlFetchApp`) e `ai.parseExpenseResponse` em `src/ai.js` para o texto, fazendo T011 passar — `src/ai.js`
- [x] T013 [US-004] Adicionar a `telegram.js` o helper `buildConfirmationKeyboard(token)` (teclado inline Confirmar/Corrigir/Cancelar) — `src/telegram.js`
- [x] T014 [US-001] Em `Code.js`, handler de mensagem de texto: valida dono → `sheets.getCategories()` → `ai.parseExpense(text, categories)` → se `precisa_revisao`, pede reformulação (FR-012); senão `state.savePendingDraft` → `telegram.sendMessage` com resumo + teclado — `src/Code.js` (depende de T010, T012, T013)
- [x] T015 [P] [US-001] Escrever teste Jest para `sheets.appendLancamento(draft)` (resolução de colunas por cabeçalho, `appendRow`) — `tests/sheets.test.js` (deve falhar antes da implementação)
- [x] T016 [US-001] Implementar `sheets.appendLancamento(draft)` em `src/sheets.js` para T015 passar (Decision 6: mapa nome→índice de coluna) — `src/sheets.js`
- [x] T017 [US-004] Em `Code.js`, handler de `callback_query`: `confirm` → `state.getPendingDraft` → `sheets.appendLancamento` → `answerCallbackQuery` + `editMessageText`; `cancel` → `clearPendingDraft` + edita mensagem; `edit` → pede nova mensagem — `src/Code.js` (depende de T016, T006)
- [x] T018 [US-001] Teste manual: mensagens de texto reais, confirmar e cancelar, verificar as linhas na planilha de teste — fluxo principal (texto → confirmação → gravação correta) validado de ponta a ponta na instância de desenvolvimento; ver notas para o que ainda vale testar (mais variedade de categorias/valores, e o fluxo de Cancelar/Corrigir)

**Checkpoint**: ✅ MVP completo, testado de ponta a ponta na instância de desenvolvimento (mensagem → confirmação → gravação na aba "Lançamento")

### Notas da Fase 3

**Resumo**: o MVP funciona de ponta a ponta, mas chegar lá exigiu uma sessão de depuração bem mais longa que o previsto — quase tudo que podia dar errado numa primeira publicação real dava. Registrando tudo em detalhe porque **cada um desses pontos vai se repetir para qualquer nova pessoa publicando sua própria instância (Fase 6, T029)**.

**Decisões/correções de código:**
- `sheets.appendLancamento` inicialmente assumiu que lançamentos e categorias viviam na mesma aba "Despesas" (única aba confirmada na documentação até então). **Errado**: são abas diferentes — "Despesas" (categorias, coluna C) e "**Lançamento**" (lançamentos individuais). Corrigido: `LANCAMENTOS_SHEET_NAME = 'Lançamento'`.
- A aba "Lançamento" real tem uma **linha de título antes do cabeçalho** ("Lançamentos Individuais" / "Lembretes" na linha 1, cabeçalho de verdade — Descrição/Registro no cartão/Categoria/Data/Mês/Valor — na linha 2). `appendLancamento` agora procura a linha de cabeçalho pelo conteúdo (primeira linha, dentro das 10 primeiras, que contenha "Descrição"), em vez de assumir que é sempre a linha 1.
- Reescrevi `appendLancamento` para **nunca usar `appendRow` com a linha inteira** — grava célula a célula, só nas colunas reconhecidas (Descrição/Categoria/Data/Valor), e acha a primeira linha com "Descrição" vazia (não a última linha da planilha) como destino. Isso evita sobrescrever "Mês" (preenchida por fórmula/arrastada com antecedência) e "Registro no cartão" (preenchimento manual, fora do escopo do bot por enquanto — o usuário decide depois se quer que o bot também tente inferir isso).
- `draft.data` agora é convertido para um `Date` real antes de gravar (em vez de string ISO solta), pra casar com a formatação de data já usada na planilha.
- Comparação de nomes de cabeçalho agora normaliza para NFC (`String.prototype.normalize`) antes de comparar — texto acentuado ("ç", "ã") pode chegar pré-composto ou decomposto dependendo de como foi digitado/colado, e as duas formas não são `===` iguais em JS mesmo sendo visualmente idênticas.
- `ai.callGemini` usa o alias `gemini-flash-latest` (mantido pelo Google, sempre aponta pro Flash estável mais recente) em vez de fixar uma versão numerada — `gemini-2.5-flash` (usado inicialmente) foi descontinuado pelo Gemini *durante esta mesma sessão de testes* e quebrava toda interpretação com erro 404 silencioso. Fixar uma versão específica é um risco constante; o alias elimina esse problema de vez.
- `Code.js`: adicionado dedup por `update_id` (`state.wasUpdateProcessed`/`markUpdateProcessed`, TTL 10 min) — o Telegram reenvia o mesmo update se a resposta demorar/falhar, e sem isso cada reenvio reprocessava a despesa e mandava respostas duplicadas.
- `Code.js`: `doPost` agora envolve os handlers em try/catch, loga o erro (`Logger.log`) e **manda o texto do erro real pro dono via Telegram** (não uma mensagem genérica) — como só o dono verificado recebe mensagens do bot, não há risco de vazar detalhe técnico, e isso substituiu a necessidade de configurar Cloud Logging (que exige vincular um projeto GCP) pra depurar em produção.
- `textResponse_` trocou `ContentService.createTextOutput()` por `HtmlService.createHtmlOutput()`. Causa raiz de um bug sério: Web Apps do Apps Script sempre respondem com um redirecionamento 302 (pra servir o conteúdo via `script.googleusercontent.com`); o Telegram não segue esse redirecionamento e trata a entrega como falha ("Wrong response from the webhook: 302 Found"), reenviando o mesmo update repetidamente. `HtmlService.createHtmlOutput()` responde com 200 direto. ([fonte](https://groups.google.com/g/google-apps-script-community/c/WALz_3rw7u4))

**Descobertas de infraestrutura/publicação (para o tutorial da Fase 6):**
1. A API do Apps Script (`script.google.com/home/usersettings`) precisa estar ativada manualmente na conta antes do primeiro `clasp push`/`deploy`, com 1-2 min de propagação.
2. `webapp.access` no manifesto precisa ser `"ANYONE_ANONYMOUS"`, não `"ANYONE"` — `"ANYONE"` ainda exige login numa conta Google, e o Telegram (servidor, sem conta Google) recebia 401 e nunca conseguia entregar updates.
3. **Criar** uma implantação de Web App via API (`clasp deploy` sem `-i`, gerando um ID novo) sai com o acesso público quebrado — retorna 403 ("Você precisa ter acesso", página de permissão do Drive) pra qualquer chamador anônimo, mesmo mostrando "Qualquer pessoa" corretamente na interface. É preciso **criar a implantação uma vez pela interface** (Implantar > Nova implantação > App da Web). Depois de criada, **atualizar** essa mesma implantação via `clasp deploy -i <id>` funciona normalmente e preserva o acesso público — confirmado empiricamente. Ou seja: só a criação inicial precisa ser manual; todo redeploy seguinte pode ser feito via `clasp deploy -i`.
4. Cuidado ao testar o endpoint manualmente (`curl`) antes de haver um dono registrado: qualquer requisição parecida com uma mensagem real do Telegram aciona `registerOwnerIfUnset` de verdade. Testes de conectividade devem usar um `from.id` que dá pra limpar depois (via exclusão manual da propriedade `OWNER_TELEGRAM_ID`), ou ser feitos só depois que o dono real já estiver registrado.
5. `clasp logs` exige um projeto GCP vinculado ao projeto Apps Script (não configuramos isso) — não é o caminho de depuração usado aqui; a mitigação foi mandar o próprio erro pro chat do Telegram (ver acima).

**O que ficou pra depois:**
- "Registro no cartão" (forma de pagamento) não é preenchido pelo bot — decisão pendente de confirmação com o usuário sobre se vale a pena estender `ai.parseExpense`/o prompt pra tentar inferir isso também.
- Tratamento de erro/rate-limit mais fino do Gemini (mensagens específicas por tipo de erro 4xx/5xx) continua no escopo do Final Phase (T032).
- Testar Cancelar/Corrigir e uma variedade maior de categorias/valores ainda não foi feito — o essencial (Confirmar com gravação correta) está validado.
- Ficaram duas implantações de Web App órfãs (das tentativas via API que saíram com acesso quebrado) — não fazem mal (o Telegram não aponta pra elas), mas podem ser arquivadas/apagadas na interface por limpeza.

## Phase 4: Lançamento por áudio — US-002 (P2) ⏳ (~4h)
**Goal**: mandar uma nota de voz descrevendo um gasto e ver o mesmo fluxo de confirmação/gravação do MVP.
**Independent Test**: mandar uma nota de voz real dizendo um gasto e conferir que o rascunho mostrado bate com o que foi falado.

### Tasks
- [x] T019 [US-002] SPIKE — pulado como script avulso; dobrado no teste manual real (T024), já que a sessão de depuração da Fase 3 já tinha uma instância real publicada e pronta pra testar ao vivo
- [x] T020 [US-002] Em `telegram.js`, implementar `downloadFile(fileId)` (usa `getFile` + `UrlFetchApp`, retorna base64) — `src/telegram.js`
- [x] T021 [US-002] Estender `ai.parseExpense`/`ai.buildPrompt` em `ai.js` para aceitar uma `part` de áudio (`inline_data`, `mime_type: audio/ogg`) via um parâmetro `media` — `src/ai.js`
- [x] T022 [US-002] Em `Code.js`, rotear `message.voice` para `telegram.downloadFile` + `ai.parseExpense(null, categorias, media)`, reaproveitando o fluxo de confirmação (`handleExpenseMedia_`, compartilhado com a Fase 5) — `src/Code.js`
- [x] T023 [P] [US-002] Escrever teste Jest do caminho de áudio de `ai.parseExpense`/`buildPrompt` (mock do `UrlFetchApp`) — `tests/ai.test.js`
- [ ] T024 [US-002] Teste manual com notas de voz variadas (sotaque, ruído, curtas/longas) — **pendente**, código publicado e pronto pra testar

**Checkpoint**: ⏰ Código publicado; falta validar com notas de voz reais (T024)

## Phase 5: Lançamento por print/foto — US-003 (P2) ⏳ (~2.5h)
**Goal**: mandar uma foto de comprovante/nota fiscal e ver o mesmo fluxo de confirmação/gravação.
**Independent Test**: mandar um print de confirmação de Pix e uma foto de nota fiscal física, confirmando os dois lançamentos.

### Tasks
- [x] T025 [US-003] Estender `ai.parseExpense`/`ai.buildPrompt` em `ai.js` para aceitar uma `part` de imagem (`inline_data`, `mime_type: image/jpeg`), com o mesmo parâmetro `media` da Fase 4 — `src/ai.js`
- [x] T026 [US-003] Em `Code.js`, rotear `message.photo` (maior resolução do array, com legenda opcional) via `handleExpenseMedia_` (compartilhado com a Fase 4) — `src/Code.js`
- [x] T027 [P] [US-003] Escrever teste Jest do caminho de imagem de `ai.buildPrompt` (mock do `UrlFetchApp`) — `tests/ai.test.js`
- [x] T028 [US-003] Teste manual com print de confirmação de pagamento digital — validado com o print real do usuário (histórico da Carteira Google, 7 transações): resumo em lote exibido corretamente, "Confirmar todos" gravou as 7 linhas certas na aba "Lançamento", sem tocar em "Mês". Falta só testar com foto de nota fiscal física (papel), se o usuário quiser cobrir esse caso também

**Checkpoint**: ✅ Validado ao vivo com print real (Carteira Google) — extração em lote + "Confirmar todos" gravando certo na planilha. Nota fiscal física em papel ainda não testada.

### Notas das Fases 4/5
- `ai.js`: `buildPrompt(text, categories, media)` e `parseExpense(text, categories, media)` agora aceitam um terceiro parâmetro opcional `media = {mimeType, data}` — mesma implementação serve texto, áudio e imagem, sem duplicar `callGemini`/`parseExpenseResponse`. `text` pode ser `null` (áudio nunca tem legenda; foto pode ter).
- `Code.js`: `handleExpenseMedia_(chatId, fromId, fileId, mimeType, origem, origemDisplay, caption)` é o handler único pra áudio e foto — baixa o arquivo (`telegram.downloadFile`), chama `ai.parseExpenses` (ver abaixo) com a mídia, e reaproveita `formatDraftFields_`/`buildConfirmationKeyboard` do fluxo de texto (T014/T017) sem duplicação.
- Também adicionado (fora do escopo original das Fases 4/5, a pedido do usuário durante os testes manuais): campo `registro_cartao` no `ExpenseDraft` — a IA tenta extrair a forma de pagamento (PIX, cartão, dinheiro) quando mencionada/visível no comprovante; grava na coluna "Registro no cartão" da aba Lançamento só quando reconhecida (nunca escreve string vazia por cima de uma célula).

**Extensão pedida pelo usuário durante os testes manuais — extração em lote (várias despesas por mensagem):** o `contracts.md` original modela `ExpenseDraft` como sempre singular (uma despesa por mensagem). O usuário pediu que uma imagem só (ex: print do histórico da Carteira Google com várias transações) já insira todos os lançamentos, sem precisar mandar um print por despesa. Como isso colide em cheio com FR-005 ("só grava após confirmação explícita") se feito sem nenhuma confirmação, a decisão (validada com o usuário) foi: **resumo em lista + um único botão "Confirmar todos (N)"** — mantém FR-005 de pé (nada grava sem o usuário ver e confirmar) com fricção mínima (1 toque, não N).
- `ai.js`: novo trio `buildBatchPrompt`/`parseExpenseListResponse`/`parseExpenses`, espelhando `buildPrompt`/`parseExpenseResponse`/`parseExpense` mas pedindo/parseando uma **lista** JSON em vez de um objeto único; compartilha `callGemini` e o normalizador de item (`normalizeExpenseItem_`). Itens malformados na lista são descartados individualmente (não invalidam o lote inteiro).
- `Code.js`: `handleExpenseMedia_` (áudio e foto) sempre usa `ai.parseExpenses` (lote) — um comprovante com uma despesa só vira uma lista de tamanho 1, tratada com a mesma UI (sem duplicar um caminho "singular" e outro "lote").
- `state.savePendingDraft`/`getPendingDraft` não precisaram mudar — já armazenam qualquer valor serializável em JSON, então guardam tanto um draft único quanto uma lista deles sob o mesmo token. `handleConfirmCallback_` detecta `Array.isArray(draft)` pra decidir entre um `appendLancamento` só ou um por item da lista.
- **Texto continua sempre singular** (`ai.parseExpense`, não `parseExpenses`) — mensagens digitadas praticamente sempre descrevem uma despesa só, e trocar a UX de confirmação já validada do texto não trazia benefício.
- **Ajuste feito depois do primeiro teste real**: a regra original ("qualquer item incerto bloqueia a confirmação do lote inteiro, pede reformulação") virou um beco sem saída na prática — não existe como corrigir só parte de uma lista por texto (o texto sempre cai no fluxo singular). Mudado para: **item único** incerto ainda bloqueia e pede reformulação (igual ao texto, FR-012); **lote** (>1 item) com algum item incerto **sempre oferece "Confirmar todos"** mesmo assim, com os incertos marcados ⚠️ no resumo — mais fácil corrigir categoria/data errada depois direto na planilha do que travar o lote inteiro.
- **Confiabilidade do parsing**: trocado o "responda como uma lista JSON" (só instrução em texto) por `generationConfig.responseSchema` (structured output da API do Gemini) — força o formato exato da resposta (array vs. objeto, tipos de cada campo) na própria API, em vez de confiar que o modelo obedeça a instrução em prosa. Isso resolveu um caso real em que o Gemini aparentemente não devolvia um array puro e o lote inteiro era descartado como "nenhuma despesa encontrada".
- **`ai.callGemini` agora lança erro (não retorna `null`) em qualquer HTTP 4xx/5xx não-retriável**, com o status e o corpo da resposta — e `Code.js` repassa esse erro pro dono via Telegram (já existia esse mecanismo para exceções em geral). Isso trocou mensagens genéricas e não-diagnosticáveis por algo acionável. Encontrado ao vivo assim: erro real era HTTP 503 do Gemini ("This model is currently experiencing high demand... Please try again later"), não limite de cota como se suspeitava a princípio — sem essa mudança, teria sido muito mais difícil de diagnosticar sem acesso ao Cloud Logging.
- **Retry automático com backoff só para 503** (`GEMINI_MAX_RETRIES = 2`) — implementado depois de ver esse 503 ao vivo, já que o próprio Gemini recomenda tentar de novo para esse tipo de erro (sobrecarga momentânea do modelo). Isso adianta o T032 (Final Phase) para o caminho mais crítico (erro HTTP), embora mensagens amigáveis por tipo específico de erro ainda não tenham sido feitas.
- **Fallback automático de modelo, generalizado para qualquer falha definitiva** (não só cota): o primeiro caso encontrado ao vivo foi um **429 de cota**: `"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier", "quotaValue": "20"` — o modelo que `gemini-flash-latest` resolve hoje (`gemini-3.8-flash`, lançado recentemente) tem uma cota de estreia no tier gratuito de só **20 requisições/dia**, bem abaixo do documentado nos Riscos da arquitetura (250-1500/dia). Logo em seguida apareceu também um **503 persistente** (sobrecarga do modelo que não se resolveu nem depois das retentativas). Como os dois casos pedem a mesma solução (modelo diferente = cota e capacidade isoladas), a lógica final ficou simples: `GEMINI_MODEL` (`gemini-flash-latest`) é sempre tentado primeiro (com suas próprias retentativas pra 503); se ele falhar de vez por **qualquer** motivo, `GEMINI_FALLBACK_MODEL` (`gemini-3.5-flash`, uma versão mais madura) é tentado uma vez antes de desistir de verdade. Vale reavaliar `GEMINI_FALLBACK_MODEL` periodicamente (mesmo raciocínio do `gemini-flash-latest`: evitar ficar preso numa versão que será descontinuada).
- **Validado ao vivo, com sucesso completo, no dia seguinte (2026-09-03)**: print real do usuário (Carteira Google, 7 transações) → resumo em lote com 3 itens marcados ⚠️ (2 por categoria ambígua da Amazon, 1 por uma linha cortada no rodapé do print sem data visível) → "Confirmar todos" gravou as 7 linhas certas na aba "Lançamento", com "Mês" intocado (preenchido pela fórmula) e categorias corretas. Fecha o critério de sucesso definido pelo usuário para esta extensão: mandar só a imagem e o bot lançar todas as despesas pagas nela.
- T019/T024 (spike e teste manual real com notas de voz) ainda ficam por conta do usuário — o código está publicado (Versão 17) e pronto. T028 (foto) já foi validado com print digital; falta só nota fiscal física em papel, se o usuário quiser cobrir esse caso.

## Phase 6: Instância isolada e onboarding — US-005 / US-006 ⏳ (~3h)
**Goal**: uma nova pessoa publica sua própria instância isolada seguindo só o tutorial, sem ajuda técnica direta, com isolamento confirmado.
**Independent Test**: publicar uma segunda instância completa (planilha/bot/chave separados) só seguindo `docs/setup-tutorial.md`.

### Tasks
- [x] T029 [US-006] Escrever `docs/setup-tutorial.md` cobrindo os 7 passos da Decision 5 (copiar planilha, criar bot no BotFather, criar chave Gemini, configurar Propriedades do Script, publicar Web App, chamar `setWebhook`, mandar `/start`) com capturas de tela — **texto completo pronto**; capturas de tela não incluídas (sem acesso pra gerar screenshots reais da UI do Google/Telegram) — pendente adicionar depois, se quiser
- [ ] T030 [US-005] Dry-run completo: publicar uma segunda instância de teste seguindo o tutorial à risca, sem atalhos de quem já conhece o código; anotar qualquer passo confuso — `docs/setup-tutorial.md` (ajustes)
- [ ] T031 [US-005] Verificar isolamento: confirmar que a conta Google original não tem acesso à segunda planilha, e que mensagens ao segundo bot vindas do Telegram do usuário original são recusadas (dono já é outra pessoa) — validação manual

**Checkpoint**: ✋ Uma segunda pessoa consegue se configurar sozinha, com isolamento confirmado

## Final Phase: Polish ⏳ (~2h)
- [ ] T032 [P] Tratamento de erro/rate-limit da API do Gemini em `ai.callGemini` (HTTP 4xx/5xx → mensagem amigável, sem quebrar o fluxo) — `src/ai.js`
- [ ] T033 [P] Adicionar `Logger.log` nos pontos-chave (update recebido, decisão de dono, chamada ao Gemini, gravação na planilha) para depuração via log de execuções do Apps Script — `src/Code.js`
- [ ] T034 [P] Escrever `README.md` na raiz do repositório com visão geral do projeto e links para `specs/bot-despesas-telegram/` e `docs/setup-tutorial.md` — `README.md`
- [ ] T035 Revisar os Success Criteria do spec (SC-001 a SC-004) contra o comportamento observado nos testes manuais e registrar o resultado nas Notas de progresso deste plano — `specs/bot-despesas-telegram/plan.md`

## Dependencies & Execution Order

```
Phase 1 (Setup) ──> Phase 2 (Foundational) ──> Phase 3 (US-001/004/007, MVP)
                                                      │
                                    ┌─────────────────┼─────────────────┐
                                    ▼                                   ▼
                        Phase 4 (US-002, áudio)             Phase 5 (US-003, foto)
                                    │                                   │
                                    └─────────────────┬─────────────────┘
                                                       ▼
                                        Phase 6 (US-005/006, onboarding)
                                                       │
                                                       ▼
                                              Final Phase (Polish)
```

- **Phase 1 e 2 são estritamente sequenciais** e bloqueiam tudo o resto — sem `config.js`/`Code.js`/`telegram.js`/`state.js` básicos, nenhuma story tem onde pendurar sua lógica.
- **Phase 3 é o MVP** e bloqueia as Phases 4 e 5, pois ambas reaproveitam o fluxo de confirmação (`state.js`, teclado inline, handler de `callback_query`) construído ali.
- **Phases 4 e 5 são independentes entre si** — podem ser feitas em qualquer ordem, ou em paralelo por duas pessoas, já que uma mexe no caminho de áudio e a outra no de imagem, ambas só estendendo `ai.parseExpense` e adicionando um novo `if` de roteamento em `Code.js` (risco baixo de conflito, mas o mesmo arquivo `Code.js` é tocado por ambas — coordenar a ordem dos merges).
- **Phase 6 depende logicamente de Phase 3** funcionar de ponta a ponta (é o que a segunda pessoa vai testar), mas não depende tecnicamente de Phase 4/5 — dá para fazer o dry-run de onboarding só com lançamento por texto funcionando, adiando áudio/foto.
- **Polish** só faz sentido depois de todas as stories terem passado por pelo menos um teste manual.

Dentro de cada phase, tarefas marcadas `[P]` tocam arquivos diferentes sem dependência lógica entre si e podem ser feitas em qualquer ordem (ou em paralelo); as demais têm uma ordem real (geralmente teste-antes-da-implementação, ou uma função que só existe depois de outra).

## Implementation Strategy

**MVP primeiro**: Phases 1–3 entregam o valor central do projeto — lançar uma despesa por texto, com confirmação e categorização automática — e já são suficientes para o usuário original validar o conceito no dia a dia antes de investir em áudio/foto/onboarding de terceiros.

**Entrega incremental**: cada phase depois do MVP adiciona um canal de entrada (áudio, foto) ou a capacidade de repassar o sistema adiante (onboarding), sem exigir retrabalho nas anteriores — todas reaproveitam o mesmo `ai.parseExpense`/fluxo de confirmação.

**Pontos de atenção**: a Phase 4 tem uma dependência de risco real (formato de áudio do Telegram) — por isso começa com um spike manual (T019) antes de qualquer código, para não investir tempo de implementação numa direção que pode não funcionar.

## Progress Tracking

⏳ Not Started · ⏰ In Progress · ✅ Completed

- [x] Phase 1: Setup ✅
- [x] Phase 2: Foundational ✅
- [x] Phase 3: US-001/004/007 (MVP) ✅
- [ ] Phase 4: US-002 (áudio) ⏰ (código pronto, falta T024 — teste manual com notas de voz reais)
- [x] Phase 5: US-003 (foto) ✅ (validado com print digital + extração em lote; nota fiscal física opcional)
- [ ] Phase 6: US-005/006 (onboarding) ⏳
- [ ] Final Phase: Polish ⏳

### Notes
_(preencher ao longo da implementação — decisões tomadas, desvios do plano, resultado do spike de áudio, resultado do dry-run de onboarding, checagem final dos Success Criteria)_
