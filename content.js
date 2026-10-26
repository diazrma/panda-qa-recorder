/**
 * Panda QA Recorder - content script.
 * Grava as interações do usuário na página e executa os passos durante o replay.
 */
(() => {
  if (window.__qaRecorderLoaded) return;
  window.__qaRecorderLoaded = true;

  const INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],[role=checkbox],[role=radio],[onclick]';
  const TEST_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy'];

  let recording = false;
  let picking = false;
  let lastLabelClick = null;

  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const q = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  function send(msg) {
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch {
      // Extensão recarregada: este script ficou órfão.
      recording = false;
      return Promise.resolve(null);
    }
  }

  // ---------- Seletores ----------

  function isStableId(id) {
    return /^[A-Za-z][\w:-]*$/.test(id)
      && !/\d{4,}/.test(id)
      && !/^[A-Z0-9]{7}$/.test(id)
      && !/^(ui-id|ember|react|mui|headlessui|radix|:r)/i.test(id);
  }

  function elementText(el) {
    if (el instanceof HTMLInputElement) return norm(el.value);
    return norm(el.innerText || el.textContent).slice(0, 120);
  }

  function isVisible(el) {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }

  function query(sel) {
    if (sel.css) return [...document.querySelectorAll(sel.css)];
    if (sel.text != null) {
      return [...document.querySelectorAll(sel.tag || INTERACTIVE)].filter((e) => elementText(e) === sel.text);
    }
    return [];
  }

  function pick(matches) {
    return matches.find(isVisible) || matches[0] || null;
  }

  function cssPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement) {
      if (cur.id && isStableId(cur.id)) {
        parts.unshift('#' + CSS.escape(cur.id));
        return parts.join(' > ');
      }
      let part = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
    }
    parts.unshift('body');
    return parts.join(' > ');
  }

  function buildSelectors(el) {
    const tag = el.tagName.toLowerCase();
    const candidates = [];

    for (const attr of TEST_ATTRS) {
      const v = el.getAttribute(attr);
      if (v) candidates.push({ css: `[${attr}="${q(v)}"]` });
    }
    const name = el.getAttribute('name');
    if (tag === 'input' && (el.type === 'radio' || el.type === 'checkbox') && name && el.value) {
      candidates.push({ css: `input[name="${q(name)}"][value="${q(el.value)}"]` });
    }
    if (el.id && isStableId(el.id)) candidates.push({ css: '#' + CSS.escape(el.id) });
    if (name) {
      const form = el.form || el.closest('form');
      if (form && form.id && isStableId(form.id)) {
        candidates.push({ css: `#${CSS.escape(form.id)} ${tag}[name="${q(name)}"]` });
      }
      candidates.push({ css: `${tag}[name="${q(name)}"]` });
    }
    const aria = el.getAttribute('aria-label');
    if (aria) candidates.push({ css: `${tag}[aria-label="${q(aria)}"]` });
    if ((tag === 'input' || tag === 'textarea') && el.placeholder) {
      candidates.push({ css: `${tag}[placeholder="${q(el.placeholder)}"]` });
    }
    if (tag === 'input' && ['submit', 'button'].includes(el.type) && el.value) {
      candidates.push({ css: `input[type="${el.type}"][value="${q(el.value)}"]` });
    }
    if (['a', 'button', 'label', 'summary', 'h1', 'h2', 'h3', 'h4'].includes(tag) || el.getAttribute('role')) {
      const text = elementText(el);
      if (text && text.length <= 60) candidates.push({ text, tag });
    }
    // Classes estáveis (sem números nem estados) e a tag sozinha: bons para títulos e mensagens.
    const classes = [...el.classList].filter((c) => /^[a-z][\w-]*$/i.test(c) && !/\d{2,}|active|focus|hover|selected|open|show|visible|^_/i.test(c)).slice(0, 2);
    if (classes.length) candidates.push({ css: tag + classes.map((c) => '.' + CSS.escape(c)).join('') });
    if (!['div', 'span', 'p', 'li', 'a', 'button', 'input', 'img', 'svg'].includes(tag)) candidates.push({ css: tag });
    if (tag === 'a' && el.getAttribute('href') && !el.getAttribute('href').startsWith('#')) {
      candidates.push({ css: `a[href="${q(el.getAttribute('href'))}"]` });
    }
    candidates.push({ css: cssPath(el) });

    // Só mantém seletores que resolvem para este elemento; únicos primeiro.
    const seen = new Set();
    const valid = [];
    for (const sel of candidates) {
      const key = JSON.stringify(sel);
      if (seen.has(key)) continue;
      seen.add(key);
      let matches;
      try {
        matches = query(sel);
      } catch {
        continue;
      }
      if (pick(matches) !== el) continue;
      valid.push({ sel, unique: matches.length === 1, path: Boolean(sel.css && sel.css.includes(' > ')) });
    }
    // Caminho CSS (body > div:nth-of-type...) sempre por último: quebra quando a página ganha um
    // banner ou pop-up antes do elemento. Entre os estáveis, os únicos vêm primeiro.
    valid.sort((a, b) => Number(a.path) - Number(b.path) || Number(b.unique) - Number(a.unique));
    return valid.slice(0, 5).map((v) => v.sel);
  }

  function fieldLabel(el) {
    if (el.labels && el.labels[0]) {
      const t = norm(el.labels[0].innerText);
      if (t) return t.replace(/\s*\*$/, '');
    }
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const ref = document.getElementById(by.split(' ')[0]);
      if (ref && norm(ref.innerText)) return norm(ref.innerText);
    }
    const aria = el.getAttribute('aria-label') || el.getAttribute('title');
    if (aria) return aria;
    // Label com "for" errado (acontece em temas): usa o label do mesmo bloco .field.
    const near = el.closest('.field, .form-group')?.querySelector('label');
    if (near && norm(near.innerText)) return norm(near.innerText).replace(/\s*\*$/, '');
    return el.placeholder || el.name || el.id || el.tagName.toLowerCase();
  }

  function describeEl(el) {
    if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) return fieldLabel(el);
    const text = elementText(el);
    if (text) return text.slice(0, 60);
    return el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || el.tagName.toLowerCase();
  }

  // ---------- Gravação ----------

  function record(step, mergeKey) {
    send({ type: 'step', step, mergeKey });
  }

  function onClick(e) {
    if (!recording || picking || !e.isTrusted) return;
    if (!(e.target instanceof Element) || overlayHost?.contains(e.target)) return;
    const el = e.target.closest(INTERACTIVE) || e.target;
    const tag = el.tagName.toLowerCase();
    if (tag === 'select' || tag === 'textarea') return;
    if (tag === 'input' && !['checkbox', 'radio', 'submit', 'button', 'image', 'reset'].includes(el.type)) return;
    // Clique no <label> já dispara o clique no input associado; gravar os dois desfaria a marcação.
    if (tag === 'input' && lastLabelClick && lastLabelClick.control === el && Date.now() - lastLabelClick.t < 300) return;
    if (tag === 'label') lastLabelClick = { control: el.control, t: Date.now() };
    record({ type: 'click', selectors: buildSelectors(el), label: describeEl(el), fp: fingerprint(el) });
  }

  function onInput(e) {
    if (!recording || !e.isTrusted) return;
    const el = e.target;
    const isText = el instanceof HTMLTextAreaElement
      || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'file', 'submit', 'button', 'image', 'reset'].includes(el.type))
      || (el instanceof HTMLElement && el.isContentEditable);
    if (!isText) return;
    // Campo invisível só recebe texto do preenchimento automático do navegador (ex.: mini-login
    // escondido no header); gravar isso gera passos que falham no replay.
    if (!isVisible(el)) return;
    const selectors = buildSelectors(el);
    let value = el.isContentEditable ? el.innerText : el.value;
    let secret;
    if (el.type === 'password') {
      secret = value;
      value = '{{senha}}';
    }
    record({ type: 'type', selectors, value, label: fieldLabel(el), secret, fp: fingerprint(el) }, 'type:' + JSON.stringify(selectors[0]));
  }

  function onChange(e) {
    // Sem exigir isTrusted: selects customizados atualizam o <select> nativo escondido via script.
    if (!recording) return;
    const el = e.target;
    if (!(el instanceof HTMLSelectElement)) return;
    record({
      type: 'select',
      selectors: buildSelectors(el),
      fp: fingerprint(el),
      value: el.value,
      optionText: norm(el.selectedOptions[0]?.text),
      label: fieldLabel(el),
    });
  }

  function onKeydown(e) {
    if (picking && e.key === 'Escape') {
      stopPick();
      return;
    }
    if (!recording || picking || !e.isTrusted) return;
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      record({ type: 'press', key: 'Enter', selectors: buildSelectors(e.target), label: fieldLabel(e.target), fp: fingerprint(e.target) });
    }
  }

  window.addEventListener('click', onClick, true);
  window.addEventListener('input', onInput, true);
  window.addEventListener('change', onChange, true);
  window.addEventListener('keydown', onKeydown, true);

  // ---------- Overlay (badge de gravação, destaque, seletor de verificação) ----------

  let overlayHost = null;
  let overlay = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlayHost = document.createElement('qa-recorder-overlay');
    overlayHost.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    const root = overlayHost.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .box{position:fixed;border:2px solid #2563eb;background:rgba(37,99,235,.12);border-radius:3px;display:none;transition:all .08s ease-out}
        .box.pick{border-color:#d97706;background:rgba(217,119,6,.14)}
        .box.ok{border-color:#16a34a;background:rgba(22,163,74,.14)}
        .badge{position:fixed;right:16px;bottom:16px;display:none;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;
          font:600 12px/1 system-ui,sans-serif;color:#fff;background:#111827;box-shadow:0 4px 16px rgba(0,0,0,.25)}
        .dot{width:8px;height:8px;border-radius:50%;background:#ef4444;animation:p 1.2s infinite}
        .badge.pick .dot{background:#f59e0b}
        @keyframes p{50%{opacity:.3}}
      </style>
      <div class="box"></div>
      <div class="badge"><span class="dot"></span><span class="txt"></span></div>`;
    (document.body || document.documentElement).appendChild(overlayHost);
    overlay = { box: root.querySelector('.box'), badge: root.querySelector('.badge'), txt: root.querySelector('.txt') };
    return overlay;
  }

  function updateBadge() {
    const o = ensureOverlay();
    if (picking) {
      o.txt.textContent = 'Clique no elemento a verificar (Esc cancela)';
      o.badge.className = 'badge pick';
      o.badge.style.display = 'flex';
    } else if (recording) {
      o.txt.textContent = 'Gravando';
      o.badge.className = 'badge';
      o.badge.style.display = 'flex';
    } else {
      o.badge.style.display = 'none';
    }
  }

  function placeBox(el, cls) {
    const o = ensureOverlay();
    const r = el.getBoundingClientRect();
    Object.assign(o.box.style, {
      display: 'block',
      left: r.left - 2 + 'px',
      top: r.top - 2 + 'px',
      width: r.width + 4 + 'px',
      height: r.height + 4 + 'px',
    });
    o.box.className = 'box ' + (cls || '');
  }

  function flash(el, cls) {
    placeBox(el, cls);
    clearTimeout(flash.t);
    flash.t = setTimeout(() => {
      if (!picking) ensureOverlay().box.style.display = 'none';
    }, 700);
  }

  function setRecording(on) {
    recording = on;
    updateBadge();
  }

  // ---------- Seletor de verificação ----------

  function onPickMove(e) {
    if (e.target instanceof Element && !overlayHost?.contains(e.target)) placeBox(e.target, 'pick');
  }

  // Sobe do elemento clicado até um alvo com seletor estável e o mesmo texto
  // (ex.: a <div> interna de uma mensagem vira o próprio .message-error).
  function verifyTarget(el) {
    const message = el.closest(PAGE_MESSAGES);
    if (message && elementText(message) === elementText(el)) return message;
    let cur = el;
    for (let i = 0; i < 4; i++) {
      const best = buildSelectors(cur)[0];
      if (best && !(best.css && best.css.includes(' > '))) return cur;
      const parent = cur.parentElement;
      if (!parent || parent === document.body || elementText(parent) !== elementText(cur)) break;
      cur = parent;
    }
    return el;
  }

  function onPickClick(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!(e.target instanceof Element)) return;
    const el = verifyTarget(e.target);
    const text = elementText(el).slice(0, 80);
    const step = text
      ? { type: 'assertText', selectors: buildSelectors(el), value: text, label: describeEl(el), fp: fingerprint(el) }
      : { type: 'assertVisible', selectors: buildSelectors(el), label: describeEl(el), fp: fingerprint(el) };
    send({ type: 'picked', step });
    stopPick();
  }

  const swallow = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  function startPick() {
    if (picking) return;
    picking = true;
    window.addEventListener('mousemove', onPickMove, true);
    window.addEventListener('click', onPickClick, true);
    window.addEventListener('mousedown', swallow, true);
    window.addEventListener('mouseup', swallow, true);
    window.addEventListener('pointerdown', swallow, true);
    updateBadge();
  }

  function stopPick() {
    picking = false;
    window.removeEventListener('mousemove', onPickMove, true);
    window.removeEventListener('click', onPickClick, true);
    window.removeEventListener('mousedown', swallow, true);
    window.removeEventListener('mouseup', swallow, true);
    window.removeEventListener('pointerdown', swallow, true);
    if (overlay) overlay.box.style.display = 'none';
    updateBadge();
  }

  // ---------- Execução ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isCheckable(el) {
    return el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio');
  }

  function stepTarget(step, predicate) {
    for (const sel of step.selectors || []) {
      let matches;
      try {
        matches = query(sel);
      } catch {
        continue;
      }
      if (!matches.length) continue;
      const visible = matches.filter(isVisible);
      // select/type aceitam campo escondido: selects customizados e passos gravados por
      // preenchimento automático em formulários ocultos (gravações antigas).
      const allowHidden = step.type === 'select' || step.type === 'type' || matches.some(isCheckable);
      const pool = visible.length ? visible : allowHidden ? matches : [];
      const usable = pool.filter((el) => !(['click', 'type', 'select', 'press'].includes(step.type) && el.disabled));
      if (!usable.length) continue;
      if (!predicate) return { el: usable[0] };
      const found = usable.find(predicate);
      if (found) return { el: found };
      return { near: usable[0] };
    }
    return {};
  }

  function loaderVisible(selector) {
    if (!selector) return false;
    try {
      return [...document.querySelectorAll(selector)].some(isVisible);
    } catch {
      return false;
    }
  }

  // ---------- Auto-correção de seletor ----------

  /** "Impressão digital" do elemento, gravada junto com o passo para achá-lo se o seletor quebrar. */
  function fingerprint(el) {
    const fp = { tag: el.tagName.toLowerCase() };
    const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    // Em campos de formulário o "texto" é o valor digitado (pode ser senha): nunca guardar.
    const isButtonInput = el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(el.type);
    const text = !isField || isButtonInput ? elementText(el).slice(0, 80) : '';
    if (text) fp.text = text;
    for (const [k, attr] of [['id', 'id'], ['name', 'name'], ['type', 'type'], ['placeholder', 'placeholder'], ['aria', 'aria-label'], ['title', 'title']]) {
      const v = el.getAttribute(attr);
      if (v) fp[k] = v;
    }
    for (const attr of TEST_ATTRS) {
      const v = el.getAttribute(attr);
      if (v) fp.testAttr = `${attr}=${v}`;
    }
    if (isField) fp.label = fieldLabel(el);
    if (el.tagName === 'A' && el.getAttribute('href')) {
      try {
        fp.href = new URL(el.href).pathname;
      } catch {
        // href inválido
      }
    }
    const classes = [...el.classList].filter((c) => !/\d{2,}|active|focus|hover|selected|open|show|visible|^_/i.test(c)).slice(0, 5);
    if (classes.length) fp.classes = classes;
    return fp;
  }

  // Passos gravados antes da impressão digital: usa o que der dos seletores e do rótulo.
  function fingerprintOf(step) {
    if (step.fp) return step.fp;
    const textSel = (step.selectors || []).find((sel) => sel.text);
    if (!textSel && !step.label) return null;
    return { tag: textSel?.tag, text: textSel?.text || step.label, label: step.label };
  }

  const simplify = (t) => norm(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  function similarity(a, b) {
    a = simplify(a);
    b = simplify(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.75;
    const wa = new Set(a.split(/\W+/).filter(Boolean));
    const wb = new Set(b.split(/\W+/).filter(Boolean));
    const inter = [...wa].filter((w) => wb.has(w)).length;
    return inter / Math.max(wa.size, wb.size, 1);
  }

  function healScore(el, fp) {
    let score = 0;
    const tag = el.tagName.toLowerCase();
    if (fp.tag && tag === fp.tag) score += 1;
    if (fp.testAttr) {
      const [attr, v] = fp.testAttr.split('=');
      if (el.getAttribute(attr) === v) score += 6;
    }
    if (fp.id && el.id === fp.id) score += 5;
    if (fp.name && el.getAttribute('name') === fp.name) score += 5;
    if (fp.text) score += 4 * similarity(elementText(el), fp.text);
    if (fp.label && (el.labels || el.tagName === 'SELECT')) score += 4 * similarity(fieldLabel(el), fp.label);
    if (fp.placeholder && el.getAttribute('placeholder')) score += 3 * similarity(el.getAttribute('placeholder'), fp.placeholder);
    if (fp.aria && el.getAttribute('aria-label')) score += 3 * similarity(el.getAttribute('aria-label'), fp.aria);
    if (fp.type && el.getAttribute('type') === fp.type) score += 1;
    if (fp.href && el.tagName === 'A') {
      try {
        if (new URL(el.href).pathname === fp.href) score += 3;
      } catch {
        // href inválido
      }
    }
    if (fp.classes && el.classList.length) score += fp.classes.filter((c) => el.classList.contains(c)).length * 0.5;
    return score;
  }

  /** Procura o elemento mais parecido com o gravado. Só aceita se for claramente o melhor. */
  function heal(step) {
    const fp = fingerprintOf(step);
    if (!fp) return null;
    const pool = document.querySelectorAll(fp.tag && !['div', 'span'].includes(fp.tag) ? `${fp.tag}, ${INTERACTIVE}` : INTERACTIVE);
    const scored = [];
    for (const el of pool) {
      if (!isVisible(el) || el.disabled || overlayHost?.contains(el)) continue;
      const score = healScore(el, fp);
      if (score >= 4) scored.push({ el, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const [best, second] = scored;
    if (!best) return null;
    if (second && best.score - second.score < 1) return null;
    return best;
  }

  async function waitFor(step, timeout, predicate, loaderSelector, healing) {
    const start = Date.now();
    const end = start + timeout;
    // Antes de esperar o tempo todo, tenta a auto-correção quando nenhum seletor acha nada.
    const healAt = start + Math.min(3000, timeout / 2);
    let near = null;
    for (;;) {
      if (!loaderVisible(loaderSelector)) {
        const res = stepTarget(step, predicate);
        if (res.el) return res.el;
        if (res.near) near = res.near;
        if (healing && !predicate && !near && Date.now() >= healAt) {
          const healed = heal(step);
          if (healed) {
            healing.result = { selectors: buildSelectors(healed.el), score: Number(healed.score.toFixed(1)), text: elementText(healed.el).slice(0, 60) };
            return healed.el;
          }
        }
      }
      if (Date.now() > end) {
        if (predicate && near) {
          throw new Error(`Texto "${step.value}" não encontrado. O elemento contém: "${elementText(near).slice(0, 100)}"`);
        }
        if (loaderVisible(loaderSelector)) throw new Error('A página continuou carregando (loader visível) até o tempo limite.');
        throw new Error(`Elemento não encontrado: ${step.label || JSON.stringify(step.selectors?.[0] || {})}`);
      }
      await sleep(120);
    }
  }

  function mouseOpts(el) {
    const r = el.getBoundingClientRect();
    return { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
  }

  function doClick(el) {
    const o = mouseOpts(el);
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    if (document.activeElement && document.activeElement !== el) document.activeElement.blur?.();
    el.focus?.({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.click();
  }

  function setValue(el, value) {
    el.focus?.({ preventScroll: true });
    if (el.isContentEditable) {
      el.innerText = value;
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: String(value).slice(-1) }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function selectOption(el, step) {
    const options = [...el.options];
    const opt = options.find((o) => o.value === step.value) || options.find((o) => norm(o.text) === norm(step.optionText || step.value));
    if (!opt) throw new Error(`Opção "${step.optionText || step.value}" não existe em ${step.label || 'select'}`);
    el.focus?.({ preventScroll: true });
    el.value = opt.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pressKey(el, key) {
    const code = key === 'Enter' ? 13 : key === 'Escape' ? 27 : key === 'Tab' ? 9 : 0;
    const o = { key, code: key, keyCode: code, which: code, bubbles: true, cancelable: true };
    const notCanceled = el.dispatchEvent(new KeyboardEvent('keydown', o));
    el.dispatchEvent(new KeyboardEvent('keypress', o));
    el.dispatchEvent(new KeyboardEvent('keyup', o));
    if (key === 'Enter' && notCanceled && el.form) {
      const submitter = el.form.querySelector('button[type=submit],input[type=submit],button:not([type])');
      el.form.requestSubmit(submitter || undefined);
    }
  }

  async function runStep(step, opts) {
    const { timeout, loaderSelector } = opts;
    if (step.type === 'assertText') {
      const expected = norm(step.value);
      const el = await waitFor(step, timeout, (e) => elementText(e).includes(expected) || norm(e.textContent).includes(expected), loaderSelector);
      flash(el, 'ok');
      return { result: { ok: true } };
    }
    if (step.type === 'assertNotVisible') {
      const end = Date.now() + timeout;
      while (stepTarget(step).el) {
        if (Date.now() > end) throw new Error(`Elemento ainda visível: ${step.label || ''}`);
        await sleep(120);
      }
      return { result: { ok: true } };
    }

    const healing = opts.autoHeal === false ? null : {};
    const el = await waitFor(step, timeout, null, loaderSelector, healing);
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    flash(el, healing?.result ? 'pick' : step.type === 'assertVisible' ? 'ok' : '');
    const ok = healing?.result ? { ok: true, healed: healing.result } : { ok: true };

    switch (step.type) {
      case 'click':
        return { result: ok, after: () => doClick(el) };
      case 'type':
        setValue(el, step.value ?? '');
        return { result: ok };
      case 'select':
        selectOption(el, step);
        return { result: ok };
      case 'press':
        return { result: ok, after: () => pressKey(el, step.key || step.value || 'Enter') };
      case 'hover': {
        const o = mouseOpts(el);
        el.dispatchEvent(new PointerEvent('pointerover', o));
        el.dispatchEvent(new MouseEvent('mouseover', o));
        el.dispatchEvent(new MouseEvent('mouseenter', { ...o, bubbles: false }));
        return { result: ok };
      }
      case 'assertVisible':
        return { result: ok };
      default:
        throw new Error(`Tipo de passo não suportado na página: ${step.type}`);
    }
  }

  // ---------- Diagnóstico (erros de JS e mensagens da loja) ----------

  // Mensagens de erro do Magento (sessão, validação de formulário) e alertas genéricos.
  const PAGE_MESSAGES = [
    '.message-error', '.message.error', '.messages .error', '.message-warning', '.message.warning',
    'div.mage-error', '.field-error', '[role="alert"]', '.alert-danger', '.error-msg',
  ].join(',');

  let runActive = false;
  const pendingLogs = [];

  function forwardLog(entry) {
    if (runActive) {
      send({ type: 'pagelog', ...entry });
      return;
    }
    pendingLogs.push(entry);
    if (pendingLogs.length > 30) pendingLogs.shift();
  }

  function flushLogs() {
    while (pendingLogs.length) send({ type: 'pagelog', ...pendingLogs.shift() });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__qaRecorder !== true) return;
    forwardLog({ kind: e.data.kind, text: e.data.text });
  });

  function pageMessages() {
    const seen = new Set();
    const out = [];
    for (const el of document.querySelectorAll(PAGE_MESSAGES)) {
      if (!isVisible(el)) continue;
      // Evita repetir a mesma mensagem em wrappers aninhados (.messages > .message-error > div).
      if (el.parentElement && el.parentElement.closest(PAGE_MESSAGES) && isVisible(el.parentElement.closest(PAGE_MESSAGES))) continue;
      let text = elementText(el);
      if (!text) continue;
      if (el.matches('div.mage-error, .field-error')) {
        const field = el.closest('.field, .control')?.parentElement?.querySelector('label');
        // O Magento cria o erro com id "<id do campo>-error".
        const fieldId = el.id && el.id.endsWith('-error') ? el.id.slice(0, -6) : null;
        const byId = fieldId ? (el.closest('form')?.querySelector('#' + CSS.escape(fieldId)) || document.getElementById(fieldId)) : null;
        const input = byId || (el.id ? document.querySelector(`[aria-describedby~="${CSS.escape(el.id)}"]`) : null);
        const name = input ? fieldLabel(input) : field ? norm(field.innerText).replace(/\s*\*$/, '') : '';
        if (name) text = `${name}: ${text}`;
      }
      if (seen.has(text)) continue;
      seen.add(text);
      out.push(text.slice(0, 300));
      if (out.length >= 10) break;
    }
    return out;
  }

  // Sinal para o diagnóstico: link de sair/minha conta visível no topo da página.
  function looksLoggedIn() {
    const re = /\b(sair|logout|log out|sign out|cerrar sesi[oó]n|minha conta|mi cuenta|my account|meus pedidos|mis pedidos)\b/i;
    const scope = document.querySelectorAll('header a, header button, .header a, .page-header a, .customer-welcome, .customer-name');
    return [...scope].some((el) => isVisible(el) && re.test(elementText(el)));
  }

  // ---------- Mensagens ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case 'ping':
        sendResponse({ pong: true });
        return false;
      case 'rec:on':
        setRecording(true);
        sendResponse({ ok: true });
        return false;
      case 'rec:off':
        setRecording(false);
        stopPick();
        sendResponse({ ok: true });
        return false;
      case 'pick:on':
        startPick();
        sendResponse({ ok: true });
        return false;
      case 'highlight': {
        const res = stepTarget(msg.step);
        if (res.el) {
          res.el.scrollIntoView({ block: 'center' });
          flash(res.el, 'ok');
        }
        const count = (msg.step.selectors || []).map((s) => {
          try {
            return query(s).length;
          } catch {
            return -1;
          }
        });
        sendResponse({ found: Boolean(res.el), count });
        return false;
      }
      case 'diagnose':
        sendResponse({ messages: pageMessages(), url: location.href, title: document.title, loggedIn: looksLoggedIn() });
        return false;
      case 'run:on':
        runActive = true;
        flushLogs();
        sendResponse({ ok: true });
        return false;
      case 'run:off':
        runActive = false;
        pendingLogs.length = 0;
        sendResponse({ ok: true });
        return false;
      case 'exec':
        if (!runActive) {
          runActive = true;
          flushLogs();
        }
        runStep(msg.step, msg)
          .then((r) => {
            sendResponse(r.result);
            if (r.after) setTimeout(r.after, 0);
          })
          .catch((e) => sendResponse({ ok: false, error: e.message }));
        return true;
      default:
        return false;
    }
  });

  send({ type: 'hello' }).then((res) => {
    if (res && res.recording) setRecording(true);
    if (res && res.running) {
      runActive = true;
      flushLogs();
    } else {
      pendingLogs.length = 0;
    }
  });
})();
