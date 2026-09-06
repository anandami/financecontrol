/**
 * Acesso a segredos e configuração durável da instância, via PropertiesService.
 * Cada instância (planilha) tem suas próprias Propriedades do Script — não há
 * nada compartilhado entre instâncias de pessoas diferentes.
 */

var CONFIG_KEYS = {
  BOT_TOKEN: 'TELEGRAM_BOT_TOKEN',
  GEMINI_API_KEY: 'GEMINI_API_KEY',
  WEBHOOK_SECRET: 'TELEGRAM_WEBHOOK_SECRET',
  OWNER_TELEGRAM_ID: 'OWNER_TELEGRAM_ID',
};

function getBotToken() {
  return PropertiesService.getScriptProperties().getProperty(CONFIG_KEYS.BOT_TOKEN);
}

function getGeminiApiKey() {
  return PropertiesService.getScriptProperties().getProperty(CONFIG_KEYS.GEMINI_API_KEY);
}

function getWebhookSecret() {
  return PropertiesService.getScriptProperties().getProperty(CONFIG_KEYS.WEBHOOK_SECRET);
}

function getOwnerTelegramId() {
  return PropertiesService.getScriptProperties().getProperty(CONFIG_KEYS.OWNER_TELEGRAM_ID);
}

function setOwnerTelegramId(telegramId) {
  PropertiesService.getScriptProperties().setProperty(CONFIG_KEYS.OWNER_TELEGRAM_ID, String(telegramId));
}

/** true se fromId for o dono já registrado desta instância. */
function isOwner(fromId) {
  var ownerId = getOwnerTelegramId();
  return ownerId !== null && ownerId !== '' && ownerId === String(fromId);
}

/**
 * Se ainda não há dono registrado, registra fromId como dono e retorna true
 * (primeira mensagem da instância). Se já houver dono, não altera nada e
 * retorna false.
 */
function registerOwnerIfUnset(fromId) {
  var ownerId = getOwnerTelegramId();
  if (ownerId) {
    return false;
  }
  setOwnerTelegramId(fromId);
  return true;
}

if (typeof module !== 'undefined') {
  module.exports = {
    CONFIG_KEYS: CONFIG_KEYS,
    getBotToken: getBotToken,
    getGeminiApiKey: getGeminiApiKey,
    getWebhookSecret: getWebhookSecret,
    getOwnerTelegramId: getOwnerTelegramId,
    setOwnerTelegramId: setOwnerTelegramId,
    isOwner: isOwner,
    registerOwnerIfUnset: registerOwnerIfUnset,
  };
}
