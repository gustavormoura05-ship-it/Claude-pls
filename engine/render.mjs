// Renderizador: Playwright (Chrome headless) -> PNGs quadro a quadro -> ffmpeg (vídeo + mixagem de som).
//
// Uso:
//   node engine/render.mjs videos/ep01-cristo/script.json
//   node engine/render.mjs videos/ep01-cristo/script.json --start 0 --duration 4 --out out/teste.mp4
// Opções:
//   --start S        começa no segundo S (padrão 0)
//   --duration D     renderiza D segundos (padrão: duração do roteiro)
//   --out arq.mp4    arquivo de saída (padrão out/<pasta-do-video>.mp4)
//   --workers N      páginas do Chrome em paralelo (padrão 2)
//   --stills a,b,c   também salva PNGs nestes tempos (s) em out/stills/
//   --keep           não apaga a pasta de quadros
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ensureSfx, SFX_DIR } from './sfx.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- argumentos ----------
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const scriptPath = argv.find(a => a.endsWith('.json'));
if (!scriptPath) { console.error('Informe o script.json'); process.exit(1); }
const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
validate(script);
const FPS = script.fps || 30;
const start = Number(opt('start', 0));
const duration = Number(opt('duration', script.duration - start));
const workers = Number(opt('workers', 2));
const name = path.basename(path.dirname(path.resolve(scriptPath)));
const out = path.resolve(opt('out', path.join('out', name + '.mp4')));
const framesDir = path.join(ROOT, 'frames', path.basename(out, '.mp4'));
const stills = (opt('stills', '') || '').split(',').filter(Boolean).map(Number);
const N = Math.round(duration * FPS);

function validate(s) {
  const err = m => { throw new Error('script.json inválido: ' + m); };
  if (!s.title?.text) err('falta title.text');
  if (!(s.duration >= 61)) console.warn('⚠ duração < 61 s (o formato pede pelo menos 61 s)');
  if (s.width && (s.width !== 1080 || s.height !== 1920)) err('o formato é 1080x1920');
  for (const c of s.captions) {
    if (!(c.end > c.start)) err(`legenda "${c.text}" com tempo inválido`);
    if (!c.camera) err(`legenda "${c.text}" sem movimento de câmera`);
  }
  for (const x of s.sounds || []) if (x.t == null || !x.sfx) err('cada som precisa de { t, sfx }');
}

// ---------- servidor estático local ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/engine/index.html`;

// ---------- quadros ----------
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
fs.mkdirSync(path.dirname(out), { recursive: true });
console.log(`▶ ${script.title.text}\n  ${N} quadros (${duration}s @ ${FPS}fps, a partir de ${start}s) com ${workers} página(s)`);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync'] });
const t0 = Date.now();
let done = 0;
async function worker(w) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('[página]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('[console]', m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true);
  await page.evaluate(s => window.loadScript(s), script);
  for (let i = w; i < N; i += workers) {
    const t = start + i / FPS;
    await page.evaluate(t => window.renderFrame(t), t);
    await page.screenshot({ path: path.join(framesDir, `f_${String(i).padStart(5, '0')}.png`), type: 'png' });
    done++;
    if (done % 30 === 0 || done === N) {
      const el = (Date.now() - t0) / 1000;
      process.stdout.write(`\r  ${done}/${N} quadros · ${(el / done).toFixed(2)} s/quadro · faltam ~${Math.round(el / done * (N - done))} s   `);
    }
  }
  if (w === 0 && stills.length) {
    const sd = path.join(path.dirname(out), 'stills'); fs.mkdirSync(sd, { recursive: true });
    for (const t of stills) {
      await page.evaluate(t => window.renderFrame(t), t);
      await page.screenshot({ path: path.join(sd, `${path.basename(out, '.mp4')}_t${t.toFixed(2)}.png`) });
    }
  }
  await page.close();
}
await Promise.all(Array.from({ length: workers }, (_, w) => worker(w)));
await browser.close();
server.close();
console.log(`\n  quadros prontos em ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// ---------- som: cada efeito no seu tempo ----------
const sounds = (script.sounds || []).filter(s => s.t < start + duration && s.t + (s.dur ?? 999) > start);
ensureSfx([...new Set(sounds.map(s => s.sfx))]);
const mix = path.join(framesDir, 'mix.wav');
const ff = (args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' }); if (r.status !== 0) throw new Error('ffmpeg falhou'); };
if (sounds.length) {
  const inputs = [], filters = [];
  sounds.forEach((s, i) => {
    inputs.push('-i', path.join(SFX_DIR, s.sfx + '.wav'));
    const rel = s.t - start; // tempo relativo ao trecho renderizado
    const chain = [];
    const skip = Math.max(0, -rel);
    if (skip > 0 || s.dur != null) chain.push(`atrim=start=${skip.toFixed(3)}${s.dur != null ? `:end=${(s.dur).toFixed(3)}` : ''}`, 'asetpts=PTS-STARTPTS');
    if (s.fadeOut) chain.push(`afade=t=out:st=${Math.max(0, (s.dur ?? 10) - skip - s.fadeOut).toFixed(3)}:d=${s.fadeOut}`);
    chain.push(`volume=${s.vol ?? 1}`);
    if (rel > 0) { const ms = Math.round(rel * 1000); chain.push(`adelay=${ms}|${ms}`); }
    filters.push(`[${i}:a]${chain.join(',')}[s${i}]`);
  });
  filters.push(`${sounds.map((_, i) => `[s${i}]`).join('')}amix=inputs=${sounds.length}:normalize=0:dropout_transition=0,alimiter=limit=0.9,atrim=end=${duration},apad=whole_dur=${duration}[mix]`);
  ff([...inputs, '-filter_complex', filters.join(';'), '-map', '[mix]', '-ar', '48000', '-ac', '2', mix]);
} else {
  ff(['-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`, '-t', String(duration), mix]);
}

// ---------- vídeo final ----------
ff(['-framerate', String(FPS), '-i', path.join(framesDir, 'f_%05d.png'), '-i', mix,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
if (!argv.includes('--keep')) fs.rmSync(framesDir, { recursive: true, force: true });
console.log(`✔ ${path.relative(process.cwd(), out)}`);
