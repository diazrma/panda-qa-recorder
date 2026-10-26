/**
 * Variáveis {{nome}} nos passos. As que começam com $ são geradas a cada execução.
 */

export const BUILTINS = [
  { key: '$email', help: 'E-mail único por execução (qa+<timestamp>@<emailDomain>)' },
  { key: '$timestamp', help: 'Data/hora atual em milissegundos' },
  { key: '$random', help: 'Número aleatório de 6 dígitos' },
  { key: '$cpf', help: 'CPF válido aleatório (só números)' },
  { key: '$date', help: 'Data de hoje (AAAA-MM-DD)' },
];

function randomCpf() {
  const digits = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const check = (arr) => {
    const sum = arr.reduce((acc, d, i) => acc + d * (arr.length + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  digits.push(check(digits));
  digits.push(check(digits));
  return digits.join('');
}

/**
 * Valores das variáveis para uma execução. Os geradores rodam uma vez só,
 * para o mesmo {{$email}} servir no cadastro e no login seguinte.
 */
export function newRunContext(vars) {
  const ctx = {};
  for (const v of vars) if (v.key) ctx[v.key] = v.value ?? '';
  const ts = Date.now();
  ctx.$timestamp = String(ts);
  ctx.$random = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  ctx.$email = `qa+${ts}@${ctx.emailDomain || 'example.com'}`;
  ctx.$cpf = randomCpf();
  ctx.$date = new Date().toISOString().slice(0, 10);
  return ctx;
}

export function interpolate(text, ctx) {
  return String(text).replace(/\{\{\s*([$\w.-]+)\s*\}\}/g, (match, key) => {
    if (!(key in ctx)) throw new Error(`Variável {{${key}}} não definida. Cadastre em Variáveis.`);
    return ctx[key];
  });
}

export function resolveStep(step, ctx) {
  const out = { ...step };
  if (out.url != null) out.url = interpolate(out.url, ctx);
  if (out.value != null) out.value = interpolate(out.value, ctx);
  return out;
}
