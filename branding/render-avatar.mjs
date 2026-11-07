// Gera as fotos de perfil do canal (1080x1080) + uma prévia de como ficam no círculo pequeno.
// Uso: node branding/render-avatar.mjs   -> out/avatar/avatar-1.png, avatar-2.png, avatar-3.png, previa.png
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out', 'avatar');
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

// 1) Cristo em contraluz no pôr do sol, renderizado pelo próprio motor 3D
{
  const ep = JSON.parse(fs.readFileSync(path.join(ROOT, 'videos/ep01-cristo/script.json'), 'utf8'));
  const pose = { pos: [11, -12.8], yaw: 140, pitch: 36, fov: 88 };
  const s = { ...ep, title: { ...ep.title, duration: 0.01, camera: undefined }, camera: { start: pose },
    captions: [{ start: 999, end: 1000, text: '', camera: { to: pose, shake: 0 } }], choice: undefined, counter: undefined, effects: [] };
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto(base + '/engine/index.html');
  await page.waitForFunction(() => window.__ready === true);
  await page.addStyleTag({ content: '#stage > div { display: none !important; }' });
  await page.evaluate(s => window.loadScript(s), s);
  await page.evaluate(() => window.renderFrame(52));
  await page.screenshot({ path: path.join(OUT, 'cristo-3d.png'), clip: { x: 0, y: 260, width: 1080, height: 1080 } });
  await page.close();
}

// 2) As três opções
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
await page.goto(base + '/branding/avatar.html');
await page.evaluate(() => document.fonts.ready);
for (const [i, id] of [[1, 'v1'], [2, 'v2'], [3, 'v3']]) {
  await page.evaluate(([id, bg]) => window.show(id, bg), [id, '/out/avatar/cristo-3d.png']);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, `avatar-${i}.png`) });
}
await page.close();

// 3) Prévia: como aparece no TikTok (círculo grande do perfil, médio e minúsculo nos comentários)
const prev = await browser.newPage({ viewport: { width: 1200, height: 760 } });
const imgs = [1, 2, 3].map(i => `${base}/out/avatar/avatar-${i}.png`);
await prev.setContent(`<!doctype html><html><head><style>
@font-face{font-family:M;font-weight:800;src:url(${base}/node_modules/@fontsource/montserrat/files/montserrat-latin-800-normal.woff2)}
body{margin:0;background:#121212;color:#fff;font-family:M,sans-serif}
.row{display:flex;justify-content:space-around;padding:40px 30px 0}
.col{display:flex;flex-direction:column;align-items:center;gap:22px;width:340px}
.n{font-size:34px;color:#ffd400}
.big{width:260px;height:260px;border-radius:50%;object-fit:cover;border:2px solid #333}
.sm{display:flex;align-items:center;gap:16px;font-size:20px;color:#bbb}
.sm img{border-radius:50%}
</style></head><body><div class="row">${imgs.map((src, k) => `<div class="col"><div class="n">${k + 1}</div>
<img class="big" src="${src}"><div class="sm"><img src="${src}" width="96" height="96"><img src="${src}" width="48" height="48"><img src="${src}" width="28" height="28"></div>
<div class="sm">@esefossevoceai</div></div>`).join('')}</div></body></html>`);
await prev.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].map(i => i.decode())]));
await prev.screenshot({ path: path.join(OUT, 'previa.png') });
await browser.close(); server.close();
console.log('✔ out/avatar/: avatar-1.png, avatar-2.png, avatar-3.png, previa.png');
