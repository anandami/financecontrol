/**
 * Mocks mínimos dos serviços globais do Google Apps Script, para uso em testes Jest.
 * O código em src/ roda sem bundler dentro do Apps Script (funções globais); os
 * mesmos arquivos são carregados via require() nos testes, então os serviços
 * precisam existir como globais antes do require. Chame installGasMocks() num
 * beforeEach() e use os objetos retornados para configurar cada teste.
 */

function createMockSheet(initialValues = []) {
  const data = initialValues; // mutado in place por getRange(...).setValue(...)

  const getRange = jest.fn().mockImplementation((row, col) => ({
    getValue: jest.fn().mockImplementation(() => {
      const rowData = data[row - 1] || [];
      return rowData[col - 1] !== undefined ? rowData[col - 1] : '';
    }),
    setValue: jest.fn().mockImplementation((value) => {
      if (!data[row - 1]) data[row - 1] = [];
      data[row - 1][col - 1] = value;
    }),
  }));

  return {
    getDataRange: jest.fn().mockImplementation(() => ({
      getValues: jest.fn().mockReturnValue(data),
    })),
    appendRow: jest.fn(),
    getRange,
    getLastRow: jest.fn().mockImplementation(() => data.length),
    getLastColumn: jest.fn().mockImplementation(() => (data[0] || []).length),
  };
}

function createMockSpreadsheet(sheetsByName = {}) {
  return {
    getSheetByName: jest.fn().mockImplementation((name) => sheetsByName[name] || null),
  };
}

function installGasMocks() {
  const scriptProperties = {
    getProperty: jest.fn().mockReturnValue(null),
    setProperty: jest.fn(),
    deleteProperty: jest.fn(),
  };

  const scriptCache = {
    get: jest.fn().mockReturnValue(null),
    put: jest.fn(),
    remove: jest.fn(),
  };

  const mockSpreadsheet = createMockSpreadsheet();

  global.SpreadsheetApp = {
    getActiveSpreadsheet: jest.fn().mockReturnValue(mockSpreadsheet),
  };

  global.PropertiesService = {
    getScriptProperties: jest.fn().mockReturnValue(scriptProperties),
  };

  global.CacheService = {
    getScriptCache: jest.fn().mockReturnValue(scriptCache),
  };

  global.UrlFetchApp = {
    fetch: jest.fn(),
  };

  global.Utilities = {
    getUuid: jest.fn().mockReturnValue('mock-uuid'),
    base64Encode: jest.fn().mockImplementation((input) => Buffer.from(input).toString('base64')),
    base64Decode: jest.fn().mockImplementation((input) => Buffer.from(input, 'base64')),
    newBlob: jest.fn().mockImplementation((data, contentType) => ({ data, contentType })),
    sleep: jest.fn(), // não dorme de verdade nos testes
  };

  global.Logger = {
    log: jest.fn(),
  };

  return { scriptProperties, scriptCache, mockSpreadsheet };
}

function createMockHttpResponse({ code = 200, text = '{}' } = {}) {
  return {
    getResponseCode: jest.fn().mockReturnValue(code),
    getContentText: jest.fn().mockReturnValue(text),
  };
}

module.exports = {
  installGasMocks,
  createMockSheet,
  createMockSpreadsheet,
  createMockHttpResponse,
};
