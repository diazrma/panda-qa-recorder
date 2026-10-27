// Bug automático do radar no ClickUp: CLICKUP_TOKEN (token pessoal) e CLICKUP_LISTA (id da lista).
export async function criarTarefa({ name, markdown_description }) {
  const token = process.env.CLICKUP_TOKEN;
  const lista = process.env.CLICKUP_LISTA;
  if (!token || !lista) throw Object.assign(new Error('Configure CLICKUP_TOKEN e CLICKUP_LISTA no servidor para abrir bugs.'), { status: 400 });
  const r = await fetch(`https://api.clickup.com/api/v2/list/${lista}/task`, {
    method: 'POST',
    headers: { Authorization: token, 'content-type': 'application/json' },
    body: JSON.stringify({ name, markdown_description, tags: ['radar-qa'] }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`ClickUp: ${d.err || r.status}`), { status: 502 });
  return { id: d.id, url: d.url };
}

export const clickupLigado = () => Boolean(process.env.CLICKUP_TOKEN && process.env.CLICKUP_LISTA);
