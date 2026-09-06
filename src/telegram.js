/**
 * Wrapper fino da API do Telegram. Toda chamada usa o token da própria
 * instância (config.getBotToken()) — nunca um token compartilhado.
 */

if (typeof require !== 'undefined') {
  var getBotToken = require('./config.js').getBotToken;
}

var TELEGRAM_API_BASE = 'https://api.telegram.org/bot';
var TELEGRAM_FILE_API_BASE = 'https://api.telegram.org/file/bot';

function telegramApiUrl(method) {
  return TELEGRAM_API_BASE + getBotToken() + '/' + method;
}

/**
 * POST genérico a um método da Bot API, com o corpo em JSON. Não lança
 * exceção em erro (a chamada segue "muda" pro código chamador, que só olha
 * o corpo) — mas registra no Logger.log pra aparecer nas Execuções do Apps
 * Script, porque um erro aqui (ex: "message is not modified" ao editar uma
 * mensagem sem nenhuma mudança de fato) não deixa rastro nenhum: a execução
 * termina normalmente, sem lançar erro, e nada chega no chat.
 */
function callTelegramApi(method, payload) {
  var response = UrlFetchApp.fetch(telegramApiUrl(method), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true,
  });
  var parsed = JSON.parse(response.getContentText());
  if (!parsed.ok) {
    Logger.log('telegram.callTelegramApi: ' + method + ' falhou - ' + JSON.stringify(parsed));
  }
  return parsed;
}

function sendMessage(chatId, text, options) {
  var payload = Object.assign({ chat_id: chatId, text: text }, options || {});
  return callTelegramApi('sendMessage', payload);
}

function editMessageText(chatId, messageId, text, options) {
  var payload = Object.assign(
    { chat_id: chatId, message_id: messageId, text: text },
    options || {}
  );
  return callTelegramApi('editMessageText', payload);
}

function answerCallbackQuery(callbackQueryId, text) {
  var payload = { callback_query_id: callbackQueryId };
  if (text) {
    payload.text = text;
  }
  return callTelegramApi('answerCallbackQuery', payload);
}

/** Metadados do arquivo (inclui file_path) — não baixa o conteúdo. Ver downloadFile. */
function getFile(fileId) {
  return callTelegramApi('getFile', { file_id: fileId });
}

/**
 * Baixa o conteúdo do arquivo (nota de voz, foto) e retorna em base64, pronto
 * para virar uma part inline_data do Gemini. Retorna null se o arquivo não
 * puder ser localizado ou baixado.
 */
function downloadFile(fileId) {
  var meta = getFile(fileId);
  var filePath = meta && meta.result && meta.result.file_path;
  if (!filePath) {
    return null;
  }

  var response = UrlFetchApp.fetch(TELEGRAM_FILE_API_BASE + getBotToken() + '/' + filePath, {
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() >= 400) {
    return null;
  }

  return Utilities.base64Encode(response.getContent());
}

/**
 * Teclado inline Confirmar/Corrigir/Cancelar para o rascunho de lançamento
 * pendente. O callback_data carrega só "<ação>:<token>" (limite de 64 bytes
 * do Telegram) — o rascunho em si vive no CacheService (state.js). `count`
 * (opcional, >1) ajusta o rótulo do botão pro caso de lote: "Confirmar todos (N)".
 * Uso: telegram.sendMessage(chatId, resumo, telegram.buildConfirmationKeyboard(token)).
 */
function buildConfirmationKeyboard(token, count) {
  var confirmLabel = count > 1 ? '✅ Confirmar todos (' + count + ')' : '✅ Confirmar';
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: confirmLabel, callback_data: 'confirm:' + token },
        { text: '✏️ Corrigir', callback_data: 'edit:' + token },
        { text: '❌ Cancelar', callback_data: 'cancel:' + token },
      ]],
    },
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    telegramApiUrl: telegramApiUrl,
    callTelegramApi: callTelegramApi,
    sendMessage: sendMessage,
    editMessageText: editMessageText,
    answerCallbackQuery: answerCallbackQuery,
    getFile: getFile,
    downloadFile: downloadFile,
    buildConfirmationKeyboard: buildConfirmationKeyboard,
  };
}
