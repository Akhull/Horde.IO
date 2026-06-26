// Horde.IO — Iso-Spike v4 (PixiJS v8).
//
// Terrain mit DETAIL: das Gouraud-Mesh wird jetzt im Fragment-Shader (a) per HILLSHADING
// (Normalen aus der Heightmap) beleuchtet -> Berge/Hänge mit Licht+Schatten, Spitzen lesbar;
// (b) mit prozeduralem DETAIL-GRAIN texturiert statt flach verwaschen; (c) ANIMIERTES Wasser
// (Schimmer/Funkeln). Flüsse graben monoton bergab bis Meer/Kartenrand (keine Pfützen).
// Berge + Wasser unbegehbar -> Engpässe. Weiterhin reine Präsentation über (gx,gy).
//
// Aufruf: http://localhost:5173/iso-spike.html  (Drag=Pan, Rad=Zoom, Klick Gebäude=looten)

import { Application, Container, Sprite, Texture, Assets, Geometry, Buffer, BufferUsage, Mesh, Shader, GlProgram, Graphics } from "pixi.js";

const TILE_W = 32, TILE_H = 16, HW = TILE_W / 2, HH = TILE_H / 2;
const MAP = 150, N = MAP + 1;
const ELEV = 150;           // Screen-Y-Lift (markante Berge)
const NORM_K = 26;          // Höhen->Slope-Skala für die Beleuchtung
const WATER = 0.38, MOUNTAIN = 0.74;
const PLAYERS = 12, HORDE = 520, BUILDINGS = 240, TREES = 650, BANDS = 120;
const ASSET = "/assets/kenney/medieval-rts/PNG/Retina";

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const v00 = hash(x0, y0), v10 = hash(x0 + 1, y0), v01 = hash(x0, y0 + 1), v11 = hash(x0 + 1, y0 + 1);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
}
function fbm(x: number, y: number, oct: number): number {
  let a = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { a += vnoise(x * f, y * f) * amp; f *= 2; amp *= 0.5; }
  return a;
}
function worldToIso(gx: number, gy: number): { x: number; y: number } {
  return { x: (gx - gy) * HW, y: (gx + gy) * HH };
}
function elevLift(h: number): number { return Math.max(0, h - WATER) * ELEV; }

const RAMP: [number, number][] = [
  [0.0, 0x123a63], [0.30, 0x205a92], [0.37, 0x3f86bd], [0.39, 0xcdbd86],
  [0.44, 0x4f9a3f], [0.60, 0x3c7d2f], [0.68, 0x5e6b3a], [0.72, 0x726a52],
  [0.80, 0x8a8278], [0.88, 0xada69c], [0.96, 0xdadbe0], [1.0, 0xf2f4f8],
];
function rampRGB(h: number, out: { r: number; g: number; b: number }): void {
  let c0 = RAMP[0][1], c1 = RAMP[0][1], t = 0;
  for (let i = 1; i < RAMP.length; i++) {
    if (h <= RAMP[i][0]) { c0 = RAMP[i - 1][1]; c1 = RAMP[i][1]; t = (h - RAMP[i - 1][0]) / (RAMP[i][0] - RAMP[i - 1][0] || 1); break; }
  }
  const ar = (c0 >> 16) & 0xff, ag = (c0 >> 8) & 0xff, ab = c0 & 0xff;
  const br = (c1 >> 16) & 0xff, bg = (c1 >> 8) & 0xff, bb = c1 & 0xff;
  out.r = (ar + (br - ar) * t) / 255; out.g = (ag + (bg - ag) * t) / 255; out.b = (ab + (bb - ab) * t) / 255;
}

const H = new Float32Array(N * N);
const HG = (i: number, j: number): number => H[Math.max(0, Math.min(N - 1, i)) * N + Math.max(0, Math.min(N - 1, j))];
function baseHeight(i: number, j: number): number {
  const n = fbm(i * 0.028 + 7, j * 0.028 + 7, 5);
  const ridge = 1 - Math.abs(fbm(i * 0.016 + 51, j * 0.016 + 51, 4) * 2 - 1);
  const dx = (i / MAP) * 2 - 1, dy = (j / MAP) * 2 - 1;
  const island = 1 - Math.min(1, (dx * dx + dy * dy) * 0.92);
  const h = n * 0.46 + ridge * ridge * 0.46 + island * 0.42 - 0.12;
  return Math.max(0, Math.min(1, h));
}
function buildHeight(): void {
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) H[i * N + j] = baseHeight(i, j);
  // Flüsse: an Höhen starten, MONOTON bergab graben, bis Meer ODER Kartenrand erreicht ist.
  for (let r = 0; r < 12; r++) {
    let bi = 0, bj = 0, bh = 0;
    for (let k = 0; k < 80; k++) {
      const i = 10 + Math.floor(Math.random() * (N - 20)), j = 10 + Math.floor(Math.random() * (N - 20));
      if (H[i * N + j] > bh) { bh = H[i * N + j]; bi = i; bj = j; }
    }
    if (bh < 0.55) continue;
    let ci = bi, cj = bj, carve = H[bi * N + bj];
    for (let step = 0; step < N * 3; step++) {
      carve = Math.max(0.08, carve - 0.0045); // erzwingt stetiges Gefälle -> erreicht Wasser garantiert
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const ii = ci + di, jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const d = di === 0 && dj === 0 ? 0 : 0.03;
        H[ii * N + jj] = Math.min(H[ii * N + jj], carve + d);
      }
      if (ci <= 1 || cj <= 1 || ci >= N - 2 || cj >= N - 2) break;           // Kartenrand erreicht
      if (carve <= WATER - 0.06 && baseHeight(ci, cj) < WATER) break;        // ins offene Meer gemündet
      // bergab weiter (tiefster Nachbar; bei Gleichstand Richtung nächster Rand)
      let ni = ci, nj = cj, nh = 1e9;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const ii = ci + di, jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N || (di === 0 && dj === 0)) continue;
        const bias = (Math.min(ii, jj, N - 1 - ii, N - 1 - jj) / N) * 0.04; // leichter Drang zum Rand
        if (H[ii * N + jj] + bias < nh) { nh = H[ii * N + jj] + bias; ni = ii; nj = jj; }
      }
      ci = ni; cj = nj;
    }
  }
}
function sampleH(fx: number, fy: number): number {
  const x = Math.max(0, Math.min(MAP - 0.001, fx)), y = Math.max(0, Math.min(MAP - 0.001, fy));
  const i = Math.floor(x), j = Math.floor(y), tx = x - i, ty = y - j;
  const a = H[i * N + j], b = H[(i + 1) * N + j], c = H[i * N + (j + 1)], d = H[(i + 1) * N + (j + 1)];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
const passable = (fx: number, fy: number): boolean => { const h = sampleH(fx, fy); return h >= WATER && h <= MOUNTAIN; };

let terrainShader: Shader;
function buildTerrainMesh(): Mesh {
  const pos = new Float32Array(N * N * 2), col = new Float32Array(N * N * 3);
  const nrm = new Float32Array(N * N * 3), wld = new Float32Array(N * N * 2), hgt = new Float32Array(N * N);
  const tmp = { r: 0, g: 0, b: 0 };
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const k = i * N + j, h = H[k], p = worldToIso(i, j);
    pos[2 * k] = p.x; pos[2 * k + 1] = p.y - elevLift(h);
    rampRGB(h, tmp); col[3 * k] = tmp.r; col[3 * k + 1] = tmp.g; col[3 * k + 2] = tmp.b;
    // Normale aus Höhen-Gradient (für Hillshading)
    const nx = -(HG(i + 1, j) - HG(i - 1, j)) * NORM_K, ny = -(HG(i, j + 1) - HG(i, j - 1)) * NORM_K, nz = 1;
    const inv = 1 / Math.hypot(nx, ny, nz);
    nrm[3 * k] = nx * inv; nrm[3 * k + 1] = ny * inv; nrm[3 * k + 2] = nz * inv;
    wld[2 * k] = i; wld[2 * k + 1] = j; hgt[k] = h;
  }
  const idx: number[] = [];
  for (let d = 0; d < 2 * MAP; d++)
    for (let i = Math.max(0, d - (MAP - 1)); i <= Math.min(d, MAP - 1); i++) {
      const j = d - i; if (j < 0 || j >= MAP) continue;
      const a = i * N + j, b = (i + 1) * N + j, c = (i + 1) * N + (j + 1), e = i * N + (j + 1);
      idx.push(a, b, c, a, c, e);
    }
  const buf = (data: Float32Array, label: string) => new Buffer({ data, label });
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: buf(pos, "pos"), format: "float32x2", stride: 8, offset: 0 },
      aColor: { buffer: buf(col, "col"), format: "float32x3", stride: 12, offset: 0 },
      aNormal: { buffer: buf(nrm, "nrm"), format: "float32x3", stride: 12, offset: 0 },
      aWorld: { buffer: buf(wld, "wld"), format: "float32x2", stride: 8, offset: 0 },
      aHeight: { buffer: buf(hgt, "hgt"), format: "float32", stride: 4, offset: 0 },
    },
    indexBuffer: new Buffer({ data: new Uint32Array(idx), label: "idx", usage: BufferUsage.INDEX | BufferUsage.COPY_DST }),
  });
  const glProgram = new GlProgram({
    vertex: `
      attribute vec2 aPosition; attribute vec3 aColor; attribute vec3 aNormal; attribute vec2 aWorld; attribute float aHeight;
      varying vec3 vColor; varying vec3 vNormal; varying vec2 vWorld; varying float vHeight;
      uniform mat3 uProjectionMatrix; uniform mat3 uWorldTransformMatrix; uniform mat3 uTransformMatrix;
      void main() {
        gl_Position = vec4((uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix*vec3(aPosition,1.0)).xy, 0.0, 1.0);
        vColor = aColor; vNormal = aNormal; vWorld = aWorld; vHeight = aHeight;
      }`,
    fragment: `
      precision mediump float;
      varying vec3 vColor; varying vec3 vNormal; varying vec2 vWorld; varying float vHeight;
      uniform float uTime; uniform vec3 uLight;
      float h2(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
      float vn(vec2 p){ vec2 i=floor(p),f=fract(p); float a=h2(i),b=h2(i+vec2(1.,0.)),c=h2(i+vec2(0.,1.)),d=h2(i+vec2(1.,1.)); vec2 u=f*f*(3.-2.*f); return mix(mix(a,b,u.x),mix(c,d,u.x),u.y); }
      void main() {
        if (vHeight < 0.382) {
          // animiertes Wasser
          float w = sin(vWorld.x*0.7 + uTime*1.6)*0.5 + sin(vWorld.y*0.55 - uTime*1.2)*0.5;
          vec3 deep = vec3(0.07,0.20,0.42), shallow = vec3(0.18,0.46,0.72);
          float dd = clamp((0.382 - vHeight)*5.0, 0.0, 1.0);
          vec3 col = mix(shallow, deep, dd) + 0.06*w;
          float spark = vn(vWorld*4.0 + uTime*0.4);
          col += vec3(0.4)*pow(max(0.0, spark-0.6), 2.0); // Funkeln
          gl_FragColor = vec4(col, 1.0); return;
        }
        vec3 nB = normalize(vNormal);
        float diff = clamp(dot(nB, normalize(uLight)), 0.0, 1.0);
        float shade = 0.42 + 0.78*diff;                    // Hillshading -> Relief
        float n = vn(vWorld*1.6)*0.55 + vn(vWorld*6.0)*0.3; // Detail-Grain
        float grain = 0.8 + 0.42*n;
        gl_FragColor = vec4(vColor*shade*grain, 1.0);
      }`,
  });
  terrainShader = new Shader({
    glProgram,
    resources: { terr: { uTime: { value: 0, type: "f32" }, uLight: { value: new Float32Array([-0.5, -0.62, 0.6]), type: "vec3<f32>" } } },
  });
  return new Mesh({ geometry, shader: terrainShader });
}

async function main(): Promise<void> {
  const hud = document.getElementById("hud")!;
  hud.textContent = "Lade…";
  const app = new Application();
  await app.init({ background: 0x0a1422, resizeTo: window, antialias: true });
  document.getElementById("app")!.appendChild(app.canvas);

  const M = {
    humanU: `${ASSET}/Unit/medievalUnit_02.png`, humanK: `${ASSET}/Unit/medievalUnit_05.png`,
    elfU: `${ASSET}/Unit/medievalUnit_14.png`, elfK: `${ASSET}/Unit/medievalUnit_17.png`,
    orcU: `${ASSET}/Unit/medievalUnit_20.png`, orcK: `${ASSET}/Unit/medievalUnit_23.png`,
    barn: `${ASSET}/Structure/medievalStructure_19.png`, house: `${ASSET}/Structure/medievalStructure_17.png`,
    tower: `${ASSET}/Structure/medievalStructure_12.png`, barracks: `${ASSET}/Structure/medievalStructure_02.png`,
    tree1: `${ASSET}/Environment/medievalEnvironment_01.png`, tree2: `${ASSET}/Environment/medievalEnvironment_02.png`,
    tree3: `${ASSET}/Environment/medievalEnvironment_03.png`,
  };
  const tex: Record<string, Texture> = {};
  for (const [k, url] of Object.entries(M)) tex[k] = await Assets.load(url);

  hud.textContent = "Baue Welt…";
  buildHeight();
  const world = new Container();
  app.stage.addChild(world);
  world.scale.set(0.4); world.x = app.screen.width / 2; world.y = 60;
  world.addChild(buildTerrainMesh());

  const bandParent = new Container();
  bandParent.sortableChildren = true;
  world.addChild(bandParent);
  const bands: Container[] = [];
  const bandSize = (2 * MAP) / BANDS;
  for (let i = 0; i < BANDS; i++) { const c = new Container(); c.zIndex = i; bands.push(c); bandParent.addChild(c); }
  const bandOf = (gx: number, gy: number): number => Math.max(0, Math.min(BANDS - 1, Math.floor((gx + gy) / bandSize)));
  function placeOnLand(): { gx: number; gy: number } {
    for (let i = 0; i < 60; i++) {
      const gx = 6 + Math.random() * (MAP - 12), gy = 6 + Math.random() * (MAP - 12), h = sampleH(gx, gy);
      if (h >= WATER + 0.03 && h <= MOUNTAIN - 0.02) return { gx, gy };
    }
    return { gx: MAP / 2, gy: MAP / 2 };
  }
  function place(spr: Sprite, gx: number, gy: number): void {
    const p = worldToIso(gx, gy); spr.x = p.x; spr.y = p.y - elevLift(sampleH(gx, gy)); bands[bandOf(gx, gy)].addChild(spr);
  }

  const treeTex = [tex.tree1, tex.tree2, tex.tree3];
  for (let i = 0; i < TREES; i++) { const { gx, gy } = placeOnLand(); const s = new Sprite(treeTex[i % 3]); s.anchor.set(0.5, 0.9); s.scale.set(0.16); s.zIndex = 0; place(s, gx, gy); }

  const bTex = [tex.barn, tex.house, tex.tower, tex.barracks];
  interface Orb { spr: Sprite; life: number; }
  const orbs: Orb[] = [];
  let buildingsLeft = 0;
  const orbTex = makeOrbTexture(app);
  for (let i = 0; i < BUILDINGS; i++) {
    const { gx, gy } = placeOnLand();
    const s = new Sprite(bTex[i % 4]); s.anchor.set(0.5, 0.88); s.scale.set(0.34); s.zIndex = 1; s.eventMode = "static"; s.cursor = "pointer";
    s.on("pointerdown", (e) => {
      e.stopPropagation();
      const orb = new Sprite(orbTex); orb.anchor.set(0.5); orb.x = s.x; orb.y = s.y - 12; orb.tint = 0xffd24a; orb.scale.set(0.5);
      (s.parent ?? bandParent).addChild(orb); orbs.push({ spr: orb, life: 1 }); s.destroy(); buildingsLeft--;
    });
    place(s, gx, gy); buildingsLeft++;
  }

  const factions = [{ u: tex.humanU, k: tex.humanK }, { u: tex.elfU, k: tex.elfK }, { u: tex.orcU, k: tex.orcK }];
  interface U { gx: number; gy: number; vx: number; vy: number; spr: Sprite; band: number; }
  const units: U[] = [];
  function spawn(gx: number, gy: number, t: Texture, scale: number): void {
    const spr = new Sprite(t); spr.anchor.set(0.5, 0.82); spr.scale.set(scale);
    const ang = Math.random() * Math.PI * 2, sp = 0.006 + Math.random() * 0.014;
    const u: U = { gx, gy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, spr, band: bandOf(gx, gy) };
    bands[u.band].addChild(spr); units.push(u);
  }
  for (let pi = 0; pi < PLAYERS; pi++) {
    const f = factions[pi % 3], c = placeOnLand();
    spawn(c.gx, c.gy, f.k, 0.2);
    for (let i = 0; i < HORDE; i++) spawn(c.gx + (Math.random() - 0.5) * 12, c.gy + (Math.random() - 0.5) * 12, f.u, 0.12);
  }

  let dragging = false, lastX = 0, lastY = 0;
  app.canvas.style.touchAction = "none";
  app.canvas.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener("pointerup", () => { dragging = false; });
  window.addEventListener("pointermove", (e) => { if (!dragging) return; world.x += e.clientX - lastX; world.y += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; });
  app.canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    // Zoom-zum-Cursor: den Weltpunkt unter der Maus fixiert halten.
    const rect = app.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const old = world.scale.x;
    const ns = Math.max(0.12, Math.min(2.5, old * (e.deltaY < 0 ? 1.12 : 0.89)));
    const wx = (mx - world.x) / old, wy = (my - world.y) / old;
    world.scale.set(ns);
    world.x = mx - wx * ns; world.y = my - wy * ns;
  }, { passive: false });

  let acc = 0, time = 0;
  app.ticker.add((t) => {
    const dt = t.deltaTime;
    time += t.deltaMS / 1000;
    terrainShader.resources.terr.uniforms.uTime = time;
    for (const u of units) {
      const nx = u.gx + u.vx * dt, ny = u.gy + u.vy * dt;
      if (!passable(nx, u.gy)) u.vx = -u.vx; else u.gx = nx;
      if (!passable(u.gx, ny)) u.vy = -u.vy; else u.gy = ny;
      const p = worldToIso(u.gx, u.gy);
      u.spr.x = p.x; u.spr.y = p.y - elevLift(sampleH(u.gx, u.gy));
      const nb = bandOf(u.gx, u.gy);
      if (nb !== u.band) { bands[nb].addChild(u.spr); u.band = nb; }
    }
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i]; o.life -= 0.012 * dt; o.spr.y -= 0.6 * dt; o.spr.alpha = Math.max(0, o.life);
      if (o.life <= 0) { o.spr.destroy(); orbs.splice(i, 1); }
    }
    acc += t.deltaMS;
    if (acc > 250) { acc = 0; hud.textContent = `Horde.IO — Iso Spike v4 · ${units.length} Units · ${PLAYERS} Horden · ${buildingsLeft} Gebäude · ${app.ticker.FPS.toFixed(0)} FPS · Hillshade+Wasser-Anim · Klick=looten`; }
  });
}

function makeOrbTexture(app: Application): Texture {
  const gr = new Graphics();
  gr.circle(0, 0, 7).fill(0xffffff).stroke({ color: 0x6a4a00, width: 1.5 });
  const t = app.renderer.generateTexture({ target: gr, antialias: true });
  gr.destroy();
  return t;
}

main();
