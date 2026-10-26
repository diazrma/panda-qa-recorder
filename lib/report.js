/**
 * Relatório de uma execução: HTML independente (com print) e resumo em texto para colar na tarefa.
 */
import { describeStep } from './steps.js';

export const LOG_KIND = {
  js: 'Erro de JavaScript',
  console: 'console.error',
  http: 'Requisição com erro',
  net: 'Falha de rede',
};

const STATUS = { healed: 'Passou (corrigido)', passed: 'Passou', failed: 'Falhou', stopped: 'Interrompido', warning: 'Aviso', skipped: 'Pulado', pending: 'Não executado' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const secs = (ms) => `${((ms || 0) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}s`;

function logLine(log) {
  return `${LOG_KIND[log.kind] || log.kind}: ${log.text}${log.count > 1 ? ` (${log.count}x)` : ''}`;
}

export function toSummaryText(test, run, diag = null) {
  const lines = [`Teste: ${test.name}`, `Resultado: ${STATUS[run.status] || run.status} em ${new Date(run.at || run.finishedAt).toLocaleString('pt-BR')} (${secs(run.ms ?? run.finishedAt - run.startedAt)})`];
  if (run.diagnostics?.url) lines.push(`Página: ${run.diagnostics.url}`);
  if (run.email) lines.push(`E-mail usado: ${run.email}`);
  if (run.status === 'failed' && run.failedIndex >= 0) {
    lines.push('', `Falhou no passo ${run.failedIndex + 1}: ${describeStep(test.steps[run.failedIndex] || { type: '?' })}`, `Erro: ${run.error}`);
  }
  if (diag) lines.push('', `Diagnóstico (IA local, ${Math.round(diag.confidence * 100)}%): ${diag.label}`, `O que fazer: ${diag.fix}`);
  const messages = run.diagnostics?.messages || [];
  if (messages.length) lines.push('', 'Mensagens na página:', ...messages.map((m) => `- ${m}`));
  const logs = run.logs || [];
  if (logs.length) lines.push('', 'Erros capturados:', ...logs.map((l) => `- Passo ${l.step + 1}: ${logLine(l)}`));
  lines.push('', 'Passos:');
  test.steps.forEach((s, i) => {
    const r = run.results?.[i];
    lines.push(`${i + 1}. [${STATUS[r?.status] || '-'}] ${describeStep(s)}`);
  });
  return lines.join('\n') + '\n';
}

export function toReportHtml(test, run, shot, diag = null) {
  const ms = run.ms ?? run.finishedAt - run.startedAt;
  const when = new Date(run.at || run.finishedAt).toLocaleString('pt-BR');
  const logsByStep = new Map();
  for (const log of run.logs || []) {
    if (!logsByStep.has(log.step)) logsByStep.set(log.step, []);
    logsByStep.get(log.step).push(log);
  }
  const rows = test.steps.map((s, i) => {
    const r = run.results?.[i] || {};
    const logs = logsByStep.get(i) || [];
    return `<tr class="${esc(r.status)}">
      <td class="n">${i + 1}</td>
      <td><div>${esc(describeStep(s))}</div>
        ${r.error ? `<div class="err">${esc(r.error)}</div>` : ''}
        ${logs.map((l) => `<div class="log ${l.kind}">${esc(logLine(l))}</div>`).join('')}</td>
      <td class="st">${esc(STATUS[r.status] || '-')}</td>
      <td class="ms">${r.ms != null ? secs(r.ms) : ''}</td>
    </tr>`;
  }).join('');
  const messages = run.diagnostics?.messages || [];

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(test.name)} - ${esc(STATUS[run.status])}</title>
<style>
  :root{--ok:#15803d;--fail:#c2261d;--muted:#646b78;--border:#e3e6eb}
  body{font:14px/1.5 system-ui,sans-serif;color:#16191f;max-width:960px;margin:24px auto;padding:0 16px;background:#fff}
  h1{font-size:20px;margin:0 0 4px} .meta{color:var(--muted);margin-bottom:16px}
  .status{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:600;font-size:13px}
  .status.passed{background:#e7f6ec;color:var(--ok)} .status.failed{background:#fdecea;color:var(--fail)} .status.stopped{background:#fff4e0;color:#b45309}
  .box{border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin:12px 0}
  .box.fail{border-color:#f3b4ae;background:#fdf3f2}
  h2{font-size:14px;margin:20px 0 8px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  table{width:100%;border-collapse:collapse} td{border-top:1px solid var(--border);padding:8px 6px;vertical-align:top}
  td.n{width:28px;color:var(--muted);font-variant-numeric:tabular-nums} td.st{width:110px;font-weight:600} td.ms{width:60px;color:var(--muted);text-align:right}
  tr.passed td.st{color:var(--ok)} tr.failed td.st{color:var(--fail)} tr.failed{background:#fdf3f2} tr.skipped,tr.pending{color:var(--muted)}
  .err{color:var(--fail);margin-top:2px} .log{font:12px/1.4 ui-monospace,monospace;color:#8a4b00;margin-top:3px;word-break:break-all}
  ul{margin:4px 0;padding-left:20px} img{max-width:100%;border:1px solid var(--border);border-radius:8px}
</style></head><body>
<h1>${esc(test.name)}</h1>
<div class="meta"><span class="status ${esc(run.status)}">${esc(STATUS[run.status])}</span> · ${esc(when)} · ${secs(ms)}${run.email ? ` · e-mail usado: ${esc(run.email)}` : ''}</div>
${run.status === 'failed' ? `<div class="box fail"><strong>Falhou no passo ${run.failedIndex + 1}:</strong> ${esc(describeStep(test.steps[run.failedIndex] || { type: '?' }))}<br>${esc(run.error)}
  ${run.diagnostics?.url ? `<div class="meta" style="margin:6px 0 0">Página: ${esc(run.diagnostics.url)}</div>` : ''}</div>` : ''}
${diag ? `<h2>Diagnóstico (IA local)</h2><div class="box"><strong>${esc(diag.label)}</strong> <span class="meta">(${Math.round(diag.confidence * 100)}% de confiança)</span><br>${esc(diag.explain)}<br><b>O que fazer:</b> ${esc(diag.fix)}</div>` : ''}
${messages.length ? `<h2>Mensagens na página</h2><div class="box"><ul>${messages.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
${shot ? `<h2>Tela no momento da falha</h2><img src="${shot}" alt="Print da tela">` : ''}
<h2>Passos</h2>
<table>${rows}</table>
<p class="meta" style="margin-top:24px">Gerado pelo Panda QA Recorder.</p>
</body></html>`;
}
