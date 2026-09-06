# Arquitetura

> **Nota**: este projeto ainda está em fase de planejamento — não há código escrito. Este documento registra a **intenção** arquitetural que orienta a implementação. A arquitetura detalhada da primeira feature está em [`specs/bot-despesas-telegram/architecture.md`](../specs/bot-despesas-telegram/architecture.md).

## Overview

Bot do Telegram que reduz a fricção de registrar despesas no dia a dia. A pessoa envia uma mensagem de texto, um áudio ou uma foto de comprovante ao bot; ele interpreta o conteúdo com IA, mostra o que entendeu e pede confirmação, e só então grava um lançamento estruturado (data, valor, categoria, descrição) na planilha do Google Sheets.

O sistema é um **template replicável**, não um serviço multi-tenant: cada pessoa publica sua própria instância isolada, com sua própria planilha, seu próprio bot do Telegram e sua própria chave de API. Não existe nenhuma conta, credencial ou backend compartilhado entre pessoas — ninguém (nem o autor do template) tem acesso aos dados de outra pessoa.

Prioridade central do projeto: **custo mínimo de operação** — todos os serviços usados operam dentro de camadas gratuitas.

## Stack

- **Arquitetura de repositório**: monolito — um único projeto Apps Script vinculado à planilha (container-bound)
- **Linguagem**: JavaScript (runtime V8 do Google Apps Script)
- **Gerenciador de pacotes**: npm (apenas para ferramentas de desenvolvimento — `clasp` e `jest`; o código publicado não tem dependências de runtime)
- **Publicação**: [`clasp`](https://github.com/google/clasp), mantendo o código do Apps Script versionado neste repositório
- **Testes**: Jest, rodando localmente em Node com os serviços do Google mockados
- **Hospedagem**: Google Apps Script Web App — sem servidor próprio, sem banco de dados
- **Integrações externas**: Telegram Bot API (webhook) e Gemini API (`generateContent`, entrada multimodal)
- **Persistência**: a própria planilha Google Sheets (dados de negócio), `PropertiesService` (configuração durável) e `CacheService` (estado efêmero)

## Modules

Projeto de módulo único. A estrutura prevista dentro de `src/`:

- `Code.js` — ponto de entrada `doPost`, validação do webhook e roteamento
- `config.js` — segredos e configuração via `PropertiesService`, incluindo o registro do dono da instância
- `telegram.js` — wrapper da API do Telegram
- `ai.js` — wrapper da API do Gemini (prompt, chamada, parsing da resposta)
- `sheets.js` — leitura de categorias e gravação de lançamentos na planilha vinculada
- `state.js` — rascunhos pendentes de confirmação, via `CacheService`

## Main Flows

**Registrar uma despesa**: mensagem no Telegram (texto/áudio/foto) → validação do segredo do webhook → verificação de que o remetente é o dono da instância → leitura das categorias da planilha → interpretação via Gemini → rascunho salvo em cache e enviado ao usuário com botões de confirmação → ao confirmar, o lançamento é gravado na planilha.

**Publicar uma instância**: copiar a planilha-modelo (o script vai junto) → criar um bot no BotFather → criar uma chave de API do Gemini → preencher as credenciais nas Propriedades do Script → publicar o Web App → registrar o webhook no Telegram → mandar a primeira mensagem, que registra o remetente como dono exclusivo daquela instância.

## CodeAdvisor Conventions

- language: pt-BR
- docs_location: docs
- project_skills_dir: none
- adr_policy: lightweight
- issue_tracker: none
- branch_template: `<type>/<short-description>`
- commit_types: feat, bug, hotfix, chore
- sonarqube_mode: none
