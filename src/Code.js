/**
 * Ponto de entrada do Web App. Recebe updates do Telegram via webhook (doPost),
 * valida a origem, e roteia para o handler adequado.
 *
 * Segurança do webhook: o Apps Script não expõe headers HTTP customizados em
 * doPost(e) (limitação confirmada do runtime), então o segredo do webhook
 * trafega como parâmetro de query na própria URL registrada no setWebhook
 * (?secret=...), validado aqui contra TELEGRAM_WEBHOOK_SECRET. O Apps Script
 * também não permite definir o código de status HTTP da resposta — toda
 * resposta de Web App volta como 200; o que importa é nunca processar um
 * update quando o segredo não bate.
 */

if (typeof require !== 'undefined') {
  var configModule_ = require('./config.js');
  var getWebhookSecret = configModule_.getWebhookSecret;
  var isOwner = configModule_.isOwner;
  var registerOwnerIfUnset = configModule_.registerOwnerIfUnset;

  var telegramModule_ = require('./telegram.js');
  var sendMessage = telegramModule_.sendMessage;
  var editMessageText = telegramModule_.editMessageText;
  var answerCallbackQuery = telegramModule_.answerCallbackQuery;
  var buildConfirmationKeyboard = telegramModule_.buildConfirmationKeyboard;
  var downloadFile = telegramModule_.downloadFile;

  var sheetsModule_ = require('./sheets.js');
  var getCategories = sheetsModule_.getCategories;
  var appendLancamento = sheetsModule_.appendLancamento;

  var aiModule_ = require('./ai.js');
  var parseExpenses = aiModule_.parseExpenses;
  var correctExpense = aiModule_.correctExpense;

  var stateModule_ = require('./state.js');
  var savePendingDraft = stateModule_.savePendingDraft;
  var getPendingDraft = stateModule_.getPendingDraft;
  var clearPendingDraft = stateModule_.clearPendingDraft;
  var updatePendingDraft = stateModule_.updatePendingDraft;
  var savePendingEdit = stateModule_.savePendingEdit;
  var getPendingEdit = stateModule_.getPendingEdit;
  var clearPendingEdit = stateModule_.clearPendingEdit;
  var saveLastDraftRef = stateModule_.saveLastDraftRef;
  var getLastDraftRef = stateModule_.getLastDraftRef;
  var clearLastDraftRef = stateModule_.clearLastDraftRef;
  var wasUpdateProcessed = stateModule_.wasUpdateProcessed;
  var markUpdateProcessed = stateModule_.markUpdateProcessed;
}

function doPost(e) {
  if (!isValidWebhookRequest_(e)) {
    return textResponse_('unauthorized');
  }

  var update = parseUpdate_(e);
  if (!update) {
    Logger.log('doPost: corpo do request não é um JSON válido');
    return textResponse_('bad request');
  }

  Logger.log(
    'doPost: update_id=' + update.update_id +
    ' tipo=' + (update.message ? 'message' : update.callback_query ? 'callback_query' : 'desconhecido')
  );

  if (update.update_id !== undefined) {
    if (wasUpdateProcessed(update.update_id)) {
      Logger.log('doPost: update_id=' + update.update_id + ' já processado (reenvio do Telegram) — ignorando');
      return textResponse_('ok');
    }
    markUpdateProcessed(update.update_id);
  }

  try {
    if (update.message) {
      handleMessageUpdate_(update.message);
    } else if (update.callback_query) {
      handleCallbackQueryUpdate_(update.callback_query);
    }
  } catch (err) {
    Logger.log('doPost: erro não tratado - ' + err + (err && err.stack ? '\n' + err.stack : ''));
    notifyUnexpectedError_(update, err);
  }

  return textResponse_('ok');
}

/**
 * Manda o erro real pro dono (não uma mensagem genérica): como só o dono
 * verificado recebe mensagens do bot (config.isOwner), não há risco de
 * vazar detalhe técnico pra terceiros, e isso poupa depender do Cloud
 * Logging (que exige vincular um projeto GCP, não configurado) pra depurar.
 */
function notifyUnexpectedError_(update, err) {
  var chatId =
    (update.message && update.message.chat && update.message.chat.id) ||
    (update.callback_query && update.callback_query.message && update.callback_query.message.chat && update.callback_query.message.chat.id);
  if (chatId === undefined) {
    return;
  }
  try {
    sendMessage(chatId, 'Ocorreu um erro ao processar sua mensagem:\n' + err);
  } catch (sendErr) {
    Logger.log('doPost: falha ao notificar erro ao usuário - ' + sendErr);
  }
}

function isValidWebhookRequest_(e) {
  var expected = getWebhookSecret();
  var received = e && e.parameter && e.parameter.secret;
  return !!expected && received === expected;
}

function parseUpdate_(e) {
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    return null;
  }
}

/**
 * Cuida de identidade (registra o primeiro remetente como dono, recusa
 * qualquer outro) e roteia a mensagem para o fluxo de interpretação de
 * despesa (US-001/002/003): texto, nota de voz ou foto de comprovante.
 */
function handleMessageUpdate_(message) {
  var fromId = message.from && message.from.id;
  var chatId = message.chat && message.chat.id;
  if (fromId === undefined || chatId === undefined) {
    return;
  }

  if (registerOwnerIfUnset(fromId)) {
    Logger.log('handleMessageUpdate_: dono registrado, fromId=' + fromId);
    sendMessage(chatId, 'Bot configurado para você. A partir de agora só responderei suas mensagens.');
    return;
  }

  if (!isOwner(fromId)) {
    Logger.log('handleMessageUpdate_: mensagem recusada, fromId=' + fromId + ' não é o dono');
    sendMessage(chatId, 'Este bot já está configurado para outra pessoa e não pode ser usado por você.');
    return;
  }

  if (message.text) {
    var pendingEdit = getPendingEdit(fromId);
    if (pendingEdit) {
      handleExpenseCorrection_(fromId, message.text, pendingEdit);
      return;
    }
    handleExpenseText_(chatId, fromId, message.text);
    return;
  }

  if (message.voice) {
    handleExpenseMedia_(chatId, fromId, message.voice.file_id, 'audio/ogg', 'audio', 'esse áudio', null);
    return;
  }

  if (message.photo && message.photo.length) {
    var largestPhoto = message.photo[message.photo.length - 1];
    handleExpenseMedia_(chatId, fromId, largestPhoto.file_id, 'image/jpeg', 'imagem', 'essa imagem', message.caption);
    return;
  }

  Logger.log('handleMessageUpdate_: tipo de mensagem sem texto/voice/photo, ainda não suportado');
  sendMessage(chatId, 'Ainda não sei processar esse tipo de mensagem. Por enquanto, mande texto, áudio ou foto de comprovante.');
}

/**
 * Interpreta uma mensagem de texto como despesa — possivelmente MAIS DE UMA
 * (ex: "Gastei 100 no barzinho sabado, 500 no mercado"), usando o mesmo
 * parser em lote de ai.parseExpenses (US-002/US-003) e o helper compartilhado
 * handleParsedDrafts_ com handleExpenseMedia_.
 *
 * Se o Gemini não encontrar NENHUMA despesa nova no texto e houver um
 * rascunho ainda pendente de confirmação (state.getLastDraftRef), assume que
 * a mensagem é uma correção daquele rascunho em vez de reclamar que não achou
 * despesa — cobre o caso comum de "descrição é X" ou "categoria é Y", sem
 * precisar clicar em "✏️ Corrigir" antes (esse botão continua funcionando,
 * principalmente pra lote, onde é preciso indicar qual item mudar).
 */
function handleExpenseText_(chatId, fromId, text) {
  var startedAt = Date.now();
  Logger.log('handleExpenseText_: texto="' + text + '"');

  var categories = getCategories();
  var drafts = parseExpenses(text, categories);
  Logger.log(
    'handleExpenseText_: parseExpenses -> ' + (drafts ? drafts.length + ' item(ns)' : 'null') +
    ' (+' + (Date.now() - startedAt) + 'ms desde o início)'
  );

  if (drafts && drafts.length === 0) {
    var lastRef = getLastDraftRef(fromId);
    if (lastRef) {
      Logger.log('handleExpenseText_: nenhuma despesa nova encontrada, tratando como correção do rascunho ' + lastRef.token);
      handleExpenseCorrection_(fromId, text, lastRef);
      return;
    }
  }

  handleParsedDrafts_(chatId, fromId, drafts, 'texto', 'essa mensagem',
    'Pode reformular com mais detalhes (valor, categoria e o que foi)?');
  Logger.log('handleExpenseText_: concluído em ' + (Date.now() - startedAt) + 'ms');
}

/**
 * Interpreta uma nota de voz (US-002) ou foto de comprovante (US-003) como
 * despesa — possivelmente MAIS DE UMA (ex: print de extrato/fatura com várias
 * transações). Baixa o arquivo do Telegram, manda pro Gemini junto com as
 * categorias (ai.parseExpenses, sempre em lote — um item só vira uma lista de
 * tamanho 1), e mostra um resumo com um único botão que confirma todos de uma
 * vez (FR-005: nada é gravado sem confirmação explícita, mas em lote isso não
 * deve custar N toques). Item único de baixa confiança bloqueia a confirmação
 * e pede reformulação (FR-012), igual ao texto — mas um LOTE com algum item
 * incerto ainda oferece "confirmar todos" (com os incertos marcados ⚠️),
 * porque não existe um jeito de corrigir só parte de uma lista via chat, e é
 * mais fácil ajustar a categoria/data errada depois direto na planilha.
 * `caption` é a legenda da foto, se houver (nota de voz nunca tem).
 */
function handleExpenseMedia_(chatId, fromId, fileId, mimeType, origem, origemDisplay, caption) {
  var startedAt = Date.now();
  Logger.log('handleExpenseMedia_: origem=' + origem + ' fileId=' + fileId);

  var base64Data = downloadFile(fileId);
  if (!base64Data) {
    Logger.log('handleExpenseMedia_: falha ao baixar o arquivo (+' + (Date.now() - startedAt) + 'ms)');
    sendMessage(chatId, 'Não consegui baixar ' + origemDisplay + '. Tente enviar de novo.');
    return;
  }
  Logger.log('handleExpenseMedia_: arquivo baixado (+' + (Date.now() - startedAt) + 'ms)');

  var categories = getCategories();
  var drafts = parseExpenses(caption || null, categories, { mimeType: mimeType, data: base64Data });
  Logger.log(
    'handleExpenseMedia_: parseExpenses -> ' + (drafts ? drafts.length + ' item(ns)' : 'null') +
    ' (+' + (Date.now() - startedAt) + 'ms desde o início)'
  );

  handleParsedDrafts_(chatId, fromId, drafts, origem, origemDisplay, 'Pode enviar de novo ou descrever em texto?');
  Logger.log('handleExpenseMedia_: concluído em ' + (Date.now() - startedAt) + 'ms');
}

/**
 * Lógica compartilhada por texto, áudio e foto depois do parse (ai.parseExpenses,
 * sempre em lote — um item só vira uma lista de tamanho 1): valida a resposta do
 * Gemini, monta o resumo (único ou em lote) e guarda o rascunho pendente
 * aguardando confirmação (FR-005). `origemDisplay` referencia a entrada nas
 * mensagens de erro (ex: "essa mensagem", "esse áudio"); `reformularHint`
 * completa a frase de como tentar de novo (reformular texto vs. reenviar mídia).
 */
function handleParsedDrafts_(chatId, fromId, drafts, origem, origemDisplay, reformularHint) {
  if (drafts === null) {
    sendMessage(chatId, 'Não consegui processar ' + origemDisplay + ' (falha ao consultar o Gemini). Tente de novo em instantes.');
    return;
  }

  if (drafts.length === 0) {
    sendMessage(chatId, 'Não encontrei nenhuma despesa em ' + origemDisplay + '. ' + reformularHint);
    return;
  }

  var precisamRevisao = drafts.filter(function (d) { return d.precisa_revisao; });

  // Item único de baixa confiança: sem rascunho, pede reformulação (FR-012).
  if (drafts.length === 1 && precisamRevisao.length > 0) {
    sendMessage(chatId, 'Não consegui interpretar ' + origemDisplay + ' com confiança. ' + reformularHint);
    return;
  }

  drafts.forEach(function (draft) {
    draft.origem = origem;
    draft.telegram_user_id = fromId;
  });

  var token = savePendingDraft(drafts);
  sendMessage(chatId, buildConfirmationSummary_(drafts), buildConfirmationKeyboard(token, drafts.length));
  saveLastDraftRef(fromId, { token: token, chatId: chatId });
  Logger.log('handleParsedDrafts_: token=' + token + ', itens=' + drafts.length);
}

/** Resumo mostrado junto do teclado de confirmação — único item ou lote (ver handleParsedDrafts_ e handleExpenseCorrection_). */
function buildConfirmationSummary_(drafts) {
  if (drafts.length === 1) {
    return 'Confirma esse lançamento?\n' + formatDraftFields_(drafts[0]);
  }

  // Lote: sempre oferece "Confirmar todos", mesmo com itens incertos — não há
  // como corrigir só parte de uma lista por texto, e é bem mais fácil ajustar
  // categoria/data errada depois direto na planilha do que travar a
  // confirmação do lote inteiro por causa de 1-2 itens duvidosos.
  var precisamRevisao = drafts.filter(function (d) { return d.precisa_revisao; });
  var summary = 'Encontrei ' + drafts.length + ' lançamentos';
  if (precisamRevisao.length > 0) {
    summary += ' (⚠️ ' + precisamRevisao.length + ' com baixa confiança — confira antes de confirmar; dá pra corrigir depois direto na planilha)';
  }
  return summary + ':\n\n' + formatDraftListSummary_(drafts);
}

/**
 * Trata a resposta em texto a um pedido de correção (fluxo iniciado pelo
 * botão "✏️ Corrigir" — handleEditCallback_): reinterpreta só o item indicado
 * (ai.correctExpense) e atualiza o rascunho pendente NO MESMO token, em vez
 * de descartar o lote inteiro e pedir pra reenviar a mensagem original —
 * essencial pro caso de várias despesas, onde só uma saiu errada. O resultado
 * vai numa mensagem NOVA (não edita a anterior) — como o Gemini pode demorar
 * alguns segundos, uma mensagem editada passa batido (Telegram não notifica
 * edição), então cada passo do fluxo de correção é uma mensagem própria.
 * `pendingEdit` é `{token, chatId}` (ver state.savePendingEdit).
 */
function handleExpenseCorrection_(fromId, text, pendingEdit) {
  var draft = getPendingDraft(pendingEdit.token);
  if (!draft) {
    clearPendingEdit(fromId);
    clearLastDraftRef(fromId);
    sendMessage(pendingEdit.chatId, 'Esse rascunho expirou. Mande a mensagem de novo.');
    return;
  }

  var drafts = Array.isArray(draft) ? draft : [draft];
  var itemIndex = 0;
  var correctionText = text.trim();

  if (drafts.length > 1) {
    // Aceita "2:", "2.", "2-" ou "2)" como separador — pedimos ":" no exemplo,
    // mas é natural digitar "2." como se fosse um item de lista numerada
    // (visto ao vivo: "3. Descrição é X" não era reconhecido antes).
    var match = /^\s*(\d+)\s*[.:)\-]\s*([\s\S]+)$/.exec(text);
    if (!match) {
      sendMessage(pendingEdit.chatId, 'Não entendi. Responda com o número do item e o que corrigir, ex: "2: categoria é Lazer".');
      return;
    }
    itemIndex = parseInt(match[1], 10) - 1;
    if (itemIndex < 0 || itemIndex >= drafts.length) {
      sendMessage(pendingEdit.chatId, 'Número inválido. Escolha de 1 a ' + drafts.length + '.');
      return;
    }
    correctionText = match[2].trim();
  }

  var categories = getCategories();
  var updatedItem = correctExpense(drafts[itemIndex], correctionText, categories);
  if (!updatedItem) {
    sendMessage(pendingEdit.chatId, 'Não consegui aplicar essa correção. Pode descrever de outro jeito?');
    return;
  }

  var mergedItem = Object.assign({}, drafts[itemIndex], updatedItem);
  // Se nada mudou de fato (ex: pedir pra corrigir um campo que já estava
  // certo), avisa em vez de mandar uma "nova" confirmação idêntica à anterior.
  if (JSON.stringify(mergedItem) === JSON.stringify(drafts[itemIndex])) {
    sendMessage(pendingEdit.chatId, 'Não percebi nenhuma mudança — esse campo já estava assim. Se quiser, descreva de outro jeito (ex: "valor é R$150").');
    return;
  }

  drafts[itemIndex] = mergedItem;
  updatePendingDraft(pendingEdit.token, drafts);
  clearPendingEdit(fromId);
  // Mantém viva a referência ao rascunho (renova o TTL) — permite corrigir de
  // novo (outro item do lote, ou mais um ajuste) sem precisar clicar em
  // "✏️ Corrigir" outra vez.
  saveLastDraftRef(fromId, pendingEdit);

  sendMessage(
    pendingEdit.chatId,
    '✏️ Corrigido:\n\n' + buildConfirmationSummary_(drafts),
    buildConfirmationKeyboard(pendingEdit.token, drafts.length)
  );
  Logger.log('handleExpenseCorrection_: token=' + pendingEdit.token + ', item=' + (itemIndex + 1) + '/' + drafts.length);
}

function formatDraftFields_(draft) {
  var lines = [
    '💰 Valor: R$ ' + Number(draft.valor).toFixed(2).replace('.', ','),
    '🏷️ Categoria: ' + draft.categoria,
    '📝 Descrição: ' + draft.descricao,
    '📅 Data: ' + draft.data,
  ];
  if (draft.registro_cartao) {
    lines.push('💳 Registro no cartão: ' + draft.registro_cartao);
  }
  return lines.join('\n');
}

/** Lista numerada compacta, usada no resumo de confirmação em lote e na mensagem final de gravação. */
function formatDraftListSummary_(drafts) {
  return drafts.map(function (draft, index) {
    var marker = draft.precisa_revisao ? '⚠️ ' : '';
    return (index + 1) + '. ' + marker + 'R$ ' + Number(draft.valor).toFixed(2).replace('.', ',') +
      ' | ' + draft.categoria + ' | ' + draft.descricao + ' | ' + draft.data;
  }).join('\n');
}

/** Roteia confirm/cancel/edit do teclado inline (Decision 4) para o rascunho referenciado pelo token. */
function handleCallbackQueryUpdate_(callbackQuery) {
  var fromId = callbackQuery.from && callbackQuery.from.id;
  if (fromId === undefined || !isOwner(fromId)) {
    return;
  }

  var dataParts = (callbackQuery.data || '').split(':');
  var action = dataParts[0];
  var token = dataParts[1];
  var chatId = callbackQuery.message && callbackQuery.message.chat && callbackQuery.message.chat.id;
  var messageId = callbackQuery.message && callbackQuery.message.message_id;

  if (action === 'confirm') {
    handleConfirmCallback_(callbackQuery.id, chatId, messageId, token, fromId);
  } else if (action === 'cancel') {
    handleCancelCallback_(callbackQuery.id, chatId, messageId, token, fromId);
  } else if (action === 'edit') {
    handleEditCallback_(callbackQuery.id, chatId, messageId, token, fromId);
  }
}

/**
 * `draft` pode ser um ExpenseDraft único (texto) ou uma lista (lote de
 * áudio/imagem/texto com várias despesas, ver handleParsedDrafts_). Também
 * limpa qualquer correção pendente do dono (handleEditCallback_) — assume
 * um único rascunho em andamento por vez, então uma confirmação encerra
 * qualquer correção que não tenha sido respondida ainda.
 */
function handleConfirmCallback_(callbackQueryId, chatId, messageId, token, fromId) {
  var draft = getPendingDraft(token);
  if (!draft) {
    answerCallbackQuery(callbackQueryId, 'Esse rascunho expirou. Mande a mensagem de novo.');
    return;
  }

  var drafts = Array.isArray(draft) ? draft : [draft];
  drafts.forEach(function (item) {
    appendLancamento(item);
  });
  clearPendingDraft(token);
  clearPendingEdit(fromId);
  clearLastDraftRef(fromId);
  answerCallbackQuery(callbackQueryId, drafts.length > 1 ? drafts.length + ' lançamentos gravados.' : 'Lançamento gravado.');

  var confirmedText = drafts.length > 1
    ? '✅ Gravados ' + drafts.length + ' lançamentos:\n\n' + formatDraftListSummary_(drafts)
    : '✅ Gravado:\n' + formatDraftFields_(drafts[0]);
  editMessageText(chatId, messageId, confirmedText);
}

function handleCancelCallback_(callbackQueryId, chatId, messageId, token, fromId) {
  clearPendingDraft(token);
  clearPendingEdit(fromId);
  clearLastDraftRef(fromId);
  answerCallbackQuery(callbackQueryId, 'Cancelado.');
  editMessageText(chatId, messageId, '❌ Lançamento cancelado.');
}

/**
 * Em vez de descartar o rascunho e pedir pra reenviar a mensagem inteira,
 * guarda qual rascunho/mensagem está sendo corrigido (state.savePendingEdit)
 * e pede a descrição da mudança — a próxima mensagem de texto do dono é
 * interceptada em handleMessageUpdate_ e tratada por handleExpenseCorrection_.
 * Em lote, pede o número do item porque não dá pra saber qual está errado.
 */
function handleEditCallback_(callbackQueryId, chatId, messageId, token, fromId) {
  var draft = getPendingDraft(token);
  if (!draft) {
    answerCallbackQuery(callbackQueryId, 'Esse rascunho expirou. Mande a mensagem de novo.');
    editMessageText(chatId, messageId, '⌛ Esse rascunho expirou. Mande a mensagem de novo.');
    return;
  }

  var drafts = Array.isArray(draft) ? draft : [draft];
  savePendingEdit(fromId, { token: token, chatId: chatId });
  saveLastDraftRef(fromId, { token: token, chatId: chatId });
  answerCallbackQuery(callbackQueryId, 'Ok, descreva a correção.');

  // Mensagem NOVA (não edita o card original) — mais fácil de notar quando a
  // resposta chega, principalmente se o Gemini demorar alguns segundos.
  if (drafts.length === 1) {
    sendMessage(
      chatId,
      '✏️ O que você quer corrigir?\n' + formatDraftFields_(drafts[0]) +
      '\n\nDescreva a mudança (ex: "valor é R$150", "categoria é Lazer").'
    );
  } else {
    sendMessage(
      chatId,
      '✏️ Qual item corrigir? Responda "<número>: <o que mudar>" (ex: "2: categoria é Lazer").\n\n' +
      formatDraftListSummary_(drafts)
    );
  }
}

/**
 * ContentService.createTextOutput() faz o Web App responder com um
 * redirecionamento 302 (para servir o conteúdo via script.googleusercontent.com)
 * antes do corpo real — o Telegram não segue esse redirecionamento e trata a
 * entrega como falha ("Wrong response from the webhook: 302 Found"), reenviando
 * o mesmo update repetidamente. HtmlService.createHtmlOutput() responde direto
 * com 200, sem esse redirecionamento.
 */
function textResponse_(text) {
  if (typeof HtmlService !== 'undefined') {
    return HtmlService.createHtmlOutput(text);
  }
  return { body: text };
}

if (typeof module !== 'undefined') {
  module.exports = {
    doPost: doPost,
    isValidWebhookRequest_: isValidWebhookRequest_,
    parseUpdate_: parseUpdate_,
    handleMessageUpdate_: handleMessageUpdate_,
    handleCallbackQueryUpdate_: handleCallbackQueryUpdate_,
  };
}
