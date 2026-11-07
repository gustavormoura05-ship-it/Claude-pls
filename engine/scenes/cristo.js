// Cena: topo do Corcovado, aos pés do Cristo Redentor, ao entardecer.
// Unidades em metros. O piso do mirante fica em y = 0; a cidade, 700 m abaixo.
// O Cristo fica na origem e olha para +Z (para a baía). yaw 0 da câmera = olhando para o Cristo.
//
// Eventos usados (definidos em script.json -> events):
//   sirenes, incendios, celular_on, celular_off, trem, zumbis_escada,
//   panico, portao_trancado, portao_cede, apagao

export async function build({ THREE, renderer, scene, camera, script, events, helpers }) {
  const { rng, clamp, lerp, smooth, H: SCREEN_H } = helpers;
  const R = rng(script.seed ?? 1234);
  const since = id => t => events.since(id, t);

  // ---------------- céu ----------------
  const sunDir = new THREE.Vector3();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: sunDir }, dusk: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 sunDir; uniform float dusk;
      void main(){
        float h = vDir.y;
        vec3 zen = mix(vec3(0.10,0.22,0.52), vec3(0.04,0.05,0.16), dusk);
        vec3 mid = mix(vec3(0.55,0.45,0.62), vec3(0.28,0.15,0.30), dusk);
        vec3 hor = mix(vec3(1.00,0.55,0.25), vec3(0.85,0.28,0.14), dusk);
        vec3 col = h > 0.0 ? mix(mid, zen, smoothstep(0.0, 0.55, h)) : mix(mid, vec3(0.25,0.20,0.24), smoothstep(0.0,-0.2,h));
        col = mix(col, hor, (1.0 - smoothstep(0.0, 0.16, abs(h))) * 0.9);
        float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        col += vec3(1.0,0.55,0.25) * pow(s, 8.0) * 0.55 * (1.0 - dusk*0.6);
        col += vec3(1.0,0.85,0.6) * pow(s, 900.0) * 6.0 + vec3(1.0,0.7,0.4) * pow(s, 60.0) * 0.6 * (1.0 - dusk*0.5);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50000, 48, 24), skyMat);
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.FogExp2(0xd9a07e, 0.000072);

  // ---------------- luz ----------------
  const sun = new THREE.DirectionalLight(0xffc48a, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x8fa6d8, 0x4a3a2c, 1.1);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0x9fb4ff, 1.2); // luz de preenchimento (contra o sol)
  fill.position.set(-40, 25, -30); scene.add(fill);
  const floods = new THREE.SpotLight(0xdfe8ff, 0, 120, 0.42, 0.6, 1.2); // holofotes do Cristo
  floods.position.set(0, 2, 26); floods.target.position.set(0, 26, 0);
  scene.add(floods, floods.target);

  // ---------------- terreno (morro do Corcovado) ----------------
  const ridgeW = th => Math.exp(-Math.pow(Math.atan2(Math.sin(th), Math.cos(th)), 2) / 0.06); // crista em +X
  function terrainY(x, z) {
    const r = Math.hypot(x, z), th = Math.atan2(z, x);
    const n = Math.sin(th * 7 + r * 0.004) * 0.5 + Math.sin(th * 13 - r * 0.009) * 0.3 + Math.sin(r * 0.02 + th * 3) * 0.2;
    const cliff = -0.8 - 700 * (1 - Math.exp(-Math.max(0, r - 24) / (230 + 60 * n)));
    const ridge = -0.8 - 700 * (1 - Math.exp(-Math.max(0, r - 18) * 0.55 / 700));
    let y = lerp(cliff, ridge, ridgeW(th)) + n * Math.min(40, r * 0.04) * smooth(30, 70, r);
    // corredor da escada: o morro nunca fica acima dos degraus/trilha
    if (x > 16) {
      const path = x < 38 ? -0.5 - (x - 17) * 0.543 : ridge - 0.3;
      const b = smooth(4, 16, Math.abs(z - 7.5));
      y = Math.min(y, lerp(path - 0.4, y, b));
    }
    return Math.max(-700, y);
  }
  {
    const rings = 110, segs = 160, rMax = 3200;
    const pos = [], col = [], idx = [];
    const cRock = new THREE.Color(0x6e6a63), cRock2 = new THREE.Color(0x4d4a45), cForest = new THREE.Color(0x24401f), cForest2 = new THREE.Color(0x35552a);
    const tmp = new THREE.Color();
    for (let i = 0; i <= rings; i++) {
      const r = i === 0 ? 0 : 10 * Math.pow(rMax / 10, (i - 1) / (rings - 1));
      for (let j = 0; j < segs; j++) {
        const th = (j / segs) * Math.PI * 2;
        const x = Math.cos(th) * r, z = Math.sin(th) * r;
        const y = terrainY(x, z);
        pos.push(x, y, z);
        const yIn = terrainY(Math.cos(th) * (r + 6), Math.sin(th) * (r + 6));
        const steep = clamp((y - yIn) / 6 / 2.2);
        const v = 0.5 + 0.5 * Math.sin(x * 0.05) * Math.cos(z * 0.043);
        tmp.copy(cForest).lerp(cForest2, v);
        tmp.lerp(v > 0.5 ? cRock : cRock2, Math.max(steep * (r < 400 ? 1 : 0.4), 1 - ridgeW(th) > 0.5 && r < 70 ? 0.85 : 0));
        col.push(tmp.r, tmp.g, tmp.b);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + (j + 1) % segs, c = (i + 1) * segs + j, d = (i + 1) * segs + (j + 1) % segs;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.receiveShadow = true;
    scene.add(m);
  }
  // árvores da Floresta da Tijuca (copas arredondadas)
  {
    const N = 9000;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), N);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    let k = 0;
    while (k < N) {
      const r = 45 + Math.pow(R(), 1.6) * 2600, th = R() * Math.PI * 2;
      if (ridgeW(th) > 0.4 && r < 160) continue;
      const x = Math.cos(th) * r, z = Math.sin(th) * r, y = terrainY(x, z);
      if (y < -690) continue;
      const sc = (4 + R() * 5) * (1 + r / 600);
      p.set(x, y + sc * 0.6, z); s.set(sc, sc * (0.8 + R() * 0.4), sc);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.28);
      M.compose(p, q, s); im.setMatrixAt(k, M);
      c.setHSL(0.27 + R() * 0.06, 0.45, 0.12 + R() * 0.1); im.setColorAt(k, c);
      k++;
    }
    scene.add(im);
  }

  // ---------------- planície, mar, lagoa e morros ----------------
  const land = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000), new THREE.MeshLambertMaterial({ color: 0x7a7a6c }));
  land.rotation.x = -Math.PI / 2; land.position.y = -701; land.receiveShadow = false; scene.add(land);
  const seaMat = new THREE.MeshStandardMaterial({ color: 0x1d3550, roughness: 0.28, metalness: 0.1 });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(90000, 40000), seaMat);
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, -700.3, 3900 + 20000); scene.add(sea);
  const bay = new THREE.Mesh(new THREE.CircleGeometry(2600, 48), seaMat); // Baía de Guanabara (lado direito)
  bay.rotation.x = -Math.PI / 2; bay.position.set(-4200, -700.25, 2600); bay.scale.set(1, 1.6, 1); scene.add(bay);
  const lagoa = new THREE.Mesh(new THREE.CircleGeometry(700, 32), seaMat); // Lagoa Rodrigo de Freitas
  lagoa.rotation.x = -Math.PI / 2; lagoa.position.set(1500, -700.2, 2300); lagoa.scale.set(1.4, 1, 1); scene.add(lagoa);
  const hillMat = new THREE.MeshLambertMaterial({ color: 0x3c4a33 });
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x55524c });
  function hill(x, z, sx, sy, sz, mat) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    h.position.set(x, -701, z); h.scale.set(sx, sy, sz); scene.add(h); return h;
  }
  { // Pão de Açúcar: perfil de "pão" (laterais íngremes)
    const pts = []; for (let i = 0; i <= 16; i++) { const a = i / 16; pts.push(new THREE.Vector2(Math.pow(1 - a, 0.55) * 250 + 1, a * 396)); }
    const pa = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), rockMat); pa.position.set(-2100, -701, 5200); pa.scale.set(1, 1, 0.8); pa.rotation.z = 0.12; scene.add(pa);
  }
  hill(-2500, 4900, 260, 220, 240, hillMat);   // Morro da Urca
  hill(4600, 3700, 520, 533, 380, rockMat);    // Dois Irmãos
  hill(6800, 2500, 700, 840, 600, rockMat);    // Pedra da Gávea
  hill(-1500, -5500, 2600, 1000, 1400, hillMat); // serra atrás (Tijuca)
  hill(6500, -3000, 1800, 520, 1200, hillMat);
  hill(-3800, 4300, 240, 160, 300, hillMat);
  hill(-600, 3200, 420, 260, 300, hillMat);

  // ---------------- cidade ----------------
  const isWater = (x, z) => z > 3900 || Math.hypot((x + 4200) / 1, (z - 2600) / 1.6) < 2600 || Math.hypot((x - 1500) / 1.4, z - 2300) < 700;
  const isHill = (x, z) => [[-2100, 5200, 300], [-2500, 4900, 300], [4600, 3700, 560], [6800, 2500, 760], [-600, 3200, 440], [-3800, 4300, 300]].some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr);
  const cityPts = [];
  {
    const N = 14000;
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), N);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    let k = 0, guard = 0;
    while (k < N && guard++ < 200000) {
      let x, z, tall = 1;
      if (k < 1400) { // orla de Copacabana / Ipanema: prédios altos colados na praia
        x = -1200 + R() * 5400; z = 3880 - R() * 260 - Math.max(0, x - 2500) * 0.12; tall = 2.2;
      } else {
        const r = 1700 + Math.pow(R(), 0.9) * 9000, th = R() * Math.PI * 2;
        x = Math.cos(th) * r; z = Math.sin(th) * r;
      }
      if (isWater(x, z) || isHill(x, z) || Math.hypot(x, z) < 1600) continue;
      const w = 18 + R() * 30, d = 18 + R() * 30, h = (8 + Math.pow(R(), 3) * 70) * tall;
      p.set(x, -701, z); s.set(w, h, d); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4 + (R() < 0.5 ? 0 : 0.3));
      M.compose(p, q, s); im.setMatrixAt(k, M);
      const l = 0.55 + R() * 0.35; c.setRGB(l, l * (0.95 + R() * 0.05), l * (0.88 + R() * 0.08)); im.setColorAt(k, c);
      cityPts.push([x, -701 + h, z]);
      k++;
    }
    im.count = k;
    scene.add(im);
  }
  // luzes da cidade (acendem ao anoitecer; algumas apagam no "apagão")
  const lightsN = 9000;
  const lightsGeo = new THREE.BufferGeometry();
  const lp = new Float32Array(lightsN * 3), lc = new Float32Array(lightsN * 3), lPhase = new Float32Array(lightsN), lSector = new Float32Array(lightsN);
  {
    let k = 0, guard = 0;
    while (k < lightsN && guard++ < 300000) {
      const b = cityPts[Math.floor(R() * cityPts.length)];
      const x = b[0] + (R() - 0.5) * 60, z = b[2] + (R() - 0.5) * 60;
      if (isWater(x, z)) continue;
      lp.set([x, b[1] * R() + -701 * (1 - R()) * 0 - 0, z], k * 3);
      lp[k * 3 + 1] = -701 + (b[1] + 701) * R();
      lPhase[k] = R(); lSector[k] = (Math.atan2(z, x) / (Math.PI * 2) + 0.5);
      k++;
    }
  }
  lightsGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  lightsGeo.setAttribute('color', new THREE.BufferAttribute(lc, 3));
  const lightsMat = new THREE.PointsMaterial({ size: 2.6, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const cityLights = new THREE.Points(lightsGeo, lightsMat); scene.add(cityLights);

  // ---------------- fogo e fumaça (shader de pontos com tamanho em metros) ----------------
  const puffMat = (additive) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uScale: { value: 1 }, fogCol: { value: new THREE.Color(0xd9a07e) }, fogD: { value: 0.000072 } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; uniform float uScale; uniform float fogD;
      varying float vA; varying vec3 vC; varying float vF;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv;
        gl_PointSize = clamp(size*uScale/-mv.z, 0.0, 900.0); vA = alpha; vC = color;
        float d = -mv.z; vF = 1.0 - exp(-d*d*fogD*fogD); }`,
    fragmentShader: `varying float vA; varying vec3 vC; varying float vF; uniform vec3 fogCol;
      void main(){ vec2 q = gl_PointCoord-0.5; float d = length(q)*2.0; float a = smoothstep(1.0,0.0,d); a*=a;
        vec3 c = mix(vC, fogCol, vF*${additive ? '0.0' : '0.85'}); gl_FragColor = vec4(c, a*vA*${additive ? '(1.0-vF*0.6)' : '1.0'}); }`,
  });
  const FIRES = 18, PUFFS = 46;
  const fires = [];
  {
    // focos escolhidos em pontos da cidade, em ordem de "contágio"
    const order = [];
    let g = 0;
    while (order.length < FIRES && g++ < 5000) {
      const b = cityPts[Math.floor(R() * cityPts.length)];
      const d = Math.hypot(b[0], b[2]);
      if (d < 2000 || d > 7000) continue;
      const ang = Math.atan2(b[0], b[2]) * 180 / Math.PI; // visível olhando para a cidade
      if (Math.abs(ang) > 75) continue;
      order.push(b);
    }
    order.forEach((b, i) => fires.push({ x: b[0], y: b[1], z: b[2], t0: i < 3 ? i * 1.2 : 3 + i * 1.6, big: 0.7 + R() * 0.8, wind: 0.6 + R() * 0.5 }));
  }
  const smokeN = FIRES * PUFFS, glowN = FIRES * 3;
  const mkPts = (n, additive) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const p = new THREE.Points(g, puffMat(additive)); p.frustumCulled = false; scene.add(p); return p;
  };
  const smoke = mkPts(smokeN, false), glow = mkPts(glowN, true);
  // sirenes piscando nas ruas
  const SIR = 40;
  const sirens = mkPts(SIR, true);
  const sirenPos = [];
  for (let i = 0; i < SIR; i++) { const b = cityPts[Math.floor(R() * cityPts.length)]; sirenPos.push([b[0] + 25, -699, b[2] + 25, R()]); }

  // ---------------- mirante (piso em pedra portuguesa, guarda-corpo) ----------------
  const tex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const g = cv.getContext('2d');
    g.fillStyle = '#d8d2c4'; g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#36322d';
    for (let y = -64; y < 600; y += 128) { // ondas do calçadão
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= 512; x += 8) g.lineTo(x, y + Math.sin(x / 512 * Math.PI * 4) * 30);
      for (let x = 512; x >= 0; x -= 8) g.lineTo(x, y + 52 + Math.sin(x / 512 * Math.PI * 4) * 30);
      g.closePath(); g.fill();
    }
    const r2 = rng(77); g.globalAlpha = 0.18; // pedrinhas
    for (let i = 0; i < 9000; i++) { g.fillStyle = r2() < 0.5 ? '#000' : '#fff'; g.fillRect(r2() * 512, r2() * 512, 3, 3); }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(11, 14); t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4; return t;
  })();
  const X0 = -17, X1 = 17, Z0 = -14, Z1 = 29;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(X1 - X0, 1.2, Z1 - Z0), [
    new THREE.MeshLambertMaterial({ color: 0x8d877b }), new THREE.MeshLambertMaterial({ color: 0x8d877b }),
    new THREE.MeshLambertMaterial({ map: tex }), new THREE.MeshLambertMaterial({ color: 0x8d877b }),
    new THREE.MeshLambertMaterial({ color: 0x8d877b }), new THREE.MeshLambertMaterial({ color: 0x8d877b })]);
  floor.position.set(0, -0.6, (Z0 + Z1) / 2); floor.receiveShadow = true; scene.add(floor);
  // guarda-corpo (balaustrada branca)
  const railMat = new THREE.MeshLambertMaterial({ color: 0xe9e4d8 });
  const GATE_Z0 = 4.5, GATE_Z1 = 10.5;
  function railLine(ax, az, bx, bz, skip) {
    const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 0.45);
    const post = new THREE.CylinderGeometry(0.06, 0.08, 0.95, 6); post.translate(0, 0.475, 0);
    const im = new THREE.InstancedMesh(post, railMat, n + 1); let k = 0; const M = new THREE.Matrix4();
    for (let i = 0; i <= n; i++) { const x = lerp(ax, bx, i / n), z = lerp(az, bz, i / n); if (skip && skip(x, z)) continue; M.makeTranslation(x, 0, z); im.setMatrixAt(k++, M); }
    im.count = k; im.castShadow = true; scene.add(im);
    const top = (x0, z0, x1, z1) => { const b = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) + 0.25, 0.14, Math.abs(z1 - z0) + 0.25), railMat); b.position.set((x0 + x1) / 2, 1.0, (z0 + z1) / 2); b.castShadow = true; scene.add(b); };
    if (skip && ax === bx) { top(ax, az, bx, GATE_Z0); top(ax, GATE_Z1, bx, bz); } else top(ax, az, bx, bz);
  }
  railLine(X0, Z1, X1, Z1); railLine(X0, Z0, X0, Z1); railLine(X0, Z0, X1, Z0);
  railLine(X1, Z0, X1, Z1, (x, z) => z > GATE_Z0 - 0.1 && z < GATE_Z1 + 0.1);
  // postes de luz no mirante
  const lampGlow = [];
  for (const [x, z] of [[-14, 26], [14, 26], [-14, 12], [14, 15], [-14, -2], [14, -2], [-8, -12], [8, -12]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.6, 8), new THREE.MeshLambertMaterial({ color: 0x2b2b2b }));
    pole.position.set(x, 1.8, z); pole.castShadow = true; scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: 0x332211 }));
    bulb.position.set(x, 3.7, z); scene.add(bulb); lampGlow.push(bulb);
  }

  // ---------------- escadaria (220 degraus; vemos o lance final) ----------------
  const STEP_RUN = 0.35, STEP_RISE = 0.19, STEPS = 60, SX0 = X1;
  const stairY = x => x <= SX0 ? 0 : x <= SX0 + STEPS * STEP_RUN ? -Math.ceil((x - SX0) / STEP_RUN) * STEP_RISE : terrainY(x, 7.5);
  {
    const stepMat = new THREE.MeshLambertMaterial({ color: 0xb9b2a4 });
    const g = new THREE.BoxGeometry(STEP_RUN, 2, GATE_Z1 - GATE_Z0); g.translate(0, -1, 0);
    const im = new THREE.InstancedMesh(g, stepMat, STEPS); const M = new THREE.Matrix4();
    for (let i = 0; i < STEPS; i++) { M.makeTranslation(SX0 + (i + 0.5) * STEP_RUN, -(i + 1) * STEP_RISE + 0.0, (GATE_Z0 + GATE_Z1) / 2); im.setMatrixAt(i, M); }
    im.receiveShadow = true; im.castShadow = true; scene.add(im);
    // corrimãos laterais
    for (const z of [GATE_Z0 - 0.15, GATE_Z1 + 0.15]) {
      const L = STEPS * STEP_RUN, ang = Math.atan2(STEPS * STEP_RISE, L);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(L, STEPS * STEP_RISE), 0.12, 0.12), railMat);
      rail.position.set(SX0 + L / 2, -STEPS * STEP_RISE / 2 + 0.9, z); rail.rotation.z = -ang; scene.add(rail);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(L, STEPS * STEP_RISE), 1.2, 0.3), stepMat);
      wall.position.set(SX0 + L / 2, -STEPS * STEP_RISE / 2 - 0.2, z + (z < 7 ? -0.15 : 0.15)); wall.rotation.z = -ang; scene.add(wall);
    }
    // trilha/estrada que continua descendo pela crista
    const pts = []; for (let x = SX0 + STEPS * STEP_RUN; x < 420; x += 4) pts.push(x);
    const pg = new THREE.BufferGeometry(); const pp = [], pi = [];
    pts.forEach((x, i) => { const y = terrainY(x, 7.5) + 0.15; pp.push(x, y, GATE_Z0 - 1, x, y, GATE_Z1 + 1); if (i) { const a = (i - 1) * 2; pi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3)); pg.setIndex(pi); pg.computeVertexNormals();
    const path = new THREE.Mesh(pg, new THREE.MeshLambertMaterial({ color: 0x8a8274, side: THREE.DoubleSide })); path.receiveShadow = true; scene.add(path);
  }
  // portão de grade no topo da escada
  const gate = new THREE.Group();
  {
    const barMat = new THREE.MeshLambertMaterial({ color: 0x1c1c1c });
    const W = GATE_Z1 - GATE_Z0;
    for (let i = 0; i <= 24; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.1, 0.04), barMat); b.position.set(0, 1.05, (i / 24) * W); b.castShadow = true; gate.add(b); }
    for (const y of [0.15, 1.0, 2.05]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, W), barMat); b.position.set(0, y, W / 2); gate.add(b); }
    gate.position.set(SX0 + 0.05, 0, GATE_Z0); scene.add(gate);
    for (const z of [GATE_Z0 - 0.2, GATE_Z1 + 0.2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.4, 0.35), railMat); p.position.set(SX0, 1.2, z); p.castShadow = true; scene.add(p); }
  }

  // ---------------- o Cristo Redentor (pedestal 8 m + estátua 30 m, braços 28 m) ----------------
  const stone = new THREE.MeshStandardMaterial({ color: 0xcfd0c4, roughness: 0.85, metalness: 0 });
  const statue = new THREE.Group(); scene.add(statue);
  {
    const ped = new THREE.Mesh(new THREE.BoxGeometry(9.5, 8, 9.5), new THREE.MeshStandardMaterial({ color: 0xb4b0a4, roughness: 0.95 }));
    ped.position.y = 4; ped.castShadow = ped.receiveShadow = true; statue.add(ped);
    const base = new THREE.Mesh(new THREE.BoxGeometry(14, 0.9, 14), new THREE.MeshLambertMaterial({ color: 0xa29d91 })); base.position.y = 0.45; base.receiveShadow = base.castShadow = true; statue.add(base);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.6, 10.2), new THREE.MeshLambertMaterial({ color: 0xa8a397 })); cap.position.y = 8; cap.castShadow = true; statue.add(cap);
    // porta de manutenção (frente do pedestal)
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.3, 0.12), new THREE.MeshLambertMaterial({ color: 0x3b2a1e }));
    door.position.set(2.2, 0.9 + 1.15, 4.78); statue.add(door);
    const doorLamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb35a }));
    doorLamp.position.set(2.2, 3.45, 4.85); statue.add(doorLamp);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.3), new THREE.MeshBasicMaterial({ color: 0xc8a020 })); sign.position.set(2.2, 3.15, 4.86); statue.add(sign);
    // túnica (torno com pregas)
    const prof = [[3.3, 0], [3.5, 0.4], [3.1, 2], [2.9, 6], [2.75, 10], [2.7, 14], [2.85, 18], [2.9, 20.5], [2.5, 21.6], [1.5, 22.3], [0.8, 22.6], [0.01, 22.7]];
    const lg = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 72);
    const pa = lg.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i); const th = Math.atan2(z, x);
      const fold = 1 + 0.05 * Math.sin(th * 11 + y * 0.15) * clamp(1 - y / 22) + (Math.abs(Math.cos(th)) > 0.6 ? 0.02 : 0);
      pa.setXYZ(i, x * 1.32 * fold, y, z * 0.82 * fold);
    }
    lg.computeVertexNormals();
    const robe = new THREE.Mesh(lg, stone); robe.position.y = 8.3; robe.castShadow = robe.receiveShadow = true; statue.add(robe);
    // braços abertos + mangas caídas
    const SH = 8.3 + 21.3;
    for (const sgn of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(12.6, 1.5, 1.6), stone); arm.position.set(sgn * 7.9, SH, 0.1); arm.castShadow = true; statue.add(arm);
      const sg = new THREE.BoxGeometry(11.5, 3.2, 1.3); const sp = sg.attributes.position;
      for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), y = sp.getY(i); const u = (x + 5.75) / 11.5; const nx = sgn > 0 ? u : 1 - u; if (y < 0) sp.setY(i, -1.6 - 1.6 * (1 - nx) + 1.2 * nx); }
      sg.computeVertexNormals();
      const sleeve = new THREE.Mesh(sg, stone); sleeve.position.set(sgn * 7.6, SH - 1.4, 0.15); sleeve.castShadow = true; statue.add(sleeve);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 1.0), stone); hand.position.set(sgn * 14.3, SH - 0.2, 0.2); hand.castShadow = true; statue.add(hand);
    }
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 1.6, 16), stone); neck.position.y = 8.3 + 23.1; statue.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.55, 28, 20), stone); head.scale.set(0.95, 1.25, 1.0); head.position.set(0, 8.3 + 25.2, 0.2); head.castShadow = true; statue.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(1.7, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.6), stone); hair.position.set(0, 8.3 + 25.6, -0.15); hair.scale.set(1, 1.15, 1.05); statue.add(hair);
    const heart = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), stone); heart.position.set(0.9, 8.3 + 18.6, 2.35); heart.scale.set(1, 1, 0.4); statue.add(heart);
  }

  // ---------------- pessoas (turistas e zumbis) com partes instanciadas ----------------
  function makeCrowd(n, palette) {
    const parts = {
      torso: (() => { const g = new THREE.BoxGeometry(0.42, 0.62, 0.24); g.translate(0, 0.31, 0); return g; })(),
      head: (() => { const g = new THREE.SphereGeometry(0.125, 10, 8); g.translate(0, 0.14, 0); return g; })(),
      arm: (() => { const g = new THREE.BoxGeometry(0.11, 0.68, 0.11); g.translate(0, -0.34, 0); return g; })(),
      leg: (() => { const g = new THREE.BoxGeometry(0.15, 0.88, 0.17); g.translate(0, -0.44, 0); return g; })(),
    };
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mk = (g, count) => { const m = new THREE.InstancedMesh(g, mat, count); m.castShadow = true; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); return m; };
    const crowd = { torso: mk(parts.torso, n), head: mk(parts.head, n), arms: mk(parts.arm, n * 2), legs: mk(parts.leg, n * 2), n };
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const p = palette(i);
      crowd.torso.setColorAt(i, c.set(p.shirt)); crowd.head.setColorAt(i, c.set(p.skin));
      crowd.arms.setColorAt(i * 2, c.set(p.arm || p.skin)); crowd.arms.setColorAt(i * 2 + 1, c.set(p.arm || p.skin));
      crowd.legs.setColorAt(i * 2, c.set(p.pants)); crowd.legs.setColorAt(i * 2 + 1, c.set(p.pants));
    }
    return crowd;
  }
  const M0 = new THREE.Matrix4(), MT = new THREE.Matrix4(), MP = new THREE.Matrix4(), TMP = new THREE.Matrix4();
  const HID = new THREE.Matrix4().makeScale(0, 0, 0);
  // pose: { x, y, z, yaw, phase, walk(0-1), lean, armPitch, armSpread, headTilt, sway, scale }
  function setPose(cr, i, p) {
    if (!p) { cr.torso.setMatrixAt(i, HID); cr.head.setMatrixAt(i, HID); for (const k of [0, 1]) { cr.arms.setMatrixAt(i * 2 + k, HID); cr.legs.setMatrixAt(i * 2 + k, HID); } return; }
    const s = p.scale || 1;
    M0.makeRotationY(p.yaw).setPosition(p.x, p.y, p.z); if (s !== 1) M0.multiply(TMP.makeScale(s, s, s));
    const sw = Math.sin(p.phase) * p.walk;
    for (const k of [0, 1]) {
      const sg = k ? 1 : -1;
      MP.copy(M0).multiply(TMP.makeTranslation(sg * 0.1, 0.9, 0)).multiply(TMP.makeRotationX(sw * 0.55 * sg));
      cr.legs.setMatrixAt(i * 2 + k, MP);
    }
    MT.copy(M0).multiply(TMP.makeTranslation(0, 0.88 + Math.abs(Math.cos(p.phase)) * 0.03 * p.walk, 0))
      .multiply(TMP.makeRotationX(p.lean || 0)).multiply(TMP.makeRotationZ(p.sway || 0));
    cr.torso.setMatrixAt(i, MT);
    MP.copy(MT).multiply(TMP.makeTranslation(0, 0.62, 0.0)).multiply(TMP.makeRotationX(p.headTilt || 0)).multiply(TMP.makeRotationZ(p.headRoll || 0));
    cr.head.setMatrixAt(i, MP);
    for (const k of [0, 1]) {
      const sg = k ? 1 : -1;
      const ap = (p.armPitch || 0) + (p.armSwing ?? 0.4) * -sw * sg + (p.armJitter ? Math.sin(p.phase * 1.7 + k * 2) * p.armJitter : 0);
      MP.copy(MT).multiply(TMP.makeTranslation(sg * 0.27, 0.58, 0)).multiply(TMP.makeRotationX(ap)).multiply(TMP.makeRotationZ(sg * (p.armSpread || 0.06)));
      cr.arms.setMatrixAt(i * 2 + k, MP);
    }
  }
  const flush = cr => { for (const k of ['torso', 'head', 'arms', 'legs']) cr[k].instanceMatrix.needsUpdate = true; };

  // turistas no mirante
  const shirts = ['#e23b3b', '#f2c12e', '#2f7de1', '#ffffff', '#23a35a', '#ff7a1a', '#7b3fe4', '#111111', '#13b5c8', '#f25ca8'];
  const skins = ['#f1c7a3', '#d9a27a', '#b57a52', '#8a5636', '#5e3a24'];
  const TN = 150;
  const tourists = makeCrowd(TN, i => ({ shirt: shirts[i % shirts.length], skin: skins[(i * 7) % skins.length], pants: ['#2b3a55', '#3a3a3a', '#d8cfb8', '#4a5a3a'][i % 4] }));
  const tData = [];
  for (let i = 0; i < TN; i++) {
    let x, z, g = 0;
    do { x = lerp(X0 + 1.5, X1 - 1.5, R()); z = lerp(Z0 + 1.5, Z1 - 1.5, R()); g++; }
    while ((Math.abs(x) < 7.5 && Math.abs(z) < 7.5) || (Math.abs(x) < 3.5 && z > 12 && z < 28) || (x > 9 && z > 2 && z < 13) || (Math.abs(x - 2) < 4 && z > 20)) ;
    const ang = R() * Math.PI * 2, rr = 7.8 + R() * 4.5; // posição de "pânico" junto ao pedestal
    const hx = Math.cos(ang) * rr, hz = Math.sin(ang) * rr * 0.9 - 2;
    tData.push({ x, z, hx, hz, yaw: R() * 6.28, ph: R() * 6.28, sp: 0.8 + R() * 0.6, phone: R() < 0.4, delay: R() * 2.5 });
  }
  // zumbis
  const ZN = 230;
  const zombies = makeCrowd(ZN, i => ({ shirt: ['#3d3b36', '#5a1f1f', '#2e3a46', '#6b5b45', '#432b2b'][i % 5], skin: ['#9aab84', '#a7ad92', '#8c9a78'][i % 3], pants: ['#22252b', '#3a3026', '#2c2c2c'][i % 3] }));
  const zData = [];
  for (let i = 0; i < ZN; i++) {
    const lane = i % 5, row = Math.floor(i / 5);
    zData.push({
      lane, row,
      x0: SX0 + STEPS * STEP_RUN + 8 + row * 0.9 + R() * 0.8,  // surgem no pé da escada e na crista abaixo
      z: lerp(GATE_Z0 + 0.6, GATE_Z1 - 0.6, (lane + 0.2 + R() * 0.6) / 5),
      sp: 1.8 + R() * 0.4, ph: R() * 6.28, lean: 0.15 + R() * 0.35, roll: (R() - 0.5) * 0.6,
    });
  }

  // ---------------- celular na mão (alerta de emergência) ----------------
  const phone = new THREE.Group();
  {
    const cv = document.createElement('canvas'); cv.width = 540; cv.height = 1100; const g = cv.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 1100); grd.addColorStop(0, '#1a1f2e'); grd.addColorStop(1, '#090b12'); g.fillStyle = grd; g.fillRect(0, 0, 540, 1100);
    g.fillStyle = '#fff'; g.font = '800 64px Montserrat'; g.textAlign = 'center'; g.fillText('17:41', 270, 140);
    g.fillStyle = 'rgba(255,255,255,0.92)'; roundRect(g, 30, 260, 480, 520, 36); g.fill();
    g.fillStyle = '#d71920'; roundRect(g, 30, 260, 480, 96, { tl: 36, tr: 36, bl: 0, br: 0 }); g.fill();
    g.fillStyle = '#fff'; g.font = '900 34px Montserrat'; g.fillText('⚠ ALERTA DE EMERGÊNCIA', 270, 322);
    g.fillStyle = '#111'; g.font = '900 52px Montserrat';
    ['NÃO SAIA', 'DE CASA.'].forEach((l, i) => g.fillText(l, 270, 450 + i * 64));
    g.fillStyle = '#d71920'; g.font = '900 60px Montserrat'; g.fillText('ELES MORDEM.', 270, 610);
    g.fillStyle = '#555'; g.font = '800 26px Montserrat'; g.fillText('Procure um local alto e trancado.', 270, 700);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.16, 0.009), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.071, 0.15), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
    screen.position.z = 0.0047; body.add(screen);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.09, 0.03), new THREE.MeshLambertMaterial({ color: 0xc58f6a }));
    hand.position.set(0.006, -0.06, -0.012); body.add(hand);
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.02), new THREE.MeshLambertMaterial({ color: 0xc58f6a }));
    thumb.position.set(-0.045, -0.03, 0.006); thumb.rotation.z = -0.4; body.add(thumb);
    phone.add(body); phone.visible = true; camera.add(phone); // visível até o 1º update para o shader ser pré-compilado
  }
  function roundRect(g, x, y, w, h, r) {
    if (typeof r === 'number') r = { tl: r, tr: r, bl: r, br: r };
    g.beginPath(); g.moveTo(x + r.tl, y); g.lineTo(x + w - r.tr, y); g.quadraticCurveTo(x + w, y, x + w, y + r.tr);
    g.lineTo(x + w, y + h - r.br); g.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h); g.lineTo(x + r.bl, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r.bl); g.lineTo(x, y + r.tl); g.quadraticCurveTo(x, y, x + r.tl, y); g.closePath();
  }

  // =====================================================================
  // update(t): TUDO derivado de t
  // =====================================================================
  const tSir = since('sirenes'), tFire = since('incendios'), tTrain = since('trem'), tZ = since('zumbis_escada');
  const tPanic = since('panico'), tLock = since('portao_trancado'), tGive = since('portao_cede'), tOut = since('apagao');
  const tPhOn = since('celular_on'), tPhOff = since('celular_off');
  const fovScale = () => SCREEN_H / (2 * Math.tan(camera.fov * Math.PI / 360));
  const DUR = script.duration;

  return {
    update(t) {
      // ---- entardecer: sol de ~7° até abaixo do horizonte ----
      const u = clamp(t / DUR);
      const elev = lerp(7, -1.5, u) * Math.PI / 180, az = 132 * Math.PI / 180;
      sunDir.set(-Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev));
      const dusk = smooth(0.15, 1.0, u);
      skyMat.uniforms.dusk.value = dusk;
      sun.position.copy(sunDir).multiplyScalar(120); sun.target.position.set(0, 0, 8);
      sun.intensity = lerp(3.0, 0.25, smooth(0.1, 0.95, u));
      sun.color.setHSL(0.07 - 0.03 * dusk, 0.9, 0.62 - 0.1 * dusk);
      hemi.intensity = lerp(1.15, 0.45, dusk);
      hemi.color.setHSL(0.62, 0.45, lerp(0.7, 0.45, dusk));
      const fogC = new THREE.Color().setHSL(0.06 - 0.02 * dusk, 0.55, lerp(0.6, 0.26, dusk));
      scene.fog.color.copy(fogC);
      smoke.material.uniforms.fogCol.value.copy(fogC);
      floods.intensity = smooth(0.35, 0.6, u) * 900;
      renderer.toneMappingExposure = lerp(1.0, 1.15, dusk);
      for (const b of lampGlow) b.material.color.setHSL(0.09, 1, lerp(0.1, 0.65, smooth(0.3, 0.5, u)));

      // ---- luzes da cidade ----
      const on = smooth(0.25, 0.7, u);
      const outK = tOut(t);
      const lcA = lightsGeo.attributes.color.array;
      for (let i = 0; i < lightsN; i++) {
        let k = on * (lPhase[i] < on * 1.2 ? 1 : 0);
        if (outK > 0 && lSector[i] < outK / 6) k *= (Math.sin(t * 40 + i) > 0.9 ? 0.6 : 0.0); // apagão avançando por setores
        const w = 0.9 + 0.1 * Math.sin(t * 3 + i);
        lcA[i * 3] = k * w; lcA[i * 3 + 1] = k * w * 0.72; lcA[i * 3 + 2] = k * w * 0.42;
      }
      lightsGeo.attributes.color.needsUpdate = true;

      // ---- incêndios + fumaça ----
      const fs = tFire(t);
      const sA = smoke.geometry.attributes, gA = glow.geometry.attributes;
      for (let f = 0; f < FIRES; f++) {
        const F = fires[f]; const age = fs - F.t0;
        const grow = clamp(age / 6);
        for (let k = 0; k < 3; k++) {
          const i = f * 3 + k, fl = 0.75 + 0.25 * Math.sin(t * (9 + k * 3) + f);
          gA.position.setXYZ(i, F.x + (k - 1) * 18, F.y + 8 + k * 6, F.z);
          gA.size.setX(i, age > 0 ? (200 + 140 * k) * F.big * grow * fl : 0);
          gA.alpha.setX(i, age > 0 ? 0.9 : 0);
          gA.color.setXYZ(i, 1.0, 0.45 + 0.15 * k, 0.12);
        }
        for (let p = 0; p < PUFFS; p++) {
          const i = f * PUFFS + p;
          const life = 14, ph = ((age / life) + p / PUFFS) % 1; // fase no ciclo de vida do "puff"
          const born = age - ph * life; // momento em que este puff nasceu (relativo ao início)
          if (age <= 0 || born < 0) { sA.alpha.setX(i, 0); sA.size.setX(i, 0); continue; }
          const hgt = ph * 1100 * F.big;
          sA.position.setXYZ(i, F.x + ph * ph * 700 * F.wind + Math.sin(p * 2.3) * 40, F.y + hgt, F.z - ph * 220 + Math.cos(p * 1.7) * 40);
          sA.size.setX(i, (180 + ph * 700) * F.big);
          sA.alpha.setX(i, Math.min(ph * 8, 1) * (1 - ph) * 0.75);
          const lit = Math.max(0, 1 - ph * 5);
          const gr = lerp(0.16, 0.26, Math.sin(p) * 0.5 + 0.5) * lerp(1, 0.6, dusk);
          sA.color.setXYZ(i, gr + lit * 0.6, gr + lit * 0.25, gr + lit * 0.05);
        }
      }
      for (const a of ['position', 'size', 'alpha', 'color']) { sA[a].needsUpdate = true; gA[a].needsUpdate = true; }
      smoke.material.uniforms.uScale.value = glow.material.uniforms.uScale.value = sirens.material.uniforms.uScale.value = fovScale();

      // ---- sirenes ----
      const ss = tSir(t), siA = sirens.geometry.attributes;
      for (let i = 0; i < SIR; i++) {
        const [x, y, z, ph] = sirenPos[i];
        const active = ss > ph * 6;
        const blink = Math.sin((t + ph * 3) * 14) > 0;
        siA.position.setXYZ(i, x, y, z);
        siA.size.setX(i, active ? 26 : 0); siA.alpha.setX(i, active ? 1 : 0);
        if (blink) siA.color.setXYZ(i, 1, 0.1, 0.1); else siA.color.setXYZ(i, 0.15, 0.3, 1);
      }
      for (const a of ['position', 'size', 'alpha', 'color']) siA[a].needsUpdate = true;

      // ---- portão: aberto -> trancado -> cedendo ----
      const lockK = smooth(0, 1.4, tLock(t));
      const giveS = tGive(t);
      const rattle = giveS > 0 ? (0.03 + 0.05 * clamp(giveS / 5)) * (Math.sin(t * 31) * 0.6 + Math.sin(t * 47 + 1) * 0.4) : 0;
      const zPress = tZ(t) > 0 ? clamp((tZ(t) - 9) / 3) * 0.02 * Math.sin(t * 23) : 0;
      gate.rotation.y = lerp(-Math.PI / 2 + 0.15, 0, lockK) + rattle + zPress;
      gate.position.x = SX0 + 0.05 + (giveS > 0 ? clamp(giveS / 5) * 0.25 : 0);

      // ---- turistas ----
      const pk = tPanic(t);
      for (let i = 0; i < TN; i++) {
        const d = tData[i];
        const k = smooth(0, 6, pk - d.delay);
        let x = lerp(d.x, d.hx, k), z = lerp(d.z, d.hz, k);
        { // ninguém atravessa a câmera: empurra para fora de um raio de 1,1 m
          const dx = x - camera.position.x, dz = z - camera.position.z, dd = Math.hypot(dx, dz);
          if (dd < 2.2) { const f = 2.2 / Math.max(dd, 1e-3); x = camera.position.x + dx * f; z = camera.position.z + dz * f; }
        }
        const moving = pk - d.delay > 0 && k < 1 ? 1 : 0;
        const yaw = k > 0 ? Math.atan2(d.hx - d.x, d.hz - d.z) * (k < 0.95 ? 1 : 1) : d.yaw + 0.3 * Math.sin(t * 0.3 + d.ph);
        const facing = k >= 0.95 ? Math.atan2(SX0 - x, 7.5 - z) : yaw; // no fim, olham para o portão
        setPose(tourists, i, {
          x, y: 0, z, yaw: facing, phase: t * 7 * d.sp + d.ph, walk: moving ? 1 : 0.0, lean: moving ? 0.12 : 0,
          armPitch: d.phone && pk < 0 ? -1.2 : (k >= 0.95 && i % 4 === 0 ? -2.6 + 0.2 * Math.sin(t * 5 + i) : 0),
          armSwing: moving ? 0.6 : 0.05, headTilt: d.phone && pk < 0 ? 0.35 : -0.05, sway: 0.02 * Math.sin(t * 1.3 + d.ph),
        });
      }
      flush(tourists);

      // ---- zumbis subindo a escada ----
      const zs = tZ(t);
      for (let i = 0; i < ZN; i++) {
        const d = zData[i];
        if (zs < 0) { setPose(zombies, i, null); continue; }
        const front = SX0 + 0.45 + d.row * 0.62 + (d.lane % 2) * 0.2 + (giveS > 0 ? -clamp(giveS / 5) * 0.2 : 0);
        const xFree = d.x0 - zs * d.sp;
        const x = Math.max(front, xFree);
        const atGate = x <= front + 0.01;
        const y = stairY(x);
        const ph = t * 3.2 * d.sp + d.ph;
        setPose(zombies, i, {
          x, y, z: d.z + Math.sin(ph * 0.5) * 0.08, yaw: -Math.PI / 2 + d.roll * 0.3, phase: ph, walk: atGate ? 0.25 : 1,
          lean: d.lean + (atGate ? 0.25 : 0), sway: d.roll * 0.4 + Math.sin(ph * 0.5) * 0.12,
          armPitch: atGate ? -1.75 + 0.25 * Math.sin(t * 6 + i) : -1.45, armSwing: 0.12, armJitter: atGate ? 0.25 : 0.08,
          headTilt: 0.35 + 0.15 * Math.sin(ph * 0.7), headRoll: d.roll, armSpread: 0.12,
        });
      }
      flush(zombies);

      // ---- celular ----
      const on1 = tPhOn(t), off1 = tPhOff(t);
      const up = on1 > 0 ? (off1 > 0 ? 1 - smooth(0, 0.5, off1) : smooth(0, 0.6, on1)) : 0;
      phone.visible = up > 0.001;
      phone.position.set(0.05, lerp(-0.42, -0.1, up), -0.27);
      phone.rotation.set(lerp(-0.9, -0.12, up) + 0.01 * Math.sin(t * 2.1), -0.08, 0.05 + 0.01 * Math.sin(t * 1.7));
    },
  };
}
