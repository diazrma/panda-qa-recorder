/**
 * Diagnóstico de falhas com um classificador local (TensorFlow.js). Nada sai do navegador.
 *
 * Entrada: o que a execução já captura (tipo do passo, erro, mensagens da página, erros de
 * JS/HTTP, se a página parece logada). Saída: a categoria provável da falha, com explicação
 * e o que fazer. O modelo começa treinado com exemplos sintéticos de falhas típicas de lojas
 * Magento (pt/es/en) e é retreinado com as correções feitas pelo QA.
 *
 * Requer window.tf (lib/vendor/tf.min.js carregado antes, só nas páginas da extensão).
 */

export const CATEGORIES = [
  {
    key: 'selector', label: 'Elemento mudou ou sumiu', origin: 'teste',
    explain: 'O elemento do passo não foi encontrado e a página não mostrou erro. Normalmente o site mudou (layout, texto, classe) ou o elemento aparece só depois de alguma ação.',
    fix: 'Edite o passo e use "Testar na página" para ajustar os seletores, ou apague o passo e regrave o trecho com "Continuar gravando".',
  },
  {
    key: 'session', label: 'Sessão de uma execução anterior', origin: 'teste',
    explain: 'A página parece estar logada (ou com carrinho) quando o teste esperava começar do zero, por isso o botão de login ou o passo esperado não apareceu.',
    fix: 'Deixe marcado "Começar com sessão limpa" no teste, ou adicione no início os passos de sair da conta.',
  },
  {
    key: 'captcha', label: 'Captcha bloqueou', origin: 'ambiente',
    explain: 'A loja pediu captcha. No Magento isso acontece depois de algumas tentativas erradas com o mesmo e-mail, ou quando o captcha está sempre ligado.',
    fix: 'Use um e-mail novo a cada execução ({{$email}} ou rodrigo.test+{{$timestamp}}@example.com) ou peça para desativar o captcha no ambiente de teste.',
  },
  {
    key: 'timeout', label: 'Lentidão ou página travada', origin: 'ambiente',
    explain: 'A página não terminou de carregar, o loader ficou na tela ou a página parou de responder dentro do tempo limite.',
    fix: 'Rode de novo para ver se é intermitente. Se for lentidão do ambiente, aumente o tempo limite do passo ou a pausa entre passos em Configurações.',
  },
  {
    key: 'server', label: 'Erro no servidor', origin: 'site',
    explain: 'A loja respondeu com erro 5xx ou mostrou a página de erro do servidor. É um problema no back-end, não no teste.',
    fix: 'Abra um bug para o dev com o JSON da falha (Compartilhar > Para o dev): ele traz a requisição que falhou e o horário.',
  },
  {
    key: 'validation', label: 'Campo obrigatório ou inválido', origin: 'teste',
    explain: 'O formulário recusou o envio porque algum campo ficou vazio ou com formato inválido.',
    fix: 'Veja em "Mensagens na página" qual campo e confira o valor do passo (variável vazia, máscara, formato de CPF/RUT/CEP, data).',
  },
  {
    key: 'business', label: 'A loja recusou a ação', origin: 'site',
    explain: 'A loja mostrou uma mensagem de erro de negócio (login inválido, sem estoque, cupom inválido, frete indisponível). Pode ser o comportamento esperado para os dados usados ou um bug.',
    fix: 'Confira os dados do teste (usuário, senha, produto, CEP). Se os dados estão certos, abra um bug com o relatório.',
  },
  {
    key: 'duplicate', label: 'Dado já cadastrado', origin: 'teste',
    explain: 'O cadastro foi recusado porque o e-mail (ou documento) já existe, provavelmente criado por uma execução anterior.',
    fix: 'Troque o valor fixo por uma variável gerada: {{$email}}, {{$cpf}} ou rodrigo.test+{{$timestamp}}@example.com.',
  },
  {
    key: 'jserror', label: 'Erro de JavaScript na página', origin: 'site',
    explain: 'A página teve erro de JavaScript e o próximo elemento não apareceu. Em Magento é comum o checkout ou o mini carrinho pararem de montar por causa disso.',
    fix: 'Mande o JSON da falha para o dev: os erros de JS estão em "capturedErrors", com o passo em que aconteceram.',
  },
  {
    key: 'navigation', label: 'Foi para outra página', origin: 'site',
    explain: 'Depois da ação, a URL não é a esperada: houve um redirecionamento (para login, carrinho, home) ou a ação não saiu da página.',
    fix: 'Veja o print e a URL da falha. Se o redirecionamento é esperado, ajuste o passo "Verificar URL"; senão, abra um bug.',
  },
  {
    key: 'content', label: 'Texto diferente do esperado', origin: 'teste',
    explain: 'O elemento existe, mas o texto mudou (preço, tradução, nome do produto, mensagem).',
    fix: 'Se o texto novo está certo, edite a verificação; se não, abra um bug com o print.',
  },
  {
    key: 'config', label: 'Configuração do teste', origin: 'teste',
    explain: 'Falta configurar algo no teste, como uma variável sem valor, ou a aba não é de um site.',
    fix: 'Abra Variáveis ({ }) e preencha o que falta (baseUrl, senha). Rode o teste numa aba com a loja aberta.',
  },
];

const KEYS = CATEGORIES.map((c) => c.key);
const DIM = 1024;
const MODEL_URL = 'indexeddb://panda-qa-diagnosis';
// Mudar quando os exemplos-base ou as features mudarem, para forçar novo treino.
const MODEL_VERSION = 'v1';

// ---------- Features ----------

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function words(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\d+/g, ' ')
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2);
}

/** Tokens de uma falha: palavras + marcadores estruturais (prefixo "#"). */
export function tokensOf(failure) {
  const t = [];
  const add = (x) => t.push(x);
  add('#step:' + (failure.stepType || 'none'));
  const err = String(failure.error || '');
  if (/não encontrado|not found/i.test(err) && /^Elemento/i.test(err)) add('#err:notfound');
  if (/^Texto /i.test(err)) add('#err:text');
  if (/URL atual/i.test(err)) add('#err:url');
  if (/não terminou de carregar|não respondeu|loader/i.test(err)) add('#err:load');
  if (/Variável|Abra a página|não suportad|conectar/i.test(err)) add('#err:config');
  for (const w of words(err)) add('e:' + w);

  const messages = failure.messages || [];
  add(messages.length ? '#msg:yes' : '#msg:no');
  for (const m of messages) for (const w of words(m)) add('m:' + w);

  const logs = failure.logs || [];
  for (const l of logs) {
    if (l.kind === 'http') {
      const status = Number(String(l.text).split(' ')[0]);
      add(status >= 500 ? '#http:5xx' : '#http:4xx');
    } else if (l.kind === 'js') add('#js:error');
    else if (l.kind === 'console') add('#js:console');
    else if (l.kind === 'net') add('#net:error');
  }
  if (!logs.length) add('#logs:none');
  if (failure.loggedIn) add('#page:loggedin');
  for (const w of words(failure.stepLabel)) add('l:' + w);
  return t;
}

export function vectorize(tokens) {
  const v = new Float32Array(DIM);
  for (const tok of tokens) {
    const weight = tok.startsWith('#') ? 2 : 1;
    v[fnv1a(tok) % DIM] = Math.min(3, v[fnv1a(tok) % DIM] + weight);
  }
  return v;
}

// ---------- Exemplos-base (sintéticos) ----------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOISE_LOGS = [
  { kind: 'net', text: 'net::ERR_BLOCKED_BY_ORB GET https://www.googletagmanager.com/gtag/js' },
  { kind: 'net', text: 'net::ERR_BLOCKED_BY_CLIENT GET https://connect.facebook.net/en_US/fbevents.js' },
  { kind: 'http', text: '404 GET https://loja.test/static/frontend/Theme/pt_BR/images/banner.png' },
  { kind: 'console', text: 'Failed to load resource' },
];

const LABELS = ['Entrar', 'Finalizar compra', 'Comprar', 'Ingresar', 'Continuar', 'Próximo', 'Adicionar ao carrinho', 'Salvar', 'Login', 'Mi cuenta', 'Pagar', 'Cadastrar'];

const TEMPLATES = {
  selector: () => ({ stepType: ['click', 'type', 'select', 'assertVisible'], error: ['Elemento não encontrado: {label}'], messages: [[]], logs: [[], 'noise'] }),
  session: () => ({ stepType: ['click'], error: ['Elemento não encontrado: Entrar', 'Elemento não encontrado: Login', 'Elemento não encontrado: Ingresar', 'Elemento não encontrado: Iniciar sesión', 'Elemento não encontrado: Criar conta'], messages: [[]], logs: [[], 'noise'], loggedIn: true }),
  captcha: () => ({
    stepType: ['assertText', 'assertUrl', 'click', 'assertVisible'],
    error: ['Elemento não encontrado: {label}', 'URL atual "https://loja.test/customer/account/login/" não contém "/customer/account/index".', 'Texto "Bem-vindo" não encontrado. O elemento contém: "Acesso"'],
    messages: [['CAPTCHA incorrecto'], ['Incorrect CAPTCHA'], ['CAPTCHA incorreto.'], ['Por favor, escriba las letras y los números siguientes: Este campo es un campo obligatorio.'], ['Please type the letters and numbers below: This is a required field.'], ['Digite as letras e números abaixo: Este é um campo obrigatório.']],
    logs: [[], 'noise'],
  }),
  timeout: () => ({
    stepType: ['click', 'type', 'navigate', 'assertText'],
    error: ['A página não terminou de carregar no tempo limite.', 'A página continuou carregando (loader visível) até o tempo limite.', 'A página não respondeu (navegou ou travou).'],
    messages: [[]], logs: [[], 'noise'],
  }),
  server: () => ({
    stepType: ['click', 'assertText', 'assertUrl', 'navigate', 'type'],
    error: ['Elemento não encontrado: {label}', 'Texto "Pedido realizado" não encontrado. O elemento contém: "There has been an error processing your request"', 'URL atual "https://loja.test/checkout/" não contém "success".'],
    messages: [[], ['There has been an error processing your request'], ['Ocorreu um erro ao processar sua solicitação'], ['Service Unavailable'], ['Error 503 Backend fetch failed']],
    logs: [[{ kind: 'http', text: '500 POST https://loja.test/rest/default/V1/carts/mine/payment-information' }], [{ kind: 'http', text: '502 GET https://loja.test/checkout/' }], [{ kind: 'http', text: '503 POST https://loja.test/customer/section/load/' }], [{ kind: 'http', text: '500 GET https://loja.test/' }]],
  }),
  validation: () => ({
    stepType: ['assertUrl', 'click', 'assertText', 'assertVisible'],
    error: ['URL atual "https://loja.test/customer/account/create/" não contém "/customer/account/".', 'Elemento não encontrado: {label}', 'Texto "Obrigado" não encontrado. O elemento contém: "Cadastro"'],
    messages: [['Email: Este é um campo obrigatório.'], ['Contraseña: Este campo es un campo obligatorio.'], ['Telefone: This is a required field.'], ['CPF: Por favor, insira um CPF válido.'], ['CEP: Please enter a valid zip code.'], ['RUT: Ingrese un RUT válido.'], ['Senha: Mínimo de 8 caracteres.'], ['Please enter a valid email address (Ex: johndoe@domain.com).'], ['Nombre: Este campo es un campo obligatorio.', 'Email: Este campo es un campo obligatorio.']],
    logs: [[], 'noise'],
  }),
  business: () => ({
    stepType: ['assertUrl', 'assertText', 'click', 'assertVisible'],
    error: ['URL atual "https://loja.test/customer/account/login/" não contém "/customer/account/index".', 'Elemento não encontrado: {label}', 'Texto "Minha conta" não encontrado. O elemento contém: "Acesso"', 'URL atual "https://loja.test/checkout/cart/" não contém "/checkout/".'],
    messages: [['O login ou a senha estão incorretos.'], ['El acceso fue incorrecto o tu cuenta está desactivada temporalmente. Intenta más tarde.'], ['The account sign-in was incorrect or your account is disabled temporarily.'], ['A quantidade solicitada não está disponível.'], ['The requested qty is not available'], ['Produto fora de estoque.'], ['O código do cupom "TESTE10" não é válido.'], ['El código de cupón no es válido.'], ['Não há métodos de entrega disponíveis.'], ['Seu pagamento foi recusado.'], ['Esta conta não está confirmada.']],
    logs: [[], 'noise', [{ kind: 'http', text: '400 POST https://loja.test/rest/default/V1/carts/mine/coupons/TESTE10' }]],
  }),
  duplicate: () => ({
    stepType: ['assertUrl', 'assertText', 'click'],
    error: ['URL atual "https://loja.test/customer/account/create/" não contém "/customer/account/".', 'Texto "Obrigado por se cadastrar" não encontrado. O elemento contém: "Criar conta"', 'Elemento não encontrado: {label}'],
    messages: [['Já existe uma conta com este endereço de e-mail.'], ['There is already an account with this email address.'], ['Ya existe una cuenta con esta dirección de correo electrónico.'], ['Este CPF já está cadastrado.'], ['Este RUT ya está registrado.'], ['A customer with the same email address already exists in an associated website.']],
    logs: [[], 'noise'],
  }),
  jserror: () => ({
    stepType: ['click', 'type', 'assertVisible', 'select'],
    error: ['Elemento não encontrado: {label}'],
    messages: [[]],
    logs: [[{ kind: 'js', text: "Uncaught TypeError: Cannot read properties of undefined (reading 'quoteData') (checkout-loader.js:12)" }], [{ kind: 'js', text: 'Uncaught ReferenceError: jQuery is not defined (minicart.js:1)' }], [{ kind: 'js', text: "Uncaught Error: Script error for: Magento_Checkout/js/view/payment" }], [{ kind: 'js', text: 'Promise rejeitada: TypeError: Failed to fetch' }, { kind: 'console', text: 'knockout binding error' }], [{ kind: 'js', text: "Uncaught SyntaxError: Unexpected token '<' (requirejs-config.js:1)" }]],
  }),
  navigation: () => ({
    stepType: ['assertUrl'],
    error: ['URL atual "https://loja.test/" não contém "/checkout/onepage/success".', 'URL atual "https://loja.test/customer/account/login/" não contém "/checkout".', 'URL atual "https://loja.test/checkout/cart/" não contém "/checkout/#payment".', 'URL atual "https://loja.test/produto-x.html" não contém "/checkout/cart".'],
    messages: [[]], logs: [[], 'noise'],
  }),
  content: () => ({
    stepType: ['assertText'],
    error: ['Texto "R$ 199,90" não encontrado. O elemento contém: "R$ 189,90"', 'Texto "Frete grátis" não encontrado. O elemento contém: "Frete: R$ 15,00"', 'Texto "Camiseta Básica" não encontrado. O elemento contém: "Camiseta Basica Algodão"', 'Texto "Adicionar ao carrinho" não encontrado. O elemento contém: "Comprar"', 'Texto "Pedido realizado" não encontrado. O elemento contém: "Obrigado pela compra"'],
    messages: [[]], logs: [[], 'noise'],
  }),
  config: () => ({
    stepType: ['navigate', 'type', 'click'],
    error: ['Variável {{senha}} não definida. Cadastre em Variáveis.', 'Variável {{baseUrl}} não definida. Cadastre em Variáveis.', 'Não foi possível conectar à página (chrome://, loja do Chrome e PDFs não são suportados).', 'Abra a página da loja (http/https) nesta aba antes de gravar.'],
    messages: [[]], logs: [[]],
  }),
};

const pickOne = (r, arr) => arr[Math.floor(r() * arr.length)];

export function seedExamples(perCategory = 70) {
  const r = rng(20261026);
  const out = [];
  for (const key of KEYS) {
    for (let i = 0; i < perCategory; i++) {
      const t = TEMPLATES[key]();
      const label = pickOne(r, LABELS);
      let logs = pickOne(r, t.logs);
      if (logs === 'noise') logs = [pickOne(r, NOISE_LOGS)];
      else if (r() < 0.25) logs = [...logs, pickOne(r, NOISE_LOGS)];
      out.push({
        label: key,
        failure: {
          stepType: pickOne(r, t.stepType),
          stepLabel: label,
          error: pickOne(r, t.error).replace('{label}', label),
          messages: pickOne(r, t.messages),
          logs,
          loggedIn: t.loggedIn ? r() < 0.9 : r() < 0.08,
        },
      });
    }
  }
  return out;
}

// ---------- Modelo ----------

let modelPromise = null;

function tfOrThrow() {
  if (!globalThis.tf) throw new Error('TensorFlow.js não carregado.');
  return globalThis.tf;
}

async function getUserExamples() {
  return (await chrome.storage.local.get('diagExamples')).diagExamples || [];
}

function buildModel(tf) {
  const model = tf.sequential();
  model.add(tf.layers.dense({ inputShape: [DIM], units: 48, activation: 'relu', kernelRegularizer: tf.regularizers.l2({ l2: 1e-4 }) }));
  model.add(tf.layers.dropout({ rate: 0.15 }));
  model.add(tf.layers.dense({ units: KEYS.length, activation: 'softmax' }));
  model.compile({ optimizer: tf.train.adam(0.01), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
  return model;
}

/** Treina do zero com os exemplos-base mais as correções do QA (usado também no build). */
export async function trainOn(tf, userExamples = []) {
  const examples = [...seedExamples()];
  // Correções do QA pesam mais que os exemplos sintéticos.
  for (const ex of userExamples) for (let i = 0; i < 8; i++) examples.push(ex);
  const xs = tf.tensor2d(examples.map((e) => Array.from(vectorize(tokensOf(e.failure)))));
  const ys = tf.oneHot(tf.tensor1d(examples.map((e) => KEYS.indexOf(e.label)), 'int32'), KEYS.length);
  const model = buildModel(tf);
  await model.fit(xs, ys, { epochs: 30, batchSize: 32, shuffle: true, verbose: 0 });
  xs.dispose();
  ys.dispose();
  return model;
}

async function train(tf) {
  return trainOn(tf, await getUserExamples());
}

// Modelo base treinado no build (scripts/train-model.mjs): evita treinar no primeiro uso.
const BUNDLED_MODEL = 'lib/model/model.json';

async function signature() {
  return `${MODEL_VERSION}:${(await getUserExamples()).length}`;
}

async function loadOrTrain() {
  const tf = tfOrThrow();
  // GPU (WebGL) treina bem mais rápido; sem ela, CPU.
  if (!(await tf.setBackend('webgl').catch(() => false))) await tf.setBackend('cpu');
  const sig = await signature();
  if ((await getUserExamples()).length === 0) {
    try {
      return await tf.loadLayersModel(chrome.runtime.getURL(BUNDLED_MODEL));
    } catch {
      // sem modelo embarcado: treina aqui
    }
  }
  const { diagModelSig } = await chrome.storage.local.get('diagModelSig');
  if (diagModelSig === sig) {
    try {
      return await tf.loadLayersModel(MODEL_URL);
    } catch {
      // modelo salvo inválido: treina de novo
    }
  }
  const model = await train(tf);
  await model.save(MODEL_URL);
  await chrome.storage.local.set({ diagModelSig: sig });
  return model;
}

export function ensureModel() {
  if (!modelPromise) modelPromise = loadOrTrain().catch((e) => { modelPromise = null; throw e; });
  return modelPromise;
}

/** Classifica uma falha. Retorna a categoria provável, a confiança e as 3 mais prováveis. */
export async function diagnose(failure) {
  const tf = tfOrThrow();
  const model = await ensureModel();
  const probs = tf.tidy(() => model.predict(tf.tensor2d([Array.from(vectorize(tokensOf(failure)))])).dataSync());
  const ranked = KEYS.map((key, i) => ({ key, p: probs[i] })).sort((a, b) => b.p - a.p);
  const best = CATEGORIES.find((c) => c.key === ranked[0].key);
  return { ...best, confidence: ranked[0].p, top: ranked.slice(0, 3) };
}

/** Guarda a correção do QA e retreina o modelo com ela. */
export async function learn(failure, label) {
  if (!KEYS.includes(label)) throw new Error('Categoria inválida.');
  const examples = await getUserExamples();
  examples.push({ label, failure, at: Date.now() });
  await chrome.storage.local.set({ diagExamples: examples.slice(-500) });
  modelPromise = null;
  return ensureModel();
}

/** Descarta o modelo salvo; o próximo diagnóstico treina de novo. */
export async function resetModel() {
  modelPromise = null;
  await chrome.storage.local.remove('diagModelSig');
}

export function backend() {
  return globalThis.tf?.getBackend?.() || null;
}

export async function learnedCount() {
  return (await getUserExamples()).length;
}

/** Monta a entrada do diagnóstico a partir de um teste e de uma execução com falha. */
export function failureOf(test, run) {
  const idx = run.failedIndex ?? run.index;
  const step = test.steps[idx] || {};
  return {
    stepType: step.type,
    stepLabel: step.label || '',
    error: run.error || '',
    messages: run.diagnostics?.messages || [],
    logs: (run.logs || []).filter((l) => l.step === idx || l.step === idx - 1),
    loggedIn: Boolean(run.diagnostics?.loggedIn),
  };
}
