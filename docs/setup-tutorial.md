# Tutorial: publique sua própria instância do bot

Este tutorial te leva do zero até um bot funcionando no seu Telegram, registrando despesas na sua própria planilha. Leva uns 15-20 minutos e **não exige conhecimento técnico** — só ir seguindo os passos.

Importante antes de começar: cada pessoa publica a **própria** instância. Sua planilha, seu bot e sua chave de IA são só seus — a pessoa que te passou este tutorial não tem (e nunca vai ter) acesso a nada do que você configurar aqui.

Você vai precisar de:
- Uma conta Google (a mesma que você já usa pro Gmail/Drive serve).
- O app do Telegram instalado (celular ou computador).
- ~15-20 minutos sem interrupção.

---

## Passo 1 — Copiar a planilha-modelo

1. Abra o link da planilha-modelo que te passaram: `[LINK DA PLANILHA-MODELO]`
2. No menu, vá em **Arquivo > Fazer uma cópia**.
3. Dê um nome pra sua cópia (ex: "Despesas — [seu nome]") e salve na sua própria conta Google.
4. Pronto — o script do bot **já vem junto** com a cópia, você não precisa copiar nenhum código. A partir daqui, tudo que você fizer é só na sua cópia.

## Passo 2 — Criar seu bot no Telegram

1. No Telegram, procure por **@BotFather** (ou abra [t.me/BotFather](https://t.me/BotFather)) e inicie uma conversa.
2. Mande o comando `/newbot`.
3. Escolha um nome de exibição (ex: "Despesas da Maria") e depois um *username* único terminado em `bot` (ex: `despesasdamaria_bot`) — o BotFather avisa se já estiver em uso.
4. O BotFather responde com uma mensagem contendo um **token** (algo como `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`). Copie e guarde esse token — é a única credencial da sua instância que dá acesso ao SEU bot; não compartilhe com ninguém.
5. **Importante**: essa mesma mensagem do BotFather traz um link tipo `t.me/seu_username_bot` — é **clicável** e abre direto a conversa com o SEU bot novo. Não precisa lembrar do username depois: quando chegar no Passo 6, é só voltar nessa conversa com o BotFather e clicar nesse link de novo.

## Passo 3 — Criar sua chave de API do Gemini (gratuita)

1. Acesse [aistudio.google.com](https://aistudio.google.com/) e faça login com a mesma conta Google da sua planilha.
2. Procure a opção **Get API key** (ou "Criar chave de API") e gere uma chave nova.
3. Copie a chave gerada e guarde — assim como o token do bot, ela é só sua.

## Passo 4 — Publicar como Web App

1. Na sua cópia da planilha, vá em **Extensões > Apps Script**. Isso abre o editor de código já vinculado à sua planilha.
2. Clique no botão azul **Implantar** (canto superior direito) > **Nova implantação**.
3. Clique no ícone de engrenagem ao lado de "Selecionar tipo" e escolha **App da Web**.
4. Configure:
   - **Executar como**: Eu (sua conta)
   - **Quem tem acesso**: Qualquer pessoa
5. Clique em **Implantar**. Pode pedir pra você autorizar o script a acessar sua planilha — autorize (é a sua própria planilha, sob a sua própria conta).

Não precisa copiar a URL gerada nem mexer em nada mais aqui — o próximo passo cuida disso sozinho.

## Passo 5 — Configurar o bot (um formulário, sem código)

1. Feche o editor do Apps Script e volte pra sua planilha (recarregue a página se ela já estava aberta).
2. Vai aparecer um menu novo: **⚙️ Configurar Bot**. Clique nele e depois em **Configurar/atualizar credenciais**.
3. Cole o **token do bot** (Passo 2) e a **chave do Gemini** (Passo 3) nos dois campos e clique em **Configurar**.
4. Isso já faz tudo: salva as credenciais, gera um segredo aleatório para o webhook e registra esse endereço no Telegram — sem precisar abrir Propriedades do Script nem rodar nenhum comando. Se aparecer uma mensagem verde "Tudo certo!", terminou.

Se o menu "⚙️ Configurar Bot" não aparecer, recarregue a página da planilha (ele só é criado quando ela é aberta).

## Passo 6 — Mandar a primeira mensagem

1. No Telegram, volte na conversa com o **@BotFather** (Passo 2) e clique no link `t.me/seu_username_bot` que ele te mandou — isso abre a conversa com o SEU bot. Mande `/start` (ou qualquer mensagem).
2. O bot responde confirmando que foi configurado pra você. A partir daqui, só ele responde a você — ninguém mais consegue usar essa instância.

## Testando

Mande uma mensagem de teste, tipo "gastei 20 reais no mercado". O bot deve mostrar o que entendeu e pedir confirmação com botões — clique em **Confirmar** e veja a linha aparecer na sua planilha, na aba "Lançamento".

---

## Problemas comuns

- **O bot não responde nada**: confira se o Passo 4 (publicar o Web App) já estava feito quando você usou o menu "⚙️ Configurar Bot" — se não estava, o formulário avisa que precisa publicar primeiro. Se você publicou depois, é só abrir o menu de novo (ele já vem com o token e a chave preenchidos) e clicar em "Configurar" mais uma vez pra registrar o webhook.
- **"Este bot já está configurado para outra pessoa"**: alguém (ou você mesma, testando) já mandou a primeira mensagem antes. Se for sua própria instância de teste, apague a propriedade `OWNER_TELEGRAM_ID` em Configurações do projeto > Propriedades do script e mande `/start` de novo.
- **Erro ao interpretar a despesa / demora muito**: quando o modelo principal está sobrecarregado, o bot tenta sozinho outros modelos (outros Gemini Flash e, por último, o Gemma 4) — nesses momentos a resposta pode levar até 1-2 minutos, mas chega. Se mesmo assim vier um erro, é porque todos estavam indisponíveis (tente de novo em alguns instantes) ou a chave do Gemini está incorreta. Notas de voz não passam pelo Gemma, então dependem só dos modelos Gemini.
