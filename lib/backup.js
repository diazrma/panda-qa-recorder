/**
 * Backup completo (testes + histórico + variáveis sem segredos) e restauração por mesclagem.
 */
import { getTests, saveTests, getVars, saveVars, uid } from './store.js';

export const BACKUP_FORMAT = 'panda-qa-recorder/backup-v1';
export const FULL_BACKUP_FORMAT = 'panda-qa-recorder/encrypted-backup-v1';
const FULL_BACKUP_DATA_FORMAT = 'panda-qa-recorder/full-backup-v1';
const BACKUP_ITERATIONS = 250000;

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
const base64ToBytes = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

async function backupKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: BACKUP_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Exporta todos os dados locais, incluindo configurações e chaves, protegidos por senha. */
export async function buildFullBackup(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Use uma senha com pelo menos 8 caracteres para proteger o backup.');
  }
  const storage = await chrome.storage.local.get(null);
  delete storage.backupState;
  delete storage.updateInfo;
  const payload = new TextEncoder().encode(JSON.stringify({
    format: FULL_BACKUP_DATA_FORMAT,
    createdAt: new Date().toISOString(),
    storage,
  }));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await backupKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
  return {
    format: FULL_BACKUP_FORMAT,
    kdf: 'PBKDF2-SHA-256',
    iterations: BACKUP_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export const isFullBackup = (data) => data && data.format === FULL_BACKUP_FORMAT;

/** Descriptografa e mescla o backup completo sem descartar dados locais mais novos. */
export async function restoreFullBackup(data, password) {
  if (!isFullBackup(data) || data.kdf !== 'PBKDF2-SHA-256'
    || data.iterations !== BACKUP_ITERATIONS
    || !data.salt || !data.iv || !data.ciphertext) {
    throw new Error('Arquivo não é um backup completo válido do Panda QA Recorder.');
  }
  if (typeof password !== 'string' || !password) throw new Error('Informe a senha do backup.');

  let decoded;
  try {
    const key = await backupKey(password, base64ToBytes(data.salt));
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(data.iv) },
      key,
      base64ToBytes(data.ciphertext),
    );
    decoded = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('Não foi possível abrir o backup. Confira a senha e tente novamente.');
  }
  if (decoded.format !== FULL_BACKUP_DATA_FORMAT || !decoded.storage || typeof decoded.storage !== 'object') {
    throw new Error('O conteúdo do backup completo é inválido.');
  }

  const incoming = decoded.storage;
  const current = await chrome.storage.local.get(null);
  const settings = { ...(incoming.settings || {}), ...(current.settings || {}) };
  for (const [key, value] of Object.entries(incoming.settings || {})) {
    if (settings[key] === '' && value) settings[key] = value;
  }
  const tests = current.tests || [];
  const byId = new Map(tests.map((test) => [test.id, test]));
  let added = 0;
  let updated = 0;
  for (const test of incoming.tests || []) {
    if (!test || !Array.isArray(test.steps)) continue;
    const existing = test.id && byId.get(test.id);
    if (!existing) {
      const copy = { ...test, id: test.id || uid() };
      tests.push(copy);
      byId.set(copy.id, copy);
      added++;
    } else if ((test.updatedAt || 0) > (existing.updatedAt || 0)) {
      Object.assign(existing, test);
      updated++;
    }
  }

  const restored = Object.fromEntries(
    Object.entries(incoming).filter(([key]) => !['tests', 'vars', 'settings'].includes(key) && current[key] === undefined),
  );
  const vars = incoming.vars || [];
  const currentVars = current.vars || [];
  const varsByKey = new Map(currentVars.map((variable) => [variable.key, variable]));
  for (const variable of vars) {
    const existing = varsByKey.get(variable.key);
    if (!existing) {
      currentVars.push(variable);
      varsByKey.set(variable.key, variable);
    } else if (existing.secret && !existing.value && variable.value) {
      existing.value = variable.value;
    }
  }

  await chrome.storage.local.set({
    ...restored,
    tests,
    vars: currentVars.length ? currentVars : vars,
    settings,
  });
  return { added, updated, total: (incoming.tests || []).length };
}

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
