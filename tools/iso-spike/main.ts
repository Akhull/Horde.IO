// Horde.IO — Iso-Spike v3 (PixiJS v8).
//
// Terrain-Rewrite gegen den "Minecraft-Block"-Look: das Gelände ist jetzt EIN
// Gouraud-Mesh — Höhe pro ECKPUNKT (geneigte Dreiecke statt flacher Kacheln mit
// senkrechten Kanten), Farbe im Shader linear interpoliert -> nahtlose Hänge + weiche
// Küsten, keine sichtbaren Quadrate. Plus: markante Berge (Ridge-Noise), eingegrabene
// Flüsse, und BERGE + WASSER sind unbegehbar -> natürliche Engpässe/Chokepoints.
//
// Weiterhin reine PRÄSENTATION über kartesischen (gx,gy). Aufruf:
// http://localhost:5173/iso-spike.html  (Drag=Pan, Rad=Zoom, Klick Gebäude=looten)

import { Application, Container, Sprite, Texture, Assets, Geometry, Buffer, BufferUsage, Mesh, Shader, GlProgram, Graphics } from "pixi.js";

const TILE_W = 32, TILE_H = 16, HW = TILE_W / 2, HH = TILE_H / 2;
const MAP = 150;            // 150x150 Zellen
const N = MAP + 1;          // Eckpunkte je Achse
const ELEV = 120;           // Screen-Y-Lift pro Höheneinheit (markante Berge)
const WATER = 0.38;         // darunter = Wasser (unbegehbar)
const MOUNTAIN = 0.72;      // darüber = Berg (unbegehbar -> Wall/Chokepoint)
const PLAYERS = 12, HORDE = 520, BUILDINGS = 240, TREES = 650, BANDS = 120;
const ASSET = "/assets/kenney/medieval-rts/PNG/Retina";

// ---- Noise ----
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

// kontinuierliche Höhen-Farbrampe (tiefes Wasser -> Schnee)
const RAMP: [number, number][] = [
  [0.0, 0x123a63], [0.30, 0x205a92], [0.37, 0x3f86bd], [0.39, 0xcdbd86],
  [0.44, 0x4f9a3f], [0.60, 0x3c7d2f], [0.68, 0x5e6b3a], [0.72, 0x726a52],
  [0.80, 0x8a8278], [0.88, 0xada69c], [0.96, 0xdadbe0], [1.0, 0xf2f4f8],
];
function rampRGB(h: number, out: { r: number; g: number; b: number }): void {
  let c0 = RAMP[0][1], c1 = RAMP[0][1], t = 0;
  for (let i = 1; i < RAMP.length; i++) {
    if (h <= RAMP[i][0]) { c0 = RAMP[i - 1][1]; c1 = RAMP[i][1]; t = (h - RAMP[i - 1][0]) / (RAMP[i][0] - RAMP[i - 1][0] || 1); break; }
    c1 = RAMP[i][1]; c0 = RAMP[i][1]; t = 0;
  }
  const ar = (c0 >> 16) & 0xff, ag = (c0 >> 8) & 0xff, ab = c0 & 0xff;
  const br = (c1 >> 16) & 0xff, bg = (c1 >> 8) & 0xff, bb = c1 & 0xff;
  out.r = (ar + (br - ar) * t) / 255; out.g = (ag + (bg - ag) * t) / 255; out.b = (ab + (bb - ab) * t) / 255;
}

// ---- Höhenraster H (inkl. Berge + eingegrabene Flüsse) ----
const H = new Float32Array(N * N);
function baseHeight(i: number, j: number): number {
  const n = fbm(i * 0.028 + 7, j * 0.028 + 7, 5);
  const ridge = 1 - Math.abs(fbm(i * 0.016 + 51, j * 0.016 + 51, 4) * 2 - 1); // scharfe Bergkämme
  const dx = (i / MAP) * 2 - 1, dy = (j / MAP) * 2 - 1;
  const island = 1 - Math.min(1, (dx * dx + dy * dy) * 0.92); // Inselrand -> Küste ringsum
  const h = n * 0.5 + ridge * ridge * 0.42 + island * 0.42 - 0.12;
  return Math.max(0, Math.min(1, h));
}
function buildHeight(): void {
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) H[i * N + j] = baseHeight(i, j);
  // Flüsse: an hohen Punkten starten, bergab fließen, Kanal eingraben (auf Wasser senken).
  for (let r = 0; r < 10; r++) {
    let bi = 0, bj = 0, bh = 0;
    for (let k = 0; k < 60; k++) {
      const i = 5 + Math.floor(Math.random() * (N - 10)), j = 5 + Math.floor(Math.random() * (N - 10));
      if (H[i * N + j] > bh) { bh = H[i * N + j]; bi = i; bj = j; }
    }
    if (bh < 0.55) continue;
    let ci = bi, cj = bj;
    for (let step = 0; step < N * 2; step++) {
      // Kanal eingraben (Mitte + Nachbarn leicht) -> sichtbar breit, unbegehbar.
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const ii = ci + di, jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const depth = di === 0 && dj === 0 ? 0.06 : 0.03;
        H[ii * N + jj] = Math.min(H[ii * N + jj], WATER - depth);
      }
      // steilste Abwärts-Nachbarschaft suchen
      let ni = ci, nj = cj, nh = H[ci * N + cj];
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const ii = ci + di, jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        if (H[ii * N + jj] < nh) { nh = H[ii * N + jj]; ni = ii; nj = jj; }
      }
      if (ni === ci && nj === cj) break;       // lokales Minimum -> See/Ende
      ci = ni; cj = nj;
      if (H[ci * N + cj] < WATER - 0.05) break; // Meer erreicht
    }
  }
}
function sampleH(fx: number, fy: number): number {
  const x = Math.max(0, Math.min(MAP - 0.001, fx)), y = Math.max(0, Math.min(MAP - 0.001, fy));
  const i = Math.floor(x), j = Math.floor(y), tx = x - i, ty = y - j;
  const a = H[i * N + j], b = H[(i + 1) * N + j], c = H[i * N + (j + 1)], d = H[(i + 1) * N + (j + 1)];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
const passable = (fx: number, fy: number): boolean => {
  const h = sampleH(fx, fy);
  return h >= WATER && h <= MOUNTAIN; // Wasser UND Berg blockieren -> Engpässe
};

function buildTerrainMesh(): Mesh {
  const positions = new Float32Array(N * N * 2);
  const colors = new Float32Array(N * N * 3);
  const tmp = { r: 0, g: 0, b: 0 };
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const k = i * N + j, h = H[k], p = worldToIso(i, j);
    positions[2 * k] = p.x; positions[2 * k + 1] = p.y - elevLift(h);
    rampRGB(h, tmp); colors[3 * k] = tmp.r; colors[3 * k + 1] = tmp.g; colors[3 * k + 2] = tmp.b;
  }
  // Indizes back-to-front (nach Zell-Tiefe i+j), 2 Dreiecke pro Zelle.
  const idx: number[] = [];
  for (let d = 0; d < 2 * MAP; d++)
    for (let i = Math.max(0, d - (MAP - 1)); i <= Math.min(d, MAP - 1); i++) {
      const j = d - i; if (j < 0 || j >= MAP) continue;
      const a = i * N + j, b = (i + 1) * N + j, c = (i + 1) * N + (j + 1), e = i * N + (j + 1);
      idx.push(a, b, c, a, c, e);
    }
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: new Buffer({ data: positions, label: "pos" }), format: "float32x2", stride: 8, offset: 0 },
      aColor: { buffer: new Buffer({ data: colors, label: "col" }), format: "float32x3", stride: 12, offset: 0 },
    },
    indexBuffer: new Buffer({ data: new Uint32Array(idx), label: "idx", usage: BufferUsage.INDEX | BufferUsage.COPY_DST }),
  });
  const glProgram = new GlProgram({
    vertex: `
      attribute vec2 aPosition;
      attribute vec3 aColor;
      varying vec3 vColor;
      uniform mat3 uProjectionMatrix;
      uniform mat3 uWorldTransformMatrix;
      uniform mat3 uTransformMatrix;
      void main() {
        mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
        gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
        vColor = aColor;
      }`,
    fragment: `
      varying vec3 vColor;
      void main() { gl_FragColor = vec4(vColor, 1.0); }`,
  });
  return new Mesh({ geometry, shader: new Shader({ glProgram }) });
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
  world.scale.set(0.4);
  world.x = app.screen.width / 2;
  world.y = 60;
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
      const gx = 6 + Math.random() * (MAP - 12), gy = 6 + Math.random() * (MAP - 12);
      const h = sampleH(gx, gy);
      if (h >= WATER + 0.03 && h <= MOUNTAIN - 0.02) return { gx, gy };
    }
    return { gx: MAP / 2, gy: MAP / 2 };
  }
  function place(spr: Sprite, gx: number, gy: number): void {
    const p = worldToIso(gx, gy);
    spr.x = p.x; spr.y = p.y - elevLift(sampleH(gx, gy));
    bands[bandOf(gx, gy)].addChild(spr);
  }

  // Bäume
  const treeTex = [tex.tree1, tex.tree2, tex.tree3];
  for (let i = 0; i < TREES; i++) {
    const { gx, gy } = placeOnLand();
    const s = new Sprite(treeTex[i % 3]); s.anchor.set(0.5, 0.9); s.scale.set(0.16); s.zIndex = 0;
    place(s, gx, gy);
  }

  // zerstörbare Loot-Gebäude
  const bTex = [tex.barn, tex.house, tex.tower, tex.barracks];
  interface Orb { spr: Sprite; life: number; }
  const orbs: Orb[] = [];
  let buildingsLeft = 0;
  const orbTex = makeOrbTexture(app);
  for (let i = 0; i < BUILDINGS; i++) {
    const { gx, gy } = placeOnLand();
    const s = new Sprite(bTex[i % 4]); s.anchor.set(0.5, 0.88); s.scale.set(0.34); s.zIndex = 1;
    s.eventMode = "static"; s.cursor = "pointer";
    s.on("pointerdown", (e) => {
      e.stopPropagation();
      const orb = new Sprite(orbTex); orb.anchor.set(0.5); orb.x = s.x; orb.y = s.y - 12; orb.tint = 0xffd24a; orb.scale.set(0.5);
      (s.parent ?? bandParent).addChild(orb); orbs.push({ spr: orb, life: 1 });
      s.destroy(); buildingsLeft--;
    });
    place(s, gx, gy); buildingsLeft++;
  }

  // 12 Horden
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

  // Kamera
  let dragging = false, lastX = 0, lastY = 0;
  app.canvas.style.touchAction = "none";
  app.canvas.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener("pointerup", () => { dragging = false; });
  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    world.x += e.clientX - lastX; world.y += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
  });
  app.canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const s = e.deltaY < 0 ? 1.12 : 0.89;
    world.scale.x = Math.max(0.12, Math.min(2.5, world.scale.x * s)); world.scale.y = world.scale.x;
  }, { passive: false });

  let acc = 0;
  app.ticker.add((t) => {
    const dt = t.deltaTime;
    for (const u of units) {
      const nx = u.gx + u.vx * dt, ny = u.gy + u.vy * dt;
      // Wasser UND Berg unbegehbar -> abprallen (Engpässe entstehen natürlich).
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
    if (acc > 250) {
      acc = 0;
      hud.textContent = `Horde.IO — Iso Spike v3 · ${units.length} Units · ${PLAYERS} Horden · ${buildingsLeft} Gebäude · ${app.ticker.FPS.toFixed(0)} FPS · Berge+Wasser blockieren · Klick=looten`;
    }
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
