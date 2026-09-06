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
 * Usa o alias "-latest" mantido pelo Google em vez de fixar uma versão
 * numerada: aponta sempre para o Flash estável mais recente (confirmado via
 * generateContent em 2026-09-02, resolvendo hoje para gemini-3.8-flash), sem
 * precisar atualizar este código quando uma versão for descontinuada — foi
 * exatamente isso que quebrou o parsing de despesas ao fixar "gemini-2.5-flash".
 *
 * Trade-off descoberto ao vivo: um modelo recém-lançado (é o caso do que
 * "-latest" resolve pra hoje) pode vir com uma cota de estreia no tier
 * gratuito bem mais apertada que o normal (visto: 20 requisições/DIA, contra
 * os ~250-1500/dia esperados). Cada modelo tem sua própria cota isolada, então
 * `GEMINI_FALLBACK_MODEL` (uma versão um pouco mais madura, não a mais nova)
 * serve de plano B só quando a cota diária do principal esgota de vez —
 * ver callGemini().
 */
var GEMINI_MODEL = 'gemini-flash-latest';
var GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash';
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

var GEMINI_MAX_RETRIES = 2;
var GEMINI_RETRY_BASE_DELAY_MS = 1000;
// 503 (sobrecarga momentânea do modelo) é um erro que o próprio Gemini
// recomenda tentar de novo — visto ao vivo com "This model is currently
// experiencing high demand... Please try again later." 429 NÃO entra aqui:
// quando é por cota diária esgotada (RESOURCE_EXHAUSTED), esperar segundos não
// resolve — o caminho é trocar de modelo (ver callGemini/GEMINI_FALLBACK_MODEL).
var GEMINI_RETRYABLE_STATUS_CODES = [503];

/** Uma tentativa de generateContent contra um modelo específico, com retry para erros transitórios (503). */
function requestGemini_(model, parts, generationConfig) {
  var url = GEMINI_API_BASE + model + ':generateContent?key=' + getGeminiApiKey();
  var payload = {
    contents: [{ parts: parts }],
    generationConfig: generationConfig,
  };

  for (var attempt = 0; ; attempt++) {
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

      if (GEMINI_RETRYABLE_STATUS_CODES.indexOf(code) !== -1 && attempt < GEMINI_MAX_RETRIES) {
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

/**
 * Chama generateContent com as parts dadas, usando o modelo principal
 * (GEMINI_MODEL). Se ele falhar de vez (depois dos próprios retries em
 * requestGemini_) — seja por cota DIÁRIA esgotada (429 RESOURCE_EXHAUSTED;
 * visto ao vivo: tier gratuito de um modelo recém-lançado com limite de só
 * 20 requisições/dia) ou por sobrecarga persistente (503 que não se resolveu
 * nem depois das retentativas) — tenta uma vez o modelo de reserva
 * (GEMINI_FALLBACK_MODEL), que tem cota e capacidade isoladas do principal.
 * `responseSchema` (opcional) força o formato exato da resposta. Lança um
 * erro com o status e o corpo em caso de falha definitiva (em ambos os
 * modelos) — Code.js repassa pro dono via Telegram. Retorna null (sem
 * lançar) só quando a resposta veio OK mas o corpo não é um JSON válido.
 */
function callGemini(parts, responseSchema) {
  var generationConfig = { responseMimeType: 'application/json' };
  if (responseSchema) {
    generationConfig.responseSchema = responseSchema;
  }

  try {
    return requestGemini_(GEMINI_MODEL, parts, generationConfig);
  } catch (err) {
    if (GEMINI_MODEL === GEMINI_FALLBACK_MODEL) {
      throw err;
    }
    Logger.log('ai.callGemini: falha definitiva em ' + GEMINI_MODEL + ' (' + err + '), tentando modelo de reserva ' + GEMINI_FALLBACK_MODEL);
    return requestGemini_(GEMINI_FALLBACK_MODEL, parts, generationConfig);
  }
}

function extractResponseText_(rawJson) {
  try {
    return rawJson.candidates[0].content.parts[0].text;
  } catch (err) {
    return null;
  }
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
    parsed = JSON.parse(text);
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
    parsed = JSON.parse(text);
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
