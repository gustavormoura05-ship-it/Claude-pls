// Biblioteca de efeitos sonoros sintetizados (determinísticos, sem downloads).
// Gera assets/sfx/<nome>.wav — 48 kHz, 16 bits, estéreo.
// Uso: node engine/sfx.mjs            (gera só o que falta)
//      node engine/sfx.mjs --force    (regera tudo)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SFX_DIR = path.join(ROOT, 'assets', 'sfx');
const SR = 48000;
const TAU = Math.PI * 2;

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---- filtros ----
function biquad(type, f, q = 0.707) {
  const w = TAU * f / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; } // bp
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const f_ = x => { const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
  return f_;
}
// filtro com frequência variável (recalcula a cada amostra — simples e suficiente)
function sweepFilter(type, q = 0.707) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x, f) => {
    const w = TAU * clamp(f, 20, SR * 0.45) / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    let b0, b1, b2; const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; } else { b0 = al; b1 = 0; b2 = -al; }
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; return y;
  };
}
// reverb simples (Schroeder): 4 combs + 2 allpass
function reverb(buf, mix = 0.3, size = 1) {
  const combs = [1557, 1617, 1491, 1422].map(n => ({ b: new Float32Array(Math.floor(n * size * 2.2)), i: 0, fb: 0.8 }));
  const aps = [225, 556].map(n => ({ b: new Float32Array(Math.floor(n * 2.2)), i: 0 }));
  const out = new Float32Array(buf.length);
  for (let n = 0; n < buf.length; n++) {
    let s = 0;
    for (const c of combs) { const y = c.b[c.i]; c.b[c.i] = buf[n] + y * c.fb; c.i = (c.i + 1) % c.b.length; s += y; }
    s /= 4;
    for (const a of aps) { const y = a.b[a.i]; const v = s + y * 0.5; a.b[a.i] = v; a.i = (a.i + 1) % a.b.length; s = y - v * 0.5; }
    out[n] = buf[n] * (1 - mix) + s * mix;
  }
  return out;
}
const env = (t, a, d, len) => clamp(t / a, 0, 1) * clamp((len - t) / d, 0, 1);

// ---- sons ----
const SOUNDS = {
  // vento contínuo no topo do morro
  vento(len = 72) {
    const r = rng(1), lp = sweepFilter('lp', 0.9), L = new Float32Array(len * SR);
    let pink = 0;
    for (let n = 0; n < L.length; n++) {
      const t = n / SR; pink = pink * 0.97 + (r() * 2 - 1) * 0.03;
      const gust = 0.55 + 0.45 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1);
      L[n] = lp(pink * 9, 250 + 550 * gust) * (0.5 + 0.5 * gust) * env(t, 2, 2, len);
    }
    return L;
  },
  // trilha: drone grave tenso que cresce
  trilha(len = 72) {
    const L = new Float32Array(len * SR), lp = biquad('lp', 700);
    for (let n = 0; n < L.length; n++) {
      const t = n / SR, g = clamp(t / len, 0, 1);
      let s = 0;
      for (const [f, a] of [[55, 1], [55.35, 0.8], [82.4, 0.5], [110.3, 0.35], [164.8, 0.12 + g * 0.25], [207.7, g * 0.18]]) {
        let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin(TAU * f * h * t) / h; s += v * a;
      }
      const pulse = 0.75 + 0.25 * Math.sin(TAU * (0.5 + g * 1.2) * t);
      L[n] = lp(s) * 0.16 * pulse * (0.45 + 0.55 * g) * env(t, 3, 2.5, len);
    }
    return L;
  },
  // riser agudo (cordas tensas) para o final
  tensao(len = 14) {
    const L = new Float32Array(len * SR), r = rng(9);
    for (let n = 0; n < L.length; n++) {
      const t = n / SR, g = t / len, f = 440 * Math.pow(2, g * 1.2);
      const trem = 0.6 + 0.4 * Math.sin(TAU * (6 + g * 10) * t);
      let s = 0; for (const d of [1, 1.006, 0.994, 1.5]) s += Math.sin(TAU * f * d * t + Math.sin(TAU * 5 * t) * 0.6);
      L[n] = (s * 0.08 + (r() - 0.5) * 0.02) * trem * g * g * env(t, 0.5, 0.05, len);
    }
    return L;
  },
  // sirene distante (oscilando), com eco
  sirene(len = 9) {
    const L = new Float32Array(len * SR), lp = biquad('lp', 1800); let ph = 0;
    for (let n = 0; n < L.length; n++) {
      const t = n / SR, f = 760 + 340 * Math.sin(TAU * t / 2.6 - Math.PI / 2);
      ph += TAU * f / SR;
      L[n] = lp(Math.sin(ph) * 0.6 + Math.sin(ph * 2) * 0.2 + Math.sign(Math.sin(ph)) * 0.08) * 0.35 * env(t, 1.2, 2, len);
    }
    return reverb(L, 0.45, 1.3);
  },
  // celular vibrando
  vibra(len = 1.4) {
    const L = new Float32Array(len * SR), lp = biquad('lp', 400);
    for (let n = 0; n < L.length; n++) {
      const t = n / SR, on = (t % 0.55) < 0.38 ? 1 : 0;
      L[n] = lp(Math.sign(Math.sin(TAU * 165 * t)) * 0.9 + Math.sin(TAU * 55 * t)) * on * 0.5;
    }
    return L;
  },
  // grunhido de zumbi
  grunhido(len = 2.6, seed = 3) {
    const r = rng(seed), L = new Float32Array(len * SR);
    const f1 = biquad('bp', 520, 4), f2 = biquad('bp', 1150, 5), f3 = biquad('bp', 260, 3); let ph = 0;
    for (let n = 0; n < L.length; n++) {
      const t = n / SR, g = t / len;
      const f0 = 78 + 22 * Math.sin(TAU * 0.6 * t) + 10 * Math.sin(TAU * 7.3 * t) + (r() - 0.5) * 25;
      ph += f0 / SR; const saw = (ph % 1) * 2 - 1;
      const src = saw * 0.8 + (r() * 2 - 1) * 0.5 * (0.4 + 0.6 * Math.abs(Math.sin(TAU * 3.1 * t)));
      L[n] = (f1(src) * 1.2 + f2(src) * 0.7 + f3(src)) * 0.9 * Math.sin(Math.PI * g) * (0.7 + 0.3 * Math.sin(TAU * 4.5 * t));
    }
    return reverb(L, 0.2);
  },
  // grito distante
  grito(len = 2.2) {
    const r = rng(5), L = new Float32Array(len * SR); let ph = 0;
    const f1 = biquad('bp', 1100, 3), f2 = biquad('bp', 2600, 4), lp = biquad('lp', 3000);
    for (let n = 0; n < L.length; n++) {
      const t = n / SR, g = t / len;
      const f0 = 520 + 520 * Math.sin(Math.PI * Math.min(1, g * 1.6)) + 18 * Math.sin(TAU * 6 * t);
      ph += f0 / SR; const saw = (ph % 1) * 2 - 1;
      const src = saw + (r() * 2 - 1) * 0.35;
      L[n] = lp(f1(src) + f2(src) * 0.6) * 0.8 * env(t, 0.06, 0.8, len);
    }
    return reverb(L, 0.55, 1.4);
  },
  // portão de metal sacudindo
  portao(len = 3.5) {
    const r = rng(7), L = new Float32Array(len * SR);
    const hits = []; for (let k = 0; k < 16; k++) hits.push({ t: r() * (len - 0.5), a: 0.4 + r() * 0.6 });
    const partials = [212, 347, 529, 811, 1243, 1712, 2390];
    for (const h of hits) {
      const s0 = Math.floor(h.t * SR);
      for (let n = 0; n < SR * 0.6 && s0 + n < L.length; n++) {
        const t = n / SR; let s = 0;
        partials.forEach((f, i) => { s += Math.sin(TAU * f * (1 + h.a * 0.01) * t) * Math.exp(-t * (6 + i * 3)) / (1 + i * 0.4); });
        L[s0 + n] += (s * 0.25 + (n < 300 ? (r() * 2 - 1) * 0.6 : 0)) * h.a;
      }
    }
    return reverb(L, 0.25);
  },
  // batimento cardíaco (acelerando)
  coracao(len = 10) {
    const L = new Float32Array(len * SR), lp = biquad('lp', 120);
    let t0 = 0, k = 0; const beats = [];
    while (t0 < len) { beats.push(t0, t0 + 0.22); const per = 0.9 - 0.45 * (t0 / len); t0 += per; k++; }
    for (const b of beats) {
      const s0 = Math.floor(b * SR);
      for (let n = 0; n < SR * 0.25 && s0 + n < L.length; n++) { const t = n / SR; L[s0 + n] += Math.sin(TAU * (55 - t * 60) * t) * Math.exp(-t * 22) * 1.4; }
    }
    return L.map(v => lp(v) * 1.6);
  },
  // transição
  whoosh(len = 1.1) {
    const r = rng(11), L = new Float32Array(len * SR), bp = sweepFilter('bp', 1.2);
    for (let n = 0; n < L.length; n++) { const t = n / SR, g = t / len; L[n] = bp(r() * 2 - 1, 250 + 3200 * Math.sin(Math.PI * g)) * Math.sin(Math.PI * g) * 0.9; }
    return L;
  },
  // impacto grave (título / escolha)
  impacto(len = 3.2) {
    const r = rng(13), L = new Float32Array(len * SR), lp = biquad('lp', 400); let ph = 0;
    for (let n = 0; n < L.length; n++) {
      const t = n / SR, f = 35 + 110 * Math.exp(-t * 6); ph += TAU * f / SR;
      L[n] = Math.sin(ph) * Math.exp(-t * 1.4) * 0.9 + lp(r() * 2 - 1) * Math.exp(-t * 9) * 0.8;
    }
    return reverb(L, 0.3, 1.5);
  },
  // multidão em pânico
  multidao(len = 9) {
    const r = rng(17), L = new Float32Array(len * SR);
    for (let v = 0; v < 26; v++) {
      const f = biquad('bp', 350 + r() * 1400, 3 + r() * 4), rate = 2 + r() * 4, ph = r() * 6, amp = 0.3 + r() * 0.7, st = r() * 1.5;
      for (let n = 0; n < L.length; n++) { const t = n / SR; if (t < st) continue; const syl = Math.max(0, Math.sin(TAU * rate * t + ph)); L[n] += f(r() * 2 - 1) * syl * amp * 0.35; }
    }
    for (let n = 0; n < L.length; n++) L[n] *= env(n / SR, 1.2, 2.5, len);
    return reverb(L, 0.3);
  },
  // trem chegando (rangido de ferro + motor)
  trem(len = 6) {
    const r = rng(19), L = new Float32Array(len * SR), lp = biquad('lp', 300), sq = biquad('bp', 2300, 12);
    for (let n = 0; n < L.length; n++) {
      const t = n / SR, g = t / len;
      const clack = ((t * 3.2) % 1) < 0.02 ? (r() * 2 - 1) : 0;
      L[n] = (lp(r() * 2 - 1) * 1.4 + clack * 0.5 + sq(r() * 2 - 1) * 0.6 * Math.max(0, Math.sin(TAU * 0.4 * t))) * env(t, 2, 1.5, len) * (1 - g * 0.3);
    }
    return reverb(L, 0.35, 1.2);
  },
};

function writeWav(file, L) {
  // estéreo com leve "abertura" (atraso de 0,4 ms no canal direito)
  const n = L.length, d = 19, data = Buffer.alloc(n * 4);
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]));
  const g = peak > 0.98 ? 0.98 / peak : 1;
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(clamp(L[i] * g, -1, 1) * 32767), i * 4);
    data.writeInt16LE(Math.round(clamp((L[i - d] || 0) * g, -1, 1) * 32767), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

export function ensureSfx(names = Object.keys(SOUNDS), force = false) {
  fs.mkdirSync(SFX_DIR, { recursive: true });
  for (const name of names) {
    if (!SOUNDS[name]) throw new Error(`Som desconhecido: "${name}". Disponíveis: ${Object.keys(SOUNDS).join(', ')}`);
    const f = path.join(SFX_DIR, name + '.wav');
    if (!force && fs.existsSync(f)) continue;
    writeWav(f, SOUNDS[name]());
    console.log('  sfx ->', path.relative(ROOT, f));
  }
}
export const SFX_NAMES = Object.keys(SOUNDS);

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  ensureSfx(undefined, process.argv.includes('--force'));
}
