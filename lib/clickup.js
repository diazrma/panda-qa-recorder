/**
 * ClickUp: vincula um teste a uma tarefa e lança nela as horas de QA (com comentário, relatório
 * anexado e troca de status opcionais). Usa o token pessoal de quem está lançando.
 */
const API = 'https://api.clickup.com/api/v2';

async function cu(token, path, { method = 'GET', body, form } = {}) {
  if (!token) throw new Error('Configure o token do ClickUp em Configurações.');
  const headers = { Authorization: token };
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.err || data.error || `HTTP ${res.status}`;
    throw new Error(res.status === 401 ? 'Token do ClickUp inválido.' : `ClickUp: ${msg}`);
  }
  return data;
}

/** Aceita o link da tarefa (app.clickup.com/t/...), o ID (86ajthyru, #86ajthyru) ou um ID customizado (SUP-123). */
export function parseTaskRef(text) {
  const t = String(text || '').trim();
  const link = t.match(/clickup\.com\/t\/(?:(\d+)\/)?([A-Za-z0-9_-]+)/);
  if (link) return /^[A-Za-z]+-\d+$/.test(link[2]) ? { id: link[2], custom: true, teamId: link[1] || null } : { id: link[2] };
  const raw = t.replace(/^#/, '');
  if (/^[A-Za-z]+-\d+$/.test(raw)) return { id: raw, custom: true, teamId: null };
  if (/^[a-z0-9]{6,12}$/i.test(raw)) return { id: raw };
  throw new Error('Cole o link da tarefa do ClickUp ou o ID dela.');
}

export async function getTask(token, ref) {
  if (ref.custom && !ref.teamId) throw new Error('Para ID customizado, cole o link completo da tarefa.');
  const q = ref.custom ? `?custom_task_ids=true&team_id=${ref.teamId}` : '';
  const t = await cu(token, `/task/${encodeURIComponent(ref.id)}${q}`);
  const listData = t.list?.id ? await cu(token, `/list/${encodeURIComponent(t.list.id)}`) : {};
  return {
    id: t.id,
    name: t.name,
    status: t.status?.status || '',
    color: t.status?.color || '',
    list: [t.folder?.name, t.list?.name].filter((x) => x && x !== 'hidden').join(' › '),
    statuses: (listData.statuses || []).map((status) => ({
      status: status.status,
      color: status.color || '',
    })),
    teamId: t.team_id,
    url: t.url,
  };
}

/** Busca tarefas acessíveis nos workspaces do usuário pelo nome ou ID. */
export async function searchTasks(token, query) {
  const term = String(query || '').trim().toLocaleLowerCase();
  if (term.length < 2) throw new Error('Digite ao menos 2 caracteres para pesquisar.');

  const { teams = [] } = await cu(token, '/team');
  const matches = new Map();
  for (const team of teams) {
    for (let page = 0; ; page++) {
      const data = await cu(token, `/team/${encodeURIComponent(team.id)}/task?page=${page}&include_closed=true`);
      const tasks = data.tasks || [];
      for (const task of tasks) {
        if (`${task.name || ''} ${task.id || ''} ${task.custom_id || ''}`.toLocaleLowerCase().includes(term)) {
          matches.set(task.id, {
            id: task.id,
            name: task.name,
            status: task.status?.status || '',
            color: task.status?.color || '',
            list: [task.folder?.name, task.list?.name].filter((x) => x && x !== 'hidden').join(' › '),
            teamId: task.team_id || team.id,
            url: task.url,
          });
        }
      }
      if (tasks.length < 100) break;
    }
  }
  return [...matches.values()];
}

export async function logTime(token, task, { start, duration, description }) {
  return cu(token, `/team/${task.teamId}/time_entries`, {
    method: 'POST',
    body: { tid: task.id, start: Math.round(start), duration: Math.round(duration), description, billable: false },
  });
}

export const comment = (token, taskId, text) => cu(token, `/task/${taskId}/comment`, { method: 'POST', body: { comment_text: text, notify_all: false } });

export function attach(token, taskId, filename, html) {
  const form = new FormData();
  form.append('attachment', new Blob([html], { type: 'text/html' }), filename);
  return cu(token, `/task/${taskId}/attachment`, { method: 'POST', form });
}

export const setStatus = (token, taskId, status) => cu(token, `/task/${taskId}`, { method: 'PUT', body: { status } });

/** Últimos lançamentos de tempo da tarefa, de todo mundo. */
export async function taskTimes(token, taskId) {
  const data = await cu(token, `/task/${taskId}/time`);
  const out = [];
  for (const u of data.data || []) {
    for (const i of u.intervals || []) out.push({ user: u.user?.username || '?', start: Number(i.start), ms: Number(i.time) });
  }
  return out.sort((a, b) => b.start - a.start).slice(0, 5);
}

export function fmtDuration(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(min / 60);
  return h ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
}
