# Panda QA Recorder

<img src="icons/icon128.png" width="64" alt="">

Guia para o time de QA (instalação e uso, com prints): [docs/Panda-QA-Recorder-Guia.pdf](docs/Panda-QA-Recorder-Guia.pdf).

Extensão do Chrome para gravar fluxos de teste no front (login, cadastro, checkout), manter a lista de passos e repetir quando precisar.

## Instalação

Baixe o `panda-qa-recorder.zip` da [última versão](https://github.com/diazrma/panda-qa-recorder/releases/latest).


1. Descompacte o zip numa pasta fixa (não apague a pasta depois).
2. No Chrome, abra `chrome://extensions` e ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha a pasta descompactada.
4. Fixe o ícone da extensão na barra (ícone de quebra-cabeça → alfinete). Clicar nele abre o painel lateral.

### Atualizar

A extensão verifica duas vezes por dia o [`version.json`](version.json) deste repositório e mostra **Nova versão X** no painel (ou em Configurações > Atualização > Verificar atualização). Para atualizar: baixe o zip pelo aviso, descompacte por cima da pasta da extensão e clique em **Recarregar extensão**. Os testes continuam salvos. A troca de arquivos é manual porque o Chrome não deixa uma extensão instalada pela pasta alterar os próprios arquivos.

## Gravar um teste

1. Abra a página da loja na aba atual.
2. No painel, clique em **Gravar novo teste** e dê um nome ao teste.
3. Faça o fluxo normalmente. Cada clique, campo preenchido e opção selecionada aparece como um passo.
4. Use **Verificação** para conferir que algo apareceu na tela: clique no botão e depois no texto da página (por exemplo, "Pedido realizado com sucesso"). Esc cancela.
5. Clique em **Parar gravação**.

Para completar um teste existente, abra-o e clique em **Continuar gravando**: os novos passos entram no final.

## Repetir

- **Executar**: roda o teste na aba atual, do primeiro passo ao último.
- **▶ ao lado de um passo**: roda a partir daquele passo, útil para depurar.
- **Executar todos** (na lista): roda todos os testes em sequência.
- **Começar com sessão limpa** (ligado por padrão): antes de cada execução apaga cookies e dados só do site do teste, para começar deslogado e com carrinho vazio.

Cada passo fica verde quando passa e vermelho quando falha, com a mensagem do erro. Na falha, a extensão guarda um print da tela, que aparece no topo do teste (clique para ampliar). O histórico guarda as últimas 15 execuções.

## Repetir várias vezes

Abaixo dos botões do teste: **Repetir N vez(es)** e **intervalo** em segundos entre uma execução e outra (até 500 repetições). Cada repetição gera variáveis novas (outro `{{$email}}`, outro `{{$cpf}}`), então dá para criar vários cadastros seguidos. No fim aparece o placar ("8 de 10 execuções passaram"); se alguma falhou, a última falha fica guardada com print e erros, mesmo que as seguintes tenham passado. O botão **Parar** interrompe inclusive durante o intervalo.

## Quando falha: o que a extensão captura

- **Mensagem do erro** do passo (ex.: "Elemento não encontrado: título").
- **Mensagens na página**: avisos de erro do Magento (`.message-error`), erros de validação de campo (`Campo: This is a required field.`) e alertas (`role=alert`), lidos no momento da falha.
- **Erros capturados por passo**: erros de JavaScript, `console.error`, requisições com status 4xx/5xx (página e AJAX) e falhas de rede. Aparecem embaixo do passo em que aconteceram, mesmo quando o teste passa.
- **Print da tela** no momento da falha.

Com isso, **Baixar relatório** gera um HTML com tudo (passos, erros, mensagens e print) para anexar na tarefa, e **Copiar resumo** copia em texto para colar direto no comentário.

## Diagnóstico com IA local (TensorFlow.js)

Quando um teste falha, o painel mostra o tipo provável da falha, a confiança, a explicação e o que fazer, e indica a origem: ajustar o teste, problema no site ou ambiente. O modelo roda dentro da extensão (TensorFlow.js, backend WebGL ou CPU), e nada é enviado para serviços de terceiros.

Categorias: elemento mudou ou sumiu, sessão de execução anterior, captcha, lentidão, erro no servidor (5xx), campo obrigatório ou inválido, recusa da loja, dado já cadastrado, erro de JavaScript, redirecionamento inesperado, texto diferente e configuração do teste.

- O modelo base vem treinado em `lib/model/` (gerado por `npm run train` a partir de exemplos de falhas típicas de Magento em pt/es/en), então a primeira análise é imediata.
- **Está certo** e **Corrigir** ensinam o modelo: as correções ficam salvas no navegador e o modelo é retreinado localmente.
- O diagnóstico vai no relatório, no resumo e no JSON para o dev.

## Separar por site

O seletor acima da lista mostra os sites dos testes, com a contagem de cada um. Escolhido um site, a lista e o **Executar todos** passam a valer só para ele, e a escolha fica salva. O site é gravado junto com o teste na primeira gravação. Testes antigos usam a primeira URL gravada ou, se ela é `{{baseUrl}}`, o valor da variável. **Usar o site da aba atual** cadastra a loja aberta na aba, e **Renomear** troca o nome mostrado (ex.: "Mueller · staging"). Dentro do teste, o campo **Site** muda o site dele.

## Teste instável

Quando um teste alterna entre passar e falhar nas últimas 10 execuções, a lista mostra **Instável · 3/10** e, dentro do teste, a chance de falhar na próxima. Nesses casos, rode de novo antes de abrir bug.

## Lançar horas no ClickUp

Em Configurações > ClickUp, cole o seu token pessoal (ClickUp: avatar > Settings > Apps > API Token). As horas saem no seu nome. Dentro do teste, pesquise a tarefa pelo nome/ID ou cole o link/ID para vincular. O dropdown de status carrega as opções da lista da tarefa e salva a alteração no ClickUp. A duração vem do relógio da sessão de QA, que começa na primeira gravação ou execução depois do último lançamento, e pode ser editada. Opcional: comentar na tarefa com o resumo e o relatório HTML anexado, e mover para o status configurado quando o teste passou. Embaixo aparece o que já foi lançado na tarefa por todo mundo.

## Servidor do time (aprendizado federado e radar)

Em Configurações > Time, informe o endereço do servidor e a chave do time.

- **Aprender com o time**: a extensão baixa o modelo do time e o ajusta com as suas correções. Só a diferença de pesos (números) vai para o servidor, nunca texto, URL ou print. O servidor junta as contribuições numa rodada, descarta as que pioram o modelo nos casos de referência, faz a média e só publica a versão nova se ela não errar mais que a anterior. As extensões baixam a versão nova em até 15 minutos.
- **Radar das lojas**: a cada execução vai o apelido do site (hash do endereço), o trecho da URL com só as partes conhecidas do Magento (`/checkout#payment`, produto vira `*`), se passou ou falhou, o tempo e os números da falha. O servidor classifica a falha e aponta quebra nova: um trecho que passava e começou a falhar para mais de um QA na janela recente.

- **Link do relatório**: em Compartilhar > Link do relatório (ou **Copiar link do relatório** na falha), o relatório vai para o servidor e vira um link individual, `https://<servidor>/relatorio/<número>`, com botão **Baixar PDF**. O link só abre com a chave do time: na primeira vez a página pede a chave e o navegador fica liberado por 90 dias. Gerar uma chave nova no admin derruba todos os acessos. Com o servidor configurado, o comentário do ClickUp leva esse link em vez do HTML anexado.

O painel do servidor (página inicial, protegida pela senha do admin) mostra os alertas, o mapa de calor por site e trecho, as rodadas do aprendizado, permite voltar o modelo para uma versão anterior e abrir o bug de um alerta no ClickUp. O bug automático vem desligado e só cria tarefa quando é ligado no painel.

### Subir o servidor

Projeto Vercel na raiz deste repositório, com Vercel Blob ligado. Variáveis:

| Variável | Para que serve |
|---|---|
| `ADMIN_SENHA` | Senha do painel (mínimo 8 caracteres). |
| `EQUIPE_CHAVE` | Chave inicial do time. Depois, o cartão **Chave do time** do admin mostra, copia e gera uma nova (vale na hora, sem deploy; a antiga para de funcionar). |
| `BLOB_READ_WRITE_TOKEN` | Criada ao ligar o Blob no projeto. |
| `CLICKUP_TOKEN`, `CLICKUP_LISTA` | (opcional) Token e id da lista onde o radar abre bugs. |

Local: `npm run servidor` (lê `.env.local` e grava em `.dados/`; o token do Blob que o `vercel link` põe no `.env.local` é ignorado para não gravar em produção, a menos que rode com `USAR_BLOB=1`).

## Auto-correção de seletores

Ao gravar, cada passo guarda uma "impressão digital" do elemento (texto, rótulo, id, name, placeholder, aria-label, link, classes; nunca o valor digitado). Se nenhum seletor encontra o elemento, a extensão procura o mais parecido e só segue quando um candidato é claramente o melhor. O passo fica amarelo, e **Aplicar correção** atualiza os seletores, mantendo os antigos como reserva.

As duas funções têm chave em Configurações > Inteligência.


## Editar passos

Passe o mouse sobre um passo para ver as ações: executar a partir dali, editar, desativar e excluir. Arraste pela alça (⋮⋮) para reordenar. **+ Passo** adiciona passos manuais: abrir URL, esperar, verificar URL, verificar texto ou verificar que um elemento sumiu.

No editor:
- **Seletores**: como a extensão encontra o elemento, testados em ordem. Aceita CSS (`#email`, `button[type=submit]`) ou texto (`button:text=Finalizar compra`).
- **Testar na página**: destaca na aba atual o elemento que o passo encontraria.
- **Opcional**: se o passo falhar, o teste continua (útil para pop-ups que às vezes aparecem, como o de cookies).
- **Tempo limite**: quanto esperar o elemento, só para esse passo.

## Variáveis

Botão `{ }` no topo da lista. Use `{{nome}}` em URLs e valores.

| Variável | Para que serve |
|---|---|
| `baseUrl` | Endereço da loja. A URL gravada vira `{{baseUrl}}/...`; troque o valor para rodar o mesmo teste em local, staging ou produção. |
| `senha` | Preenchida sozinha com a senha digitada na gravação. O teste guarda só `{{senha}}`, nunca o valor. |
| `emailDomain` | (opcional) Domínio usado pelo `{{$email}}`. Padrão `example.com`. |
| `{{$email}}` | E-mail novo a cada execução. Use no cadastro para não dar "e-mail já cadastrado". O mesmo valor vale até o fim da execução, então serve também para o login seguinte. |
| `{{$cpf}}`, `{{$random}}`, `{{$timestamp}}`, `{{$date}}` | Gerados a cada execução. |

Variáveis marcadas como secretas (🔒) não saem no arquivo exportado.

## Compartilhar

Botão **Compartilhar** no teste:
- **Para outro QA**: copia um código (`PANDAQA1.…`) para colar no chat ou na tarefa. Quem recebe usa `⋯` > **Colar teste compartilhado** (pode colar a mensagem inteira).
- **Para o dev**: JSON com o teste e o resultado da última execução (passo que falhou, erro, mensagens da página, erros de JS, requisições com erro e a URL). O dev lê o arquivo ou importa na própria extensão para reproduzir.
- **Relatório da execução** (HTML com print) e **Lista de passos**.

## Backup

Em Configurações > Backup. Quando algum teste muda, a extensão salva sozinha `Downloads/panda-qa-recorder/backup-AAAA-MM-DD.json` (um arquivo por dia, padrão a cada 6 h; dá para mudar para 1 h, 24 h ou desligar). O arquivo fica fora do Chrome, então sobrevive a limpar dados, reinstalar a extensão ou trocar de computador. Leva todos os testes, histórico, resultados e variáveis, menos as senhas.

Para recuperar: **Restaurar backup** e escolha o arquivo. Nada é apagado: testes que não existem são adicionados, e os que existem só são atualizados se a versão do backup for mais nova. Depois, preencha de novo as variáveis secretas (`senha`).

## Exportar e importar

Menu `⋯` de cada teste:
- **Exportar lista de passos (.md)** ou **Copiar lista de passos**: a lista em texto, para colar na tarefa ou no plano de teste.
- **Exportar teste (.json)**: para outra pessoa importar.
- **Exportar Playwright (.spec.ts)**: o mesmo fluxo como teste automatizado de código, para rodar em CI.

No `⋯` da lista: **Exportar todos**, **Importar testes ou backup** e **Colar teste compartilhado**. Quem importa precisa cadastrar as próprias variáveis (`baseUrl`, `senha`).

## Configurações

Botão de engrenagem:
- **Tempo limite por passo**: padrão de 15 s.
- **Pausa entre passos**: aumente se a loja for lenta para reagir aos cliques.
- **Seletor de carregamento**: enquanto algum desses elementos estiver visível, o passo espera. O padrão já cobre o loader do Magento.

## Limitações

- **Pagamento em iframe**: campos de cartão do gateway e a tela do 3DS não podem ser automatizados (bloqueio de segurança do navegador). Use um meio de pagamento de teste (boleto, PIX, "check/money order").
- **Captcha e 2FA**: desative no ambiente de teste.
- **Dados reais**: rodar em produção cria pedidos e clientes de verdade. Prefira staging.
- **Durante o replay**, deixe a aba visível. A extensão precisa dela em primeiro plano para tirar o print em caso de falha.
- Páginas `chrome://` e a Chrome Web Store não aceitam extensões.

## Desenvolvimento

```bash
npm install
npm test                 # carrega a extensão no Chromium, grava, executa e tira prints em tests/out/
npm run test:time        # seletor de site, instável, ClickUp (API simulada) e servidor do time local
npm run test:servidor    # aprendizado federado, radar e bug automático do servidor
MAGENTO_URL=https://sua-loja.test npm run test:magento   # mesmo fluxo numa loja Magento real (prints em tests/out/magento/)
npm run guide:screens    # refaz os prints do guia usando a Loja Demo (tests/site)
npm run guide            # gera docs/Panda-QA-Recorder-Guia.pdf a partir de docs/guia/guia.html
npm run train            # retreina o modelo base do diagnóstico (lib/model/) depois de mudar lib/diagnosis.js
npm run pack             # gera dist/panda-qa-recorder-<versão>.zip
```

Se a versão do Playwright não encontrar o navegador, aponte para um Chromium já instalado: `CHROME_PATH=/caminho/do/chrome npm test`.

### Publicar uma versão

1. Suba `version` em `manifest.json`, `package.json` e `version.json` (com as notas).
2. `npm test && npm run pack`.
3. Crie o release `vX.Y.Z` no GitHub com o asset `dist/panda-qa-recorder.zip` (nome fixo: o link de download aponta para o último release).

## Terceiros

TensorFlow.js 4.22.0 (`lib/vendor/tf.min.js`), licença Apache 2.0.

Autor: Rodrigo Cardoso
