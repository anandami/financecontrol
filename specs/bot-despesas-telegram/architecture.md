# Architecture: Bot de Controle de Despesas via Telegram

**Feature**: bot-despesas-telegram **Date**: 2026-08-30 **Branch**: `bot-despesas-telegram` **Specs**: [spec.md](./spec.md)

## Summary

Um template de bot do Telegram, implementado inteiramente como um script do Google Apps Script vinculado a uma planilha (sem servidor próprio e sem backend compartilhado), recebe texto/áudio/foto descrevendo uma despesa, usa a API do Gemini para extrair os dados estruturados, pede confirmação via botões inline, e grava o lançamento confirmado na própria planilha. Cada pessoa — o usuário original incluído — publica sua **própria instância isolada**: sua própria cópia da planilha (com o script já junto, via "Arquivo > Fazer uma cópia"), seu próprio bot no Telegram (criado no BotFather) e sua própria chave de API do Gemini. Não existe nenhuma conta, credencial ou componente compartilhado entre instâncias — o que uma pessoa configura na sua cópia nunca dá acesso à cópia de outra.

## Technical Context

**Language/Stack**: JavaScript (Google Apps Script V8 runtime), gerenciado via [`clasp`](https://github.com/google/clasp) para manter o código versionado neste repositório.
**Key Dependencies**: Telegram Bot API (webhook), Gemini API (`generateContent`, multimodal), Google Sheets (via `SpreadsheetApp`, nativo do Apps Script).
**Storage**: A planilha Google Sheets de cada usuário é o único armazenamento persistente de dados de negócio. `PropertiesService` (Script Properties) guarda configuração durável (segredos, mapeamento usuário→planilha). `CacheService` guarda o rascunho de lançamento pendente de confirmação (efêmero, TTL curto).
**Testing**: Lógica pura (montagem de prompt, parsing/validação da resposta do Gemini, casamento de categoria) isolada em funções testáveis e cobertas com Jest rodando localmente (Node), com os serviços do Google mockados. Fluxo ponta a ponta validado manualmente com um bot de teste no Telegram apontando para uma implantação de desenvolvimento e uma cópia de planilha de teste.
**Platform**: 100% Google Apps Script Web App — sem servidor, sem banco de dados, sem conta de nuvem paga.

## Technical Decisions

### Decision 1: Hospedagem — Google Apps Script Web App, sem servidor próprio

**What**: Todo o backend é um único projeto Apps Script. O webhook do Telegram aponta para a URL de implantação do Web App (`doPost`), que roteia `message` e `callback_query`.

> **Correção pós-pesquisa (durante a implementação)**: `doPost(e)` do Apps Script **não expõe headers HTTP customizados** — é uma limitação deliberada do Google, confirmada oficialmente em 2023 por motivos de segurança. Isso invalida a ideia original de validar o header `X-Telegram-Bot-Api-Secret-Token` do Telegram. A mitigação equivalente, e a única viável no Apps Script, é embutir um segredo aleatório na própria **URL do webhook** como parâmetro de query (`.../exec?secret=<valor>`), configurado uma única vez ao chamar `setWebhook`, e validar `e.parameter.secret` dentro do `doPost` — ver Decision 7 e a versão corrigida da tabela de Riscos.
**Why**: Custo zero dentro das cotas gratuitas para o volume esperado (uso pessoal + poucas amigas), acesso nativo à planilha via `SpreadsheetApp` sem precisar de conta de serviço/OAuth, e nenhuma infraestrutura para manter — alinhado à prioridade máxima do projeto (custo mínimo).
**Alternatives Considered**:
- Servidor Node/Python em Render/Fly/Cloud Run (free tier) + conta de serviço do Google para acessar as planilhas: mais fácil de testar localmente e sem os limites de execução do Apps Script, mas exige configurar uma conta de serviço com acesso às planilhas de cada pessoa, um pipeline de deploy, e os free tiers desses provedores costumam hibernar ou ter teto mensal.
- Google Cloud Functions (Gen2): cobrança por uso com free tier generoso, mas ainda exige conta de serviço, `gcloud` para deploy e mais peças móveis do que o Apps Script para esta escala.
**Trade-offs**: Apps Script tem cotas (20.000 chamadas `UrlFetchApp`/dia em conta pessoal @gmail, execução máxima de 6 min, 30 execuções simultâneas), depuração mais limitada (logs básicos do Stackdriver) e nenhum test runner nativo. Aceitável para o volume de uso previsto (uma pessoa + poucas amigas, uso esporádico ao longo do dia).

### Decision 2: Isolamento total — script vinculado à planilha (container-bound), uma instância por pessoa, sem backend compartilhado

**What**: O script Apps Script é **vinculado diretamente à planilha** de cada pessoa (container-bound, criado via "Extensões > Apps Script" dentro da própria planilha), em vez de um projeto único e centralizado. Quando alguém faz "Arquivo > Fazer uma cópia" da planilha-modelo, o Google copia a planilha **e o script junto**, automaticamente. Cada pessoa então: cria seu próprio bot no Telegram (via BotFather, gratuito), cria sua própria chave de API do Gemini (gratuita, via Google AI Studio), preenche essas duas credenciais nas Propriedades do Script da sua cópia, e implanta seu próprio Web App (rodando sob a identidade Google *dela*, acessando só a planilha *dela* via `SpreadsheetApp.getActiveSpreadsheet()`). Não existe um `sheet_id` para resolver nem um mapeamento usuário→planilha: cada instância só conhece a única planilha à qual está fisicamente vinculada.
**Why**: É a única forma de garantir isolamento real: não há nenhuma conta, token ou banco de credenciais central que, se comprometido, exponha dados de mais de uma pessoa. Cada instância vive inteiramente dentro da conta Google da própria pessoa — inclusive a instância do usuário original segue o mesmo modelo, sem tratamento especial.
**Alternatives Considered**:
- (Descartada) Backend único com "Executar como: Eu" e planilhas compartilhadas com a conta do desenvolvedor — rejeitada explicitamente: concentra acesso de edição de todas as planilhas numa única conta.
- OAuth2 por usuário com um backend/bot único, usando o escopo restrito `drive.file` (o app só acessa o arquivo que a pessoa autorizou explicitamente) — reduziria a fricção de onboarding (um só bot, uma só chave de Gemini para todo mundo), mas ainda mantém um backend central guardando os tokens de todas as pessoas sob controle do usuário original; um comprometimento desse backend ainda afetaria todo o grupo, o que viola o requisito de isolamento total.
**Trade-offs**: Onboarding fica mais trabalhoso — cada pessoa precisa criar seu próprio bot (BotFather) e sua própria chave Gemini, além de copiar a planilha e publicar o Web App. Em compensação, não existe nenhum ponto único de falha compartilhado: um problema afeta, no máximo, a própria pessoa. O custo continua zero — bot do Telegram, Apps Script e o tier gratuito do Gemini são gratuitos por conta individual (e, como bônus, cada pessoa passa a ter sua própria cota gratuita do Gemini, sem disputar limite com as demais).

### Decision 3: IA — um único modelo multimodal (Gemini Flash) para texto, áudio e imagem

**What**: Uma chamada ao `generateContent` do Gemini (via `UrlFetchApp`, chave em Script Properties) processa texto puro, bytes de áudio (base64) ou bytes de imagem (base64), sempre com a lista de categorias já existentes da planilha do usuário incluída no prompt, retornando JSON estrito: `{valor, categoria, descricao, data, precisa_revisao}`.
**Why**: Um único provedor/API em vez de combinar serviços separados de transcrição, OCR e NLP — muito menos integração e uma só linha de custo. O tier gratuito do Gemini Flash cobre o volume pessoal esperado; mesmo excedendo, o preço pago do Flash é frações de centavo por requisição.
**Alternatives Considered**: OpenAI Whisper (áudio) + GPT-4o-mini (texto) + uma API de visão para OCR — mais superfícies de integração, sem ganho claro de custo. Google Cloud Speech-to-Text + Cloud Vision — APIs pagas por uso que exigem conta de faturamento própria, sem o tier gratuito que o Gemini Flash oferece via chave de API do AI Studio.
**Trade-offs / Risco**: Notas de voz do Telegram são OGG/Opus. O Gemini lista OGG como formato de áudio suportado para entendimento de áudio, mas isso ainda não foi validado ponta a ponta com um arquivo real do Telegram, e ao menos uma superfície da API do Gemini (Embeddings, não usada aqui) rejeita OGG/Opus especificamente — ver mitigação na tabela de riscos. Os limites exatos do tier gratuito do Gemini variam entre fontes (relatos de 1.500 requisições/dia vs. 250/dia com 10/min); ver mitigação na tabela de riscos.

### Decision 4: Fluxo de confirmação — teclado inline do Telegram + `CacheService` para o rascunho pendente

**What**: Após interpretar a mensagem, o bot envia o rascunho do lançamento com botões inline (✅ Confirmar / ✏️ Corrigir / ❌ Cancelar). O rascunho é salvo no `CacheService` (TTL de 15 min) sob um token curto e aleatório; o `callback_data` do botão carrega apenas esse token (o limite do Telegram é 64 bytes). Ao confirmar, o rascunho é lido do cache e gravado na planilha; ao corrigir, o bot pede a mensagem corrigida; se expirar, o bot avisa que precisa reenviar.
**Why**: FR-005 exige confirmação explícita antes de gravar. Botões inline evitam a ambiguidade de interpretar respostas livres como "sim"/"ok", e dão uma UX mais clara. `CacheService` é o lugar natural e gratuito do Apps Script para estado efêmero por conversa (diferente do `PropertiesService`, reservado à configuração durável).
**Alternatives Considered**: Confirmação por texto livre ("responda SIM") — mais simples de implementar, mas reintroduz o mesmo problema de ambiguidade de linguagem natural que a confirmação deveria resolver.
**Trade-offs**: Entradas do `CacheService` expiram (máx. 6h) — aceitável, pois a confirmação é esperada em minutos; se expirar, o usuário só reenvia a mensagem original.

### Decision 5: Onboarding — tutorial autoguiado de "implante sua própria instância", sem comando de registro em bot nenhum

**What**: Não existe um comando `/setup` que registra alguém num sistema central — porque não existe sistema central. O tutorial (`docs/setup-tutorial.md`) guia cada pessoa por: (1) abrir o link da planilha-modelo e fazer "Arquivo > Fazer uma cópia" (o script já vem junto, por estar vinculado à planilha); (2) criar um bot no Telegram via [@BotFather](https://t.me/BotFather) e copiar o token gerado; (3) criar uma chave de API gratuita no Google AI Studio; (4) abrir "Extensões > Apps Script" na sua cópia, colar as duas credenciais nas Propriedades do Script (`TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`) e gerar um `TELEGRAM_WEBHOOK_SECRET` (qualquer string aleatória); (5) publicar via "Implantar > Nova implantação > Web app" (executar como "Eu", acesso "Qualquer pessoa") e copiar a URL gerada; (6) chamar uma vez a API `setWebhook` do Telegram (visitando uma URL no navegador) apontando para essa URL **com o segredo anexado como parâmetro de query** (`?secret=<TELEGRAM_WEBHOOK_SECRET>`, ver Decision 7 — o Apps Script não suporta o `secret_token` nativo do Telegram, que viria por header); (7) mandar `/start` para o próprio bot — a primeira mensagem recebida registra automaticamente o remetente como dono exclusivo daquela instância (ver FR-015), sem precisar informar ID nenhum manualmente.
**Why**: Segue o modelo que o usuário já descreveu (repassar a planilha para as amigas copiarem) e satisfaz o isolamento total: cada passo acontece inteiramente dentro da conta Google e do Telegram da própria pessoa, sem nenhum contato com uma conta ou serviço do usuário original. Não precisa de site, formulário ou backend adicional — mantendo o custo em zero.
**Alternatives Considered**: Comando `/setup <link>` num bot central (proposta original) — descartado junto com a Decision 2, pois pressupunha um backend compartilhado. Formulário web externo para orquestrar a cópia — exigiria hospedagem própria, sem benefício real dado que os passos (2)-(6) já são nativos do Google/Telegram.
**Trade-offs**: Mais passos manuais para quem não é técnico (comparado a um único comando `/setup`); mitigado com um tutorial detalhado, passo a passo, com prints de tela — o usuário original pode inclusive acompanhar a primeira amiga ao vivo na primeira vez.

### Decision 6: Colunas resolvidas por nome de cabeçalho, não por posição fixa

**What**: Sempre que possível, `sheets.js` localiza colunas lendo a primeira linha (cabeçalhos) de cada aba e casando pelo nome (ex: "Data", "Valor", "Descrição"), em vez de hardcodar letras de coluna. A única exceção é a lista de categorias em Despesas, que o usuário confirmou estar na coluna C.
**Why**: A estrutura exata de colunas de cada aba só será confirmada quando o acesso real à planilha for concedido (ver Notas do spec). Resolver por nome de cabeçalho torna o bot resiliente a pequenas diferenças entre a planilha original e cada cópia, e elimina a necessidade de travar esse detalhe antes da implementação.
**Alternatives Considered**: Hardcodar letras de coluna após inspecionar a planilha real — mais simples de escrever, porém frágil a qualquer edição futura de estrutura e exigiria acesso já concedido para nem começar a implementação.
**Trade-offs**: Levemente mais lógica (ler cabeçalho, montar mapa nome→índice) do que acessar por letra fixa; custo desprezível dado o volume de chamadas.

### Decision 7: Autenticação do webhook — segredo na URL de query, não no header

**What**: Como `doPost(e)` do Apps Script não expõe headers customizados (ver correção na Decision 1), o `TELEGRAM_WEBHOOK_SECRET` é embutido como parâmetro de query na própria URL registrada via `setWebhook` (ex: `https://script.google.com/macros/s/<deploymentId>/exec?secret=<valor>`). Toda chamada a `doPost` valida `e.parameter.secret` contra o valor esperado (lido de `config.getWebhookSecret()`) antes de processar qualquer coisa; se não bater, responde e não processa o corpo.
**Why**: É a única forma prática de autenticar a origem da requisição dentro das limitações reais do Apps Script — `e.parameter` (query string) é o único canal de "metadado fora do corpo" que o `doPost` expõe. Mantém o mesmo objetivo de segurança da ideia original (impedir que requisições forjadas acionem gravações na planilha) sem depender de um recurso que o Apps Script não suporta.
**Alternatives Considered**: Usar o `secret_token` nativo do `setWebhook` do Telegram (via header) — tecnicamente inviável no Apps Script, como descoberto durante a implementação. Validar só pela URL de implantação em si (sem segredo adicional) — a URL do Web App já é difícil de adivinhar, mas não é secreta por design (pode vazar em logs, prints, etc.); um segredo explícito e rotacionável é mais robusto e não custa nada a mais.
**Trade-offs**: Um segredo em query string é, em teoria, mais sujeito a aparecer em logs de acesso do que um header — mas como quem faz a chamada é sempre o servidor do Telegram (requisição servidor-a-servidor via `setWebhook`, nunca um navegador), o risco prático de vazamento por histórico de navegador/Referer não se aplica aqui. Se o segredo precisar ser trocado, basta chamar `setWebhook` de novo com uma nova URL.

## Architecture Overview

Hoje, o usuário registra cada despesa manualmente, abrindo a planilha e digitando a linha. Depois desta feature, o fluxo passa a ser: a pessoa (dona daquela instância) manda uma mensagem ao seu próprio bot no Telegram → o Web App vinculado à sua planilha recebe o update via webhook → confirma que o remetente é o dono registrado → chama o Gemini (com a chave de API dela) para extrair os dados da despesa (do texto, áudio transcrito, ou imagem) → guarda o rascunho no cache e responde no chat pedindo confirmação com botões → ao confirmar, grava a linha na aba de lançamentos da própria planilha e responde confirmando. Uma nova pessoa entra no sistema copiando a planilha-modelo (que já traz o script junto) e seguindo o tutorial de publicação da própria instância uma única vez.

### Component Structure

**New Files/Modules** (projeto Apps Script gerenciado via `clasp`, dentro deste repositório — é o **template-fonte**; cada pessoa publica sua própria cópia, não um deploy compartilhado):

- `src/appsscript.json` — manifesto do Apps Script (fuso horário, config do Web App, escopos).
- `src/Code.js` — ponto de entrada `doPost`; valida o `secret_token` do Telegram; verifica se o remetente é o dono registrado (ou registra o primeiro remetente como dono); roteia `message` (texto/áudio/foto) e `callback_query` (confirmação).
- `src/telegram.js` — wrapper da API do Telegram: `sendMessage` (com teclado inline), `editMessageText`, `answerCallbackQuery`, `getFile`/download de mídia.
- `src/ai.js` — wrapper do Gemini: monta o prompt (incluindo categorias conhecidas), envia texto/áudio/imagem, valida e faz parse da resposta JSON.
- `src/sheets.js` — acesso à planilha vinculada (`SpreadsheetApp.getActiveSpreadsheet()`, sem ID nenhum para resolver): `getCategories()`, `appendLancamento(draft)`, resolução de colunas por cabeçalho (Decision 6).
- `src/state.js` — helpers do `CacheService`: `savePendingDraft`, `getPendingDraft`, `clearPendingDraft`.
- `src/config.js` — acesso a segredos/config via `PropertiesService` (`TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`, `OWNER_TELEGRAM_ID`).
- `tests/ai.test.js`, `tests/sheets.test.js` — testes Jest da lógica pura, com `SpreadsheetApp`/`UrlFetchApp`/`PropertiesService`/`CacheService` mockados.
- `docs/setup-tutorial.md` — tutorial passo a passo de "implante sua própria instância" (US-006, Decision 5).

**Modified Files**: nenhum — projeto novo (greenfield), sem código existente no repositório.

### Component Relationships

`Code.js` é o único ponto de entrada e orquestra os demais módulos: recebe o update do Telegram, valida o dono via `config.js`, usa `sheets.js` para ler categorias e gravar o lançamento na própria planilha vinculada, usa `ai.js` para interpretar a mensagem, usa `state.js` para guardar/recuperar o rascunho pendente, e usa `telegram.js` para toda comunicação de volta ao usuário. Não há módulo de onboarding dentro do código — a configuração inicial (credenciais, dono) acontece via Propriedades do Script e a primeira mensagem enviada, conforme o tutorial.

### Data Flow

**Lançamento por texto/áudio/imagem (US-001/002/003/007)**:
`Telegram (message)` → `Code.js: doPost` → valida dono (`config.isOwner(fromId)`) → `sheets.getCategories()` → `ai.parseExpense(conteúdo, categorias)` → `state.savePendingDraft(token, draft)` → `telegram.sendMessage` (resumo + botões) → *(usuário toca em Confirmar)* → `Telegram (callback_query)` → `Code.js: doPost` → `state.getPendingDraft(token)` → `sheets.appendLancamento(draft)` → `telegram.answerCallbackQuery` + `telegram.editMessageText` (confirmado).

**Registro do dono (primeira mensagem, parte do onboarding — US-005/006)**:
`Telegram (message)` → `Code.js: doPost` → `config.getOwnerId()` retorna vazio → `config.setOwnerId(fromId)` → `telegram.sendMessage` ("Bot configurado para você.") → mensagens seguintes de outros remetentes são recusadas por `config.isOwner`.

## Implementation Approach

### User Story Mapping

**US-001: Lançamento por texto** — Arquivos: `Code.js`, `ai.js`, `sheets.js`, `state.js`, `telegram.js`. Testes: unitário de montagem/parse do prompt em `ai.test.js`; manual enviando mensagens reais a um bot de desenvolvimento.

**US-002: Lançamento por áudio** — Arquivos: `Code.js` (download via `telegram.getFile`), `ai.js` (`parseExpense` com bytes de áudio). Testes: teste manual exploratório (spike) com notas de voz reais do Telegram *antes* de finalizar o restante do fluxo, dado o risco de formato OGG/Opus (ver Riscos).

**US-003: Lançamento por print/foto** — Arquivos: `Code.js` (download da foto), `ai.js` (`parseExpense` com bytes de imagem). Testes: manual com print de confirmação de pagamento e com foto de nota fiscal física.

**US-004: Confirmação antes de gravar** — Arquivos: `state.js`, `telegram.js` (teclado inline, `callback_query`), `Code.js` (roteamento). Testes: manual, cobrindo confirmar, corrigir, cancelar e expiração do cache.

**US-005/US-006: Instância isolada e onboarding** — Arquivos: `config.js` (registro do dono, credenciais próprias), `docs/setup-tutorial.md` (passo a passo de cópia + bot próprio + chave própria + publicação). Testes: manual, publicando uma segunda instância completa (planilha, bot e chave de API separados) simulando uma amiga, confirmando que uma instância não enxerga nada da outra.

**US-007: Categorização automática** — Arquivos: `sheets.getCategories` (leitura de Despesas!C), `ai.js` (categorias no prompt). Testes: unitário garantindo que a categoria retornada sempre pertence à lista lida da planilha (ou `SEM_CATEGORIA` quando não há correspondência).

## Integration Points

- **Telegram Bot API**: cada instância recebe updates via webhook do seu próprio bot (`setWebhook` apontando para a URL de implantação da sua cópia do Web App); envia respostas via `sendMessage`/`editMessageText`/`answerCallbackQuery`; baixa mídia via `getFile`.
- **Gemini API** (`generateContent`): chamado via `UrlFetchApp`, com a chave de API da própria pessoa, entrada multimodal (texto/áudio/imagem inline em base64), saída JSON estruturada.
- **Google Sheets**: acessado nativamente via `SpreadsheetApp.getActiveSpreadsheet()` — o script está fisicamente vinculado à planilha da própria pessoa, sem precisar de ID, API externa ou permissão de terceiros.
- **Nenhum banco de dados externo, nenhum backend compartilhado**: `PropertiesService` (config durável, local a cada instância) e `CacheService` (estado efêmero, local a cada instância) cobrem toda a necessidade de estado do sistema.

## Technical Constraints

- Cotas do Apps Script (conta pessoal @gmail, aplicadas por instância/conta individual): 20.000 chamadas `UrlFetchApp`/dia, execução máxima de 6 minutos por invocação, até 30 execuções simultâneas.
- Limite de 64 bytes no `callback_data` dos botões do Telegram — por isso o cache guarda o rascunho e o botão carrega só um token.
- `CacheService` do Apps Script: TTL máximo de 6 horas.
- Tier gratuito do Gemini Flash (por conta individual, já que cada pessoa usa sua própria chave): limites relatados de forma inconsistente entre fontes (1.500 req/dia em algumas, 250 req/dia com 10/min em outras) — a confirmar com a chave de API real na implementação.
- Sem test runner nativo no editor do Apps Script — testes de lógica pura rodam localmente via Jest fora do runtime do Apps Script.
- "Fazer uma cópia" de uma planilha do Google preserva o script vinculado a ela — é o mecanismo que torna a distribuição do template possível sem `clasp`/Git para quem só vai usar o bot (só o mantenedor do template precisa do repositório).

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Notas de voz OGG/Opus do Telegram não serem bem aceitas/transcritas pelo Gemini | US-002 (lançamento por áudio) quebrado | Fazer um teste exploratório cedo, com notas de voz reais, antes de construir o restante do fluxo de áudio; ter como alternativa uma API de STT dedicada (ex: OpenAI Whisper) que suporta OGG explicitamente, caso o Gemini não performe bem |
| Onboarding manual (BotFather + chave Gemini + publicar Web App) é mais longo do que um comando único, e pode intimidar alguém não-técnico | Amigas desistem do setup antes de terminar, ou pedem ajuda constante | Tutorial passo a passo com prints de tela para cada etapa; usuário original acompanha a primeira execução ao vivo com a primeira amiga antes de repassar o link para as demais |
| Cotas gratuitas do Apps Script/Gemini (por conta individual) | Bot de uma instância específica para de responder se excedido | Volume esperado por pessoa (uso pessoal) fica bem abaixo da cota; como cada instância tem sua própria cota, o problema nunca se propaga entre pessoas |
| Endpoint do webhook é publicamente acessível (exigência do Apps Script Web App: acesso "Qualquer pessoa") | Requisições falsas poderiam tentar acionar gravações na planilha | Validar o segredo embutido na query string da URL (`e.parameter.secret`) em toda requisição antes de processar — ver Decision 7 (o header nativo do Telegram não é acessível no Apps Script) |
| Alguém descobre o nome de usuário do bot de outra pessoa no Telegram e manda mensagem para ele | Tentativa de criar lançamentos falsos na planilha de outra pessoa | `config.isOwner` (FR-015) recusa qualquer remetente diferente do dono registrado na primeira mensagem |

## Open Questions

Nenhuma. A estrutura exata de colunas de cada aba (pendente de acesso real à planilha) foi endereçada pela Decision 6 (resolução por nome de cabeçalho), então não bloqueia o início da implementação — o acesso real só é necessário para os testes manuais de ponta a ponta.

## Next Steps

1. Revisar esta arquitetura.
2. Testar localmente com a planilha real do usuário original (a própria pessoa já tem acesso a ela — não é preciso compartilhar com mais ninguém).
3. Rodar `/codeadvisor-dev:plan`.
