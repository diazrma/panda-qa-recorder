/**
 * Persistência em chrome.storage.local: testes, variáveis, configurações e prints de falha.
 */

export const DEFAULT_SETTINGS = {
  timeout: 15000,
  stepDelay: 250,
  loaderSelector: '.loading-mask, [data-role="loader"], .loader',
  backupHours: 6,
  autoHeal: true,
  aiDiagnosis: true,
  updateUrl: 'https://raw.githubusercontent.com/diazrma/panda-qa-recorder/main/version.json',
};

export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

export async function getTests() {
  return (await chrome.storage.local.get('tests')).tests || [];
}

export async function saveTests(tests) {
  await chrome.storage.local.set({ tests });
}

export async function getTest(id) {
  return (await getTests()).find((t) => t.id === id) || null;
}

export async function updateTest(id, mutate) {
  const tests = await getTests();
  const test = tests.find((t) => t.id === id);
  if (!test) throw new Error('Teste não encontrado.');
  mutate(test);
  test.updatedAt = Date.now();
  await saveTests(tests);
  return test;
}

export async function createTest(name, steps = []) {
  const tests = await getTests();
  const test = { id: uid(), name, steps, createdAt: Date.now(), updatedAt: Date.now(), runs: [] };
  tests.unshift(test);
  await saveTests(tests);
  return test;
}

export async function deleteTest(id) {
  await saveTests((await getTests()).filter((t) => t.id !== id));
  await chrome.storage.local.remove('shot:' + id);
}

export async function getVars() {
  return (await chrome.storage.local.get('vars')).vars || [
    { key: 'baseUrl', value: '', secret: false },
    { key: 'senha', value: '', secret: true },
  ];
}

export async function saveVars(vars) {
  await chrome.storage.local.set({ vars });
}

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...((await chrome.storage.local.get('settings')).settings || {}) };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}
