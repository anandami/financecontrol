/**
 * Rascunhos de lançamento pendentes de confirmação, via CacheService.
 * Estado efêmero (TTL curto) — diferente de config.js, que guarda config durável.
 */

var PENDING_DRAFT_TTL_SECONDS = 15 * 60; // 15 min
var PENDING_DRAFT_PREFIX = 'draft_';

/** Token curto (cabe com folga no limite de 64 bytes do callback_data do Telegram). */
function generateDraftToken() {
  return Utilities.getUuid().split('-')[0];
}

/** Salva o rascunho no cache e retorna o token gerado para referenciá-lo depois. */
function savePendingDraft(draft) {
  var token = generateDraftToken();
  CacheService.getScriptCache().put(
    PENDING_DRAFT_PREFIX + token,
    JSON.stringify(draft),
    PENDING_DRAFT_TTL_SECONDS
  );
  return token;
}

/** Retorna o rascunho salvo para o token, ou null se não existir/tiver expirado. */
function getPendingDraft(token) {
  var raw = CacheService.getScriptCache().get(PENDING_DRAFT_PREFIX + token);
  return raw ? JSON.parse(raw) : null;
}

function clearPendingDraft(token) {
  CacheService.getScriptCache().remove(PENDING_DRAFT_PREFIX + token);
}

/** Substitui o conteúdo do rascunho, mantendo o mesmo token (e o mesmo botão de confirmação já mostrado no chat). */
function updatePendingDraft(token, draft) {
  CacheService.getScriptCache().put(
    PENDING_DRAFT_PREFIX + token,
    JSON.stringify(draft),
    PENDING_DRAFT_TTL_SECONDS
  );
}

/**
 * Estado do fluxo "✏️ Corrigir" (Code.js/handleEditCallback_): enquanto o
 * dono ainda não respondeu com a descrição da correção, guarda a referência
 * de qual rascunho/mensagem está sendo corrigido. Chaveado por fromId (não
 * por token) porque é a próxima mensagem de TEXTO desse remetente que
 * precisa ser interceptada antes de virar uma despesa nova — ver
 * handleMessageUpdate_.
 */
var PENDING_EDIT_PREFIX = 'edit_';

function savePendingEdit(fromId, editState) {
  CacheService.getScriptCache().put(
    PENDING_EDIT_PREFIX + fromId,
    JSON.stringify(editState),
    PENDING_DRAFT_TTL_SECONDS
  );
}

function getPendingEdit(fromId) {
  var raw = CacheService.getScriptCache().get(PENDING_EDIT_PREFIX + fromId);
  return raw ? JSON.parse(raw) : null;
}

function clearPendingEdit(fromId) {
  CacheService.getScriptCache().remove(PENDING_EDIT_PREFIX + fromId);
}

/**
 * Referência ao rascunho mais recente ainda pendente de confirmação
 * (Code.js/handleParsedDrafts_ mantém isso atualizado sempre que mostra ou
 * atualiza um rascunho). Diferente de PENDING_EDIT: essa não é "modo de
 * correção" ligado por um clique — é um fallback usado quando o dono manda
 * uma mensagem de texto que NÃO parece uma despesa nova (ex: "descrição é
 * X", sem nenhum valor), pra tratar como correção do rascunho pendente em
 * vez de simplesmente dizer "não encontrei nenhuma despesa".
 */
var LAST_DRAFT_REF_PREFIX = 'lastref_';

function saveLastDraftRef(fromId, ref) {
  CacheService.getScriptCache().put(
    LAST_DRAFT_REF_PREFIX + fromId,
    JSON.stringify(ref),
    PENDING_DRAFT_TTL_SECONDS
  );
}

function getLastDraftRef(fromId) {
  var raw = CacheService.getScriptCache().get(LAST_DRAFT_REF_PREFIX + fromId);
  return raw ? JSON.parse(raw) : null;
}

function clearLastDraftRef(fromId) {
  CacheService.getScriptCache().remove(LAST_DRAFT_REF_PREFIX + fromId);
}

/**
 * Se o processamento de uma mensagem demorar demais, o Telegram reenvia o
 * mesmo update (mesmo update_id) — sem isso, cada reenvio processava a
 * despesa de novo e mandava respostas duplicadas ao usuário.
 */
var PROCESSED_UPDATE_TTL_SECONDS = 10 * 60; // 10 min — cobre a janela de retries do Telegram
var PROCESSED_UPDATE_PREFIX = 'update_';

function wasUpdateProcessed(updateId) {
  return CacheService.getScriptCache().get(PROCESSED_UPDATE_PREFIX + updateId) !== null;
}

function markUpdateProcessed(updateId) {
  CacheService.getScriptCache().put(PROCESSED_UPDATE_PREFIX + updateId, '1', PROCESSED_UPDATE_TTL_SECONDS);
}

if (typeof module !== 'undefined') {
  module.exports = {
    PENDING_DRAFT_TTL_SECONDS: PENDING_DRAFT_TTL_SECONDS,
    generateDraftToken: generateDraftToken,
    savePendingDraft: savePendingDraft,
    getPendingDraft: getPendingDraft,
    clearPendingDraft: clearPendingDraft,
    updatePendingDraft: updatePendingDraft,
    savePendingEdit: savePendingEdit,
    getPendingEdit: getPendingEdit,
    clearPendingEdit: clearPendingEdit,
    saveLastDraftRef: saveLastDraftRef,
    getLastDraftRef: getLastDraftRef,
    clearLastDraftRef: clearLastDraftRef,
    PROCESSED_UPDATE_TTL_SECONDS: PROCESSED_UPDATE_TTL_SECONDS,
    wasUpdateProcessed: wasUpdateProcessed,
    markUpdateProcessed: markUpdateProcessed,
  };
}
