/**
 * Código de compartilhamento: o teste compactado (deflate) em base64url, para colar em chat/tarefa.
 */
const PREFIX = 'PANDAQA1.';

function cleanStep(step) {
  const { mergeKey, secret, ...rest } = step;
  return rest;
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function encodeShare(test) {
  const json = JSON.stringify({ name: test.name, repeat: test.repeat, interval: test.interval, steps: test.steps.map(cleanStep) });
  return PREFIX + toBase64Url(await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw')));
}

/** Aceita o código mesmo com texto em volta (ex.: colado junto da mensagem do chat). */
export async function decodeShare(text) {
  const match = String(text).match(/PANDAQA1\.([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('Código de compartilhamento não encontrado no texto colado.');
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(await pipe(fromBase64Url(match[1]), new DecompressionStream('deflate-raw'))));
  } catch {
    throw new Error('Código incompleto ou corrompido. Peça para copiar de novo.');
  }
  if (!data || !Array.isArray(data.steps)) throw new Error('Código não contém um teste.');
  return data;
}
