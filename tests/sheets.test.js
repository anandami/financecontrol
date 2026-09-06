const { installGasMocks, createMockSheet, createMockSpreadsheet } = require('./__mocks__/google-apps-script.js');

describe('sheets.js', () => {
  let sheets;

  beforeEach(() => {
    jest.resetModules();
    installGasMocks();
    sheets = require('../src/sheets.js');
  });

  describe('getCategories', () => {
    it('lê a coluna C da aba Despesas, ignorando o cabeçalho', () => {
      const despesasSheet = createMockSheet([
        ['Data', 'Descrição', 'Categoria'],
        ['2026-01-01', 'Mercado', 'Alimentação'],
        ['2026-01-02', 'Uber', 'Transporte'],
      ]);
      global.SpreadsheetApp.getActiveSpreadsheet.mockReturnValue(
        createMockSpreadsheet({ Despesas: despesasSheet })
      );

      expect(sheets.getCategories()).toEqual(['Alimentação', 'Transporte']);
    });

    it('ignora células vazias na coluna de categorias', () => {
      const despesasSheet = createMockSheet([
        ['Data', 'Descrição', 'Categoria'],
        ['2026-01-01', 'Mercado', 'Alimentação'],
        ['2026-01-02', 'Sem categoria ainda', ''],
      ]);
      global.SpreadsheetApp.getActiveSpreadsheet.mockReturnValue(
        createMockSpreadsheet({ Despesas: despesasSheet })
      );

      expect(sheets.getCategories()).toEqual(['Alimentação']);
    });

    it('retorna lista vazia se a aba Despesas não existir', () => {
      global.SpreadsheetApp.getActiveSpreadsheet.mockReturnValue(createMockSpreadsheet({}));

      expect(sheets.getCategories()).toEqual([]);
    });
  });

  describe('appendLancamento', () => {
    it('grava na aba Lançamento (diferente da aba Despesas), célula a célula por cabeçalho', () => {
      const lancamentoSheet = createMockSheet([
        ['Descrição', 'Registro no cartão', 'Categoria', 'Data', 'Mês', 'Valor'],
      ]);
      global.SpreadsheetApp.getActiveSpreadsheet.mockReturnValue(
        createMockSpreadsheet({ Lançamento: lancamentoSheet })
      );

      sheets.appendLancamento({
        valor: 100,
        categoria: 'Serviços domésticos',
        descricao: 'faxina',
        data: '2026-08-30',
      });

      expect(lancamentoSheet.getRange).toHaveBeenCalledWith(2, 1); // Descrição
      expect(lancamentoSheet.getRange).toHaveBeenCalledWith(2, 3); // Categoria
      expect(lancamentoSheet.getRange).toHaveBeenCalledWith(2, 4); // Data
      expect(lancamentoSheet.getRange).toHaveBeenCalledWith(2, 6); // Valor
      // "Registro no cartão" (coluna 2) e "Mês" (coluna 5) nunca são tocadas
      expect(lancamentoSheet.getRange).not.toHaveBeenCalledWith(2, 2);
      expect(lancamentoSheet.getRange).not.toHaveBeenCalledWith(2, 5);

      const values = lancamentoSheet.getDataRange().getValues();
      expect(values[1][0]).toBe('faxina');
      expect(values[1][2]).toBe('Serviços domésticos');
      expect(values[1][3]).toEqual(new Date(2026, 7, 30));
      expect(values[1][5]).toBe(100);
      expect(values[1][1]).toBeUndefined(); // Registro no cartão intocado
      expect(values[1][4]).toBeUndefined(); // Mês intocado
    });

    it('grava "Registro no cartão" quando o draft traz esse valor', () => {
      const lancamentoSheet = createMockSheet([
        ['Descrição', 'Registro no cartão', 'Categoria', 'Data', 'Mês', 'Valor'],
      ]);
      global.SpreadsheetApp.getActiveSpreadsheet.mockReturnValue(
        createMockSpreadsheet({ Lançamento: lancamentoSheet })
      );

      sheets.appendLancamento({
        valor: 50,
        categoria: 'Mercado',
        descricao: 'compras',
        data: '2026-08-30',
        registro_cartao: 'PIX',
      });

      expect(lancamentoSheet.getRange).toHaveBeenCalledWith(2, 2);
      const values = lancamentoSheet.getDataRange().getValues();
      expect(values[1][1]).toBe('PIX');
    });

    it('acha o cabeçalho mesmo com uma linha de título acima dele (caso real da aba Lançamento)', () => {
      const lancamentoSheet = createMockSheet([
        ['Lançamentos Individuais', '', '', '', '', 'Lembretes'],
        ['Descrição', 'Registro no cartão', 'Categoria', 'Data', 'Mês', 'Valor'],
      ]);
      global.SpreadsheetApp.getActiveSpreadsheet.mockReturnValue(
        createMockSpreadsheet({ Lançamento: lancamentoSheet })
      );

      sheets.appendLancamento({
        valor: 1.99,
        categoria: 'Jogos',
        descricao: 'Ficha com Pokémon GO',
        data: '2026-09-02',
      });

      const values = lancamentoSheet.getDataRange().getValues();
      expect(values[2][0]).toBe('Ficha com Pokémon GO'); // linha 3 (após título + cabeçalho)
      expect(values[2][2]).toBe('Jogos');
      expect(values[2][5]).toBe(1.99);
    });

    it('usa a primeira linha com Descrição vazia, não a última linha da planilha', () => {
      // Linhas futuras já têm "Mês" pré-preenchido (fórmula arrastada), mas Descrição vazia.
      const lancamentoSheet = createMockSheet([
        ['Descrição', 'Categoria', 'Data', 'Mês', 'Valor'],
        ['compras', 'Mercado', '2026-08-01', 8, 50],
        ['', '', '', 8, ''],
        ['', '', '', 8, ''],
      ]);
      global.SpreadsheetApp.getActiveSpreadsheet.mockReturnValue(
        createMockSpreadsheet({ Lançamento: lancamentoSheet })
      );

      sheets.appendLancamento({
        valor: 30,
        categoria: 'Jogos',
        descricao: 'ficha',
        data: '2026-08-31',
      });

      const values = lancamentoSheet.getDataRange().getValues();
      expect(values[2][0]).toBe('ficha'); // linha 3 (índice 2), não a linha 4
      expect(values[2][3]).toBe(8); // "Mês" da linha usada continua intocado
      expect(values[3][0]).toBe(''); // linha seguinte permanece vazia
    });

    it('lança erro se a aba de lançamentos não existir', () => {
      global.SpreadsheetApp.getActiveSpreadsheet.mockReturnValue(createMockSpreadsheet({}));

      expect(() =>
        sheets.appendLancamento({ valor: 1, categoria: 'x', descricao: 'y', data: '2026-01-01' })
      ).toThrow();
    });

    it('lança erro se a aba de lançamentos não tiver cabeçalho "Descrição"', () => {
      const lancamentoSheet = createMockSheet([['Valor', 'Categoria']]);
      global.SpreadsheetApp.getActiveSpreadsheet.mockReturnValue(
        createMockSpreadsheet({ Lançamento: lancamentoSheet })
      );

      expect(() =>
        sheets.appendLancamento({ valor: 1, categoria: 'x', descricao: 'y', data: '2026-01-01' })
      ).toThrow();
    });
  });
});
