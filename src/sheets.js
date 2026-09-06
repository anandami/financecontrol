/**
 * Acesso à planilha vinculada à instância (SpreadsheetApp.getActiveSpreadsheet()).
 * Nunca resolve por ID de planilha — o script está fisicamente vinculado à
 * planilha da própria pessoa (Decision 2 da arquitetura).
 *
 * Categorias e lançamentos vivem em ABAS DIFERENTES: "Despesas" guarda a lista
 * de categorias conhecidas na coluna C (posição fixa, Decision 6); "Lançamento"
 * é onde cada despesa individual é registrada, com colunas resolvidas por
 * cabeçalho.
 */

var CATEGORIAS_SHEET_NAME = 'Despesas';
var CATEGORIA_COLUMN_INDEX = 2; // coluna C, fixa (Decision 6)

var LANCAMENTOS_SHEET_NAME = 'Lançamento';
var LANCAMENTO_COLUMN_HEADERS = {
  data: 'Data',
  valor: 'Valor',
  categoria: 'Categoria',
  descricao: 'Descrição',
  registroCartao: 'Registro no cartão',
};

/** Lê a coluna C da aba "Despesas" (categorias já usadas), ignorando o cabeçalho. */
function getCategories() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CATEGORIAS_SHEET_NAME);
  if (!sheet) {
    return [];
  }

  var values = sheet.getDataRange().getValues();
  var categories = [];
  for (var i = 1; i < values.length; i++) {
    var raw = values[i][CATEGORIA_COLUMN_INDEX];
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      categories.push(String(raw).trim());
    }
  }
  return categories;
}

/**
 * Normaliza para NFC antes de comparar: o mesmo texto acentuado ("ç", "ã")
 * pode chegar como caractere pré-composto ou como base+diacrítico combinante
 * dependendo de como foi digitado/colado na planilha, e essas duas formas não
 * são "===" iguais em JavaScript mesmo parecendo idênticas visualmente.
 */
function normalizeHeader_(text) {
  return String(text).trim().normalize('NFC');
}

function buildHeaderIndexMap_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var header = headerRow[i];
    if (header !== undefined && header !== null && String(header).trim() !== '') {
      map[normalizeHeader_(header)] = i;
    }
  }
  return map;
}

var HEADER_SEARCH_MAX_ROWS = 10;

/**
 * Acha a linha de cabeçalho de verdade dentro das primeiras linhas da aba,
 * em vez de assumir que é sempre a linha 1 — a aba "Lançamento" real tem uma
 * linha de título ("Lançamentos Individuais") antes do cabeçalho de fato.
 * Procura pela primeira linha que contenha "Descrição" como valor de célula.
 */
function findHeaderRowIndex_(values) {
  var target = normalizeHeader_(LANCAMENTO_COLUMN_HEADERS.descricao);
  var limit = Math.min(values.length, HEADER_SEARCH_MAX_ROWS);
  for (var i = 0; i < limit; i++) {
    var row = values[i] || [];
    for (var j = 0; j < row.length; j++) {
      if (row[j] !== undefined && row[j] !== null && normalizeHeader_(row[j]) === target) {
        return i;
      }
    }
  }
  return 0;
}

/** Converte "YYYY-MM-DD" num Date real, para a planilha tratar como data de verdade. */
function parseIsoDate_(isoDate) {
  var parts = String(isoDate).split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

/**
 * Grava o lançamento na aba "Lançamento", resolvendo colunas por cabeçalho
 * (Decision 6). Escreve célula a célula, só nas colunas reconhecidas — nunca
 * usa appendRow com uma linha inteira, para não sobrescrever colunas como
 * "Mês" (preenchida por fórmula) ou "Registro no cartão" (preenchimento manual,
 * fora do escopo do bot por enquanto). A linha de destino é a primeira, após o
 * cabeçalho, com a coluna "Descrição" vazia — não necessariamente a última
 * linha da planilha, já que linhas futuras podem já ter "Mês" pré-preenchido.
 */
function appendLancamento(draft) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LANCAMENTOS_SHEET_NAME);
  if (!sheet) {
    throw new Error('Aba "' + LANCAMENTOS_SHEET_NAME + '" não encontrada na planilha.');
  }

  var values = sheet.getDataRange().getValues();
  var headerRowIndex = findHeaderRowIndex_(values);
  var headerRow = values[headerRowIndex] || [];
  var headerIndex = buildHeaderIndexMap_(headerRow);

  var descricaoHeader = normalizeHeader_(LANCAMENTO_COLUMN_HEADERS.descricao);
  if (!Object.prototype.hasOwnProperty.call(headerIndex, descricaoHeader)) {
    throw new Error(
      'Cabeçalho "' + descricaoHeader + '" não encontrado na aba "' + LANCAMENTOS_SHEET_NAME +
      '" (procurado nas primeiras ' + HEADER_SEARCH_MAX_ROWS + ' linhas). Linha ' + (headerRowIndex + 1) +
      ' encontrada: ' + JSON.stringify(headerRow)
    );
  }
  var descricaoColIndex = headerIndex[descricaoHeader];

  var targetRow = values.length + 1;
  for (var i = headerRowIndex + 1; i < values.length; i++) {
    var cell = values[i][descricaoColIndex];
    if (cell === undefined || cell === null || String(cell).trim() === '') {
      targetRow = i + 1; // values é 0-indexed, a planilha é 1-indexed
      break;
    }
  }

  var fieldsByHeader = {};
  fieldsByHeader[LANCAMENTO_COLUMN_HEADERS.data] = parseIsoDate_(draft.data);
  fieldsByHeader[LANCAMENTO_COLUMN_HEADERS.valor] = draft.valor;
  fieldsByHeader[LANCAMENTO_COLUMN_HEADERS.categoria] = draft.categoria;
  fieldsByHeader[LANCAMENTO_COLUMN_HEADERS.descricao] = draft.descricao;
  if (draft.registro_cartao) {
    fieldsByHeader[LANCAMENTO_COLUMN_HEADERS.registroCartao] = draft.registro_cartao;
  }

  Object.keys(fieldsByHeader).forEach(function (header) {
    if (Object.prototype.hasOwnProperty.call(headerIndex, header)) {
      sheet.getRange(targetRow, headerIndex[header] + 1).setValue(fieldsByHeader[header]);
    }
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    CATEGORIAS_SHEET_NAME: CATEGORIAS_SHEET_NAME,
    CATEGORIA_COLUMN_INDEX: CATEGORIA_COLUMN_INDEX,
    LANCAMENTOS_SHEET_NAME: LANCAMENTOS_SHEET_NAME,
    getCategories: getCategories,
    appendLancamento: appendLancamento,
  };
}
