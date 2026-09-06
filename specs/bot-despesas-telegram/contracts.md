# Contracts: Bot de Controle de Despesas via Telegram

## Data Models

### ExpenseDraft

**Purpose**: Representa uma despesa interpretada pelo Gemini, ainda não confirmada pelo usuário. Vive no `CacheService`, indexado por um token curto.

**Attributes**:
| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `valor` | number | sim | Valor da despesa em Reais (BRL), positivo |
| `categoria` | string | sim | Uma das categorias existentes na aba Despesas do usuário, ou `"SEM_CATEGORIA"` se nenhuma correspondência razoável foi encontrada |
| `descricao` | string | sim | Descrição curta da despesa (ex: "faxina", "mercado") |
| `data` | string (`YYYY-MM-DD`) | sim | Data da despesa; default = data do envio da mensagem se não informada |
| `precisa_revisao` | boolean | sim | `true` quando o modelo tem baixa confiança em algum campo (ex: valor ambíguo, categoria sem correspondência) |
| `origem` | string (`"texto"` \| `"audio"` \| `"imagem"`) | sim | Canal de onde veio o lançamento, útil para depuração |
| `telegram_user_id` | number | sim | ID do usuário do Telegram que enviou a mensagem (deve ser igual ao dono registrado da instância) |

Não há campo de planilha de destino: cada instância está vinculada a exatamente uma planilha (`SpreadsheetApp.getActiveSpreadsheet()`), então não existe ambiguidade a resolver.

**Example JSON**:
```json
{
  "valor": 100.0,
  "categoria": "Serviços domésticos",
  "descricao": "faxina",
  "data": "2026-08-30",
  "precisa_revisao": false,
  "origem": "texto",
  "telegram_user_id": 123456789
}
```

## Integration Contracts

### Telegram Bot API — updates recebidos (`doPost`)

**Update tipo `message` (texto)**:
```json
{
  "update_id": 123,
  "message": {
    "message_id": 1,
    "from": { "id": 123456789 },
    "chat": { "id": 123456789 },
    "date": 1756540800,
    "text": "paguei 100 reais de faxina"
  }
}
```

**Update tipo `message` (áudio/voice)**: mesma forma, com `message.voice.file_id` (formato OGG/Opus) em vez de `text`. O bot chama `getFile(file_id)` para obter a URL de download antes de enviar ao Gemini.

**Update tipo `message` (foto)**: `message.photo` é um array de tamanhos; o bot usa a maior resolução disponível (`photo[photo.length - 1].file_id`).

**Update tipo `callback_query`** (confirmação):
```json
{
  "update_id": 124,
  "callback_query": {
    "id": "abc",
    "from": { "id": 123456789 },
    "message": { "message_id": 2, "chat": { "id": 123456789 } },
    "data": "confirm:tok_ab12cd"
  }
}
```
`data` segue o formato `<ação>:<token>`, onde `<ação>` é `confirm`, `edit` ou `cancel`, e `<token>` referencia o rascunho salvo no `CacheService`.

**Validação obrigatória**: `doPost(e)` do Apps Script não expõe headers HTTP customizados (limitação confirmada do runtime — ver Decision 7 da arquitetura), então o segredo trafega como parâmetro de query na própria URL do webhook (`?secret=<valor>`), configurado uma vez no `setWebhook`. Todo `doPost` DEVE verificar `e.parameter.secret` contra o valor configurado em `PropertiesService` (`TELEGRAM_WEBHOOK_SECRET`) antes de processar qualquer update.

**Nota sobre código de status**: o Apps Script também não permite definir o código de status HTTP da resposta — toda resposta de um Web App volta como HTTP 200, independente do resultado. Requisições sem o segredo correto **não são processadas** (nada é lido do update, nada é gravado na planilha), mas a resposta ainda é um 200 genérico, já que não há outra opção no runtime. Isso não enfraquece a proteção: o que impede a ação indevida é não processar o conteúdo, não o código de status devolvido.

### Gemini API (`generateContent`) — contrato de prompt e resposta

**Request** (resumo — via `UrlFetchApp`, `POST` para o endpoint `generateContent` do modelo Flash, chave em query string):
```json
{
  "contents": [{
    "parts": [
      { "text": "Extraia os dados da despesa descrita. Categorias válidas: [\"Mercado\", \"Transporte\", \"Serviços domésticos\", ...]. Responda em JSON estrito no formato {valor, categoria, descricao, data, precisa_revisao}. Se nenhuma categoria for uma correspondência razoável, use \"SEM_CATEGORIA\" e marque precisa_revisao=true." },
      { "text": "Mensagem do usuário: paguei 100 reais de faxina" }
    ]
  }],
  "generationConfig": { "responseMimeType": "application/json" }
}
```
Para áudio/imagem, uma `part` adicional do tipo `inline_data` carrega os bytes em base64 com o `mime_type` correspondente (`audio/ogg`, `image/jpeg`).

**Response (sucesso)**: corpo JSON do Gemini contendo o texto gerado, que por sua vez DEVE ser um JSON válido no formato de `ExpenseDraft` (sem os campos de controle `origem`/`telegram_user_id`, adicionados pelo bot depois). Se o parse do JSON falhar ou campos obrigatórios estiverem ausentes, o bot trata como falha de interpretação (ver FR-012) e pede para o usuário reformular.

**Response (erro/rate limit)**: HTTP 4xx/5xx do Gemini — o bot avisa o usuário que não conseguiu processar a mensagem no momento e sugere tentar novamente.

### Google Sheets — leitura de categorias e gravação de lançamento

**Leitura de categorias**: `sheets.getCategories()` opera sempre sobre `SpreadsheetApp.getActiveSpreadsheet()` (a planilha à qual o script está vinculado) e lê todos os valores não vazios da coluna C da aba "Despesas" (posição fixa, confirmada pelo usuário), ignorando a linha de cabeçalho.

**Gravação de lançamento**: `sheets.appendLancamento(draft)` localiza a aba de lançamentos na mesma planilha ativa, lê a linha de cabeçalho para montar um mapa nome→índice de coluna (Decision 6 da arquitetura), e usa `appendRow` preenchendo cada coluna reconhecida (Data, Valor, Categoria, Descrição) na posição correta. Colunas não reconhecidas ficam em branco na nova linha.

### Registro do dono da instância

**Primeira mensagem recebida** (qualquer `message`, incluindo `/start`): se `PropertiesService` não tem `OWNER_TELEGRAM_ID` definido, o `from.id` do remetente é gravado como dono e o bot confirma a configuração. Toda mensagem subsequente com `from.id` diferente do dono registrado é recusada com uma explicação, sem processar o conteúdo.

## State Transitions

```text
[Sem dono configurado] --primeira mensagem recebida--> [Dono registrado (OWNER_TELEGRAM_ID)]
[Mensagem de remetente != dono] --sempre--> [Recusada, sem processar]
[Mensagem recebida (dono)] --parse com sucesso (ai.parseExpense)--> [Rascunho pendente, aguardando confirmação]
[Rascunho pendente] --usuário toca "Confirmar"--> [Gravado na planilha]
[Rascunho pendente] --usuário toca "Corrigir"--> [Aguardando nova mensagem] --nova mensagem--> [Rascunho pendente] (novo token)
[Rascunho pendente] --usuário toca "Cancelar"--> [Descartado]
[Rascunho pendente] --TTL do cache expira (15 min)--> [Descartado, bot avisa se usuário tentar confirmar]
[Mensagem recebida (dono)] --parse falha ou baixa confiança (precisa_revisao=true)--> [Bot pede reformulação, nenhum rascunho salvo]
```
