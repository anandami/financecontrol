const { installGasMocks } = require('./__mocks__/google-apps-script.js');

describe('ai.js', () => {
  let ai;

  beforeEach(() => {
    jest.resetModules();
    installGasMocks();
    ai = require('../src/ai.js');
  });

  describe('buildPrompt', () => {
    it('inclui a lista de categorias e a mensagem do usuário', () => {
      const parts = ai.buildPrompt('paguei 100 reais de faxina', ['Mercado', 'Transporte']);
      const combined = parts.map((p) => p.text).join(' ');

      expect(combined).toContain('Mercado');
      expect(combined).toContain('Transporte');
      expect(combined).toContain('paguei 100 reais de faxina');
      expect(combined).toContain('SEM_CATEGORIA');
    });

    it('funciona com lista de categorias vazia', () => {
      const parts = ai.buildPrompt('gastei 20 no busão', []);

      expect(parts.map((p) => p.text).join(' ')).toContain('gastei 20 no busão');
    });

    it('inclui uma part inline_data quando há mídia (áudio/imagem)', () => {
      const parts = ai.buildPrompt(null, ['Mercado'], { mimeType: 'audio/ogg', data: 'QUJD' });

      const mediaPart = parts.find((p) => p.inline_data);
      expect(mediaPart).toEqual({ inline_data: { mime_type: 'audio/ogg', data: 'QUJD' } });
      // sem texto do usuário, não deve incluir a linha "Mensagem do usuário:"
      expect(parts.some((p) => p.text && p.text.startsWith('Mensagem do usuário'))).toBe(false);
    });

    it('inclui tanto a legenda quanto a mídia quando as duas existem (foto com legenda)', () => {
      const parts = ai.buildPrompt('almoço de negócios', ['Restaurantes'], { mimeType: 'image/jpeg', data: 'QUJD' });

      expect(parts.some((p) => p.text === 'Mensagem do usuário: almoço de negócios')).toBe(true);
      expect(parts.some((p) => p.inline_data)).toBe(true);
    });
  });

  describe('parseExpenseResponse', () => {
    function geminiResponse(expenseObj) {
      return {
        candidates: [{ content: { parts: [{ text: JSON.stringify(expenseObj) }] } }],
      };
    }

    it('faz o parse de uma resposta válida', () => {
      const raw = geminiResponse({
        valor: 100,
        categoria: 'Serviços domésticos',
        descricao: 'faxina',
        data: '2026-08-30',
        precisa_revisao: false,
      });

      expect(ai.parseExpenseResponse(raw)).toEqual({
        valor: 100,
        categoria: 'Serviços domésticos',
        descricao: 'faxina',
        data: '2026-08-30',
        precisa_revisao: false,
        registro_cartao: '',
      });
    });

    it('extrai registro_cartao quando informado, e usa string vazia quando ausente', () => {
      const comCartao = geminiResponse({
        valor: 50,
        categoria: 'Mercado',
        descricao: 'compras',
        data: '2026-08-30',
        precisa_revisao: false,
        registro_cartao: 'PIX',
      });
      const semCartao = geminiResponse({
        valor: 50,
        categoria: 'Mercado',
        descricao: 'compras',
        data: '2026-08-30',
        precisa_revisao: false,
      });

      expect(ai.parseExpenseResponse(comCartao).registro_cartao).toBe('PIX');
      expect(ai.parseExpenseResponse(semCartao).registro_cartao).toBe('');
    });

    it('aceita o fallback SEM_CATEGORIA com precisa_revisao=true', () => {
      const raw = geminiResponse({
        valor: 30,
        categoria: 'SEM_CATEGORIA',
        descricao: 'gasto não identificado',
        data: '2026-08-30',
        precisa_revisao: true,
      });

      const draft = ai.parseExpenseResponse(raw);

      expect(draft.categoria).toBe('SEM_CATEGORIA');
      expect(draft.precisa_revisao).toBe(true);
    });

    it('retorna null se o texto gerado não for um JSON válido', () => {
      const raw = { candidates: [{ content: { parts: [{ text: 'isso não é json' }] } }] };

      expect(ai.parseExpenseResponse(raw)).toBeNull();
    });

    it('retorna null se faltar um campo obrigatório', () => {
      const raw = geminiResponse({
        valor: 100,
        categoria: 'Mercado',
        data: '2026-08-30',
        precisa_revisao: false,
      });

      expect(ai.parseExpenseResponse(raw)).toBeNull();
    });

    it('retorna null se valor não for positivo', () => {
      const raw = geminiResponse({
        valor: -5,
        categoria: 'Mercado',
        descricao: 'compras',
        data: '2026-08-30',
        precisa_revisao: false,
      });

      expect(ai.parseExpenseResponse(raw)).toBeNull();
    });

    it('retorna null se a resposta do Gemini não tiver o formato esperado', () => {
      expect(ai.parseExpenseResponse({})).toBeNull();
    });
  });

  describe('parseExpense', () => {
    it('orquestra buildPrompt + callGemini + parseExpenseResponse via UrlFetchApp', () => {
      global.UrlFetchApp.fetch.mockReturnValue({
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    valor: 100,
                    categoria: 'Serviços domésticos',
                    descricao: 'faxina',
                    data: '2026-08-30',
                    precisa_revisao: false,
                  }),
                }],
              },
            }],
          }),
      });

      const draft = ai.parseExpense('paguei 100 reais de faxina', ['Serviços domésticos']);

      expect(draft).toEqual({
        valor: 100,
        categoria: 'Serviços domésticos',
        descricao: 'faxina',
        data: '2026-08-30',
        precisa_revisao: false,
        registro_cartao: '',
      });
      expect(global.UrlFetchApp.fetch).toHaveBeenCalledTimes(1);
    });

    it('lança um erro com o status e o corpo quando o Gemini responde com erro HTTP não-retriável (em todos os modelos)', () => {
      global.UrlFetchApp.fetch.mockReturnValue({
        getResponseCode: () => 400,
        getContentText: () => '{"error":{"message":"Invalid argument"}}',
      });

      expect(() => ai.parseExpense('paguei 100 reais de faxina', [])).toThrow(/400/);
      // 1 tentativa em cada um dos 6 modelos da cadeia (400 não é retriável em nenhum)
      expect(global.UrlFetchApp.fetch).toHaveBeenCalledTimes(6);
    });

    it('tenta de novo em erro 503 (sobrecarga temporária) e usa a resposta da tentativa seguinte', () => {
      global.UrlFetchApp.fetch
        .mockReturnValueOnce({ getResponseCode: () => 503, getContentText: () => '{"error":{"message":"overloaded"}}' })
        .mockReturnValueOnce({
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: JSON.stringify({
                valor: 100, categoria: 'Mercado', descricao: 'compras', data: '2026-08-30', precisa_revisao: false,
              }) }] } }],
            }),
        });

      const draft = ai.parseExpense('paguei 100 reais de compras', ['Mercado']);

      expect(draft.descricao).toBe('compras');
      expect(global.Utilities.sleep).toHaveBeenCalledTimes(1);
      expect(global.UrlFetchApp.fetch).toHaveBeenCalledTimes(2);
    });

    it('desiste de vez só depois de esgotar as tentativas no principal E em todos os modelos de reserva', () => {
      global.UrlFetchApp.fetch.mockReturnValue({
        getResponseCode: () => 503,
        getContentText: () => '{"error":{"message":"overloaded"}}',
      });

      expect(() => ai.parseExpense('paguei 100 reais de faxina', [])).toThrow(/503/);
      // (1 tentativa inicial + 2 retentativas) no principal + 1 em cada um dos 5 de reserva = 8 chamadas
      expect(global.UrlFetchApp.fetch).toHaveBeenCalledTimes(8);
    });

    it('cai pro Gemma 4 quando todos os Gemini estão sobrecarregados, sem structured output e aceitando JSON em bloco markdown', () => {
      const overloaded = { getResponseCode: () => 503, getContentText: () => '{"error":{"message":"overloaded"}}' };
      global.UrlFetchApp.fetch
        .mockReturnValueOnce(overloaded)
        .mockReturnValueOnce(overloaded)
        .mockReturnValueOnce(overloaded)
        .mockReturnValueOnce(overloaded)
        .mockReturnValueOnce(overloaded)
        .mockReturnValueOnce(overloaded)
        .mockReturnValueOnce({
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({
              candidates: [{ content: { parts: [
                { text: 'pensando...', thought: true },
                { text: '```json\n' + JSON.stringify({
                  valor: 370, categoria: 'Eletrônicos', descricao: 'Galaxy Buds 3', data: '2026-09-24', precisa_revisao: false,
                }) + '\n```' },
              ] } }],
            }),
        });

      const draft = ai.parseExpense('370 reais no galaxy buds 3', ['Eletrônicos']);

      expect(draft.valor).toBe(370);
      expect(global.UrlFetchApp.fetch).toHaveBeenCalledTimes(7);
      const [gemmaUrl, gemmaOptions] = global.UrlFetchApp.fetch.mock.calls[6];
      expect(gemmaUrl).toContain('gemma-4-26b-a4b-it');
      expect(JSON.parse(gemmaOptions.payload).generationConfig).toEqual({});
    });

    describe('com 503 lento (~60s, visto ao vivo sob "high demand")', () => {
      let now;
      beforeEach(() => {
        now = 0;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
      });
      afterEach(() => {
        jest.restoreAllMocks();
      });

      const slowOverloaded = () => {
        now += 60000;
        return { getResponseCode: () => 503, getContentText: () => '{"error":{"message":"overloaded"}}' };
      };

      it('não retenta o mesmo modelo e passa direto pro próximo', () => {
        global.UrlFetchApp.fetch
          .mockImplementationOnce(slowOverloaded)
          .mockReturnValueOnce({
            getResponseCode: () => 200,
            getContentText: () =>
              JSON.stringify({
                candidates: [{ content: { parts: [{ text: JSON.stringify({
                  valor: 100, categoria: 'Mercado', descricao: 'compras', data: '2026-08-30', precisa_revisao: false,
                }) }] } }],
              }),
          });

        const draft = ai.parseExpense('paguei 100 reais de compras', ['Mercado']);

        expect(draft.descricao).toBe('compras');
        expect(global.Utilities.sleep).not.toHaveBeenCalled();
        expect(global.UrlFetchApp.fetch.mock.calls[0][0]).toContain('/gemini-3.5-flash-lite:');
        expect(global.UrlFetchApp.fetch.mock.calls[1][0]).toContain('/gemini-3.1-flash-lite:');
      });

      it('para a cadeia antes do limite de 6 min do Apps Script, pra ainda dar tempo de avisar o erro', () => {
        global.UrlFetchApp.fetch.mockImplementation(slowOverloaded);

        expect(() => ai.parseExpense('paguei 100 reais de faxina', [])).toThrow(/sem tempo para tentar: gemma-4-26b-a4b-it, gemma-4-31b-it/);
        // 4 chamadas de 60s (os dois lite, 3.5-flash, flash-latest); a 5ª não caberia no orçamento
        expect(global.UrlFetchApp.fetch).toHaveBeenCalledTimes(4);
        expect(now).toBeLessThanOrEqual(300000);
      });
    });

    it('não tenta o Gemma para áudio (sem suporte nesses tamanhos)', () => {
      global.UrlFetchApp.fetch.mockReturnValue({
        getResponseCode: () => 503,
        getContentText: () => '{"error":{"message":"overloaded"}}',
      });

      expect(() => ai.parseExpense(null, [], { mimeType: 'audio/ogg', data: 'QUJD' })).toThrow(/503/);
      // 3 no principal + 1 em cada um dos outros 3 Gemini; nenhum Gemma
      expect(global.UrlFetchApp.fetch).toHaveBeenCalledTimes(6);
      global.UrlFetchApp.fetch.mock.calls.forEach(([url]) => expect(url).not.toContain('gemma'));
    });

    it('cai pro modelo de reserva quando a cota diária do modelo principal esgota (429 RESOURCE_EXHAUSTED)', () => {
      global.UrlFetchApp.fetch
        .mockReturnValueOnce({
          getResponseCode: () => 429,
          getContentText: () => '{"error":{"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}}',
        })
        .mockReturnValueOnce({
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: JSON.stringify({
                valor: 100, categoria: 'Mercado', descricao: 'compras', data: '2026-08-30', precisa_revisao: false,
              }) }] } }],
            }),
        });

      const draft = ai.parseExpense('paguei 100 reais de compras', ['Mercado']);

      expect(draft.descricao).toBe('compras');
      // não deve esperar antes de trocar de modelo (não adianta pra cota diária)
      expect(global.Utilities.sleep).not.toHaveBeenCalled();
      expect(global.UrlFetchApp.fetch).toHaveBeenCalledTimes(2);
      const [firstUrl] = global.UrlFetchApp.fetch.mock.calls[0];
      const [secondUrl] = global.UrlFetchApp.fetch.mock.calls[1];
      expect(firstUrl).not.toEqual(secondUrl);
    });

    it('cai pro modelo de reserva mesmo quando a falha do principal não é de cota (qualquer erro definitivo)', () => {
      global.UrlFetchApp.fetch
        .mockReturnValueOnce({
          getResponseCode: () => 400,
          getContentText: () => '{"error":{"status":"INVALID_ARGUMENT","message":"bad request"}}',
        })
        .mockReturnValueOnce({
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: JSON.stringify({
                valor: 100, categoria: 'Mercado', descricao: 'compras', data: '2026-08-30', precisa_revisao: false,
              }) }] } }],
            }),
        });

      const draft = ai.parseExpense('paguei 100 reais de compras', ['Mercado']);

      expect(draft.descricao).toBe('compras');
      expect(global.UrlFetchApp.fetch).toHaveBeenCalledTimes(2);
    });

    it('envia a part de mídia (áudio) até o corpo da requisição ao Gemini', () => {
      global.UrlFetchApp.fetch.mockReturnValue({
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    valor: 12,
                    categoria: 'Transporte',
                    descricao: 'uber',
                    data: '2026-09-02',
                    precisa_revisao: false,
                  }),
                }],
              },
            }],
          }),
      });

      const draft = ai.parseExpense(null, ['Transporte'], { mimeType: 'audio/ogg', data: 'QUJD' });

      expect(draft.descricao).toBe('uber');
      const requestBody = JSON.parse(global.UrlFetchApp.fetch.mock.calls[0][1].payload);
      const parts = requestBody.contents[0].parts;
      expect(parts.some((p) => p.inline_data && p.inline_data.mime_type === 'audio/ogg')).toBe(true);
    });
  });

  describe('buildBatchPrompt', () => {
    it('inclui a lista de categorias e pede uma lista JSON', () => {
      const parts = ai.buildBatchPrompt(null, ['Mercado'], { mimeType: 'image/jpeg', data: 'QUJD' });
      const combined = parts.map((p) => p.text).filter(Boolean).join(' ');

      expect(combined).toContain('Mercado');
      expect(combined).toContain('LISTA');
      expect(parts.some((p) => p.inline_data && p.inline_data.mime_type === 'image/jpeg')).toBe(true);
    });
  });

  describe('parseExpenseListResponse', () => {
    function geminiListResponse(list) {
      return {
        candidates: [{ content: { parts: [{ text: JSON.stringify(list) }] } }],
      };
    }

    it('faz o parse de uma lista com vários lançamentos', () => {
      const raw = geminiListResponse([
        { valor: 84.23, categoria: 'Combustível', descricao: 'Ipiranga Mobile', data: '2026-08-19', precisa_revisao: false },
        { valor: 50.9, categoria: 'Restaurantes', descricao: "McDonald's", data: '2026-08-12', precisa_revisao: false, registro_cartao: 'Google Pay' },
      ]);

      const drafts = ai.parseExpenseListResponse(raw);

      expect(drafts).toHaveLength(2);
      expect(drafts[0]).toEqual({
        valor: 84.23,
        categoria: 'Combustível',
        descricao: 'Ipiranga Mobile',
        data: '2026-08-19',
        precisa_revisao: false,
        registro_cartao: '',
      });
      expect(drafts[1].registro_cartao).toBe('Google Pay');
    });

    it('retorna lista vazia quando não há despesas identificáveis', () => {
      expect(ai.parseExpenseListResponse(geminiListResponse([]))).toEqual([]);
    });

    it('descarta itens malformados mas mantém os válidos', () => {
      const raw = geminiListResponse([
        { valor: 10, categoria: 'Mercado', descricao: 'compras', data: '2026-08-01', precisa_revisao: false },
        { valor: 'não é número', categoria: 'Mercado', descricao: 'item inválido', data: '2026-08-01', precisa_revisao: false },
      ]);

      expect(ai.parseExpenseListResponse(raw)).toHaveLength(1);
    });

    it('retorna null se a resposta não for uma lista', () => {
      const raw = geminiListResponse({ valor: 10 });

      expect(ai.parseExpenseListResponse(raw)).toBeNull();
    });

    it('retorna null se o texto gerado não for JSON válido', () => {
      const raw = { candidates: [{ content: { parts: [{ text: 'não é json' }] } }] };

      expect(ai.parseExpenseListResponse(raw)).toBeNull();
    });
  });

  describe('parseExpenses', () => {
    it('orquestra buildBatchPrompt + callGemini + parseExpenseListResponse', () => {
      global.UrlFetchApp.fetch.mockReturnValue({
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify([
                    { valor: 84.23, categoria: 'Combustível', descricao: 'Ipiranga', data: '2026-08-19', precisa_revisao: false },
                    { valor: 57.26, categoria: 'Combustível', descricao: 'Ipiranga', data: '2026-08-15', precisa_revisao: false },
                  ]),
                }],
              },
            }],
          }),
      });

      const drafts = ai.parseExpenses(null, ['Combustível'], { mimeType: 'image/jpeg', data: 'QUJD' });

      expect(drafts).toHaveLength(2);
    });

    it('lança um erro com o status e o corpo quando o Gemini responde com erro HTTP', () => {
      global.UrlFetchApp.fetch.mockReturnValue({
        getResponseCode: () => 429,
        getContentText: () => '{"error":{"message":"Quota exceeded"}}',
      });

      expect(() => ai.parseExpenses(null, [], { mimeType: 'image/jpeg', data: 'QUJD' })).toThrow(/429/);
    });
  });

  describe('buildCorrectionPrompt', () => {
    it('inclui o item atual, a correção pedida e as categorias', () => {
      const currentItem = {
        valor: 100, categoria: 'Bar', descricao: 'Barzinho', data: '2026-08-29', registro_cartao: '',
      };
      const parts = ai.buildCorrectionPrompt(currentItem, 'na verdade foi R$150', ['Bar', 'Mercado']);
      const combined = parts.map((p) => p.text).join(' ');

      expect(combined).toContain('"valor":100');
      expect(combined).toContain('na verdade foi R$150');
      expect(combined).toContain('Mercado');
    });
  });

  describe('correctExpense', () => {
    it('orquestra buildCorrectionPrompt + callGemini + parseExpenseResponse', () => {
      global.UrlFetchApp.fetch.mockReturnValue({
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    valor: 150,
                    categoria: 'Bar',
                    descricao: 'Barzinho',
                    data: '2026-08-29',
                    precisa_revisao: false,
                  }),
                }],
              },
            }],
          }),
      });

      const currentItem = {
        valor: 100, categoria: 'Bar', descricao: 'Barzinho', data: '2026-08-29', registro_cartao: '',
      };
      const updated = ai.correctExpense(currentItem, 'na verdade foi R$150', ['Bar']);

      expect(updated.valor).toBe(150);
      expect(global.UrlFetchApp.fetch).toHaveBeenCalledTimes(1);
    });

    it('retorna null quando a resposta do Gemini não tem o formato esperado', () => {
      global.UrlFetchApp.fetch.mockReturnValue({
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify({ candidates: [{ content: { parts: [{ text: 'não é json' }] } }] }),
      });

      const currentItem = {
        valor: 100, categoria: 'Bar', descricao: 'Barzinho', data: '2026-08-29', registro_cartao: '',
      };
      expect(ai.correctExpense(currentItem, 'na verdade foi R$150', ['Bar'])).toBeNull();
    });
  });
});
