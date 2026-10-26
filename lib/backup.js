/**
 * Backup completo (testes + histórico + variáveis sem segredos) e restauração por mesclagem.
 */
import { getTests, saveTests, getVars, saveVars, uid } from './store.js';

export const BACKUP_FORMAT = 'panda-qa-recorder/backup-v1';

export async function buildBackup() {
  const tests = await getTests();
  const vars = (await getVars()).map((v) => ({ ...v, value: v.secret ? '' : v.value }));
  return {
    format: BACKUP_FORMAT,
    createdAt: new Date().toISOString(),
    tests,
    vars,
  };
}

export const isBackup = (data) => data && data.format === BACKUP_FORMAT && Array.isArray(data.tests);

/**
 * Mescla o backup com o que já existe: nada é apagado. Teste com o mesmo id só é
 * substituído se a versão do backup for mais nova. Variáveis só entram se o nome não existir.
 */
export async function restoreBackup(data) {
  if (!isBackup(data)) throw new Error('Arquivo não é um backup do Panda QA Recorder.');
  const tests = await getTests();
  const byId = new Map(tests.map((t) => [t.id, t]));
  let added = 0;
  let updated = 0;
  for (const t of data.tests) {
    if (!t || !Array.isArray(t.steps)) continue;
    const current = t.id && byId.get(t.id);
    if (!current) {
      const copy = { ...t, id: t.id || uid() };
      tests.push(copy);
      byId.set(copy.id, copy);
      added++;
    } else if ((t.updatedAt || 0) > (current.updatedAt || 0)) {
      Object.assign(current, t);
      updated++;
    }
  }
  await saveTests(tests);

  const vars = await getVars();
  const keys = new Set(vars.map((v) => v.key));
  for (const v of data.vars || []) {
    if (v.key && !keys.has(v.key)) vars.push(v);
  }
  await saveVars(vars);
  return { added, updated, total: data.tests.length };
}
