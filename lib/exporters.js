/**
 * Exportação de testes: JSON (backup/compartilhar), Markdown (lista de passos) e Playwright.
 */
import { describeStep } from './steps.js';

export const FORMAT = 'qa-recorder/v1';

function cleanStep(step) {
  const { mergeKey, secret, ...rest } = step;
  return rest;
}

export function toJSON(tests) {
  return JSON.stringify({
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    tests: tests.map((t) => ({ name: t.name, steps: t.steps.map(cleanStep) })),
  }, null, 2);
}

/** Aceita o formato exportado, um teste solto ou uma lista de testes. */
export function parseImport(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : Array.isArray(data.tests) ? data.tests : [data];
  const tests = list.filter((t) => t && Array.isArray(t.steps));
  if (!tests.length) throw new Error('Nenhum teste encontrado no arquivo.');
  return tests.map((t) => ({ name: String(t.name || 'Teste importado'), steps: t.steps.map(cleanStep) }));
}

export function toMarkdown(test) {
  const lines = [`# ${test.name}`, ''];
  test.steps.forEach((step, i) => {
    const flags = [step.disabled && 'desativado', step.optional && 'opcional'].filter(Boolean);
    lines.push(`${i + 1}. ${describeStep(step)}${flags.length ? ` _(${flags.join(', ')})_` : ''}`);
  });
  return lines.join('\n') + '\n';
}

const js = (s) => JSON.stringify(String(s ?? ''));

function toTemplate(value) {
  if (!/\{\{/.test(value)) return js(value);
  const body = String(value)
    .replace(/[`\\]/g, '\\$&')
    .replace(/\$(?!\{)/g, '\\$')
    .replace(/\{\{\s*([$\w.-]+)\s*\}\}/g, (_, k) => `\${vars[${js(k)}]}`);
  return '`' + body + '`';
}

function locator(step) {
  const sel = step.selectors?.[0];
  if (!sel) return 'page.locator("body")';
  if (sel.css) return `page.locator(${js(sel.css)}).first()`;
  if (sel.tag) return `page.locator(${js(sel.tag)}, { hasText: ${js(sel.text)} }).first()`;
  return `page.getByText(${js(sel.text)}, { exact: true }).first()`;
}

export function toPlaywright(test, vars) {
  const names = new Set();
  for (const step of test.steps) {
    for (const v of [step.url, step.value]) {
      for (const m of String(v ?? '').matchAll(/\{\{\s*([$\w.-]+)\s*\}\}/g)) names.add(m[1]);
    }
  }
  const known = Object.fromEntries(vars.map((v) => [v.key, v]));
  const varLines = [...names].map((k) => {
    if (k === '$email') return `  ${js(k)}: \`qa+\${Date.now()}@example.com\`,`;
    if (k === '$timestamp') return `  ${js(k)}: String(Date.now()),`;
    if (k === '$random') return `  ${js(k)}: String(Math.floor(Math.random() * 1e6)).padStart(6, '0'),`;
    if (k === '$date') return `  ${js(k)}: new Date().toISOString().slice(0, 10),`;
    const env = 'QA_' + k.replace(/\W/g, '_').toUpperCase();
    const fallback = known[k] && !known[k].secret ? known[k].value : '';
    return `  ${js(k)}: process.env.${env} ?? ${js(fallback)},`;
  });

  const body = [];
  for (const step of test.steps) {
    if (step.disabled) continue;
    body.push(`  // ${describeStep(step).replace(/\n/g, ' ')}`);
    const loc = locator(step);
    switch (step.type) {
      case 'navigate': body.push(`  await page.goto(${toTemplate(step.url)});`); break;
      case 'click': body.push(`  await ${loc}.click();`); break;
      case 'type': body.push(`  await ${loc}.fill(${toTemplate(step.value)});`); break;
      case 'select': body.push(`  await ${loc}.selectOption(${toTemplate(step.value)});`); break;
      case 'press': body.push(`  await ${loc}.press(${js(step.key || 'Enter')});`); break;
      case 'hover': body.push(`  await ${loc}.hover();`); break;
      case 'wait': body.push(`  await page.waitForTimeout(${Number(step.value) || 1000});`); break;
      case 'assertText': body.push(`  await expect(${loc}).toContainText(${toTemplate(step.value)});`); break;
      case 'assertVisible': body.push(`  await expect(${loc}).toBeVisible();`); break;
      case 'assertNotVisible': body.push(`  await expect(${loc}).toBeHidden();`); break;
      case 'assertUrl': body.push(`  await page.waitForURL((url) => url.href.includes(${toTemplate(step.value)}));`); break;
      default: body.push(`  // passo não suportado: ${step.type}`);
    }
  }

  return [
    "import { test, expect } from '@playwright/test';",
    '',
    'const vars = {',
    ...varLines,
    '};',
    '',
    `test(${js(test.name)}, async ({ page }) => {`,
    ...body,
    '});',
    '',
  ].join('\n');
}

/**
 * JSON para o dev: o teste (importável na extensão) + o resultado da última execução
 * com o erro, as mensagens da página, os erros de JS e as requisições que falharam.
 */
export function toDevJSON(test, vars, diag = null) {
  const run = test.lastFailure || test.lastRun || null;
  const result = run && {
    status: run.status,
    at: new Date(run.at).toISOString(),
    durationMs: run.ms,
    repetition: run.of > 1 ? `${run.iter}/${run.of}` : undefined,
    emailUsed: run.email,
    failedStep: run.failedIndex >= 0 ? {
      number: run.failedIndex + 1,
      description: describeStep(test.steps[run.failedIndex] || { type: '?' }),
      step: cleanStep(test.steps[run.failedIndex] || {}),
    } : undefined,
    error: run.error || undefined,
    pageUrl: run.diagnostics?.url,
    diagnosis: diag ? { category: diag.key, label: diag.label, origin: diag.origin, confidence: Number(diag.confidence.toFixed(3)), suggestion: diag.fix } : undefined,
    pageMessages: run.diagnostics?.messages || [],
    capturedErrors: (run.logs || []).map((l) => ({ step: l.step + 1, kind: l.kind, text: l.text, count: l.count })),
    steps: test.steps.map((s, i) => ({ number: i + 1, description: describeStep(s), status: run.results?.[i]?.status, ms: run.results?.[i]?.ms, error: run.results?.[i]?.error })),
  };
  return JSON.stringify({
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    environment: {
      baseUrl: vars.find((v) => v.key === 'baseUrl')?.value || undefined,
      userAgent: navigator.userAgent,
    },
    tests: [{ name: test.name, steps: test.steps.map(cleanStep) }],
    result,
  }, null, 2);
}
