// Gera as imagens da Chrome Web Store em dist/loja/ a partir dos prints do guia.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const img = (f) => `data:image/png;base64,${fs.readFileSync(path.join(root, 'docs/guia/img', f)).toString('base64')}`;
const out = path.join(root, 'dist/loja');
fs.mkdirSync(out, { recursive: true });

const base = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: "Inter", system-ui, "Segoe UI", Roboto, sans-serif; color: #fff; overflow: hidden; }
  .bg { width: 100vw; height: 100vh; background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 55%, #3b82f6 100%); position: relative; }
  .shot { border-radius: 12px; box-shadow: 0 18px 50px rgba(8, 20, 60, .45); background: #fff; display: block; }
  h1 { font-weight: 800; letter-spacing: -.02em; line-height: 1.1; }
  p { opacity: .9; line-height: 1.4; }
  .logo { background: #fff; border-radius: 26%; box-shadow: 0 10px 30px rgba(8, 20, 60, .35); display: inline-block; line-height: 0; }
  .logo img { width: 100%; height: 100%; }
`;
const logo = (px, extra = '') => `<span class="logo" style="width:${px}px;height:${px}px;padding:${Math.round(px * 0.1)}px;${extra}"><img src="${img('panda-big.png')}"></span>`;

function wide(title, sub, file) {
  return `<div class="bg" style="padding:44px 56px 0">
    <h1 style="font-size:40px">${title}</h1><p style="font-size:20px;margin-top:10px">${sub}</p>
    <img class="shot" src="${img(file)}" style="width:1168px;margin-top:34px;border-radius:12px 12px 0 0">
  </div>`;
}

function side(title, sub, files) {
  return `<div class="bg" style="display:flex;align-items:center;gap:56px;padding:0 64px">
    <div style="flex:0 0 420px">
      ${logo(84, 'margin-bottom:26px')}
      <h1 style="font-size:44px">${title}</h1><p style="font-size:21px;margin-top:16px">${sub}</p>
    </div>
    <div style="flex:1;display:flex;gap:28px;justify-content:flex-start;align-items:flex-start;height:720px;overflow:hidden">
      ${files.map((f) => `<img class="shot" src="${img(f)}" style="max-height:720px;width:${files.length > 1 ? 320 : 380}px;object-fit:cover;object-position:top">`).join('')}
    </div>
  </div>`;
}

const tiles = {
  'promo-pequeno-440x280': [440, 280, `<div class="bg" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px">
    ${logo(100)}
    <h1 style="font-size:30px">Panda QA Recorder</h1>
    <p style="font-size:15px">Grave e repita testes de front</p></div>`],
  'promo-grande-1400x560': [1400, 560, `<div class="bg" style="display:flex;align-items:center;gap:56px;padding:0 90px">
    ${logo(230, 'flex:0 0 230px')}
    <div><h1 style="font-size:64px">Panda QA Recorder</h1>
    <p style="font-size:28px;margin-top:16px;max-width:820px">Grave fluxos de login, cadastro e checkout, repita quando precisar e veja na hora onde e por que falhou.</p></div></div>`],
  'captura-1-gravar': [1280, 800, wide('Grave navegando normalmente', 'Cliques, campos e navegação viram uma lista de passos que você edita.', 'tela-gravando.png')],
  'captura-2-falha': [1280, 800, wide('Veja onde e por que falhou', 'Print, mensagem da loja, erros de JavaScript e requisições com erro no passo que quebrou.', 'tela-falha.png')],
  'captura-3-repetir': [1280, 800, side('Repita quando precisar', 'Um teste, vários ou todos do site, uma ou várias vezes com intervalo.', ['p2-teste-passou.png', 'p5-repeticao.png'])],
  'captura-4-ambientes': [1280, 800, side('Mesmo teste em todo ambiente', 'Variáveis para local, staging e produção, e auto-correção quando o seletor muda.', ['p7-variaveis.png', 'autocorrecao.png'])],
  'captura-5-compartilhar': [1280, 800, side('Compartilhe com o time', 'Código para outro QA, JSON para o dev, relatório e teste Playwright.', ['p6-compartilhar.png'])],
};

const browser = await chromium.launch();
for (const [name, [w, h, body]] of Object.entries(tiles)) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${base}</style></head><body>${body}</body></html>`);
  await page.waitForLoadState('load');
  await page.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 92 });
  await page.close();
  console.log(`dist/loja/${name}.jpg`);
}
await browser.close();
fs.copyFileSync(path.join(root, 'icons/icon128.png'), path.join(out, 'icone-128.png'));
console.log('dist/loja/icone-128.png');
