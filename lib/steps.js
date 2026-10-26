/**
 * Tipos de passo e texto legível de cada um (a "lista de passos").
 */

export const STEP_TYPES = {
  navigate: { label: 'Abrir URL', fields: ['url'] },
  click: { label: 'Clicar', fields: ['selectors'] },
  type: { label: 'Preencher campo', fields: ['selectors', 'value'] },
  select: { label: 'Selecionar opção', fields: ['selectors', 'value'] },
  press: { label: 'Pressionar tecla', fields: ['selectors', 'key'] },
  hover: { label: 'Passar o mouse', fields: ['selectors'] },
  wait: { label: 'Esperar', fields: ['value'] },
  assertText: { label: 'Verificar texto', fields: ['selectors', 'value'] },
  assertVisible: { label: 'Verificar elemento visível', fields: ['selectors'] },
  assertNotVisible: { label: 'Verificar elemento ausente', fields: ['selectors'] },
  assertUrl: { label: 'Verificar URL contém', fields: ['value'] },
};

export const isAssert = (step) => step.type.startsWith('assert');

export function selectorToString(sel) {
  if (sel.css) return sel.css;
  return `${sel.tag ? sel.tag + ':' : ''}text=${sel.text}`;
}

export function parseSelector(line) {
  const m = line.match(/^(?:([a-z][\w-]*):)?text=(.*)$/i);
  if (m) return m[1] ? { tag: m[1].toLowerCase(), text: m[2].trim() } : { text: m[2].trim() };
  return { css: line.trim() };
}

const quote = (s) => `"${String(s ?? '').slice(0, 70)}"`;

export function describeStep(step) {
  const target = step.label ? quote(step.label) : step.selectors?.[0] ? selectorToString(step.selectors[0]) : '?';
  switch (step.type) {
    case 'navigate': return `Abrir ${step.url}`;
    case 'click': return `Clicar em ${target}`;
    case 'type': return `Preencher ${target} com ${quote(step.value)}`;
    case 'select': return `Selecionar ${quote(step.optionText || step.value)} em ${target}`;
    case 'press': return `Pressionar ${step.key || 'Enter'} em ${target}`;
    case 'hover': return `Passar o mouse sobre ${target}`;
    case 'wait': return `Esperar ${Number(step.value) || 1000} ms`;
    case 'assertText': return `Verificar que ${target} contém ${quote(step.value)}`;
    case 'assertVisible': return `Verificar que ${target} está visível`;
    case 'assertNotVisible': return `Verificar que ${target} não está visível`;
    case 'assertUrl': return `Verificar que a URL contém ${quote(step.value)}`;
    default: return step.type;
  }
}
