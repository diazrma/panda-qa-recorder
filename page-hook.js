/**
 * Panda QA Recorder - roda no contexto da página (world MAIN) só para capturar erros de JS
 * e console.error, que o content script isolado não enxerga. Repassa via postMessage.
 */
(() => {
  if (window.__qaRecorderHook) return;
  window.__qaRecorderHook = true;

  const post = (kind, text) => {
    try {
      window.postMessage({ __qaRecorder: true, kind, text: String(text).slice(0, 500) }, '*');
    } catch {
      // mensagem não serializável: ignora
    }
  };

  const describe = (x) => {
    if (x instanceof Error) return x.message;
    if (typeof x === 'object' && x !== null) {
      try {
        return JSON.stringify(x).slice(0, 200);
      } catch {
        return Object.prototype.toString.call(x);
      }
    }
    return String(x);
  };

  window.addEventListener('error', (e) => {
    // Erro de carregamento de imagem/script também chega aqui, mas não é ErrorEvent.
    if (!(e instanceof ErrorEvent)) return;
    const where = e.filename ? ` (${e.filename.split('/').pop().split('?')[0]}:${e.lineno})` : '';
    post('js', `${e.message}${where}`);
  }, true);

  window.addEventListener('unhandledrejection', (e) => {
    post('js', `Promise rejeitada: ${describe(e.reason)}`);
  });

  const original = console.error;
  console.error = function (...args) {
    post('console', args.map(describe).join(' '));
    return original.apply(this, args);
  };
})();
