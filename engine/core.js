// Núcleo do renderizador "E Se...".
// Regra de ouro: renderFrame(t) monta o quadro INTEIRO a partir do tempo t.
// Nada depende do quadro anterior, nem de relógio, nem de Math.random —
// então renderizar o mesmo t duas vezes produz exatamente a mesma imagem.
import * as THREE from 'three';

export const W = 1080, H = 1920;
export const EYE_HEIGHT = 1.6; // metros — a câmera é o espectador

// ---------- utilidades determinísticas ----------
export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const EASE = {
  linear: k => k,
  in: k => k * k * k,
  out: k => 1 - Math.pow(1 - k, 3),
  inOut: k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
};
const DEG = Math.PI / 180;

// ---------- estado ----------
let script, renderer, scene, camera, world, camKeys, events;
const $ = s => document.querySelector(s);

// ---------- câmera: um movimento por legenda ----------
// Cada pose: { pos: [x, z] ou [x, y, z], yaw (graus), pitch (graus), fov, roll }
// yaw 0 = olhando para -Z; yaw positivo gira para a esquerda.
function normPose(p, prev) {
  const base = prev || { pos: [0, EYE_HEIGHT, 0], yaw: 0, pitch: 0, fov: 70, roll: 0 };
  const out = { ...base, ...p };
  if (p && p.pos) out.pos = p.pos.length === 2 ? [p.pos[0], EYE_HEIGHT, p.pos[1]] : p.pos.slice();
  return out;
}
function buildCameraKeys(s) {
  // Lista de segmentos [t0, t1, poseA, poseB, ease, shake]
  const segs = [];
  let pose = normPose(s.camera?.start);
  const moves = [];
  if (s.title?.camera) moves.push({ start: 0, end: s.title.duration, cam: s.title.camera });
  for (const c of s.captions) if (c.camera) moves.push({ start: c.start, end: c.end, cam: c.camera });
  moves.sort((a, b) => a.start - b.start);
  for (const m of moves) {
    const t0 = m.start + (m.cam.delay || 0);
    const t1 = m.cam.duration != null ? t0 + m.cam.duration : m.end;
    const to = normPose(m.cam.to, pose);
    segs.push({ t0, t1, a: pose, b: to, ease: EASE[m.cam.ease || 'inOut'], shake: m.cam.shake ?? 0.15, sEnd: m.end });
    pose = to;
  }
  return { start: normPose(s.camera?.start), segs };
}
function cameraAt(t) {
  const { start, segs } = camKeys;
  let pose = start, shake = segs.length ? segs[0].shake : 0.15;
  let walked = 0;
  for (const s of segs) {
    if (t >= s.t1) { pose = s.b; shake = s.shake; continue; }
    if (t >= s.t0) {
      const k = s.ease(clamp((t - s.t0) / Math.max(1e-6, s.t1 - s.t0)));
      pose = {
        pos: [0, 1, 2].map(i => lerp(s.a.pos[i], s.b.pos[i], k)),
        yaw: lerp(s.a.yaw, s.b.yaw, k), pitch: lerp(s.a.pitch, s.b.pitch, k),
        fov: lerp(s.a.fov, s.b.fov, k), roll: lerp(s.a.roll || 0, s.b.roll || 0, k),
      };
      shake = s.shake;
      // balanço de caminhada proporcional à distância percorrida
      const d = Math.hypot(s.b.pos[0] - s.a.pos[0], s.b.pos[2] - s.a.pos[2]);
      walked = d * k;
      break;
    }
    break; // antes do próximo movimento: segura a pose anterior
  }
  // tremor de mão (soma de senos = determinístico)
  const n = (f, p) => Math.sin(t * f + p);
  const sy = shake * (0.6 * n(1.3, 0.2) + 0.3 * n(2.9, 1.7) + 0.1 * n(7.1, 4.0));
  const sp = shake * (0.6 * n(1.1, 2.1) + 0.3 * n(3.3, 0.4) + 0.1 * n(6.7, 2.2));
  const bob = Math.sin(walked * Math.PI / 0.75) * 0.035 * clamp(walked * 4);
  return { ...pose, pos: [pose.pos[0], pose.pos[1] + bob, pose.pos[2]], yaw: pose.yaw + sy, pitch: pose.pitch + sp };
}

// ---------- eventos do roteiro ----------
// ev(id) devolve o tempo do evento (ou Infinity). since(id, t) = segundos desde o evento (negativo antes).
function makeEvents(s) {
  const map = {};
  for (const e of s.events || []) map[e.id] = e.t;
  return { at: id => (id in map ? map[id] : Infinity), since: (id, t) => t - (id in map ? map[id] : Infinity) };
}

// ---------- sobreposição 2D (título, contador, legendas, escolha) ----------
function esc(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function rich(s) { return esc(s).replace(/\*(.+?)\*/g, '<span class="hl">$1</span>'); }

function counterAt(t) {
  const c = script.counter; if (!c) return null;
  const k = c.keys;
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i][0]) {
      const u = (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
      const a = k[i - 1][1], b = k[i][1];
      // crescimento exponencial entre chaves positivas (parece "contágio"), linear caso contrário
      return a > 0 && b > 0 && c.curve === 'exp' ? a * Math.pow(b / a, u) : lerp(a, b, u);
    }
  }
  return k[k.length - 1][1];
}
function fmtCounter(v) {
  const c = script.counter;
  const n = Math.round(v);
  if (c.format === 'clock') { const h = Math.floor(n / 60), m = n % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
  return n.toLocaleString('pt-BR');
}

function pop(t, t0, t1, inDur = 0.18, outDur = 0.15) {
  if (t < t0 || t >= t1) return { o: 0, s: 1 };
  const a = clamp((t - t0) / inDur), b = clamp((t1 - t) / outDur);
  const s = 0.82 + 0.18 * EASE.out(a) + 0.06 * Math.sin(Math.PI * a);
  return { o: Math.min(a * 1.5, b, 1), s };
}

function updateOverlay(t) {
  const s = script;
  // título
  const td = s.title.duration;
  const tc = $('#titlecard');
  const tin = clamp(t / 0.35), tout = clamp((td - t) / 0.3);
  tc.style.opacity = Math.min(tin, tout);
  tc.style.transform = `scale(${0.9 + 0.1 * EASE.out(tin)})`;
  // cabeçalho + contador
  const hk = clamp((t - td) / 0.4);
  const choiceOn = s.choice && t >= s.choice.start;
  $('#header').style.opacity = choiceOn ? 0 : hk;
  if (s.counter) {
    const cv = counterAt(t);
    const visible = t >= (s.counter.showAt ?? td) && !choiceOn;
    const ck = visible ? clamp((t - (s.counter.showAt ?? td)) / 0.3) : 0;
    $('#counter').style.opacity = ck;
    $('#counter .value').textContent = fmtCounter(cv);
    // "pulso" quando o número sobe rápido
    const pulse = 1 + 0.04 * Math.max(0, Math.sin(t * 9));
    $('#counter .value').style.transform = `scale(${t > (s.counter.pulseFrom ?? 1e9) ? pulse : 1})`;
    $('#counter .value').style.transformOrigin = '0 50%';
  }
  // legenda ativa
  const cap = s.captions.find(c => t >= c.start && t < c.end);
  const el = $('#caption');
  if (cap && !(choiceOn && cap.hideOnChoice !== false && t >= s.choice.start)) {
    if (el.dataset.key !== String(cap.start)) { el.innerHTML = rich(cap.text); el.dataset.key = String(cap.start); }
    const p = pop(t, cap.start, cap.end);
    el.style.opacity = p.o; el.style.transform = `scale(${p.s})`;
    el.style.top = (cap.y ?? 1180) + 'px';
  } else { el.style.opacity = 0; }
  // escolha A/B
  const ch = $('#choice');
  if (choiceOn) {
    const u = t - s.choice.start;
    ch.style.opacity = clamp(u / 0.4);
    const items = [['.ask', 0.0], ['.opt.a', 0.35], ['.opt.b', 0.7], ['.cta', 1.2], ['.sub', 1.5]];
    for (const [sel, d] of items) {
      const k = clamp((u - d) / 0.3);
      const e = ch.querySelector(sel);
      e.style.opacity = k;
      const bump = sel === '.cta' ? 1 + 0.05 * Math.max(0, Math.sin((u - d) * 6)) * clamp(u - d - 0.3) : 1;
      e.style.transform = `scale(${(0.7 + 0.3 * EASE.out(k)) * bump})`;
    }
  } else ch.style.opacity = 0;
  // flash
  let f = 0;
  for (const e of s.effects || []) if (e.type === 'flash' && t >= e.t && t < e.t + e.dur) f = Math.max(f, (1 - (t - e.t) / e.dur) * (e.strength ?? 0.6));
  $('#flash').style.opacity = f;
}

function fillStatic() {
  const s = script;
  $('#titlecard .kicker').textContent = s.title.kicker || 'E SE...';
  $('#titlecard .q').innerHTML = rich(s.title.text);
  $('#header .ep').textContent = s.episode?.label || '';
  $('#header .short').textContent = s.title.short || '';
  if (s.counter) $('#counter .label').textContent = s.counter.label;
  if (s.choice) {
    $('#choice .ask').textContent = s.choice.ask || 'O QUE VOCÊ FAZ?';
    $('#choice .opt.a .txt').textContent = s.choice.a;
    $('#choice .opt.b .txt').textContent = s.choice.b;
    $('#choice .cta').textContent = s.choice.cta || 'COMENTE A OU B';
    $('#choice .sub').textContent = s.choice.sub || '';
  }
}

// ---------- API pública chamada pelo Playwright ----------
window.loadScript = async (s) => {
  script = s;
  events = makeEvents(s);
  camKeys = buildCameraKeys(s);
  renderer = new THREE.WebGLRenderer({ canvas: $('#gl'), antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, W / H, 0.05, 60000);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  await document.fonts.load('900 60px Montserrat');
  await document.fonts.load('800 60px Montserrat');
  await document.fonts.load('60px Anton');
  await document.fonts.ready;
  const mod = await import(`./scenes/${s.scene}.js`);
  world = await mod.build({ THREE, renderer, scene, camera, script: s, events, helpers: { rng, clamp, lerp, smooth, W, H } });
  fillStatic();
  // pré-compila todos os shaders (com tudo visível) para que nenhum quadro dependa de outro
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  return { duration: s.duration, fps: s.fps };
};

window.renderFrame = (t) => {
  const c = cameraAt(t);
  camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
  camera.rotation.set(c.pitch * DEG, c.yaw * DEG, (c.roll || 0) * DEG);
  if (camera.fov !== c.fov) { camera.fov = c.fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld(true);
  world.update(t, { camera, pose: c });
  renderer.render(scene, camera);
  updateOverlay(t);
  return true;
};

window.__ready = true;
