// Armazenamento do servidor do time. Na Vercel usa o Blob; sem BLOB_READ_WRITE_TOKEN (local e
// testes) grava numa pasta (.dados/ ou DADOS_DIR). Chaves são caminhos: "estado/atual.json".
// No Blob cada gravação ganha URL nova (sufixo aleatório) e a antiga é apagada, então o CDN
// nunca devolve versão velha; a leitura procura a mais recente pela listagem.
import fs from 'node:fs/promises';
import path from 'node:path';

const usaBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const pasta = () => process.env.DADOS_DIR || path.resolve(import.meta.dirname, '../.dados');

let blobMod;
const blob = async () => (blobMod ||= await import('@vercel/blob'));

async function todos(prefix) {
  const { list } = await blob();
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

// "estado/atual-Ab12Cd.json" -> "estado/atual.json"
const semSufixo = (p) => p.replace(/-[A-Za-z0-9]{20,}(\.[a-z]+)$/, '$1');

async function versoes(chave) {
  const ext = path.extname(chave);
  const base = chave.slice(0, -ext.length || undefined);
  return (await todos(base)).filter((b) => semSufixo(b.pathname) === chave)
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

export async function gravar(chave, dados, tipo = 'application/json') {
  const corpo = typeof dados === 'string' || Buffer.isBuffer(dados) ? dados : JSON.stringify(dados);
  if (!usaBlob()) {
    const arq = path.join(pasta(), chave);
    await fs.mkdir(path.dirname(arq), { recursive: true });
    await fs.writeFile(arq, corpo);
    return;
  }
  const { put, del } = await blob();
  const antigas = await versoes(chave);
  await put(chave, corpo, { access: 'public', addRandomSuffix: true, contentType: tipo });
  if (antigas.length) await del(antigas.map((b) => b.url));
}

export async function ler(chave) {
  if (!usaBlob()) return fs.readFile(path.join(pasta(), chave)).catch(() => null);
  const [ultima] = await versoes(chave);
  if (!ultima) return null;
  const r = await fetch(ultima.url, { cache: 'no-store' });
  return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
}

export async function lerJSON(chave, padrao = null) {
  const b = await ler(chave);
  return b ? JSON.parse(b.toString()) : padrao;
}

/** Chaves que começam com o prefixo, com a data de gravação. */
export async function listar(prefixo) {
  if (!usaBlob()) {
    const raiz = pasta();
    const out = [];
    const andar = async (dir) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await andar(p);
        else {
          const chave = path.relative(raiz, p).split(path.sep).join('/');
          if (chave.startsWith(prefixo)) out.push({ chave, at: (await fs.stat(p)).mtimeMs });
        }
      }
    };
    await andar(raiz);
    return out;
  }
  return (await todos(prefixo)).map((b) => ({ chave: semSufixo(b.pathname), at: new Date(b.uploadedAt).getTime() }));
}

export async function apagar(chaves) {
  if (!chaves.length) return;
  if (!usaBlob()) {
    await Promise.all(chaves.map((c) => fs.rm(path.join(pasta(), c), { force: true })));
    return;
  }
  const { del } = await blob();
  const urls = (await Promise.all(chaves.map(versoes))).flat().map((b) => b.url);
  if (urls.length) await del(urls);
}

/** Lê de uma vez todos os JSON de um prefixo (uma listagem só, sem procurar versão por chave). */
export async function lerTodosJSON(prefixo) {
  if (!usaBlob()) {
    const itens = await listar(prefixo);
    return (await Promise.all(itens.map(async (i) => ({ ...i, dados: await lerJSON(i.chave).catch(() => null) })))).filter((i) => i.dados);
  }
  const blobs = await todos(prefixo);
  const lidos = await Promise.all(blobs.map(async (b) => {
    const r = await fetch(b.url).catch(() => null);
    return r && r.ok ? { chave: semSufixo(b.pathname), at: new Date(b.uploadedAt).getTime(), dados: await r.json().catch(() => null) } : null;
  }));
  return lidos.filter((i) => i && i.dados);
}
