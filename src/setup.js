/**
 * Menu "⚙️ Configurar Bot" + formulário de setup dentro da própria planilha.
 * Substitui os passos mais técnicos e propensos a erro do onboarding manual
 * (abrir Propriedades do Script, digitar os nomes exatos das 3 chaves, gerar
 * um UUID pro segredo, montar e rodar a chamada ao setWebhook) por um
 * formulário com dois campos. Só mexe no PropertiesService da PRÓPRIA
 * instância — nada sai daqui além da chamada ao setWebhook do Telegram, com
 * o token que a própria pessoa acabou de colar.
 *
 * Pré-requisito: o Web App já precisa estar publicado (ScriptApp.getService()
 * .getUrl() só retorna algo depois do primeiro "Implantar > Nova
 * implantação") — isso o Apps Script não permite fazer de dentro do próprio
 * código, então continua sendo um passo manual do tutorial.
 */

/** Simple trigger do Apps Script — roda sozinho toda vez que a planilha é aberta. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚙️ Configurar Bot')
    .addItem('Configurar/atualizar credenciais', 'showSetupDialog')
    .addToUi();
}

function showSetupDialog() {
  var html = HtmlService.createHtmlOutputFromFile('SetupDialog').setWidth(420).setHeight(480);
  SpreadsheetApp.getUi().showModalDialog(html, 'Configurar bot do Telegram');
}

/** Preenche o formulário com o que já estiver salvo, pra facilitar corrigir um valor sem reescrever tudo. */
function getSavedCredentials() {
  var props = PropertiesService.getScriptProperties();
  return {
    botToken: props.getProperty(CONFIG_KEYS.BOT_TOKEN) || '',
    geminiApiKey: props.getProperty(CONFIG_KEYS.GEMINI_API_KEY) || '',
  };
}

/**
 * Chamado pelo formulário via google.script.run. Salva o token do bot e a
 * chave do Gemini, gera o segredo do webhook na primeira vez (mantém o
 * mesmo em execuções seguintes, pra poder rodar de novo só pra corrigir um
 * token errado sem invalidar o que já estava registrado), descobre a URL do
 * próprio Web App já publicado e registra o webhook no Telegram. Retorna
 * `{ok, message}` pro formulário mostrar o resultado — nunca lança exceção
 * pro chamador (erros viram `{ok: false, message}`).
 *
 * `webAppUrlOverride` (opcional): quando uma execução acionada pelo menu
 * roda sob a implantação "Teste" (visto ao vivo no log de Execuções),
 * `ScriptApp.getService().getUrl()` pode devolver a URL de teste (`/dev`,
 * só acessível por quem está logada) em vez da URL publicada (`/exec`) — o
 * Telegram aceita registrar essa URL sem reclamar, mas nunca consegue
 * chamá-la de verdade, e a instância fica em silêncio total. Por isso a
 * detecção automática é só a primeira tentativa; se vier um valor de
 * override (colado no formulário) ou se a URL detectada parecer ser de
 * teste, pedimos a URL publicada explicitamente em vez de seguir em frente
 * com um valor que sabemos que não vai funcionar.
 */
function runSetup(botToken, geminiApiKey, webAppUrlOverride) {
  botToken = (botToken || '').trim();
  geminiApiKey = (geminiApiKey || '').trim();
  webAppUrlOverride = (webAppUrlOverride || '').trim();

  if (!botToken || !geminiApiKey) {
    return { ok: false, message: 'Preencha o token do bot e a chave do Gemini.' };
  }

  var webAppUrl = webAppUrlOverride || ScriptApp.getService().getUrl();
  if (!webAppUrl) {
    return {
      ok: false,
      message: 'Este projeto ainda não foi publicado como Web App. Publique primeiro (Implantar > Nova implantação > App da Web) e tente de novo.',
    };
  }
  if (webAppUrl.indexOf('/dev') !== -1) {
    return {
      ok: false,
      message: 'Não consegui detectar a URL publicada automaticamente (só achei a de teste, que não funciona pro Telegram). Abra "Implantar > Gerenciar implantações", copie a URL que termina em "/exec" e cole no campo "URL do Web App" abaixo.',
    };
  }

  var props = PropertiesService.getScriptProperties();
  props.setProperty(CONFIG_KEYS.BOT_TOKEN, botToken);
  props.setProperty(CONFIG_KEYS.GEMINI_API_KEY, geminiApiKey);

  var secret = props.getProperty(CONFIG_KEYS.WEBHOOK_SECRET);
  if (!secret) {
    secret = Utilities.getUuid();
    props.setProperty(CONFIG_KEYS.WEBHOOK_SECRET, secret);
  }

  var result = callTelegramApi('setWebhook', { url: webAppUrl + '?secret=' + secret });
  if (!result || !result.ok) {
    return {
      ok: false,
      message: 'O Telegram recusou: ' + (result && result.description ? result.description : 'erro desconhecido') + '. Confira se o token do bot está certo.',
    };
  }

  return { ok: true, message: 'Tudo certo! Agora é só mandar /start pro seu bot no Telegram.' };
}
