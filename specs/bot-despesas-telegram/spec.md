# Feature Specification: Bot de Controle de Despesas via Telegram

**Feature Branch**: `bot-despesas-telegram`
**Input**: User description: "Quero fazer algo que me ajude a controlar as despesas do mês. Ideia escolhida: um chat no Telegram conectado a uma planilha, em que eu mandaria em áudio, texto ou print de uma despesa e ele converteria em um lançamento na planilha. Prioridade: custo mínimo."

## Context and Understanding

Hoje o usuário controla as despesas mensais manualmente em uma planilha do Google Sheets já existente e em uso. O processo de registrar cada gasto (abrir a planilha, digitar linha por linha) é o ponto de fricção que este projeto ataca. A ideia é permitir registrar uma despesa "no calor do momento" — mandando uma mensagem de texto, um áudio ou um print (foto de comprovante/tela de pagamento) para um bot do Telegram — e o bot interpreta essa mensagem e grava automaticamente um lançamento estruturado na planilha.

Duas abordagens foram avaliadas (bot no Telegram vs. app Android/APK). O bot no Telegram foi escolhido por exigir muito menos desenvolvimento e manutenção, e por já resolver a captura de texto/áudio/imagem nativamente, alinhado ao critério de **custo mínimo**. Como destino dos dados, Google Sheets foi escolhido em vez de um arquivo Excel real (OneDrive), pois a API do Google Sheets é gratuita e mais simples de integrar (inclusive sem exigir servidor próprio, via Google Apps Script), enquanto o Excel real exigiria Microsoft Graph API com OAuth.

O escopo cresceu durante o discovery: o usuário quer, desde já, desenhar o sistema para ser usado por outras pessoas (amigas), cada uma com sua própria cópia da planilha e seus próprios lançamentos. Um requisito não-negociável surgiu depois da primeira versão da arquitetura: **isolamento total entre pessoas**. Nenhuma conta central — nem a do próprio usuário original — pode ter acesso de leitura ou edição aos dados financeiros de outra pessoa. Não é um serviço multi-tenant com um backend compartilhado; é um template replicável, onde cada pessoa (o usuário original incluído) roda sua própria instância independente, sem nenhum componente, credencial ou conta em comum com as demais.

## Feature Description

Um template de bot no Telegram que cada pessoa implanta para si mesma — com sua própria planilha, seu próprio bot do Telegram e sua própria chave de IA — que recebe mensagens descrevendo uma despesa — em texto livre, áudio ou foto/print de comprovante — interpreta o conteúdo (usando IA) e grava um lançamento estruturado na planilha Google Sheets *daquela pessoa e só dela*, respeitando a estrutura de abas que o usuário já usa (Lançamentos, Receitas, Despesas, Consolidado), sem exigir que ninguém abra a planilha ou digite manualmente, e sem que nenhuma outra pessoa (incluindo quem criou o template) tenha qualquer acesso aos seus dados.

Valor para o usuário: reduzir a fricção de registrar gastos no dia a dia, aumentando a chance de manter o controle financeiro atualizado, com custo de operação próximo de zero — e permitir que esse benefício seja compartilhado com outras pessoas sem que cada uma precise construir o próprio sistema.

## Requirements *(mandatory)*

### Proposed solution

- **US-001**: Como usuário, quero mandar uma mensagem de texto para o bot descrevendo um gasto (ex: "paguei 100 reais de faxina") para que ele vire automaticamente uma linha na minha planilha.
- **US-002**: Como usuário, quero mandar um áudio descrevendo o gasto para que o bot transcreva e registre o lançamento, sem eu precisar digitar.
- **US-003**: Como usuário, quero mandar um print/foto de um comprovante ou confirmação de pagamento para que o bot extraia os dados (valor, estabelecimento, data) e registre o lançamento.
- **US-004**: Como usuário, quero que o bot confirme o que entendeu antes de gravar (ou avise se não conseguiu interpretar), para eu não ter lançamentos errados na planilha sem perceber.
- **US-005**: Como usuário, quero compartilhar o template com amigas para que cada uma monte sua própria instância isolada (própria planilha, próprio bot no Telegram, própria chave de IA), sem que eu tenha acesso aos dados delas nem elas aos meus.
- **US-006**: Como nova usuária (amiga convidada), quero seguir um tutorial simples de setup — copiar a planilha-modelo, criar meu próprio bot no Telegram e minha própria chave de IA (ambos gratuitos), e publicar minha própria instância — sem depender de conhecimento técnico avançado.
- **US-007**: Como usuário, quero que o bot categorize automaticamente a despesa com base na minha lista de categorias já existente na planilha, para não ter que escolher manualmente toda vez.

### Functional Requirements

- **FR-001**: O sistema DEVE receber mensagens de texto enviadas ao bot no Telegram e extrair delas: valor, categoria e descrição da despesa.
- **FR-002**: O sistema DEVE receber mensagens de áudio, transcrever o conteúdo e extrair os mesmos dados de uma despesa.
- **FR-003**: O sistema DEVE receber uma imagem (foto/print de comprovante digital ou de nota fiscal/comprovante físico) e extrair dela os dados da despesa via reconhecimento de texto/imagem.
- **FR-004**: O sistema DEVE gravar cada despesa interpretada como uma nova linha na aba de lançamentos da planilha Google Sheets vinculada àquela instância, respeitando a estrutura de colunas já usada por ela.
- **FR-005**: O sistema DEVE mostrar ao usuário o que entendeu (valor, categoria, descrição, data) e pedir confirmação explícita antes de gravar o lançamento na planilha. Só grava após confirmação.
- **FR-006**: O sistema DEVE responder ao usuário no próprio chat confirmando o lançamento feito (ou o erro/ambiguidade encontrada, permitindo corrigir antes de confirmar).
- **FR-007**: O sistema DEVE operar dentro de camadas gratuitas de serviço sempre que possível (Telegram Bot API, Google Sheets API, e hospedagem/IA de baixo ou nenhum custo), inclusive à medida que mais pessoas passem a usar o bot.
- **FR-008**: Cada instância do sistema DEVE ser isolada — vinculada a exatamente uma planilha, um bot do Telegram e uma chave de IA próprios — sem nenhum componente, credencial ou conta compartilhada entre instâncias de pessoas diferentes. Nenhuma pessoa (incluindo o autor do template) DEVE ter acesso aos dados de outra por meio do sistema.
- **FR-009**: O sistema DEVE fornecer um tutorial de configuração para uma nova pessoa criar sua própria planilha (cópia do modelo), seu próprio bot do Telegram e sua própria chave de IA, e publicar sua própria instância — sem exigir conhecimento técnico avançado dela.
- **FR-010**: O sistema DEVE categorizar automaticamente cada despesa comparando com a lista de categorias já existente na planilha do usuário (coluna C da aba "Despesas"), em vez de usar uma lista fixa definida pelo desenvolvedor.
- **FR-011**: O sistema DEVE suportar lançamentos rápidos em linguagem natural livre (ex: "paguei 100 reais de faxina"), sem exigir foto ou formato específico.
- **FR-012**: Quando o sistema não conseguir interpretar uma mensagem (áudio inaudível, imagem ilegível, texto ambíguo, categoria sem correspondência), DEVE pedir para o usuário reformular/corrigir dentro do próprio fluxo de confirmação, em vez de descartar a mensagem ou gravar algo incerto.
- **FR-013**: O sistema DEVE gravar apenas despesas — receitas continuam sendo lançadas manualmente pelo próprio usuário direto na planilha, fora do escopo do bot nesta versão.
- **FR-014**: O sistema DEVE manter a estrutura de abas já usada pelo usuário (aba única de lançamentos de despesas, aba de Despesas com categorias, aba de Receitas mantida como está hoje, e aba de Consolidado). As colunas exatas de cada aba serão confirmadas durante `/design`/implementação, quando o acesso à planilha real estiver disponível.
- **FR-015**: Cada instância DEVE responder apenas à pessoa dona daquele bot — a primeira pessoa a enviar uma mensagem é registrada automaticamente como dona, e mensagens de qualquer outro remetente DEVEM ser recusadas com uma explicação, para impedir que alguém que descubra o nome do bot no Telegram consiga criar lançamentos na planilha de outra pessoa.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O usuário consegue registrar uma despesa por texto, áudio ou imagem em menos de 15 segundos de interação com o bot, sem abrir a planilha manualmente.
- **SC-002**: Pelo menos 90% dos lançamentos enviados em texto ou áudio são gravados na planilha com valor e categoria corretos após a confirmação do usuário.
- **SC-003**: O custo mensal de operação do sistema permanece dentro das camadas gratuitas dos serviços utilizados (Telegram, Google Sheets, e provedor de IA), mesmo com múltiplas pessoas usando o bot.
- **SC-004**: Uma nova pessoa (amiga convidada) consegue concluir o setup da própria planilha seguindo o tutorial, sem precisar de ajuda direta do usuário original.

## Clarification Needed

Todos os pontos levantados na primeira rodada foram resolvidos pelo usuário. Um ponto técnico fica registrado para a etapa de `/design`, não bloqueando o fechamento deste spec:

1. **Estrutura exata das colunas de cada aba** (Lançamentos, Despesas com sua coluna de categorias, Consolidado) só pode ser confirmada com acesso real à planilha — o usuário concorda em conceder esse acesso quando chegarmos à etapa de teste/implementação (login na conta do Google necessário). `/design` deve prever a autenticação (OAuth ou conta de serviço) como pré-requisito antes de mapear colunas com precisão.

## Notes

- Abordagem de plataforma (Telegram vs. APK) e destino dos dados (Google Sheets vs. Excel/OneDrive) já foram decididos com o usuário antes desta especificação: **Telegram + Google Sheets**, priorizando custo mínimo.
- Isolamento total entre pessoas é requisito não-negociável desde a primeira versão: nenhuma conta central (nem a do usuário original) pode ter acesso aos dados de outra pessoa. Isso deve ser considerado desde o design, não parchado depois.
- O sistema é um template replicável, não um serviço multi-tenant com backend compartilhado: cada pessoa (usuário original incluído) roda sua própria instância independente.
- Receitas ficam fora do escopo do bot nesta versão — o usuário continuará lançando receitas manualmente direto na planilha.
- Onboarding de uma nova pessoa: ela recebe a planilha-modelo (compartilhada pelo usuário original), faz sua cópia, cria seu próprio bot no Telegram e sua própria chave de IA, e publica sua própria instância a partir dessa cópia. O mecanismo exato desses passos é decisão de `/design`.
- O provedor de IA para transcrição de áudio e leitura de imagem/OCR ainda não foi escolhido — isso é decisão de arquitetura e cabe à etapa de `/codeadvisor-dev:design`, não a este documento. Vale considerar uma API multimodal única (texto + áudio + imagem) para reduzir custo e complexidade de integração, em vez de contratar serviços separados de OCR e transcrição.
- A categorização automática depende de conseguir ler a coluna de categorias existente na planilha de cada usuário (via Google Sheets API) antes de classificar o lançamento — isso é um detalhe de design, mas o requisito funcional (usar categorias já existentes na planilha do próprio usuário, não uma lista fixa do sistema) já está confirmado.
