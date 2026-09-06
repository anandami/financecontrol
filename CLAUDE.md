# CLAUDE.md

## Propósito

Bot do Telegram que registra despesas em uma planilha do Google Sheets. A pessoa manda um texto, áudio ou foto de comprovante; o bot interpreta com IA, pede confirmação e grava o lançamento na planilha.

## Stack

- **JavaScript** no runtime V8 do **Google Apps Script**, vinculado à planilha (container-bound)
- **npm** + [`clasp`](https://github.com/google/clasp) para versionar o código do Apps Script neste repositório
- **Jest** para testes de lógica pura, com os serviços do Google mockados (não roda dentro do Apps Script)
- APIs externas: **Telegram Bot API** (webhook) e **Gemini** (`generateContent`, multimodal)

## Diretórios principais

- `src/` — código do Apps Script (`Code.js` é o ponto de entrada `doPost`)
- `tests/` — testes Jest da lógica pura
- `specs/` — especificações de feature (discover → design → plan), rascunho de trabalho
- `docs/` — documentação permanente e tutorial de setup para novos usuários

## Pontos de atenção

- **Isolamento total é requisito não-negociável**: cada pessoa roda sua própria instância (própria planilha, próprio bot, própria chave de API). Nunca introduzir uma conta, credencial ou backend compartilhado entre usuários.
- Segredos vivem no `PropertiesService` de cada instância, nunca no código nem no repositório.
- Como o script é vinculado à planilha, use sempre `SpreadsheetApp.getActiveSpreadsheet()` — nunca um ID de planilha hardcoded.
- Toda gravação passa por confirmação explícita do usuário (botões inline) antes de tocar a planilha.
- Colunas são resolvidas por nome de cabeçalho, não por letra fixa (exceto a coluna C de categorias na aba "Despesas").
- Idioma de documentação e commits: **pt-BR**.
