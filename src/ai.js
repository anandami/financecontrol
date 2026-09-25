/**
 * Wrapper do Gemini: monta o prompt (incluindo as categorias já usadas pelo
 * dono), chama generateContent (chave própria da instância, via config.js) e
 * valida/faz o parse da resposta como ExpenseDraft. Nunca preenche
 * origem/telegram_user_id — esses campos de controle são adicionados por
 * Code.js, que sabe de onde veio a mensagem e quem mandou (Contracts).
 */

if (typeof require !== 'undefined') {
  var getGeminiApiKey = require('./config.js').getGeminiApiKey;
}

/**
 * Cadeia de modelos tentados em ordem até um responder. Cada modelo tem cota e
 * capacidade isoladas, então um 503 ("high demand") ou 429 (cota diária) num
 * deles não afeta o seguinte.
 *
 * - `gemini-flash-latest`: alias mantido pelo Google (aponta sempre pro Flash
 *   estável mais recente — fixar "gemini-2.5-flash" quebrou tudo quando ele foi
 *   descontinuado). Trade-off visto ao vivo: modelo recém-lançado pode vir com
 *   cota de estreia apertada (20 req/dia) e sobrecarga.
 * - `gemini-3.5-flash`: versão um pouco mais madura, mesma qualidade/formato.
 * - `gemini-3.5-flash-lite`: mais leve, cota separada; rápido (~1-2s nos
 *   testes ao vivo de 2026-09-24) e ainda aceita áudio e structured output.
 * - `gemma-4-26b-a4b-it` / `gemma-4-31b-it`: Gemma 4 servido pela mesma API e
 *   mesma chave, numa infraestrutura/cota separada da família Gemini — é o que
 *   ainda responde quando os Flash estão todos sobrecarregados. Testado ao vivo
 *   em 2026-09-24 (texto, lote e foto OK), com ressalvas: bem mais lento
 *   (15-50s; o 31B chegou a ficar 60s parado antes de um 503, por isso vem por
 *   último), não aceita áudio nesses tamanhos, e structured output quebra a
 *   resposta (responseSchema devolveu "{}", responseMimeType deu HTTP 500) —
 *   então vai sem generationConfig e o formato JSON vem só da instrução no
 *   prompt, com parse tolerante (ver extractJsonText_/extractResponseText_).
 *   Em comprovantes ele tende a lançar item por item em vez do total.
 *
 * `retries` = retentativas extras para 503 no mesmo modelo. Só o principal
 * retenta; os de reserva são tentados uma vez cada, para não estourar o tempo
 * de resposta do webhook quando tudo está sobrecarregado.
 */
var GEMINI_MODELS = [
  { name: 'gemini-flash-latest', structuredOutput: true, audio: true, retries: 2 },
  { name: 'gemini-3.5-flash', structuredOutput: true, audio: true, retries: 0 },
  { name: 'gemini-3.5-flash-lite', structuredOutput: true, audio: true, retries: 0 },
  { name: 'gemma-4-26b-a4b-it', structuredOutput: false, audio: false, retries: 0 },
  { name: 'gemma-4-31b-it', structuredOutput: false, audio: false, retries: 0 },
];
var GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
var CATEGORIA_SEM_CORRESPONDENCIA = 'SEM_CATEGORIA';
var DATA_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Schema estruturado (generationConfig.responseSchema) do Gemini: força o
 * formato exato da resposta na própria API, em vez de confiar só na
 * instrução em texto do prompt — sem isso, o modelo pode embrulhar a lista
 * num objeto (ex: {"despesas": [...]}) e nosso parse descartaria tudo.
 */
var EXPENSE_ITEM_SCHEMA_ = {
  type: 'OBJECT',
  properties: {
    valor: { type: 'NUMBER' },
    categoria: { type: 'STRING' },
    descricao: { type: 'STRING' },
    data: { type: 'STRING' },
    registro_cartao: { type: 'STRING' },
    precisa_revisao: { type: 'BOOLEAN' },
  },
  required: ['valor', 'categoria', 'descricao', 'data', 'precisa_revisao'],
};

var EXPENSE_LIST_SCHEMA_ = {
  type: 'ARRAY',
  items: EXPENSE_ITEM_SCHEMA_,
};

function todayIso_() {
  var now = new Date();
  var pad = function (n) {
    return n < 10 ? '0' + n : String(n);
  };
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

/**
 * Monta as "parts" do prompt do Gemini. `text` é a mensagem de texto (ou
 * legenda de foto); pode ser null/vazio quando a despesa vem só de áudio ou
 * imagem. `media`, quando presente, é `{mimeType, data}` (data em base64) —
 * uma part inline_data extra (áudio/imagem), usada pelas Fases 4/5.
 */
function buildPrompt(text, categories, media) {
  var instructions =
    'Extraia os dados da despesa descrita pelo usuário (em texto, áudio ou imagem de comprovante). ' +
    'Categorias válidas: ' + JSON.stringify(categories || []) + '. ' +
    'Se nenhuma categoria for uma correspondência razoável, use "' +
    CATEGORIA_SEM_CORRESPONDENCIA + '" e marque precisa_revisao=true. ' +
    'Se a mensagem não informar uma data, use a data de hoje (' + todayIso_() + '). ' +
    'Se a forma de pagamento for mencionada ou aparecer no comprovante (ex: PIX, cartão de crédito, dinheiro, débito, nome de um cartão), ' +
    'extraia em "registro_cartao"; se não for possível identificar, use uma string vazia "". ' +
    'Se não conseguir interpretar o valor com confiança, marque precisa_revisao=true. ' +
    'Responda em JSON estrito, sem markdown, no formato ' +
    '{"valor": number, "categoria": string, "descricao": string, "data": "YYYY-MM-DD", "registro_cartao": string, "precisa_revisao": boolean}.';

  var parts = [{ text: instructions }];
  if (text) {
    parts.push({ text: 'Mensagem do usuário: ' + text });
  }
  if (media) {
    parts.push({ inline_data: { mime_type: media.mimeType, data: media.data } });
  }
  return parts;
}

var GEMINI_RETRY_BASE_DELAY_MS = 1000;
// 503 (sobrecarga momentânea do modelo) é um erro que o próprio Gemini
// recomenda tentar de novo — visto ao vivo com "This model is currently
// experiencing high demand... Please try again later." 429 NÃO entra aqui:
// quando é por cota diária esgotada (RESOURCE_EXHAUSTED), esperar segundos não
// resolve — o caminho é trocar de modelo (ver callGemini/GEMINI_MODELS).
var GEMINI_RETRYABLE_STATUS_CODES = [503];

// Orçamento de tempo da cadeia inteira de modelos. O Apps Script mata a
// execução em 6 min ("Tempo limite atingido") e aí o dono não recebe NEM a
// mensagem de erro — visto no painel de Execuções (360s, e várias de 290-357s
// com o par antigo de modelos). Sob "high demand" o 503 pode levar ~60s para
// voltar (visto ao vivo no gemma-4-31b-it: 62s), então uma tentativa só começa
// se couber mais uma chamada nesse pior caso antes do fim do orçamento; o que
// sobra do limite fica para o resto do doPost e para avisar o erro no Telegram.
var GEMINI_TIME_BUDGET_MS = 300000;
var GEMINI_CALL_WORST_CASE_MS = 65000;
// Só vale retentar o MESMO modelo se o 503 voltou rápido (soluço momentâneo).
// Um 503 que demorou é modelo congestionado: retentar só queima o orçamento
// que faria falta pros modelos de reserva.
var GEMINI_FAST_FAILURE_MS = 10000;

/**
 * Uma tentativa de generateContent contra um modelo específico, com até
 * `maxRetries` retentativas para 503 rápidos. Não começa nenhuma tentativa que
 * possa passar de `deadline` (lança um erro com `outOfTime = true`).
 */
function requestGemini_(model, parts, generationConfig, maxRetries, deadline) {
  var url = GEMINI_API_BASE + model + ':generateContent?key=' + getGeminiApiKey();
  var payload = {
    contents: [{ parts: parts }],
    generationConfig: generationConfig,
  };

  for (var attempt = 0; ; attempt++) {
    if (Date.now() + GEMINI_CALL_WORST_CASE_MS > deadline) {
      var outOfTime = new Error('sem tempo para tentar ' + model);
      outOfTime.outOfTime = true;
      throw outOfTime;
    }
    var startedAt = Date.now();
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    var elapsedMs = Date.now() - startedAt;
    var code = response.getResponseCode();

    if (code >= 400) {
      var errorBody = response.getContentText();
      Logger.log('ai.requestGemini_: modelo=' + model + ' HTTP ' + code + ' em ' + elapsedMs + 'ms (tentativa ' + (attempt + 1) + ') - ' + errorBody);

      if (GEMINI_RETRYABLE_STATUS_CODES.indexOf(code) !== -1 && attempt < maxRetries && elapsedMs < GEMINI_FAST_FAILURE_MS) {
        Utilities.sleep(GEMINI_RETRY_BASE_DELAY_MS * (attempt + 1));
        continue;
      }

      throw new Error('Gemini respondeu HTTP ' + code + ': ' + errorBody);
    }

    Logger.log('ai.requestGemini_: modelo=' + model + ' HTTP ' + code + ' em ' + elapsedMs + 'ms' + (attempt > 0 ? ' (tentativa ' + (attempt + 1) + ')' : ''));

    try {
      return JSON.parse(response.getContentText());
    } catch (err) {
      Logger.log('ai.requestGemini_: falha ao fazer parse do corpo da resposta - ' + err);
      return null;
    }
  }
}

function hasAudio_(parts) {
  return parts.some(function (p) {
    return p.inline_data && /^audio\//.test(p.inline_data.mime_type || '');
  });
}

/**
 * Chama generateContent com as parts dadas, percorrendo GEMINI_MODELS em
 * ordem: se um modelo falhar de vez (depois das próprias retentativas em
 * requestGemini_) por qualquer motivo — cota diária esgotada (429), sobrecarga
 * persistente (503), etc. — tenta o próximo. Modelos sem suporte a áudio são
 * pulados quando a mensagem é uma nota de voz, e a cadeia para quando o
 * orçamento de tempo (GEMINI_TIME_BUDGET_MS) não comporta mais uma tentativa,
 * para sobrar tempo de avisar o erro. `responseSchema` (opcional)
 * força o formato exato da resposta nos modelos que suportam structured
 * output. Lança um erro com o status e o corpo da última falha se TODOS os
 * modelos falharem — Code.js repassa pro dono via Telegram. Retorna null (sem
 * lançar) só quando a resposta veio OK mas o corpo não é um JSON válido.
 */
function callGemini(parts, responseSchema) {
  var withAudio = hasAudio_(parts);
  var models = GEMINI_MODELS.filter(function (m) {
    return m.audio || !withAudio;
  });

  var deadline = Date.now() + GEMINI_TIME_BUDGET_MS;
  var failures = [];
  var skipped = [];
  var lastErr = null;
  for (var i = 0; i < models.length; i++) {
    var model = models[i];
    var generationConfig = {};
    if (model.structuredOutput) {
      generationConfig.responseMimeType = 'application/json';
      if (responseSchema) {
        generationConfig.responseSchema = responseSchema;
      }
    }

    try {
      return requestGemini_(model.name, parts, generationConfig, model.retries, deadline);
    } catch (err) {
      if (err.outOfTime) {
        skipped = models.slice(i).map(function (m) { return m.name; });
        Logger.log('ai.callGemini: orçamento de tempo esgotado, sem tentar ' + skipped.join(', '));
        break;
      }
      lastErr = err;
      failures.push(model.name);
      if (i < models.length - 1) {
        Logger.log('ai.callGemini: falha definitiva em ' + model.name + ' (' + err + '), tentando ' + models[i + 1].name);
      }
    }
  }

  throw new Error(
    'Nenhum modelo de IA respondeu (' + failures.join(', ') + ')' +
    (skipped.length ? '; sem tempo para tentar: ' + skipped.join(', ') : '') +
    '. Última falha: ' + (lastErr ? lastErr.message : 'nenhuma')
  );
}

/**
 * Texto gerado pela resposta, ignorando parts de raciocínio ("thought") que
 * alguns modelos (ex: Gemma 4 com thinking) podem devolver antes da resposta.
 */
function extractResponseText_(rawJson) {
  try {
    var texts = rawJson.candidates[0].content.parts.filter(function (p) {
      return typeof p.text === 'string' && !p.thought;
    });
    return texts.length ? texts[texts.length - 1].text : null;
  } catch (err) {
    return null;
  }
}

/**
 * Sem structured output (caso do Gemma), o modelo pode embrulhar o JSON em
 * bloco de markdown (```json ... ```) ou pôr texto em volta. Recorta do
 * primeiro "{"/"[" até o último "}"/"]" — pros modelos com structured output
 * isso é um no-op.
 */
function extractJsonText_(text) {
  var start = text.search(/[\[{]/);
  var end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start === -1 || end < start) {
    return text;
  }
  return text.slice(start, end + 1);
}

function isValidExpenseShape_(obj) {
  return !!obj &&
    typeof obj.valor === 'number' && obj.valor > 0 &&
    typeof obj.categoria === 'string' && obj.categoria.trim() !== '' &&
    typeof obj.descricao === 'string' && obj.descricao.trim() !== '' &&
    typeof obj.data === 'string' && DATA_FORMAT_REGEX.test(obj.data) &&
    typeof obj.precisa_revisao === 'boolean' &&
    (obj.registro_cartao === undefined || typeof obj.registro_cartao === 'string');
}

/**
 * Faz o parse da resposta bruta do Gemini (generateContent) para um
 * ExpenseDraft parcial (sem origem/telegram_user_id). Retorna null se o texto
 * gerado não for um JSON válido ou faltar algum campo obrigatório (FR-012).
 */
function parseExpenseResponse(rawJson) {
  var text = extractResponseText_(rawJson);
  if (!text) {
    return null;
  }

  var parsed;
  try {
    parsed = JSON.parse(extractJsonText_(text));
  } catch (err) {
    return null;
  }

  if (!isValidExpenseShape_(parsed)) {
    return null;
  }

  return normalizeExpenseItem_(parsed);
}

function normalizeExpenseItem_(parsed) {
  return {
    valor: parsed.valor,
    categoria: parsed.categoria,
    descricao: parsed.descricao,
    data: parsed.data,
    precisa_revisao: parsed.precisa_revisao,
    registro_cartao: typeof parsed.registro_cartao === 'string' ? parsed.registro_cartao : '',
  };
}

/**
 * Orquestra buildPrompt + callGemini + parseExpenseResponse. `media`
 * (opcional) é `{mimeType, data}` para despesas vindas de áudio (Fase 4) ou
 * imagem (Fase 5); para texto puro, chame só com `parseExpense(text, categories)`.
 */
function parseExpense(text, categories, media) {
  var parts = buildPrompt(text, categories, media);
  var rawJson = callGemini(parts, EXPENSE_ITEM_SCHEMA_);
  if (!rawJson) {
    return null;
  }
  return parseExpenseResponse(rawJson);
}

/**
 * Monta as "parts" do prompt para extrair VÁRIAS despesas de uma vez (ex: um
 * extrato/fatura numa imagem só, uma nota de voz descrevendo mais de um
 * gasto). Mesma estrutura de `buildPrompt`, mas pede uma lista JSON em vez de
 * um único objeto.
 */
function buildBatchPrompt(text, categories, media) {
  var instructions =
    'Extraia TODAS as despesas descritas ou visíveis (pode haver mais de uma — ex: uma lista de transações de um extrato, fatura ou histórico de pagamentos). ' +
    'Categorias válidas: ' + JSON.stringify(categories || []) + '. ' +
    'Para cada item, se nenhuma categoria for uma correspondência razoável, use "' +
    CATEGORIA_SEM_CORRESPONDENCIA + '" e marque precisa_revisao=true para aquele item. ' +
    'Se um item não informar uma data, use a data de hoje (' + todayIso_() + '). ' +
    'Se a forma de pagamento for mencionada ou aparecer no comprovante, extraia em "registro_cartao" de cada item; se não for possível identificar, use uma string vazia "". ' +
    'Se não conseguir interpretar o valor de um item com confiança, marque precisa_revisao=true para aquele item. ' +
    'Ignore linhas que claramente não são despesas (saldo, cabeçalhos, receitas, estornos, transferências recebidas). ' +
    'Responda em JSON estrito, sem markdown, como uma LISTA de objetos no formato ' +
    '[{"valor": number, "categoria": string, "descricao": string, "data": "YYYY-MM-DD", "registro_cartao": string, "precisa_revisao": boolean}]. ' +
    'Se não houver nenhuma despesa identificável, responda com uma lista vazia [].';

  var parts = [{ text: instructions }];
  if (text) {
    parts.push({ text: 'Mensagem do usuário: ' + text });
  }
  if (media) {
    parts.push({ inline_data: { mime_type: media.mimeType, data: media.data } });
  }
  return parts;
}

/**
 * Faz o parse da resposta bruta do Gemini como uma LISTA de ExpenseDrafts.
 * Itens que não têm o formato esperado são descartados; retorna null (falha
 * total) se o texto gerado não for um JSON válido ou não for uma lista.
 */
function parseExpenseListResponse(rawJson) {
  var text = extractResponseText_(rawJson);
  if (!text) {
    return null;
  }

  var parsed;
  try {
    parsed = JSON.parse(extractJsonText_(text));
  } catch (err) {
    return null;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  var drafts = [];
  parsed.forEach(function (item) {
    if (isValidExpenseShape_(item)) {
      drafts.push(normalizeExpenseItem_(item));
    }
  });
  return drafts;
}

/** Orquestra buildBatchPrompt + callGemini + parseExpenseListResponse. */
function parseExpenses(text, categories, media) {
  var parts = buildBatchPrompt(text, categories, media);
  var rawJson = callGemini(parts, EXPENSE_LIST_SCHEMA_);
  if (!rawJson) {
    return null;
  }
  return parseExpenseListResponse(rawJson);
}

/**
 * Monta as "parts" do prompt para corrigir UM item já interpretado (fluxo do
 * botão "✏️ Corrigir" — Code.js/handleExpenseCorrection_), a partir de uma
 * descrição em texto livre da mudança (ex: "valor é R$150", "categoria é
 * Lazer"). Devolve o objeto ExpenseDraft inteiro atualizado, não um diff —
 * pede pra manter os campos não mencionados como estão.
 */
function buildCorrectionPrompt(currentItem, correctionText, categories) {
  var atual = {
    valor: currentItem.valor,
    categoria: currentItem.categoria,
    descricao: currentItem.descricao,
    data: currentItem.data,
    registro_cartao: currentItem.registro_cartao || '',
  };
  var instructions =
    'Esta despesa já foi interpretada assim: ' + JSON.stringify(atual) + '. ' +
    'O usuário pediu a seguinte correção: "' + correctionText + '". ' +
    'Aplique a correção pedida e devolva o objeto COMPLETO atualizado, mantendo os campos que não foram mencionados na correção. ' +
    'Categorias válidas: ' + JSON.stringify(categories || []) + '. ' +
    'Se nenhuma categoria for uma correspondência razoável, use "' + CATEGORIA_SEM_CORRESPONDENCIA + '" e marque precisa_revisao=true. ' +
    'Se não conseguir aplicar a correção com confiança, marque precisa_revisao=true. ' +
    'Responda em JSON estrito, sem markdown, no formato ' +
    '{"valor": number, "categoria": string, "descricao": string, "data": "YYYY-MM-DD", "registro_cartao": string, "precisa_revisao": boolean}.';
  return [{ text: instructions }];
}

/** Orquestra buildCorrectionPrompt + callGemini + parseExpenseResponse. */
function correctExpense(currentItem, correctionText, categories) {
  var parts = buildCorrectionPrompt(currentItem, correctionText, categories);
  var rawJson = callGemini(parts, EXPENSE_ITEM_SCHEMA_);
  if (!rawJson) {
    return null;
  }
  return parseExpenseResponse(rawJson);
}

if (typeof module !== 'undefined') {
  module.exports = {
    CATEGORIA_SEM_CORRESPONDENCIA: CATEGORIA_SEM_CORRESPONDENCIA,
    buildPrompt: buildPrompt,
    callGemini: callGemini,
    parseExpenseResponse: parseExpenseResponse,
    parseExpense: parseExpense,
    buildBatchPrompt: buildBatchPrompt,
    parseExpenseListResponse: parseExpenseListResponse,
    parseExpenses: parseExpenses,
    buildCorrectionPrompt: buildCorrectionPrompt,
    correctExpense: correctExpense,
  };
}
