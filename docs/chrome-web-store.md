# Publicação na Chrome Web Store

Roteiro para cadastrar e atualizar o Panda QA Recorder na Chrome Web Store. Os textos abaixo são para colar nos campos do painel.

## Antes da primeira publicação

1. Criar a conta de desenvolvedor em https://chrome.google.com/webstore/devconsole com a conta Google que vai ser dona da extensão. A taxa é de US$ 5, paga uma vez.
2. Ativar a verificação em duas etapas da conta Google (o painel exige).
3. Publicar o servidor na Vercel para a política de privacidade ficar no ar em `https://<servidor>/privacidade.html`.
4. Gerar o pacote: `npm run pack` cria `dist/panda-qa-recorder-<versão>.zip`.

## Item novo

No painel: **Adicionar novo item** e enviar o zip.

### Aba "Detalhes da loja"

- Nome: Panda QA Recorder
- Resumo (até 132 caracteres): Grave fluxos de teste no front (login, cadastro, checkout), mantenha a lista de passos e repita quando precisar.
- Categoria: Ferramentas para desenvolvedores
- Idioma: Português (Brasil)
- Descrição:

```
Ferramenta de QA para gravar e repetir testes de front-end em lojas (pensada para Magento, funciona em qualquer site).

- Grave um fluxo navegando normalmente: cliques, campos, seleções e navegação viram uma lista de passos editável.
- Repita um teste, vários ou todos do site, uma ou várias vezes com intervalo.
- Quando falha, a extensão guarda o print, as mensagens da página, os erros de JavaScript e as requisições com erro.
- Auto-correção de seletores quando o elemento muda de lugar.
- Variáveis para rodar o mesmo teste em local, staging e produção.
- Exporte a lista de passos, o JSON para o dev ou um teste Playwright.
- Backup automático em arquivo e backup completo criptografado.

Opcionais, desligados por padrão:
- Diagnóstico com IA local (o modelo roda no navegador, nada é enviado).
- Servidor do time para aprendizado conjunto e radar de falhas entre lojas.
- Integração com o ClickUp para lançar horas e comentar o resultado.
```

- Ícone: `icons/icon128.png`
- Capturas de tela (1280x800 ou 640x400, de 1 a 5): usar as do guia em `docs/guia` ou rodar `npm run guide:screens` e redimensionar.
- Bloco promocional pequeno (440x280): obrigatório; montar com o logo e o nome.

### Aba "Privacidade"

Finalidade única:

```
Gravar e repetir fluxos de teste de front-end em sites, mostrando onde e por que o teste falhou.
```

Justificativa das permissões:

| Permissão | Justificativa |
|---|---|
| sidePanel | A lista de testes, a gravação e os resultados ficam no painel lateral. |
| storage | Guarda os testes, o histórico, as variáveis e as configurações no navegador. |
| unlimitedStorage | Os prints de falha e o histórico de execuções passam do limite padrão de 10 MB. |
| tabs | Abre e navega a aba do teste, lê a URL para saber o site e tira o print da falha. |
| scripting | Injeta o script de gravação e de replay nas abas que já estavam abertas antes da instalação. |
| webNavigation | Detecta a navegação entre páginas durante a gravação e o replay para continuar no passo certo. |
| webRequest | Registra requisições com erro (4xx, 5xx, falha de rede) na aba testada, para o relatório da falha. Só observa, não bloqueia nem altera. |
| downloads | Salva o backup automático, os exports e o relatório em Downloads. |
| alarms | Agenda o backup automático e o envio em lote dos sinais do radar (quando ligado). |
| browsingData | Limpa cookies e dados salvos só do site testado antes de cada execução, para o teste começar numa sessão limpa. |
| Permissão de host (`<all_urls>`) | O QA testa sites diferentes (local, staging, produção de vários clientes), que não dá para listar antes. A extensão precisa gravar e repetir os passos e capturar os erros em qualquer um deles. |

Código remoto: **Não, não estou usando código remoto.** O modelo do time baixado do servidor é só um arquivo de pesos (dados), não código executável.

Uso de dados (marcar):
- Informações de autenticação: sim (senhas de teste guardadas como variáveis, só no navegador).
- Conteúdo do site: sim (passos, textos e prints da página testada, só no navegador).
- Histórico da Web: sim (URLs dos passos gravados, só no navegador).
- Marcar as três declarações: não vende dados, não usa para fins fora da finalidade única, não usa para crédito.

URL da política de privacidade: `https://<servidor>/privacidade.html`

### Aba "Distribuição"

- Visibilidade: **Não listada** (só quem tem o link instala) ou **Particular** (só contas de um domínio Google Workspace ou testers). Para uso interno do time, prefira **Não listada**.
- Regiões: todas.

Enviar para revisão. A primeira revisão costuma levar de alguns dias a algumas semanas por causa das permissões amplas.

## Atualizar

1. Subir a versão em `manifest.json`, `package.json` e `version.json`.
2. `npm run pack`.
3. No painel, no item: **Pacote** > **Enviar novo pacote** e enviar o zip.

Quem instalou pela loja recebe a versão nova sozinho. Nessa instalação a extensão não consulta o `version.json` do GitHub nem mostra o aviso de baixar o zip.
