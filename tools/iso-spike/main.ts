// Horde.IO — Iso-Spike v4 (PixiJS v8).
//
// Terrain mit DETAIL: das Gouraud-Mesh wird jetzt im Fragment-Shader (a) per HILLSHADING
// (Normalen aus der Heightmap) beleuchtet -> Berge/Hänge mit Licht+Schatten, Spitzen lesbar;
// (b) mit prozeduralem DETAIL-GRAIN texturiert statt flach verwaschen; (c) ANIMIERTES Wasser
// (Schimmer/Funkeln). Flüsse graben monoton bergab bis Meer/Kartenrand (keine Pfützen).
// Berge + Wasser unbegehbar -> Engpässe. Weiterhin reine Präsentation über (gx,gy).
//
// Aufruf: http://localhost:5173/iso-spike.html  (Drag=Pan, Rad=Zoom, Klick Gebäude=looten)

import { Application, Container, Sprite, Texture, Assets, Geometry, Buffer, BufferUsage, Mesh, Shader, GlProgram, Graphics, RenderTexture, Rectangle, ParticleContainer, Particle } from "pixi.js";

// SEEDED RNG (mulberry32) — Worldgen + Sim ziehen hieraus -> deterministisch/reproduzierbar per ?seed=N.
// Fundament fürs Multiplayer ([[multiplayer-masterplan]]): gleicher Seed = gleicher Spielverlauf.
// FX/Optik (Poofs) dürfen weiter Math.random nutzen (rein lokale Präsentation).
let _rngState = 1 >>> 0;
function seedRng(s: number): void { _rngState = s >>> 0 || 1; }
function rng(): number {
  _rngState = (_rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(_rngState ^ (_rngState >>> 15), 1 | _rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const TILE_W = 32, TILE_H = 16, HW = TILE_W / 2, HH = TILE_H / 2;
const MAP = 720, N = MAP + 1; // große Insel (16-Spieler-Battle-Royale)
const ELEV = 150;           // Screen-Y-Lift (markante Berge)
const NORM_K = 26;          // Höhen->Slope-Skala für die Beleuchtung
const WATER = 0.38, MOUNTAIN = 0.80; // höhere Block-Schwelle -> weniger gesperrte Fläche, mehr Pässe
const STEEP = 0.22;                  // nur echte Klippen/Steilhänge blocken (Hügel begehbar -> Terrain sperrt nicht alles)
const PLAYERS = 16, HORDE = 520, BUILDINGS = 520, TREES = 4600; // dichtere Wälder (vorher 2200 = zu mau)
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
// Emergente Hydrologie (alles rein aus H abgeleitet, KEIN separates Fluss-System):
const HF = new Float32Array(N * N);   // Priority-Flood Füllhöhe = lokale Spill-/Wassertafel-Höhe
const ACC = new Float32Array(N * N);  // D8-Abfluss (Drainage-Fläche pro Zelle)
const REC = new Int32Array(N * N);    // D8-Empfänger (-1 = Auslass am Rand/Meer)
const WET = new Float32Array(N * N);  // lokaler Wasser-Lift über dem Grund (0 = trocken)
const PASS = new Uint8Array(N * N);   // Begehbarkeits-Bitmap (1=begehbar) — EINMAL beim Worldgen, O(1)-Lookup im Tick
const FLOWX = new Float32Array(N * N), FLOWY = new Float32Array(N * N); // Fließrichtung NUR auf Flusszellen
const HG = (i: number, j: number): number => H[Math.max(0, Math.min(N - 1, i)) * N + Math.max(0, Math.min(N - 1, j))];
function baseHeight(i: number, j: number): number {
  const n = fbm(i * 0.014 + 7, j * 0.014 + 7, 5);
  const ridge = 1 - Math.abs(fbm(i * 0.010 + 51, j * 0.010 + 51, 4) * 2 - 1);
  const dx = (i / MAP) * 2 - 1, dy = (j / MAP) * 2 - 1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // Ozean-Ring NUR am Rand (dist>0.72); Inneres bleibt FLACH -> kein zentraler Berg-Dom mehr.
  const edge = 1 - Math.max(0, Math.min(1, (dist - 0.82) / 0.18)); // dünnerer Ozean-Rand -> mehr Land
  const h = (n * 0.6 + ridge * ridge * 0.34) * edge + edge * 0.16 - 0.03;
  return Math.max(0, Math.min(1, h));
}
// EMERGENTE HYDROLOGIE — rein aus dem Heightmap H abgeleitet, kein Fluss-System, keine Splines:
// (1) Priority-Flood+Epsilon (Barnes/Lehman 2014): füllt Senken -> JEDE Zelle entwässert monoton
//     zum Rand (Meer). HF = lokale Spill-/Wassertafel-Höhe. (2) D8-Empfänger + Flow-Accumulation ->
//     ACC = Abfluss (Drainage-Fläche). (3) Flüsse = Zellen mit viel Abfluss: Bett drainage-getrieben
//     eintiefen (Stream-Power-Idee) + lokales Wasser füllt den Kanal auf TAL-Höhe. Seen = gefüllte
//     Senken (HF-H). Fließrichtung = D8-Gefälle. => Flüsse münden garantiert ins Meer, auf eigener Höhe.
const NB8: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
function hydrology(): void {
  const cap = N * N, EPS = 1e-6;
  // --- (1) Priority-Flood+Epsilon (binärer Min-Heap auf flachen Typed-Arrays) ---
  const hk = new Float32Array(cap), hv = new Int32Array(cap); let hn = 0;
  const swap = (a: number, b: number): void => { const tk = hk[a]; hk[a] = hk[b]; hk[b] = tk; const tv = hv[a]; hv[a] = hv[b]; hv[b] = tv; };
  const push = (key: number, idx: number): void => { let i = hn++; hk[i] = key; hv[i] = idx; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; swap(p, i); i = p; } };
  const pop = (): number => { const top = hv[0]; hn--; hk[0] = hk[hn]; hv[0] = hv[hn]; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hn && hk[l] < hk[m]) m = l; if (r < hn && hk[r] < hk[m]) m = r; if (m === i) break; swap(m, i); i = m; } return top; };
  const closed = new Uint8Array(cap);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (i === 0 || j === 0 || i === N - 1 || j === N - 1) { const k = i * N + j; HF[k] = H[k]; closed[k] = 1; push(H[k], k); }
  while (hn > 0) {
    const c = pop(), ci = (c / N) | 0, cj = c - ci * N;
    for (let d = 0; d < 8; d++) { const ni = ci + NB8[d][0], nj = cj + NB8[d][1]; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue; const n = ni * N + nj; if (closed[n]) continue; HF[n] = Math.max(H[n], HF[c] + EPS); closed[n] = 1; push(HF[n], n); }
  }
  // --- (2) D8-Empfänger auf HF (Fließrichtung) + Flow-Accumulation in Höhen-Reihenfolge ---
  REC.fill(-1);
  for (let i = 1; i < N - 1; i++) for (let j = 1; j < N - 1; j++) {
    const k = i * N + j; let best = -1, bestS = 0, bi = 0, bj = 0;
    for (let d = 0; d < 8; d++) { const di = NB8[d][0], dj = NB8[d][1]; const n = (i + di) * N + (j + dj); const dist = di && dj ? 1.4142 : 1.0; const s = (HF[k] - HF[n]) / dist; if (s > bestS) { bestS = s; best = n; bi = di; bj = dj; } }
    REC[k] = best; const fl = Math.hypot(bi, bj) || 1; FLOWX[k] = bi / fl; FLOWY[k] = bj / fl;
  }
  const order = new Int32Array(cap); for (let k = 0; k < cap; k++) { order[k] = k; ACC[k] = 1; }
  order.sort((a, b) => HF[b] - HF[a]);
  for (let o = 0; o < cap; o++) { const k = order[o], r = REC[k]; if (r >= 0) ACC[r] += ACC[k]; }
  // --- (3) WET = lokaler Wasser-Lift; Flüsse: Bett eintiefen + Kanal auf Tal-Höhe füllen ---
  let maxAcc = 1; for (let k = 0; k < cap; k++) if (ACC[k] > maxAcc) maxAcc = ACC[k];
  const RIVER_THRESH = maxAcc * 0.12;         // NUR ganz wenige, sehr große Ströme (keine dünnen Flüsse/Bäche)
  const isRiver = new Uint8Array(cap);
  for (let k = 0; k < cap; k++) {
    const lake = HF[k] - H[k];
    if (H[k] < WATER) { WET[k] = WATER - H[k]; FLOWX[k] = 0; FLOWY[k] = 0; }          // Ozean
    else if (lake > 0.09) { WET[k] = lake; FLOWX[k] = 0; FLOWY[k] = 0; }              // See NUR bei tiefem Becken (sonst Seen-Brei)
    else if (ACC[k] > RIVER_THRESH) {                                                // Fluss
      const q = Math.min(1, Math.sqrt(ACC[k] / maxAcc));
      const D = 0.025 + 0.06 * q;            // Bett-Eintiefung skaliert mit Abfluss (Stream-Power)
      H[k] = Math.max(0, H[k] - D);          // Kanal ins Terrain graben (drainage-getrieben)
      WET[k] = D * 0.82;                      // Wasser füllt Kanal; Ufer stehen leicht über -> sitzt im Tal
      isRiver[k] = 1;                          // Fließrichtung FLOWX/Y aus D8 behalten
    } else { WET[k] = 0; FLOWX[k] = 0; FLOWY[k] = 0; }                                // trockenes Land
  }
  // --- (3b) Flüsse verbreitern (Radius skaliert mit Abfluss -> große Ströme breit) -> Nachbar auf
  //     Kanal-Bett senken + Fließrichtung erben. So lesen die großen Flüsse als richtige Gewässer. ---
  const Hsrc = Float32Array.from(H), Wsrc = Float32Array.from(WET);
  for (let i = 2; i < N - 2; i++) for (let j = 2; j < N - 2; j++) {
    const k = i * N + j; if (!isRiver[k]) continue;
    const rad = ACC[k] > maxAcc * 0.4 ? 3 : 2;           // immer breit -> echtes Gewässer, kein Faden
    for (let di = -rad; di <= rad; di++) for (let dj = -rad; dj <= rad; dj++) {
      if ((di === 0 && dj === 0) || di * di + dj * dj > rad * rad + 1) continue;
      const n = (i + di) * N + (j + dj);
      if (WET[n] === 0 && Hsrc[n] >= WATER && Hsrc[n] <= Hsrc[k] + 0.05) {
        H[n] = Math.min(H[n], Hsrc[k]); WET[n] = Wsrc[k] * 0.9; FLOWX[n] = FLOWX[k]; FLOWY[n] = FLOWY[k];
      }
    }
  }
}
function buildHeight(terrace: boolean): void {
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) H[i * N + j] = baseHeight(i, j);
  erode(180000); // Droplet-Erosion: dendritische Täler bergab -> natürliches Relief direkt aus der Heightmap.
  for (let k = 0; k < N * N; k++) H[k] = Math.max(0, Math.min(1, H[k]));
  hydrology();   // emergente Flüsse/Seen + Fließrichtung rein aus H (kein separates Fluss-System)
  if (terrace) for (let k = 0; k < N * N; k++) H[k] = Math.floor(H[k] * 13) / 13; // Voxel-Stufen
  // Begehbarkeits-Bitmap EINMAL vorberechnen: NUR Wasser/Fluss + Hochgebirge blocken (keine Hang-Sperre
  // mehr -> Hügel begehbar, man bleibt nicht überall hängen; nur echte Berge & Wasser sind Hindernisse).
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const k = i * N + j, h = H[k];
    PASS[k] = h >= WATER && h <= MOUNTAIN && WET[k] <= 0.0005 ? 1 : 0;
  }
}
// Droplet-basierte hydraulische Erosion (Sebastian-Lague-Muster): jeder Tropfen folgt dem
// Gefälle, trägt Sediment, erodiert bergab und lagert in Senken ab -> dendritische Täler/Flüsse.
function erode(drops: number): void {
  const inertia = 0.04, capF = 3.6, minSlope = 0.01, erodeR = 0.34, depositR = 0.28, evap = 0.018, grav = 5, life = 36;
  for (let d = 0; d < drops; d++) {
    let x = 1 + rng() * (N - 3), y = 1 + rng() * (N - 3);
    let dx = 0, dy = 0, spd = 1, water = 1, sed = 0;
    for (let l = 0; l < life; l++) {
      const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j;
      if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) break;
      const nw = H[i * N + j], ne = H[(i + 1) * N + j], sw = H[i * N + (j + 1)], se = H[(i + 1) * N + (j + 1)];
      const gx = (ne - nw) * (1 - v) + (se - sw) * v;
      const gy = (sw - nw) * (1 - u) + (se - ne) * u;
      const hh = nw * (1 - u) * (1 - v) + ne * u * (1 - v) + sw * (1 - u) * v + se * u * v;
      dx = dx * inertia - gx * (1 - inertia);
      dy = dy * inertia - gy * (1 - inertia);
      const ml = Math.hypot(dx, dy);
      if (ml < 1e-6) break;
      dx /= ml; dy /= ml;
      const nx = x + dx, ny = y + dy;
      const ii = Math.floor(nx), jj = Math.floor(ny);
      if (ii < 0 || jj < 0 || ii >= N - 1 || jj >= N - 1) break;
      const nu = nx - ii, nv = ny - jj;
      const h2v = H[ii * N + jj] * (1 - nu) * (1 - nv) + H[(ii + 1) * N + jj] * nu * (1 - nv) + H[ii * N + (jj + 1)] * (1 - nu) * nv + H[(ii + 1) * N + (jj + 1)] * nu * nv;
      const dh = h2v - hh;
      const cap = Math.max(-dh, minSlope) * spd * water * capF;
      if (sed > cap || dh > 0) {
        const dep = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depositR;
        sed -= dep;
        H[i * N + j] += dep * (1 - u) * (1 - v); H[(i + 1) * N + j] += dep * u * (1 - v); H[i * N + (j + 1)] += dep * (1 - u) * v; H[(i + 1) * N + (j + 1)] += dep * u * v;
      } else {
        const ero = Math.min((cap - sed) * erodeR, -dh);
        H[i * N + j] -= ero * (1 - u) * (1 - v); H[(i + 1) * N + j] -= ero * u * (1 - v); H[i * N + (j + 1)] -= ero * (1 - u) * v; H[(i + 1) * N + (j + 1)] -= ero * u * v;
        sed += ero;
      }
      spd = Math.sqrt(Math.max(0, spd * spd - dh * grav));
      water *= (1 - evap);
      x = nx; y = ny;
    }
  }
}
function sampleH(fx: number, fy: number): number {
  const x = Math.max(0, Math.min(MAP - 0.001, fx)), y = Math.max(0, Math.min(MAP - 0.001, fy));
  const i = Math.floor(x), j = Math.floor(y), tx = x - i, ty = y - j;
  const a = H[i * N + j], b = H[(i + 1) * N + j], c = H[i * N + (j + 1)], d = H[(i + 1) * N + (j + 1)];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
// begehbar = O(1)-Lookup in die vorberechnete PASS-Bitmap (nicht Wasser/Hochgebirge/Steilhang/Fluss).
const passable = (fx: number, fy: number): boolean => {
  const ix = fx < 0 ? 0 : fx >= MAP ? MAP - 1 : fx | 0, iy = fy < 0 ? 0 : fy >= MAP ? MAP - 1 : fy | 0;
  return PASS[ix * N + iy] === 1;
};
// Hangneigung (für „flach genug zum Bauen"): Summe der Höhendifferenzen ringsum.
function slopeAt(gx: number, gy: number): number {
  const e = 1.5;
  return Math.abs(sampleH(gx + e, gy) - sampleH(gx - e, gy)) + Math.abs(sampleH(gx, gy + e) - sampleH(gx, gy - e));
}
// Wald-Dichte-Maske (eigenes Low-Freq-Noise) -> Bäume clustern zu echten Waldflächen statt random.
function forestMask(gx: number, gy: number): number { return fbm(gx * 0.02 + 200, gy * 0.02 + 200, 3); }

let terrainShader: Shader;
function buildTerrainMesh(): Mesh {
  const pos = new Float32Array(N * N * 2), col = new Float32Array(N * N * 3);
  const nrm = new Float32Array(N * N * 3), wld = new Float32Array(N * N * 2), hgt = new Float32Array(N * N);
  const wet = new Float32Array(N * N), flow = new Float32Array(N * N * 2);
  const tmp = { r: 0, g: 0, b: 0 };
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const k = i * N + j, h = H[k], w = WET[k], p = worldToIso(i, j);
    pos[2 * k] = p.x; pos[2 * k + 1] = p.y - elevLift(h + (w > 0 ? w : 0)); // Wasser-Vertices auf lokale Tafel heben
    rampRGB(h, tmp); col[3 * k] = tmp.r; col[3 * k + 1] = tmp.g; col[3 * k + 2] = tmp.b;
    // Normale aus Höhen-Gradient (für Hillshading)
    const nx = -(HG(i + 1, j) - HG(i - 1, j)) * NORM_K, ny = -(HG(i, j + 1) - HG(i, j - 1)) * NORM_K, nz = 1;
    const inv = 1 / Math.hypot(nx, ny, nz);
    nrm[3 * k] = nx * inv; nrm[3 * k + 1] = ny * inv; nrm[3 * k + 2] = nz * inv;
    wld[2 * k] = i; wld[2 * k + 1] = j; hgt[k] = h; wet[k] = w; flow[2 * k] = FLOWX[k]; flow[2 * k + 1] = FLOWY[k];
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
      aWet: { buffer: buf(wet, "wet"), format: "float32", stride: 4, offset: 0 },
      aFlow: { buffer: buf(flow, "flow"), format: "float32x2", stride: 8, offset: 0 },
    },
    indexBuffer: new Buffer({ data: new Uint32Array(idx), label: "idx", usage: BufferUsage.INDEX | BufferUsage.COPY_DST }),
  });
  const glProgram = new GlProgram({
    vertex: `
      attribute vec2 aPosition; attribute vec3 aColor; attribute vec3 aNormal; attribute vec2 aWorld; attribute float aHeight; attribute float aWet; attribute vec2 aFlow;
      varying vec3 vColor; varying vec3 vNormal; varying vec2 vWorld; varying float vHeight; varying float vWet; varying vec2 vFlow;
      uniform mat3 uProjectionMatrix; uniform mat3 uWorldTransformMatrix; uniform mat3 uTransformMatrix;
      void main() {
        gl_Position = vec4((uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix*vec3(aPosition,1.0)).xy, 0.0, 1.0);
        vColor = aColor; vNormal = aNormal; vWorld = aWorld; vHeight = aHeight; vWet = aWet; vFlow = aFlow;
      }`,
    fragment: `
      precision mediump float;
      varying vec3 vColor; varying vec3 vNormal; varying vec2 vWorld; varying float vHeight; varying float vWet; varying vec2 vFlow;
      uniform float uTime; uniform vec3 uLight; uniform vec3 uView; uniform float uStyle; // 0 real | 1 pixel | 2 voxel | 3 cel
      float h2(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
      float vn(vec2 p){ vec2 i=floor(p),f=fract(p); float a=h2(i),b=h2(i+vec2(1.,0.)),c=h2(i+vec2(0.,1.)),d=h2(i+vec2(1.,1.)); vec2 u=f*f*(3.-2.*f); return mix(mix(a,b,u.x),mix(c,d,u.x),u.y); }
      vec3 biome(float hh){
        if (hh < 0.415) return vec3(0.85,0.78,0.50);  // Sand
        if (hh < 0.50)  return vec3(0.45,0.72,0.31);  // Gras hell
        if (hh < 0.62)  return vec3(0.31,0.60,0.25);  // Gras
        if (hh < 0.70)  return vec3(0.22,0.47,0.20);  // Gras dunkel
        if (hh < 0.78)  return vec3(0.49,0.42,0.29);  // Erde
        if (hh < 0.88)  return vec3(0.55,0.52,0.49);  // Fels
        if (hh < 0.95)  return vec3(0.72,0.72,0.72);  // heller Fels
        return vec3(0.96,0.97,1.0);                   // Schnee
      }
      void main() {
        vec3 nB = normalize(vNormal);
        float diff = clamp(dot(nB, normalize(uLight)), 0.0, 1.0);
        // ---- WASSER: 3 GERSTNER-Wellen, ANALYTISCHE Normalen + Schlick-Fresnel + Blinn-Phong-Sonnenglanz.
        //      Bewährt: GPU Gems Ch.1 (Finch), Sea of Thieves (SIGGRAPH 2018), Wind Waker, Unreal Water.
        //      Physikalisches Wellen-Normalfeld -> jede Farbänderung kommt aus Fresnel/Specular, kein
        //      Noise, keine erfundene Helligkeits-Sinus-Hack. 3 langwellige Sinus = bandbegrenzt = keine
        //      Ölspur. + Toon-Tiefenbänder (pixelartig) + Ufer-Schaum. Null neue Texturen. ----
        if (vWet > 0.0005) {                                              // EMERGENT: Wasser wo Wassertafel > 0 (Ozean/See/Fluss)
          float depth = clamp(vWet / 0.12, 0.0, 1.0);                     // LOKALE Tiefe (kein globales Meeresniveau)
          // Tiefen-Körperfarbe als 3 weiche Toon-Bänder (liest pixelig, killt Schimmer)
          vec3 cShallow = vec3(0.34, 0.66, 0.71);                         // Küsten-Türkis
          vec3 cMid     = vec3(0.11, 0.42, 0.58);                         // mittleres Meer
          vec3 cDeep    = vec3(0.04, 0.17, 0.38);                         // tiefes Navy
          vec3 bodyCol = mix(cShallow, cMid, smoothstep(0.18, 0.42, depth));
               bodyCol = mix(bodyCol,  cDeep, smoothstep(0.55, 0.82, depth));
          // 3 Gerstner-Wellen: Richtung, Wellenlänge L (Zellen), Amplitude A, Speed S, Steilheit Q.
          // Lange, inkommensurable L (34/21/13 ~ Fibonacci) -> keine sichtbare Kachelung. Wir brauchen
          // nur die NORMALE (Silhouette ist top-down unsichtbar): analytische Ableitung der Summe.
          vec2 d0 = normalize(vec2(0.80, 0.60)), d1 = normalize(vec2(-0.60, 0.80)), d2 = normalize(vec2(0.20, -0.98));
          vec3 Lw = vec3(34.0, 21.0, 13.0), Aw = vec3(0.55, 0.32, 0.16), Sw = vec3(2.6, 3.1, 3.9), Qw = vec3(0.65, 0.55, 0.45);
          float nx = 0.0, ny = 0.0, nz = 1.0, crest = 0.0;
          { float w = 6.2831853 / Lw.x; float th = w*dot(d0, vWorld) + uTime*(Sw.x*w);
            float c = cos(th), s = sin(th), WA = w*Aw.x; nx -= d0.x*WA*c; ny -= d0.y*WA*c; nz -= Qw.x*WA*s; crest += s; }
          { float w = 6.2831853 / Lw.y; float th = w*dot(d1, vWorld) + uTime*(Sw.y*w);
            float c = cos(th), s = sin(th), WA = w*Aw.y; nx -= d1.x*WA*c; ny -= d1.y*WA*c; nz -= Qw.y*WA*s; crest += s; }
          { float w = 6.2831853 / Lw.z; float th = w*dot(d2, vWorld) + uTime*(Sw.z*w);
            float c = cos(th), s = sin(th), WA = w*Aw.z; nx -= d2.x*WA*c; ny -= d2.y*WA*c; nz -= Qw.z*WA*s; crest += s; }
          float openSea = smoothstep(0.0, 0.35, depth);                   // Wellen am Ufer flach -> Sandlinie ruhig
          vec3 Nw = normalize(vec3(nx*openSea, ny*openSea, max(nz, 0.18)));
          vec3 V = normalize(uView), Ld = normalize(uLight), Hl = normalize(Ld + V);
          // Schlick-Fresnel: Himmel-Glanz bei flachem Winkel (Wasser F0 ~0.02)
          float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(Nw, V), 0.0, 1.0), 5.0);
          vec3 col = mix(bodyCol, vec3(0.55, 0.74, 0.90), fres * 0.55);
          col *= 0.86 + 0.14 * (0.5 + 0.5 * dot(Nw, Ld));                 // sehr weiche Schwell-Schattierung
          float spec = pow(max(dot(Nw, Hl), 0.0), 96.0);                  // Sonnenglanz, wandert auf den Kämmen
          col += vec3(1.0, 0.97, 0.88) * spec * (0.55 * openSea);
          col += smoothstep(2.2, 2.9, crest) * 0.05 * openSea;            // sparsames Funkeln auf schärfsten Kämmen
          // (KEINE Fluss-Strömungs-Animation -> Flüsse rendern ruhig wie Seen/Meer, kein LSD)
          float shore = smoothstep(0.016, 0.0, vWet);                     // Schaum an Wasserkante (Küste + Ufer)
          float lap = 0.5 + 0.5 * sin(uTime * 1.0 + (vWorld.x + vWorld.y) * 0.25);
          col = mix(col, vec3(0.86, 0.93, 0.96), shore * (0.4 + 0.6 * lap) * 0.6);
          if (uStyle > 0.5 && uStyle < 2.5) { col = floor(col * 8.0 + 0.5) / 8.0; spec = step(0.5, spec); }
          gl_FragColor = vec4(col, 1.0); return;
        }
        // ---- LAND ----
        vec3 lc;
        if (uStyle < 0.5) { // realistisch
          float shade = 0.42 + 0.78*diff;
          float grain = 0.8 + 0.42*(vn(vWorld*1.6)*0.55 + vn(vWorld*6.0)*0.3);
          lc = vColor*shade*grain;
        } else {
          vec3 b = biome(vHeight);
          if (uStyle < 1.5) { // pixel: saubere Biome + Dithering + Toon
            float shade = 0.66 + 0.34*floor(diff*3.0+0.5)/3.0;
            float dth = h2(floor(vWorld*1.0));
            b *= dth > 0.62 ? 1.08 : (dth < 0.30 ? 0.90 : 1.0);
            lc = b*shade;
          } else if (uStyle < 2.5) { // voxel: Block-Look (Tops hell, Waende dunkel)
            float shade = (0.5 + 0.5*clamp(nB.z,0.0,1.0)) * (0.82 + 0.22*step(0.5, diff));
            lc = floor(b*shade*5.0+0.5)/5.0;
          } else { // cel: illustriert, sattere Farben
            float shade = diff > 0.55 ? 1.0 : (diff > 0.25 ? 0.82 : 0.64);
            lc = pow(b, vec3(0.85)) * shade;
          }
        }
        // STRAND-UEBERSCHWAPPEN: duenner nasser Sandsaum + Schaumkante, Phase raeumlich entkoppelt
        // (variiert mit Position) -> Wellen lappen lokal an Land, KEIN synchron durchlaufendes Band.
        float above = vHeight - 0.382;
        float phase = sin(uTime * 1.1 + vWorld.x * 0.11 + vWorld.y * 0.08);  // gleiche Welle wie im Wasser
        float reach = 0.012 + 0.006 * phase;                                 // wie weit die Welle hochlaeuft
        float wet = smoothstep(reach, 0.0, above);
        lc = mix(lc, lc * vec3(0.60, 0.64, 0.72), wet * 0.5);
        float foamL = smoothstep(reach, reach * 0.45, above) * (1.0 - smoothstep(reach * 0.45, 0.0, above));
        lc = mix(lc, vec3(0.90, 0.95, 0.98), clamp(foamL, 0.0, 1.0) * 0.55);
        if (uStyle > 0.5 && uStyle < 2.5) lc = floor(lc * 12.0 + 0.5) / 12.0;
        gl_FragColor = vec4(lc, 1.0);
      }`,
  });
  terrainShader = new Shader({
    glProgram,
    resources: { terr: { uTime: { value: 0, type: "f32" }, uLight: { value: new Float32Array([-0.5, -0.62, 0.6]), type: "vec3<f32>" }, uView: { value: new Float32Array([0.15, 0.20, 0.97]), type: "vec3<f32>" }, uStyle: { value: 0, type: "f32" } } },
  });
  return new Mesh({ geometry, shader: terrainShader });
}

// ── PROZEDURALE PIXEL-ART-UNITS (Palette-Swap + Layered-Parts, canvas-2D -> Pixi v8 Texture) ──
// 3 Fraktionen x 5 Typen = 15 Texturen, EINMAL beim Laden gebacken, von allen ~8000 Sprites geteilt.
// Bewährt: index-color/palette-swap Team-Farben (Pokemon/Starcraft/AoE). EIGENE Assets statt Kenney-Units.
type RGB = [number, number, number];
const hexRGB = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
function shade(h: number, t: number): RGB { // t<0 abdunkeln, t>0 aufhellen -> Hue wird zur Rampe
  let [r, g, b] = hexRGB(h);
  if (t < 0) { const k = 1 + t; r *= k; g *= k; b *= k; }
  else { r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t; }
  return [Math.round(r), Math.round(g), Math.round(b)];
}
const ramp = (base: number): RGB[] => [shade(base, -0.5), shade(base, -0.22), hexRGB(base), shade(base, 0.34)];
interface Palette { cloth: RGB[]; skin: RGB[]; metal: RGB[]; accent: RGB; }
function palette(cloth: number, skin: number, accent: number, metalBase = 0x9aa3b0): Palette {
  return { cloth: ramp(cloth), skin: ramp(skin), metal: ramp(metalBase), accent: hexRGB(accent) };
}
// 6 FRAKTIONEN mit EIGENER Identität (Palette + Körper-Profil + Kopf + Signatur) — nicht nur Recolor.
// human Argent Crown · elf Sylvan Wardens · orc Broken Tusk · undead Pale Legion · dwarf Ironbeards · giant Trollkin.
// HINWEIS: cloth ist absichtlich NEUTRAL-hell (nimmt die TEAM-Farbe als Tint sauber an, 16 Teams trennbar).
// Fraktions-Identität kommt aus Haut/Kopf/Waffe/Akzent/Haltung (skin/accent/metal bleiben fraktionsspezifisch).
const PAL: Record<string, Palette> = {
  human: palette(0xc8ccd4, 0xe6b088, 0xffcf3d, 0xc4ccd8), // neutrale Tunika + helle Haut + Gold + helles Stahl
  elf: palette(0xccd2d8, 0xe6d2b8, 0xe8d27a, 0x8c9a82),   // helle Robe + Elfenbein + Pale-Gold + Salbei-Metall
  orc: palette(0xb6bac2, 0x4e6e38, 0xb23a2a, 0x3a3d40),   // raue Felle + Moosgrün-Haut + Blut + fast-schwarzes Eisen
  undead: palette(0xacb0b8, 0x9aa890, 0x6cff8a, 0x6b7d68), // Lumpen + Knochen + Nekro-Grün + Grünspan
  dwarf: palette(0xc0c4cc, 0xb8410f, 0xd9a441, 0x7d8388), // Kittel + Kupfer-Bart(skin) + Gold + Eisen
  giant: palette(0xb2b6be, 0x7d8a72, 0x6fae4a, 0x55504a), // Lendenschurz + grau-grüner Stein + Moos + Steingrau
};
// FRAKTIONS-PROJEKTILE (Magier-Bolt + Stab-Orb + Treffer/Tod-FX): core = heller Kern, glow = Hülle/Spur.
// Auf einen Blick distinkt: Mensch gold-weiß · Elf mint · Ork rot-orange · Untot giftgrün · Zwerg bernstein · Riese grau-staub.
const FAC_PROJ: { core: number; glow: number }[] = [
  { core: 0xffffff, glow: 0xffe9a0 }, // human  (heilig)
  { core: 0xc9f58a, glow: 0x8fe39a }, // elf    (Blatt)
  { core: 0xe2795a, glow: 0xff6a4a }, // orc    (Gore)
  { core: 0xb6f0c0, glow: 0x6fe06f }, // undead (Nekro)
  { core: 0xffe08a, glow: 0xff8c2a }, // dwarf  (Glut)
  { core: 0x9aa890, glow: 0x7d8a72 }, // giant  (Stein/Staub)
];
const OUTLINE: RGB = hexRGB(0x14171f), GOLD: RGB = hexRGB(0xffd24a), GLOW: RGB = hexRGB(0x9dffb0), BONE: RGB = hexRGB(0xe8e0c8);
// 32x40-Sprites (vorher 24x28) -> deutlich mehr Detail-Raum. UCX = Mitte (gespiegelt), HIP = Bein-Ansatz,
// FOOT = Boden-Basislinie, SPLIT = Grenze Oberkörper/Beine (Oberkörper wird pro Pose um (lean,bob) verschoben).
const UW = 32, UH = 40, UCX = 16, HIP = 27, FOOT = 36, SPLIT = 27;
// ── ANIMATIONS-POSEN ── 4-Frame-Gang (0..3: Schritt/zusammen/Schritt/zusammen) + 2-Frame-Angriff
// (4 Ausholen, 5 Schlag). buildUnitAtlas backt JEDE Einheit in allen 6 Posen; renderUnits wählt nach
// Bewegung/Angriff. legL/legR = [x-Offset von UCX, Lift] je Bein; bob/lean verschieben den Oberkörper;
// arm steuert die Waffe (0 Ruhe, 0.6 Ausholen, 1 Schlag).
interface Pose { legL: [number, number]; legR: [number, number]; bob: number; arm: number; lean: number; }
const POSES: Pose[] = [
  { legL: [-3, 0], legR: [2, 2], bob: 0, arm: 0, lean: 0 },    // 0 Schritt: links vorn, rechts gehoben
  { legL: [-2, 0], legR: [1, 0], bob: -1, arm: 0, lean: 0 },   // 1 zusammen (Idle/Passing) + Hoch-Bob
  { legL: [-3, 2], legR: [2, 0], bob: 0, arm: 0, lean: 0 },    // 2 Schritt: rechts vorn, links gehoben
  { legL: [-2, 0], legR: [1, 0], bob: -1, arm: 0, lean: 0 },   // 3 zusammen
  { legL: [1, 0], legR: [4, 0], bob: -2, arm: 0.6, lean: -4 }, // 4 AUSHOLEN: weit zurücklehnen, Waffe hoch (klare Anticipation)
  { legL: [-6, 0], legR: [5, 0], bob: 3, arm: 1, lean: 5 },    // 5 SCHLAG: tiefer Ausfallschritt nach vorn, Waffe runtergeschmettert
];
let CUR: Pose = POSES[1];                 // aktuelle Pose beim Backen
const FRAMES_PER = POSES.length;          // 6 Frames/Einheit
interface Pen { m: (x: number, y: number, c: RGB) => void; r: (x: number, y: number, c: RGB) => void; }
function makePen(buf: (RGB | 0)[]): Pen {
  const set = (x: number, y: number, c: RGB): void => { if (x >= 0 && x < UW && y >= 0 && y < UH) buf[y * UW + x] = c; };
  const m = (x: number, y: number, c: RGB): void => { set(x, y, c); set(UW - 1 - x, y, c); }; // gespiegelt -> Körper-Symmetrie
  return { m, r: set }; // r = roh (asymmetrische Waffen/Beine)
}
function rline(p: Pen, x0: number, y0: number, x1: number, y1: number, c: RGB): void { // Bresenham (Klingen/Schäfte)
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy;
  for (;;) { p.r(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += sx; } if (e2 < dx) { err += dx; y0 += sy; } }
}
// ── BEINE (asymmetrisch -> echter Gang) ──
function drawLeg(p: Pen, P: Palette, x: number, topY: number, lift: number, thick: number): void {
  for (let y = topY + lift; y <= FOOT; y++) for (let k = 0; k < thick; k++) p.r(x + k, y, k === 0 ? P.cloth[0] : P.cloth[1]);
  for (let k = 0; k < thick; k++) p.r(x + k, FOOT, k === thick - 1 ? P.accent : OUTLINE); // Stiefel
}
function drawLegs(p: Pen, P: Palette, leg: string, fy: number): void {
  const hy = HIP + fy, stub = leg === "stub", wide = leg === "wide";
  const spread = wide ? 1 : 0, thick = stub ? 3 : 2, top = hy + (stub ? 3 : 0);
  drawLeg(p, P, UCX + CUR.legL[0] - spread, top, CUR.legL[1], thick);
  drawLeg(p, P, UCX + CUR.legR[0] + spread, top, CUR.legR[1], thick);
}
// ── WAFFEN-POSEN (per CUR.arm) ──
function drawSword(p: Pen, P: Palette, hx: number, hy: number, len = 11): void { // Hieb-Schwert: Ruhe/Ausholen/Schlag
  const a = CUR.arm; let tx: number, ty: number;
  if (a >= 0.9) { tx = hx + len - 4; ty = hy + len - 2; }        // Schlag: nach vorn-unten
  else if (a >= 0.4) { tx = hx - 3; ty = hy - len + 1; }         // Ausholen: hoch-zurück
  else { tx = hx + 2; ty = hy - len; }                          // Ruhe: senkrecht
  rline(p, hx, hy, tx, ty, P.metal[3]); rline(p, hx + (tx - hx >> 2), hy + (ty - hy >> 2), tx, ty, P.metal[2]);
  p.r(hx - 1, hy, GOLD); p.r(hx, hy, GOLD); p.r(hx + 1, hy, P.metal[1]); p.r(hx, hy + 1, P.cloth[0]); // Parier + Griff
}
function drawSpearWeapon(p: Pen, P: Palette): void {
  if (CUR.arm >= 0.9) { for (let x = UCX + 1; x <= UW - 1; x++) p.r(x, 19, P.cloth[0]); p.r(UW - 1, 18, P.metal[3]); p.r(UW - 1, 19, P.metal[3]); p.r(UW - 1, 20, P.metal[3]); p.r(UW - 2, 19, P.accent); } // Stoß horizontal
  else { for (let y = 3; y <= 26; y++) p.r(UW - 8, y, P.cloth[0]); p.r(UW - 8, 1, P.metal[3]); p.r(UW - 8, 2, P.metal[3]); p.r(UW - 9, 3, P.accent); p.r(UW - 7, 3, P.accent); } // aufrecht
}
// ── FRAKTIONS-NAHWAFFEN (eigene Silhouette + Schwung per CUR.arm) ── Mensch Schwert · Ork Hackbeil · Elf Glefe · Zwerg Axt · Riese Keule.
type Wpn = (p: Pen, P: Palette, hx: number, hy: number) => void;
function swingTip(hx: number, hy: number, reach: number): [number, number] {
  const a = CUR.arm;
  if (a >= 0.9) return [hx + reach, hy + reach - 3];               // Schlag: weit vor-unten
  if (a >= 0.4) return [hx - (reach >> 1), hy - reach];            // Ausholen: hoch-zurück
  return [hx + 2, hy - reach + 1];                                 // Ruhe: senkrecht
}
function wpnCleaver(p: Pen, P: Palette, hx: number, hy: number): void { // Ork: grobes, gezacktes Hackbeil — primitiv+gefährlich
  const [tx, ty] = swingTip(hx, hy, 9);
  rline(p, hx, hy, tx, ty, hexRGB(0x5a3a1e));                       // Holzstiel
  for (let oy = -2; oy <= 2; oy++) for (let ox = -1; ox <= 2; ox++) if (Math.abs(oy) + Math.max(0, ox) <= 3) p.r(tx + ox, ty + oy, ox >= 1 ? P.metal[0] : P.metal[2]); // breites Blatt
  p.r(tx + 2, ty - 2, P.metal[3]); p.r(tx + 1, ty + 2, P.metal[3]); p.r(hx, hy, BONE);   // Zacken + Knochengriff
}
function wpnAxe(p: Pen, P: Palette, hx: number, hy: number): void { // Zwerg: stämmige Bergbau-Axt/Pickel
  const [tx, ty] = swingTip(hx, hy, 8);
  rline(p, hx, hy, tx, ty, hexRGB(0x5a3a1e));
  for (let oy = -2; oy <= 2; oy++) p.r(tx, ty + oy, P.metal[1]);
  p.r(tx + 1, ty - 2, P.metal[3]); p.r(tx + 1, ty + 2, P.metal[3]); p.r(tx + 2, ty, P.metal[2]); p.r(tx - 2, ty, P.metal[2]); // Doppelklinge/Pickelseite
}
function wpnGlaive(p: Pen, P: Palette, hx: number, hy: number): void { // Elf: elegante, glühende Glefe — majestätisch/mystisch
  const [tx, ty] = swingTip(hx, hy, 14);
  rline(p, hx, hy, tx, ty, P.cloth[1]);                            // schlanker Schaft
  const cx = tx + (tx > hx ? 1 : -1), cy = ty - 2;
  rline(p, tx, ty - 1, cx, cy, P.accent); p.r(tx, ty, GLOW); p.r(cx, cy, P.metal[3]); p.r(hx, hy, P.accent); // geschwungene Klinge + Glüh-Akzente
}
function wpnClub(p: Pen, P: Palette, hx: number, hy: number): void { // Riese: massive Knüppelkeule — dumm+wuchtig
  const [tx, ty] = swingTip(hx, hy, 10);
  rline(p, hx, hy, tx, ty, hexRGB(0x6a4a28)); rline(p, hx + 1, hy, tx + 1, ty, hexRGB(0x4a3018));
  for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) if (ox * ox + oy * oy <= 9) p.r(tx + ox, ty + oy, (ox + oy) & 1 ? hexRGB(0x7a5a38) : hexRGB(0x5a4128)); // dicker Kopf
  p.r(tx - 2, ty - 1, BONE); p.r(tx + 2, ty + 1, BONE);            // eingeschlagene Knochen
}
// ── KÖPFE (kompletter Kopf pro Fraktion — stärkster Silhouetten-Tell), Kopfzone y≈4..15 ──
function headHelmed(p: Pen, P: Palette): void { // Mensch: gewölbter Stahlhelm + Visier + Nasenbügel + Feder
  for (let y = 6; y <= 12; y++) for (let x = UCX - 2; x <= UCX; x++) p.m(x, y, P.metal[1]);           // Helm-Kuppe (mittleres Stahl, nicht weiß)
  p.m(UCX - 1, 5, P.metal[1]);                                                                        // runde Oberkante (schmaler -> kein Block)
  for (let x = UCX - 2; x <= UCX; x++) p.m(x, 6, P.metal[2]); p.m(UCX - 2, 8, P.metal[2]);            // Stirnband + Glanzkante
  p.m(UCX, 9, P.metal[0]); p.m(UCX, 10, P.metal[0]); p.m(UCX, 11, P.metal[0]);                        // Nasenbügel (dunkel, mittig)
  p.r(UCX - 1, 10, OUTLINE); p.m(UCX - 2, 10, P.skin[2]); p.m(UCX - 2, 11, P.skin[2]);                // Augenschlitz + Wange
  p.r(UCX - 2, 4, P.accent); p.r(UCX - 2, 3, P.accent); p.r(UCX - 1, 3, P.accent);                    // Gold-Feder
}
function headEared(p: Pen, P: Palette): void { // Elf: spitze Kapuze + leuchtende Stirn-Gemme + langes Ohr — majestätisch/mystisch
  for (let y = 5; y <= 8; y++) for (let x = UCX - 2; x <= UCX; x++) p.m(x, y, P.cloth[1]);
  p.m(UCX - 1, 3, P.cloth[1]); p.m(UCX - 1, 4, P.cloth[2]);                                           // Kapuzenspitze
  p.r(UCX, 8, GLOW); p.r(UCX - 1, 8, P.accent);                                                       // leuchtende Stirn-Gemme (Zirkel)
  for (let y = 9; y <= 13; y++) for (let x = UCX - 1; x <= UCX; x++) p.m(x, y, P.skin[2]);
  p.r(UCX - 1, 11, OUTLINE); p.r(UCX - 1, 10, P.accent);                                              // Auge
  p.r(UCX - 3, 10, P.skin[2]); p.r(UCX - 4, 11, P.skin[3]); p.r(UCX - 4, 12, P.skin[2]);              // langes spitzes Ohr
}
function headTusked(p: Pen, P: Palette): void { // Ork: grüner Kopf + Hauer + Kriegsbemalung
  for (let y = 6; y <= 14; y++) for (let x = UCX - 3; x <= UCX; x++) p.m(x, y, P.skin[2]);
  for (let x = UCX - 3; x <= UCX; x++) p.m(x, 6, P.skin[1]);                                          // Stirn-Schatten
  p.r(UCX - 1, 10, OUTLINE); p.r(UCX, 10, OUTLINE); p.r(UCX - 1, 9, hexRGB(0xffe14a));                // böse Augen
  p.m(UCX - 2, 14, BONE); p.m(UCX - 2, 13, BONE);                                                     // Hauer
  p.r(UCX - 3, 8, hexRGB(0xb23a2a)); p.r(UCX + 2, 8, hexRGB(0xb23a2a));                               // Kriegsbemalung
}
function headSkull(p: Pen, P: Palette): void { // Untot: Schädel + grün glühende Augen + Kiefer
  for (let y = 6; y <= 13; y++) for (let x = UCX - 3; x <= UCX; x++) p.m(x, y, P.skin[3]);
  p.r(UCX - 2, 10, GLOW); p.r(UCX + 1, 10, GLOW); p.r(UCX - 2, 9, hexRGB(0x2a6e3a)); p.r(UCX + 1, 9, hexRGB(0x2a6e3a)); // glühende Augenhöhlen
  p.r(UCX - 1, 12, OUTLINE); p.r(UCX, 12, OUTLINE); p.m(UCX - 2, 13, P.skin[2]); p.m(UCX - 1, 13, P.skin[2]);          // Kiefer/Zähne
}
function headBearded(p: Pen, P: Palette): void { // Zwerg: Bergbau-Helm mit Grubenlampe + großer Bart-Block
  for (let x = UCX - 3; x <= UCX; x++) { p.m(x, 5, P.metal[1]); p.m(x, 6, P.metal[2]); p.m(x, 7, P.metal[2]); }
  p.r(UCX - 1, 4, hexRGB(0xfff2a0)); p.r(UCX, 4, hexRGB(0xffd24a)); p.r(UCX - 1, 3, hexRGB(0xffe9a0));  // GRUBENLAMPE (leuchtet) auf der Stirn
  p.m(UCX - 2, 9, hexRGB(0xcaa07a)); p.r(UCX - 1, 9, OUTLINE); p.r(UCX, 9, OUTLINE);                  // Augenstreif
  for (let y = 10; y <= 16; y++) for (let x = UCX - 4; x <= UCX; x++) p.m(x, y, P.skin[2]);           // dicker Bart-Block (bis fast zum Gürtel)
  p.m(UCX - 3, 11, P.skin[0]); p.m(UCX - 2, 14, P.skin[0]); p.m(UCX - 4, 13, P.skin[1]); p.m(UCX - 3, 16, P.skin[0]); // Bart-Strähnen
}
function headTiny(p: Pen, P: Palette): void { // Riese: kleiner Kopf tief zwischen Schultern + Unterbiss
  for (let y = 9; y <= 12; y++) for (let x = UCX - 2; x <= UCX; x++) p.m(x, y, P.skin[2]);
  p.r(UCX - 1, 10, OUTLINE); p.r(UCX, 10, OUTLINE); p.m(UCX - 1, 12, BONE);                            // Augen + Unterbiss-Hauer
  p.m(UCX - 2, 9, P.skin[1]);
}
// ── SIGNATUR-FEATURES (Telegraf-Details pro Fraktion) ──
function sigHuman(p: Pen, P: Palette): void { for (let y = 17; y <= 25; y++) p.m(UCX, y, P.accent); p.m(UCX, 19, GOLD); p.m(UCX, 23, GOLD); } // Gold-Wappenstreif
function sigElf(p: Pen, P: Palette): void { for (let y = 9; y <= 16; y++) p.r(8, y, P.accent); p.r(7, 9, P.cloth[3]); p.r(7, 10, P.cloth[3]); } // Köcher am Rücken
function sigOrc(p: Pen, P: Palette): void { p.m(UCX - 5, 17, P.metal[3]); p.m(UCX - 5, 18, P.metal[2]); p.r(UCX + 4, 16, BONE); p.r(UCX + 4, 17, BONE); } // Schulterstacheln
function sigUndead(p: Pen, P: Palette): void { for (let y = 18; y <= 25; y += 2) { p.m(UCX - 3, y, P.skin[3]); p.m(UCX - 2, y, P.skin[2]); } } // freiliegende Rippen
function sigDwarf(p: Pen, P: Palette): void { p.m(UCX, HIP - 2, GOLD); p.m(UCX - 2, HIP - 2, P.accent); } // Gürtelschnalle/Runen
function sigGiant(p: Pen, P: Palette): void { for (let y = 18; y <= 27; y++) p.r(UW - 4, y, P.skin[2]); p.r(UW - 3, 27, P.skin[1]); p.r(UW - 4, 27, P.skin[1]); p.m(UCX - 5, 14, hexRGB(0x6fae4a)); } // langer Schlepp-Arm + Moos
interface Prof { pal: Palette; w: number; scale: number; tt: number; fy: number; leg: string; hunch: number; head: (p: Pen, P: Palette) => void; melee: Wpn; sig: (p: Pen, P: Palette) => void; proj: { core: number; glow: number }; hp: number; spd: number; dmg: number; }
function drawBody(p: Pen, P: Palette, bodyW: number, torsoTop: number, leg: string, fy: number): void {
  const halfMax = bodyW >> 1, btm = HIP - 1 + fy, hgt = Math.max(1, btm - torsoTop);
  for (let y = torsoTop; y <= btm; y++) {                                                 // Torso: oben Ecke gerundet (kein Klotz), oben hell = Volumen
    const t = (y - torsoTop) / hgt;
    const half = t < 0.08 ? halfMax - 1 : halfMax;                                        // nur obere Kante runden -> entkastet, ohne Glocke
    const si = t < 0.20 ? 3 : t < 0.55 ? 2 : 1;
    for (let x = UCX - half; x <= UCX + half; x++) p.m(x, y, x === UCX - half || x === UCX + half ? P.cloth[0] : P.cloth[si]);
  }
  const beltHalf = Math.max(1, halfMax - 1);
  for (let x = UCX - beltHalf; x <= UCX + beltHalf; x++) p.m(x, btm, P.accent);           // Gürtel (maskiert Bein-Übergang)
  drawLegs(p, P, leg, fy);
}
function drawWarrior(p: Pen, pr: Prof): void {
  const P = pr.pal; drawBody(p, P, 9 + pr.w, 16 + pr.tt, pr.leg, pr.fy); pr.head(p, P);
  for (let y = 18; y <= 26; y++) for (let x = 5; x <= 8; x++) p.r(x, y, x === 5 ? P.accent : x === 8 ? P.metal[0] : P.metal[1]); // Rundschild links
  p.r(7, 22, P.metal[3]); p.r(6, 20, P.metal[3]);                                          // Schild-Buckel
  pr.melee(p, P, UW - 9, 18); pr.sig(p, P);
}
function drawArcher(p: Pen, pr: Prof): void {
  const P = pr.pal; drawBody(p, P, 8 + pr.w, 16 + pr.tt, pr.leg, pr.fy); pr.head(p, P);
  const bx = UW - 6, wood = P.cloth[0], a = CUR.arm;
  const arc: [number, number][] = [[bx - 1, 7], [bx, 8], [bx + 1, 10], [bx + 1, 13], [bx + 1, 16], [bx, 19], [bx - 1, 21]];
  for (const [x, y] of arc) { p.r(x, y, wood); p.r(x, y + 1, shade(0x6a4a2a, -0.1)); }
  if (a >= 0.4) { rline(p, bx, 8, bx - 4, 14, P.skin[3]); rline(p, bx - 4, 14, bx, 21, P.skin[3]); for (let x = UCX + 1; x <= bx - 3; x++) p.r(x, 14, P.metal[2]); p.r(UCX, 14, P.accent); } // gespannte Sehne + Pfeil
  else for (let y = 8; y <= 20; y++) p.r(bx + 1, y, shade(0xcfd6e0, -0.05)); // entspannte Sehne
  pr.sig(p, P);
}
function drawSpearman(p: Pen, pr: Prof): void {
  const P = pr.pal; drawBody(p, P, 8 + pr.w, 16 + pr.tt, pr.leg, pr.fy); pr.head(p, P);
  drawSpearWeapon(p, P); pr.sig(p, P);
}
function drawBrute(p: Pen, pr: Prof): void {
  const P = pr.pal; drawBody(p, P, 12 + pr.w, 15 + pr.tt, pr.leg, pr.fy); pr.head(p, P);
  for (let y = 15; y <= 24; y++) p.m(UCX - 6, y, P.cloth[1]); p.m(UCX - 6, 16, P.cloth[2]);            // wuchtige Schultern
  const hx = UW - 6, hy = 20;                                                                           // Keule rechts
  if (CUR.arm >= 0.9) { for (let y = hy; y <= hy + 8; y++) for (let x = UW - 6; x <= UW - 2; x++) p.r(x, y, P.cloth[0]); for (let x = UW - 6; x <= UW - 2; x++) { p.r(x, hy + 8, P.metal[2]); p.r(x, hy + 9, P.metal[1]); } }
  else { for (let y = 6; y <= hy; y++) p.r(hx, y, P.cloth[0]); for (let y = 4; y <= 9; y++) for (let x = UW - 4; x <= UW - 1; x++) p.r(x, y, P.metal[2]); p.r(UW - 1, 5, P.metal[3]); p.r(UW - 1, 8, P.metal[3]); }
  pr.sig(p, P);
}
function drawKing(p: Pen, pr: Prof): void {
  const P = pr.pal; drawBody(p, P, 11 + pr.w, 15 + pr.tt, pr.leg, pr.fy); pr.head(p, P);
  for (let y = 16; y <= 30; y++) { p.r(UCX - 7, y, P.accent); p.r(UCX - 8, y, shade(0xd8b34a, -0.4)); }  // wallender Umhang
  for (let x = UCX - 3; x <= UCX + 2; x++) p.m(x, 1, GOLD); p.r(UCX - 3, 0, GOLD); p.r(UCX - 1, 0, GOLD); p.r(UCX + 1, 0, GOLD); // Krone
  pr.melee(p, P, UW - 9, 18); p.r(UW - 9, 6, GOLD); pr.sig(p, P);                                        // Königswaffe (Fraktion)
}
function drawChampion(p: Pen, pr: Prof): void {
  const P = pr.pal; drawBody(p, P, 12 + pr.w, 14 + pr.tt, pr.leg, pr.fy); pr.head(p, P);
  for (let y = 13; y <= 18; y++) { p.m(UCX - 6, y, GOLD); p.m(UCX - 5, y, P.metal[3]); }                 // Gold-Pauldrons
  pr.melee(p, P, UW - 8, 17); p.r(UW - 8, 2, GOLD); pr.sig(p, P);                                         // Champion-Waffe (Fraktion)
}
function drawMage(p: Pen, pr: Prof): void { // Magier: Kapuze/Kopf + langes Gewand (statt Beinen) + Stab mit Glüh-Orb (Fraktionsfarbe)
  const P = pr.pal, top = 16 + pr.tt, hipY = HIP - 1 + pr.fy;
  for (let y = top; y <= hipY; y++) for (let x = UCX - 3; x <= UCX + 3; x++) p.m(x, y, x <= UCX - 2 ? P.cloth[0] : x <= UCX ? P.cloth[2] : P.cloth[1]); // Oberkörper-Robe
  for (let y = HIP + pr.fy; y <= FOOT; y++) { const w = Math.min(8, 3 + ((y - HIP - pr.fy) >> 1)); for (let x = UCX - w; x <= UCX + w; x++) p.m(x, y, x === UCX - w || x === UCX + w ? P.cloth[0] : (x + y) & 1 ? P.cloth[1] : P.cloth[2]); } // ausgestelltes Gewand bis zum Boden
  for (let x = UCX - 3; x <= UCX + 3; x++) p.m(x, hipY, P.accent);                                       // Gürtel
  pr.head(p, P);
  const sx = UW - 7, core = hexRGB(pr.proj.core), glow = hexRGB(pr.proj.glow);                            // Stab + Glüh-Orb
  for (let y = 6; y <= FOOT - 1; y++) p.r(sx, y, shade(0x6a4a2a, -0.05));
  p.r(sx, 4, glow); p.r(sx - 1, 4, glow); p.r(sx + 1, 4, glow); p.r(sx, 3, glow); p.r(sx, 5, glow); p.r(sx, 4, core); // Orb leuchtet
  pr.sig(p, P);
}
const DRAW: Record<string, (p: Pen, pr: Prof) => void> = { warrior: drawWarrior, archer: drawArcher, spearman: drawSpearman, brute: drawBrute, king: drawKing, champion: drawChampion, mage: drawMage };
const PROF: Record<string, Prof> = {
  // hunch = permanenter Oberkörper-Vorbeug (Silhouette): Ork/Riese gebeugt+roh, Mensch/Elf aufrecht. melee = Fraktionswaffe.
  human: { pal: PAL.human, w: 0, scale: 1.0, tt: 0, fy: 0, leg: "normal", hunch: 0, head: headHelmed, melee: drawSword, sig: sigHuman, proj: FAC_PROJ[0], hp: 1.1, spd: 0.9, dmg: 1.1 },
  elf: { pal: PAL.elf, w: -1, scale: 1.04, tt: -2, fy: 0, leg: "normal", hunch: 0, head: headEared, melee: wpnGlaive, sig: sigElf, proj: FAC_PROJ[1], hp: 0.9, spd: 1.15, dmg: 1.05 }, // schlank+hochgewachsen
  orc: { pal: PAL.orc, w: 3, scale: 1.06, tt: 2, fy: 0, leg: "wide", hunch: 3, head: headTusked, melee: wpnCleaver, sig: sigOrc, proj: FAC_PROJ[2], hp: 1.15, spd: 0.9, dmg: 1.1 }, // breit+gebeugt
  undead: { pal: PAL.undead, w: -2, scale: 0.92, tt: 0, fy: 0, leg: "normal", hunch: 1, head: headSkull, melee: drawSword, sig: sigUndead, proj: FAC_PROJ[3], hp: 0.85, spd: 1.0, dmg: 0.9 },
  dwarf: { pal: PAL.dwarf, w: 5, scale: 0.8, tt: 4, fy: -5, leg: "wide", hunch: 0, head: headBearded, melee: wpnAxe, sig: sigDwarf, proj: FAC_PROJ[4], hp: 1.15, spd: 0.88, dmg: 1.12 }, // klein+gedrungen
  giant: { pal: PAL.giant, w: 6, scale: 1.22, tt: -3, fy: 0, leg: "wide", hunch: 2, head: headTiny, melee: wpnClub, sig: sigGiant, proj: FAC_PROJ[5], hp: 1.15, spd: 0.85, dmg: 1.12 }, // Hüne: breite Schultern (tt -3 -> Kopf sinkt ein), planted Stand, Keule
};
// Eine Zelle (Fraktion x Typ x Pose) als roher (RGB|0)[]-Puffer: zeichnen -> Oberkörper um (lean,bob)
// verschieben -> Rim-Light (obere Kanten) -> 1px-Outline -> Boden-Schatten.
function renderUnitCell(faction: string, type: string): (RGB | 0)[] {
  let buf: (RGB | 0)[] = new Array(UW * UH).fill(0);
  DRAW[type](makePen(buf), PROF[faction]);
  const lean = CUR.lean + PROF[faction].hunch, bob = CUR.bob;                              // hunch = dauerhafter Vorbeug (Silhouette)
  if (lean || bob) {                                                                       // Oberkörper (rows<SPLIT) translatieren
    const sh: (RGB | 0)[] = new Array(UW * UH).fill(0);
    for (let y = 0; y < UH; y++) for (let x = 0; x < UW; x++) {
      const c = buf[y * UW + x]; if (c === 0) continue;
      if (y < SPLIT) { const nx = x + lean, ny = y + bob; if (nx >= 0 && nx < UW && ny >= 0 && ny < UH) sh[ny * UW + nx] = c; }
      else sh[y * UW + x] = c;
    }
    buf = sh;
  }
  const out = buf.slice();
  for (let y = 1; y < UH; y++) for (let x = 0; x < UW; x++) {                              // Rim-Light: obere Kante aufhellen
    const i = y * UW + x, c = buf[i]; if (c === 0) continue;
    if (buf[(y - 1) * UW + x] === 0) out[i] = [Math.min(255, c[0] + 30), Math.min(255, c[1] + 30), Math.min(255, c[2] + 26)];
  }
  const filled = (i: number): boolean => i >= 0 && i < buf.length && buf[i] !== 0;
  for (let y = 0; y < UH; y++) for (let x = 0; x < UW; x++) {                              // 1px Outline-Pass
    const i = y * UW + x; if (buf[i] !== 0) continue;
    if ((x > 0 && filled(i - 1)) || (x < UW - 1 && filled(i + 1)) || (y > 0 && filled(i - UW)) || (y < UH - 1 && filled(i + UW))) out[i] = OUTLINE;
  }
  const shadow: [number, number, number][] = [[UCX - 5, 37, 11], [UCX - 3, 38, 7]];        // weicher Boden-Schatten (Ellipse)
  for (const [sx, sy, sw] of shadow) for (let x = sx; x < sx + sw; x++) { const i = sy * UW + x; if (out[i] === 0) out[i] = shade(0x0c0e14, 0.14); }
  return out;
}
// ATLAS: 6 Fraktionen x 6 Typen x 6 Posen = 216 Zellen auf EINE TextureSource -> ParticleContainer
// zeichnet ALLE Units in EINEM Draw-Call. GRID-Layout (statt einer 6900px-Reihe -> unter GPU-Textur-Limit).
// Frame-Index uf = (fac*6 + type)*6 + pose; Spalte = uf%COLS, Zeile = uf/COLS. Deko folgt in eigener Reihe.
const FAC_ORDER = ["human", "elf", "orc", "undead", "dwarf", "giant"] as const;
const TY_ORDER = ["warrior", "archer", "spearman", "brute", "king", "champion", "mage"] as const;
const UNIT_FRAMES = FAC_ORDER.length * TY_ORDER.length * FRAMES_PER; // 216 Unit-Zellen, danach Deko-Frames
const unitFrame = (f: number, ty: number, pose: number): number => (f * TY_ORDER.length + ty) * FRAMES_PER + pose;
const ATLAS_COLS = 32;                                              // 32*32 = 1024px breit
const ATLAS_ROWS = Math.ceil(UNIT_FRAMES / ATLAS_COLS);            // 7 Zeilen
// Atlas: Unit-Grid oben + Deko (Bäume/Steine/Gebäude) in einer Reihe darunter -> Deko sortiert IM SELBEN
// Counting-Sort wie die Units (globale Z-Regel: tiefer im Bild = vorne gilt auch für Deko<->Units).
function buildUnitAtlas(decor: { tex: Texture }[]): Texture[] {
  // Deko in NATIVER Auflösung backen (volle Qualität); Größe kommt per Particle-scale (DECOR_SCALE).
  const dW = decor.map((dd) => Math.max(1, Math.round(dd.tex.width))), dH = decor.map((dd) => Math.max(1, Math.round(dd.tex.height)));
  const gridW = ATLAS_COLS * UW, gridH = ATLAS_ROWS * UH;
  const decorRowW = dW.reduce((a, b) => a + b, 0), decorH = Math.max(1, ...dH);
  const AW = Math.max(gridW, decorRowW), AH = gridH + decorH;
  const cv = document.createElement("canvas"); cv.width = AW; cv.height = AH;
  const ctx = cv.getContext("2d")!; ctx.imageSmoothingEnabled = false;
  const img = ctx.createImageData(gridW, gridH), d = img.data;
  for (let f = 0; f < FAC_ORDER.length; f++) for (let t = 0; t < TY_ORDER.length; t++) for (let pose = 0; pose < FRAMES_PER; pose++) {
    CUR = POSES[pose];
    const cell = renderUnitCell(FAC_ORDER[f], TY_ORDER[t]);
    const uf = unitFrame(f, t, pose), ox = (uf % ATLAS_COLS) * UW, oy = ((uf / ATLAS_COLS) | 0) * UH;
    for (let y = 0; y < UH; y++) for (let x = 0; x < UW; x++) {
      const c = cell[y * UW + x]; if (c === 0) continue;
      const o = ((oy + y) * gridW + ox + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0); // Units als ImageData; Deko danach per drawImage in die Reihe darunter
  const decorRect: Rectangle[] = [];
  let dx = 0;
  for (let j = 0; j < decor.length; j++) { ctx.drawImage(decor[j].tex.source.resource as CanvasImageSource, dx, gridH, dW[j], dH[j]); decorRect.push(new Rectangle(dx, gridH, dW[j], dH[j])); dx += dW[j]; }
  const src = Texture.from(cv).source; src.scaleMode = "nearest";
  const frames: Texture[] = [];
  for (let uf = 0; uf < UNIT_FRAMES; uf++) frames.push(new Texture({ source: src, frame: new Rectangle((uf % ATLAS_COLS) * UW, ((uf / ATLAS_COLS) | 0) * UH, UW, UH) }));
  for (const r of decorRect) frames.push(new Texture({ source: src, frame: r }));
  return frames; // 0..215 Units (unitFrame(f,ty,pose)), 216+ Deko
}

// ── AUDIO ─────────────────────────────────────────────────────────────────────────────────────
// Sounds aus dem Original (legacy/public/assets/audiosfx + music). HTMLAudioElement-POOLS statt
// new Audio() pro Event -> kein GC-Sturm bei Massenkämpfen. Pro Sound: mehrere Varianten (rotieren),
// Throttle (min. Abstand) + DISTANZ-GATE (nur nahe der Kamera hörbar, mit Falloff). Lautstärke
// Master/Musik/SFX in localStorage; Browser-Autoplay erst nach der ersten User-Geste (start()).
const A_ENC = (s: string): string => s.split("/").map((seg) => encodeURIComponent(seg)).join("/");
const SND = {
  music: ["/assets/music/Theme Music.mp3"],
  ambient: ["/assets/audiosfx/Medieval Fight Ambient Dynamic Sound/MedievalFightAmbientLoop.mp3"],
  arrow: [1, 2, 3, 4].map((n) => `/assets/audiosfx/Attack/Arrow Shot/Arrow Shot ${n}.mp3`),
  melee: [1, 2, 3].map((n) => `/assets/audiosfx/Attack/Melee/Mellee metalic ${n}.mp3`),
  collapse: [1, 2].map((n) => `/assets/audiosfx/Building Colapse/Building Cilapse ${n}.mp3`),
  death_human: [1, 2, 3, 4].map((n) => `/assets/audiosfx/Dieing/Humans/DieSound ${n}.mp3`),
  death_elf: [1, 2, 3].map((n) => `/assets/audiosfx/Dieing/Elfs/ElfsDie ${n}.mp3`),
  death_orc: [1, 2, 3].map((n) => `/assets/audiosfx/Dieing/Orcs/OrcDie ${n}.mp3`),
  footstep: ["/assets/audiosfx/StepSound/Stepsound.mp3"],
  ui: ["/assets/kenney/ui-pack/Sounds/click-a.ogg"],
} as const;
// Fraktion (0..5) -> Todes-Sound. Nur Human/Elf/Orc-Sets vorhanden -> Untot=Elf-Wehklage, Zwerg=Human, Riese=Orc.
const DEATH_SND = ["death_human", "death_elf", "death_orc", "death_elf", "death_human", "death_orc"] as const;
interface SoundDef { gap: number; vol: number; }
class AudioManager {
  started = false; muted = false;
  master = 0.8; music = 0.5; sfx = 0.65;
  lx = 0; ly = 0;                                   // Listener (Kamera-Ziel) in Grid-Koordinaten
  private hearR = 180;
  private falloff = 55;
  private hearR2 = this.hearR * this.hearR;
  private falloff2 = this.falloff * this.falloff;
  private musicEl: HTMLAudioElement;
  private ambientEl: HTMLAudioElement;
  private wantAmbient = false;
  private pools: Record<string, HTMLAudioElement[]> = {};
  private rr: Record<string, number> = {};
  private last: Record<string, number> = {};
  private def: Record<string, SoundDef> = {
    arrow: { gap: 45, vol: 0.45 }, melee: { gap: 40, vol: 0.3 }, collapse: { gap: 120, vol: 0.9 }, // Schwerthieb leiser (war zu dominant)
    death_human: { gap: 60, vol: 0.5 }, death_elf: { gap: 60, vol: 0.5 }, death_orc: { gap: 60, vol: 0.5 },
    footstep: { gap: 240, vol: 0.4 }, ui: { gap: 30, vol: 0.7 },
  };
  private actx: AudioContext | null = null;          // WebAudio nur für prozedurale Magie-Sounds (es gibt keine Magie-Dateien)
  private magicLast = -1e9;
  constructor() {
    try { const s = JSON.parse(localStorage.getItem("hordeio_audio") || "{}"); if (typeof s.master === "number") this.master = s.master; if (typeof s.music === "number") this.music = s.music; if (typeof s.sfx === "number") this.sfx = s.sfx; if (typeof s.muted === "boolean") this.muted = s.muted; } catch { /* defaults */ }
    this.musicEl = new Audio(A_ENC(SND.music[0])); this.musicEl.loop = true; this.musicEl.preload = "auto";
    this.ambientEl = new Audio(A_ENC(SND.ambient[0])); this.ambientEl.loop = true; this.ambientEl.preload = "auto";
    const POOL = 6;
    for (const [name, urls] of Object.entries(SND)) {
      if (name === "music" || name === "ambient") continue;
      const enc = (urls as readonly string[]).map(A_ENC);
      const arr: HTMLAudioElement[] = [];
      for (let i = 0; i < Math.max(POOL, enc.length); i++) { const a = new Audio(enc[i % enc.length]); a.preload = "auto"; arr.push(a); }
      this.pools[name] = arr; this.rr[name] = 0; this.last[name] = -1e9;
    }
    this.applyVolumes();
  }
  private applyVolumes(): void {
    this.musicEl.volume = this.muted ? 0 : this.master * this.music;
    this.ambientEl.volume = this.muted ? 0 : this.master * this.sfx * 0.6;
    try { localStorage.setItem("hordeio_audio", JSON.stringify({ master: this.master, music: this.music, sfx: this.sfx, muted: this.muted })); } catch { /* ignore */ }
  }
  setVolumes(v: { master?: number; music?: number; sfx?: number; muted?: boolean }): void {
    if (v.master !== undefined) this.master = v.master; if (v.music !== undefined) this.music = v.music;
    if (v.sfx !== undefined) this.sfx = v.sfx; if (v.muted !== undefined) this.muted = v.muted;
    this.applyVolumes();
    if (this.started) { if (!this.muted && this.musicEl.paused) this.musicEl.play().catch(() => {}); this.syncAmbient(); }
  }
  start(): void { // erste User-Geste -> Musik darf starten (Autoplay-Policy)
    if (this.started) return; this.started = true;
    if (!this.muted) this.musicEl.play().catch(() => {});
    this.syncAmbient();
  }
  setAmbient(on: boolean): void { this.wantAmbient = on; this.syncAmbient(); }
  private syncAmbient(): void {
    if (!this.started) return;
    if (this.wantAmbient && !this.muted) { if (this.ambientEl.paused) this.ambientEl.play().catch(() => {}); }
    else if (!this.ambientEl.paused) this.ambientEl.pause();
  }
  setListener(gx: number, gy: number): void { this.lx = gx; this.ly = gy; }
  play(name: string, gx?: number, gy?: number, volScale = 1): void {
    if (!this.started || this.muted) return;
    const d = this.def[name]; if (!d) return;
    let v = this.master * this.sfx * d.vol * volScale;
    if (gx !== undefined && gy !== undefined) {
      const dx = gx - this.lx, dy = gy - this.ly, d2 = dx * dx + dy * dy;
      if (d2 > this.hearR2) return;                                            // außer Reichweite -> billigster Reject (kein now())
      if (d2 > this.falloff2) v *= 1 - (Math.sqrt(d2) - this.falloff) / (this.hearR - this.falloff);
    }
    if (v < 0.02) return;
    const now = performance.now();
    if (now - this.last[name] < d.gap) return;                                 // Throttle
    this.last[name] = now;
    const pool = this.pools[name]; const i = this.rr[name] = (this.rr[name] + 1) % pool.length;
    const el = pool[i];
    el.playbackRate = 0.9 + Math.random() * 0.2;       // Tempo/Pitch leicht variieren -> nicht 100x exakt derselbe Sound
    el.volume = v > 1 ? 1 : v; el.currentTime = 0; el.play().catch(() => {});
  }
  private ensureCtx(): AudioContext | null {
    if (!this.actx) { try { this.actx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); } catch { return null; } }
    if (this.actx.state === "suspended") this.actx.resume().catch(() => {});
    return this.actx;
  }
  // PROZEDURALE MAGIE: kurzer abfallender Ton (Oszillator-Sweep), Grundfrequenz je Fraktion + Zufalls-Variation.
  // Distanz-Gate + Throttle wie SFX. Riese tief/grollend, Elf hell/schimmernd, Ork tief, Untot verstimmt.
  magic(gx: number, gy: number, fac: number): void {
    if (!this.started || this.muted) return;
    const dx = gx - this.lx, dy = gy - this.ly, d2 = dx * dx + dy * dy;
    if (d2 > this.hearR2) return;
    let v = this.master * this.sfx * 0.32;
    if (d2 > this.falloff2) v *= 1 - (Math.sqrt(d2) - this.falloff) / (this.hearR - this.falloff);
    if (v < 0.02) return;
    const now = performance.now(); if (now - this.magicLast < 55) return; this.magicLast = now;
    const ac = this.ensureCtx(); if (!ac) return;
    const FBASE = [560, 720, 360, 470, 430, 300][fac] ?? 500;            // Fraktions-Tonhöhe
    const base = FBASE * (0.9 + Math.random() * 0.2), t = ac.currentTime;
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = fac === 3 ? "sawtooth" : fac === 1 ? "sine" : "triangle"; // Untot verstimmt-rau, Elf rein
    osc.frequency.setValueAtTime(base * 1.7, t); osc.frequency.exponentialRampToValueAtTime(base * 0.55, t + 0.17);
    if (fac === 3) osc.detune.setValueAtTime(-30, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g).connect(ac.destination); osc.start(t); osc.stop(t + 0.24);
  }
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const style = params.get("style") ?? "real"; // real | pixel | voxel | cel
  const zoom = parseFloat(params.get("zoom") ?? "0.4");
  const styleMap: Record<string, number> = { real: 0, pixel: 1, voxel: 2, cel: 3, bake: 1 };
  const styleId = styleMap[style] ?? 0;
  const pixelateBake = style === "bake";                 // Welt-Raum-Pixelate-Bake (sticky pixel grid)
  const lowRes = style === "pixel" || style === "voxel"; // CSS-Screen-Space-Pixelation (Vergleich)
  const terrace = style === "voxel";                     // Hoehen in Stufen -> Voxel/Block-Terrassen
  const hud = document.getElementById("hud")!;
  hud.textContent = "Lade…";
  const app = new Application();
  // Pixel/Voxel-Look: in NIEDRIGER Aufloesung rendern, dann per CSS nearest hochskalieren.
  if (lowRes) {
    await app.init({ width: window.innerWidth, height: window.innerHeight, background: 0x0a1422, antialias: false, resolution: 0.25, autoDensity: false });
    app.canvas.style.width = "100vw";
    app.canvas.style.height = "100vh";
    app.canvas.style.imageRendering = "pixelated";
  } else {
    await app.init({ background: 0x0a1422, resizeTo: window, antialias: true });
  }
  document.getElementById("app")!.appendChild(app.canvas);

  // AUDIO: Sounds + Musik. Browser-Autoplay erlaubt Ton erst nach der ersten User-Geste -> bei
  // pointerdown/keydown einmalig audio.start() (Musik) auslösen.
  const audio = new AudioManager();
  const startAudioOnce = (): void => { audio.start(); window.removeEventListener("pointerdown", startAudioOnce); window.removeEventListener("keydown", startAudioOnce); };
  window.addEventListener("pointerdown", startAudioOnce); window.addEventListener("keydown", startAudioOnce);

  const M = {
    humanU: `${ASSET}/Unit/medievalUnit_02.png`, humanK: `${ASSET}/Unit/medievalUnit_05.png`,
    elfU: `${ASSET}/Unit/medievalUnit_14.png`, elfK: `${ASSET}/Unit/medievalUnit_17.png`,
    orcU: `${ASSET}/Unit/medievalUnit_20.png`, orcK: `${ASSET}/Unit/medievalUnit_23.png`,
    barn: `${ASSET}/Structure/medievalStructure_19.png`, house: `${ASSET}/Structure/medievalStructure_17.png`,
    tower: `${ASSET}/Structure/medievalStructure_12.png`, barracks: `${ASSET}/Structure/medievalStructure_02.png`,
    tree1: `${ASSET}/Environment/medievalEnvironment_01.png`, tree2: `${ASSET}/Environment/medievalEnvironment_02.png`,
    tree3: `${ASSET}/Environment/medievalEnvironment_03.png`,
    rock1: `${ASSET}/Environment/medievalEnvironment_07.png`, rock2: `${ASSET}/Environment/medievalEnvironment_08.png`,
  };
  const tex: Record<string, Texture> = {};
  for (const [k, url] of Object.entries(M)) tex[k] = await Assets.load(url);
  if (lowRes || pixelateBake) for (const tt of Object.values(tex)) tt.source.scaleMode = "nearest";

  hud.textContent = "Baue Welt…";
  // Seed: per ?seed=N reproduzierbar (Worldgen + Sim ziehen aus rng()); sonst zufällig pro Laden.
  const seed = (parseInt(params.get("seed") ?? "", 10) || ((Math.random() * 4294967296) >>> 0)) >>> 0;
  seedRng(seed);
  console.log("[Horde.IO] seed =", seed);
  buildHeight(terrace);
  const world = new Container();
  app.stage.addChild(world);
  world.scale.set(zoom);
  const cc = worldToIso(MAP / 2, MAP / 2);
  world.x = app.screen.width / 2 - cc.x * zoom;
  world.y = app.screen.height / 2 - (cc.y - elevLift(sampleH(MAP / 2, MAP / 2))) * zoom;
  world.addChild(buildTerrainMesh());
  terrainShader.resources.terr.uniforms.uStyle = styleId;

  // GLOBALE Z-REGEL: ALLE Inhalte (Units UND Deko) liegen in EINEM Counting-Sort über die Fuß-screen-Y.
  // Y_MIN/Y_SPAN = Quantisierungsgrenzen dieses Sorts. Deko wird als DECOR-Entity gespawnt (spawnDecor),
  // damit ein Baum/Gebäude relativ zu jeder Unit korrekt vorne/hinten steht (tiefer im Bild = vorne).
  const Y_MIN = -ELEV - 40, Y_SPAN = 2 * MAP * HH + ELEV + 120;
  const dry = (gx: number, gy: number): boolean => WET[Math.max(0, Math.min(N - 1, Math.floor(gx))) * N + Math.max(0, Math.min(N - 1, Math.floor(gy)))] <= 0.0005;
  function placeOnLand(): { gx: number; gy: number } {
    for (let i = 0; i < 80; i++) {
      const gx = 6 + rng() * (MAP - 12), gy = 6 + rng() * (MAP - 12), h = sampleH(gx, gy);
      if (h >= WATER + 0.03 && h <= MOUNTAIN - 0.02 && slopeAt(gx, gy) < STEEP && dry(gx, gy) && passable(gx, gy)) return { gx, gy }; // nicht in Wald-/Sperrzellen
    }
    return { gx: MAP / 2, gy: MAP / 2 };
  }
  const orbTex = makeOrbTexture(app);                       // für Seelen/Power-Ups
  interface Orb { spr: Sprite; life: number; }
  const orbs: Orb[] = [];

  // ── WÄLDER ALS (zerstörbare) MAUERN ── Bäume blocken einen 2x2-Fußabdruck in PASS -> Wälder kanalisieren die
  // Armee wie Berge/Wasser (Flow-Field läuft drumherum). NUR der Spieler-König fällt Bäume -> öffnet Pfade.
  // treeBlockN = Block-Zähler/Zelle (overlap-sicher), TERRAIN_PASS = Begehbarkeit OHNE Bäume (sauberes Freigeben),
  // treeAt = Zelle -> Baum-Entity (Fäll-Lookup).
  const TERRAIN_PASS = Uint8Array.from(PASS);
  const treeBlockN = new Uint8Array(N * N);
  const treeAt = new Int32Array(N * N).fill(-1);
  const TREE_FP: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const TREE_HP_V = 80;
  const blockTree = (gx: number, gy: number): void => { const ix = gx | 0, iy = gy | 0; for (const [dx, dy] of TREE_FP) { const x = ix + dx, y = iy + dy; if (x >= 0 && y >= 0 && x < N && y < N) { treeBlockN[x * N + y]++; PASS[x * N + y] = 0; } } };
  const unblockTree = (gx: number, gy: number): void => { const ix = gx | 0, iy = gy | 0; for (const [dx, dy] of TREE_FP) { const x = ix + dx, y = iy + dy; if (x < 0 || y < 0 || x >= N || y >= N) continue; const k = x * N + y; if (treeBlockN[k] > 0 && --treeBlockN[k] === 0) PASS[k] = TERRAIN_PASS[k]; } };

  // DEKO-PLAN: Positionen + Deko-Typ (0-2 Bäume, 3-4 Steine, 5-8 Gebäude). Entities folgen nach Engine-Setup.
  const decorPlan: { gx: number; gy: number; dt: number }[] = [];
  // WÄLDER: Bäume clustern in Wald-Zonen (forestMask) auf Gras.
  let tPlaced = 0, tGuard = 0;
  while (tPlaced < TREES && tGuard < TREES * 25) {
    tGuard++;
    const gx = 6 + rng() * (MAP - 12), gy = 6 + rng() * (MAP - 12), h = sampleH(gx, gy);
    if (h < WATER + 0.04 || h > 0.70 || slopeAt(gx, gy) > 0.06 || !dry(gx, gy)) continue;
    if (forestMask(gx, gy) < 0.46) continue;                 // größere Waldflächen
    decorPlan.push({ gx, gy, dt: (rng() * 3) | 0 }); blockTree(gx, gy); tPlaced++; // Baum blockt -> Wald = Mauer (vor Flow-Field-Aufbau)
  }
  // STEINE: am Bergfuß / felsigem Gelände gestreut.
  for (let i = 0; i < TREES * 0.2; i++) {
    let gx = 0, gy = 0, ok = false;
    for (let k = 0; k < 25; k++) { gx = 6 + rng() * (MAP - 12); gy = 6 + rng() * (MAP - 12); if (sampleH(gx, gy) > 0.58 && sampleH(gx, gy) < 0.9) { ok = true; break; } }
    if (!ok) continue;
    decorPlan.push({ gx, gy, dt: 3 + (i % 2) });
  }
  // STÄDTE: Zentren auf flachem Gras, Gebäude drumherum clustern.
  const towns: { gx: number; gy: number }[] = [];
  for (let g = 0; g < 20000 && towns.length < 26; g++) {
    const gx = 14 + rng() * (MAP - 28), gy = 14 + rng() * (MAP - 28), h = sampleH(gx, gy);
    if (h > 0.43 && h < 0.58 && slopeAt(gx, gy) < 0.022 && dry(gx, gy) && towns.every((t) => Math.hypot(t.gx - gx, t.gy - gy) > 34)) towns.push({ gx, gy });
  }
  for (const t of towns) {
    let n = 0, g2 = 0;
    const target = Math.ceil(BUILDINGS / Math.max(1, towns.length));
    while (n < target && g2 < 800) {
      g2++;
      const a = rng() * Math.PI * 2, r = rng() * 20;
      const gx = t.gx + Math.cos(a) * r, gy = t.gy + Math.sin(a) * r, h = sampleH(gx, gy);
      if (h < 0.42 || h > 0.62 || slopeAt(gx, gy) > 0.03 || !dry(gx, gy)) continue;
      decorPlan.push({ gx, gy, dt: 5 + ((rng() * 4) | 0) }); n++;
    }
  }

  // ===== MAX-UNIT-ENGINE: SoA-Sim + ParticleContainer (1 Draw-Call) + O(n) Counting-Sort =====
  // Statt Per-Unit-Sprite in 1100 Buckets (pro Frame addChild-Reparenting + Per-König-Graphics.clear):
  // flache Typed-Arrays (kein Objekt/GC pro Unit) + EIN ParticleContainer mit gepoolten Draw-Slots
  // (Array NIE umsortiert; Tiefe = WELCHE Unit in Slot k geschrieben wird). Ziel: Zehntausende Units bei
  // hoher FPS -> Spiel wird auf große Armeen gebalanced. Voller Plan: docs/ENGINE-MAXUNITS-PLAN.md.
  // Typen: 0 Krieger 1 Bogenschütze(Fern,Pfeile) 2 Speer(Reichweite) 3 Brute(zäh,langsam) 4 König.
  const T = [
    { hp: 50, atk: 6, range: 5, cd: 26, speed: 0.22, scale: 1.5 },    // 0 Krieger (Nahkampf)
    { hp: 30, atk: 8, range: 32, cd: 50, speed: 0.20, scale: 1.45 },  // 1 Bogenschütze (Fernkampf/Pfeile; an 5x5-Suchradius angeglichen)
    { hp: 58, atk: 8, range: 11, cd: 32, speed: 0.20, scale: 1.6 },   // 2 Speerträger (Reichweite)
    { hp: 135, atk: 16, range: 6, cd: 44, speed: 0.13, scale: 2.1 },  // 3 Brute (zäh, langsam)
    { hp: 340, atk: 20, range: 6, cd: 30, speed: 0.14, scale: 2.7 },  // 4 König (Anführer)
    { hp: 240, atk: 40, range: 7, cd: 30, speed: 0.16, scale: 2.4 },  // 5 Champion (Gold-Seele; zäh+schlagkräftig)
    { hp: 42, atk: 22, range: 26, cd: 70, speed: 0.18, scale: 1.7 },  // 6 Magier (Fraktions-Bolt: große Reichweite, harter Treffer, langsamer CD, fragil)
  ];
  const T_hp = Float32Array.from(T, (s) => s.hp), T_atk = Float32Array.from(T, (s) => s.atk);
  const T_range = Float32Array.from(T, (s) => s.range), T_cd = Float32Array.from(T, (s) => s.cd);
  const T_speed = Float32Array.from(T, (s) => s.speed), T_scale = Float32Array.from(T, (s) => s.scale);
  const FACTION_COL = [0x9fb8ff, 0x8fe39a, 0xe2795a, 0xb6f0c0, 0xe8a24a, 0x9aa890]; // blau·grün·rot·nekro-grün·kupfer·stein (Tod-FX)
  // 16 TEAM-Farben unabhängig von der Fraktion (Körper-Tint je König/Owner) -> Teams auf einen Blick trennbar.
  // Fraktion liest man an der SILHOUETTE (Waffe/Haltung/Kopf), das Team an der FARBE. Gut getrennte Hues.
  const TEAM_COL = [
    0x4a78ff, 0xff4d4d, 0x46d24a, 0xffd23a, 0xb060ff, 0xff8a3a, 0x2ad6c8, 0xff5ab0,
    0x9acb3a, 0x8c8cff, 0xc8503a, 0x3ad29a, 0xe8e8e8, 0xa86a2a, 0x7a5ad6, 0xd0d040,
  ];
  // Fraktions-Identität (Werte aus den Profilen): hp/speed/damage-Mults + Anzeige-Skala je Fraktion.
  const FAC_HP = Float32Array.from(FAC_ORDER, (f) => PROF[f].hp), FAC_SPD = Float32Array.from(FAC_ORDER, (f) => PROF[f].spd);
  const FAC_DMG = Float32Array.from(FAC_ORDER, (f) => PROF[f].dmg), FAC_SCALE = Float32Array.from(FAC_ORDER, (f) => PROF[f].scale);

  // Unit-Anzahl per ?units=N skalierbar (Benchmark) — Default = 16 Horden wie bisher.
  const reqUnits = Math.max(PLAYERS * 4, parseInt(params.get("units") ?? "", 10) || PLAYERS * (HORDE + 1));
  const DECOR_MAX = TREES + ((TREES * 0.2) | 0) + BUILDINGS + 100;      // Deko als Entities (Bäume/Steine/Gebäude)
  const CAP = reqUnits + DECOR_MAX + 64;                               // SoA-Kapazität: Units + Deko + Headroom
  // — SoA-Felder (Index i = Entity-ID). Kein Objekt-Pointer mehr (target = Int32-ID), kein GC. —
  const ex = new Float32Array(CAP), ey = new Float32Array(CAP);         // Welt gx/gy (Sim-Stand nach letztem Tick)
  const prevX = new Float32Array(CAP), prevY = new Float32Array(CAP);   // gx/gy vor dem letzten Tick (Render-Interpolation)
  const evx = new Float32Array(CAP), evy = new Float32Array(CAP);       // geglättete Geschwindigkeit pro Unit -> kein Zittern/Orbit (Bewegung lerpt)
  const screenX = new Float32Array(CAP), footY = new Float32Array(CAP); // iso-Render-Pos (footY = Sort-Key)
  const ehp = new Float32Array(CAP), emaxhp = new Float32Array(CAP), ecd = new Float32Array(CAP), eflash = new Float32Array(CAP), eatk = new Float32Array(CAP);
  const efac = new Uint8Array(CAP), etype = new Uint8Array(CAP), eking = new Uint8Array(CAP), eranged = new Uint8Array(CAP), ealive = new Uint8Array(CAP), evis = new Uint8Array(CAP);
  const eowner = new Uint8Array(CAP);   // König-/Team-ID (0..PLAYERS-1). FFA: anderer Owner = Feind. efac = nur Optik.
  const edecor = new Uint8Array(CAP);   // 0 = Unit, sonst Deko-Typ+1 (Baum/Stein/Gebäude) -> sortiert mit Units, keine Sim
  let decorCount = 0;                   // erste decorCount Indizes = Deko (bleiben über Runden erhalten)
  const buildingIdx: number[] = [];     // zerstörbare Gebäude (im Grid -> Units greifen an -> Rekruten-Seelen)
  const etarget = new Int32Array(CAP);
  const PLAYER = 0;                      // owner 0 = der Spieler-König
  const kingIdx = new Int32Array(PLAYERS).fill(-1); // Entity-ID des Königs je Owner (-1 = tot) -> Horde folgt IHM
  let playerKing = -1, camInit = false, pkvx = 0, pkvy = 0; // pkvx/y = geglättete Königs-Geschwindigkeit (Smoothing)
  // HORDEN-BEFEHL (nur Spieler-Horde): 0 FOLGEN (locker am König) · 1 ANGRIFF (zum Rallypunkt orderX/Y marschieren,
  // Gegner unterwegs angreifen) · 2 RÜCKZUG (eng zum König sammeln, Gegner ignorieren). Rechtsklick=Angriff, F=toggle.
  let orderMode = 0, orderX = MAP / 2, orderY = MAP / 2;
  let playerActive = false;                          // false = Menü-Vorschau-Auto-Battle; true = Spieler steuert
  let playerFaction = Math.max(0, Math.min(5, parseInt(params.get("fac") ?? "", 10) || 0)); // 0-5: Mensch/Elf/Ork/Untot/Zwerg/Riese
  let difficulty = 1;                                // 0 Leicht .. 3 Hardcore
  const DIFF = [{ label: "Leicht", hp: 1.7 }, { label: "Normal", hp: 1.0 }, { label: "Schwer", hp: 0.72 }, { label: "Hardcore", hp: 0.5 }];
  let gameState: "menu" | "playing" | "over" = "menu";
  // König-Progression: der Spieler-König levelt aus eingesammelten Seelen (mehr HP/Schaden/Größe).
  let playerXP = 0, playerLevel = 1, playerSizeMult = 1, playerDmgMult = 1;
  const XP_TO_NEXT = [0, 6, 10, 16, 24, 34]; // Index = aktuelle Stufe -> XP bis zur nächsten (Deckel Stufe 6)
  // König-Fähigkeiten (Sekunden): Dash = Burst in Laufrichtung (5s CD), Schild = -50% Schaden 5s (10s CD).
  let dashCd = 0, shieldCd = 0, shieldTimer = 0;
  let buffSpeed = 0, buffDmg = 0; // Power-Up-Timer (Sekunden): Tempo ×1.5 / Schaden ×1.5
  let eCd = 0, rCd = 0;                 // Fraktions-Fähigkeiten (E/R) Cooldowns
  let hordeBuffSpeed = 0, hordeBuffDmg = 0; // horden-weite Buffs (alle Spieler-Units) aus Fähigkeiten
  let survT = 0;                  // überlebte Zeit der laufenden Runde (Sekunden) für den End-Screen
  let nEnt = 0;                                                         // höchster je belegter Index +1
  const freeStack = new Int32Array(CAP); let freeTop = 0;               // O(1) Tod/Spawn (keine .filter-Kompaktierung)

  // ATLAS-Frames + ParticleContainer-Pool. dynamicProperties: position(x,y) + vertex(scale/anchor) +
  // uvs(welches Frame) + color(tint/alpha) ändern sich pro Slot/Frame (Slot-Inhalt = jeweils andere Unit).
  // Deko-Spezifikation: native Auflösung gebacken, Größe per scale (groß genug -> nicht winzig), Fuß-Anker.
  const DECOR_SPEC = [
    { tex: tex.tree1, scale: 0.9, anchorY: 0.92 }, { tex: tex.tree2, scale: 0.9, anchorY: 0.92 }, { tex: tex.tree3, scale: 0.9, anchorY: 0.92 },
    { tex: tex.rock1, scale: 0.5, anchorY: 0.88 }, { tex: tex.rock2, scale: 0.5, anchorY: 0.88 },
    { tex: tex.barn, scale: 0.85, anchorY: 0.9 }, { tex: tex.house, scale: 0.85, anchorY: 0.9 }, { tex: tex.tower, scale: 0.95, anchorY: 0.92 }, { tex: tex.barracks, scale: 0.85, anchorY: 0.9 },
  ];
  const DECOR_ANCHOR = DECOR_SPEC.map((s) => s.anchorY), DECOR_SCALE = DECOR_SPEC.map((s) => s.scale);
  const FRAMES = buildUnitAtlas(DECOR_SPEC);
  const UNIT_DRAW = 0.72;        // 32x40-Sprites sind ~1.43x höher als die alten 28px -> Anzeige runterskalieren, On-Screen-Größe ~wie vorher
  const ANCHOR_Y = FOOT / UH;    // Fuß-Anker (0.9) statt fixem 0.82
  const unitsPC = new ParticleContainer({ dynamicProperties: { position: true, vertex: true, uvs: true, color: true, rotation: false } });
  unitsPC.eventMode = "none"; world.addChild(unitsPC);
  const pool: Particle[] = new Array(CAP);
  for (let k = 0; k < CAP; k++) { const p = new Particle({ texture: FRAMES[0], anchorX: 0.5, anchorY: 0.82 }); p.alpha = 0; pool[k] = p; unitsPC.addParticle(p); }

  // FX-Layer (Poofs/Pfeile) ÜBER den Units; Banner/HP-Balken (≤16 Könige) ganz oben.
  const fxLayer = new Container(); fxLayer.eventMode = "none"; world.addChild(fxLayer);
  const arrowsLayer = new Container(); arrowsLayer.eventMode = "none"; world.addChild(arrowsLayer);
  const bannersLayer = new Container(); bannersLayer.eventMode = "none"; world.addChild(bannersLayer);

  // Spatial-Grid (verkettete Liste pro Zelle, flache Typed-Arrays) -> O(n) Gegnersuche/Separation.
  const CELL = 18, GW = Math.ceil(MAP / CELL) + 1;
  const gridHead = new Int32Array(GW * GW), gridNext = new Int32Array(CAP);
  const clampCell = (v: number): number => { const c = (v / CELL) | 0; return c < 0 ? 0 : c >= GW ? GW - 1 : c; };

  // ── FLOW-FIELD-PATHFINDING ── Pro König ein Richtungsfeld (BFS um Wasser/Berge herum). Units, die ihrem
  // König folgen, sampeln dessen Feld -> laufen um Hindernisse statt hängenzubleiben. Feld pro Tick für
  // EINEN König neu (Round-Robin) -> billig (BFS über ~14k Grobzellen). O(1)-Sampling pro Unit.
  const FW = 180, FCELL = MAP / FW;                                  // feiner (4 Grid/Zelle) -> dünne Landbrücken/Buchten passierbar (weniger Stuck)
  const flowPass = new Uint8Array(FW * FW);
  for (let cy = 0; cy < FW; cy++) for (let cx = 0; cx < FW; cx++) { // Zelle begehbar, wenn IRGENDEIN Punkt begehbar ist (Brücken bleiben offen)
    const x0 = cx * FCELL, y0 = cy * FCELL;
    flowPass[cy * FW + cx] = passable(x0 + FCELL * 0.5, y0 + FCELL * 0.5) || passable(x0 + 0.5, y0 + 0.5) || passable(x0 + FCELL - 0.5, y0 + 0.5) || passable(x0 + 0.5, y0 + FCELL - 0.5) || passable(x0 + FCELL - 0.5, y0 + FCELL - 0.5) ? 1 : 0;
  }
  const flowCell = (gx: number, gy: number): number => {
    let cx = (gx / FCELL) | 0, cy = (gy / FCELL) | 0;
    cx = cx < 0 ? 0 : cx >= FW ? FW - 1 : cx; cy = cy < 0 ? 0 : cy >= FW ? FW - 1 : cy; return cy * FW + cx;
  };
  const kingFlowX = new Int8Array(PLAYERS * FW * FW), kingFlowY = new Int8Array(PLAYERS * FW * FW);
  const bfsDist = new Int32Array(FW * FW), bfsQueue = new Int32Array(FW * FW);
  const FNX = [-1, 1, 0, 0, -1, -1, 1, 1], FNY = [0, 0, -1, 1, -1, 1, -1, 1]; // 8 Nachbarn
  const buildKingFlow = (king: number): void => {
    if (king < 0 || !ealive[king]) return;
    const owner = eowner[king], base = owner * FW * FW;
    bfsDist.fill(-1);
    const start = flowCell(ex[king], ey[king]);
    let head = 0, tail = 0; bfsDist[start] = 0; bfsQueue[tail++] = start;
    while (head < tail) {
      const c = bfsQueue[head++], cx = c % FW, cy = (c / FW) | 0, dc = bfsDist[c];
      for (let n = 0; n < 8; n++) { const nx = cx + FNX[n], ny = cy + FNY[n]; if (nx < 0 || ny < 0 || nx >= FW || ny >= FW) continue; const nc = ny * FW + nx; if (bfsDist[nc] !== -1 || !flowPass[nc]) continue; bfsDist[nc] = dc + 1; bfsQueue[tail++] = nc; }
    }
    for (let c = 0; c < FW * FW; c++) {
      const dc = bfsDist[c];
      if (dc <= 0) { kingFlowX[base + c] = 0; kingFlowY[base + c] = 0; continue; }       // Ziel/unerreichbar -> kein Flow
      const cx = c % FW, cy = (c / FW) | 0; let best = dc, bx = 0, by = 0;
      for (let n = 0; n < 8; n++) { const nx = cx + FNX[n], ny = cy + FNY[n]; if (nx < 0 || ny < 0 || nx >= FW || ny >= FW) continue; const nd = bfsDist[ny * FW + nx]; if (nd >= 0 && nd < best) { best = nd; bx = FNX[n]; by = FNY[n]; } }
      const m = Math.hypot(bx, by) || 1; kingFlowX[base + c] = ((bx / m) * 100) | 0; kingFlowY[base + c] = ((by / m) * 100) | 0;
    }
  };

  const puffTex = makePuffTexture(app);
  interface Puff { spr: Sprite; life: number; }
  const puffs: Puff[] = [];
  const PUFF_CAP = 500;                                                 // Massensterben: Poof-Storm deckeln (sonst Tausende Sprite-News/Tick)
  const addPuff = (gx: number, gy: number, tint: number, sc = 0.5): void => {
    if (puffs.length >= PUFF_CAP) return;
    const spr = new Sprite(puffTex); spr.anchor.set(0.5); spr.tint = tint; spr.scale.set(sc);
    const p = worldToIso(gx, gy); spr.x = p.x; spr.y = p.y - elevLift(sampleH(gx, gy)) - 6;
    fxLayer.addChild(spr); puffs.push({ spr, life: 1 });
  };
  // FRAKTIONS-TOD-FX: eigene Sterbe-Wolke je Fraktion (Ork Blut · Untot grüner Seelen-Wisp · Riese Staub+Geröll
  // · Zwerg Staub+Kupfer · Elf Blätter · Mensch goldener Aufstieg). DISTANZ-GATE zur Kamera -> bei Massensterben
  // entstehen keine Off-Screen-Poofs (billig). Nutzt den gedeckelten addPuff-Pool.
  const deathFX = (gx: number, gy: number, fac: number): void => {
    const dx = gx - audio.lx, dy = gy - audio.ly; if (dx * dx + dy * dy > 230 * 230) return;
    if (fac === 2) { addPuff(gx, gy, 0x7a1e16, 0.7); if (rng() < 0.6) addPuff(gx + (rng() - 0.5) * 7, gy + (rng() - 0.5) * 7, 0xb23a2a, 0.4); }
    else if (fac === 3) { addPuff(gx, gy, 0x6cff8a, 0.7); if (rng() < 0.5) addPuff(gx, gy, 0xb6f0c0, 0.4); }
    else if (fac === 5) { addPuff(gx, gy, 0x7d8a72, 1.3); if (rng() < 0.7) addPuff(gx + (rng() - 0.5) * 9, gy + (rng() - 0.5) * 9, 0x55504a, 0.6); }
    else if (fac === 4) { addPuff(gx, gy, 0x8a4f2a, 0.6); if (rng() < 0.5) addPuff(gx, gy, 0xff8c2a, 0.3); }
    else if (fac === 1) { addPuff(gx, gy, 0x3c7d2f, 0.6); if (rng() < 0.6) addPuff(gx + (rng() - 0.5) * 7, gy, 0x5fd07a, 0.35); }
    else addPuff(gx, gy, 0xffe9a0, 0.6); // human
  };
  // FRAKTIONS-TREFFER-FX: kleiner farbiger Funke beim Magier-Bolt-Einschlag (Kern + Hülle).
  const hitFX = (gx: number, gy: number, fac: number): void => { addPuff(gx, gy, FAC_PROJ[fac].glow, 0.5); addPuff(gx, gy, FAC_PROJ[fac].core, 0.28); };
  // SEELEN (Kern-Loop): gefallene Units lassen NAHE dem Spieler-König eine Seele fallen; der König
  // sammelt sie ein -> seine Horde wächst (kämpfen -> Seelen -> größere Horde). Nur nahe Spawns, gedeckelt.
  interface Soul { gx: number; gy: number; spr: Sprite; gold: boolean; }
  const souls: Soul[] = [];
  const SOUL_CAP = 500;
  const dropSoul = (gx: number, gy: number): void => {
    if (souls.length >= SOUL_CAP || playerKing < 0 || !ealive[playerKing]) return;
    const dx = gx - ex[playerKing], dy = gy - ey[playerKing];
    if (dx * dx + dy * dy > 250 * 250) return;                          // nur nahe dem Spieler -> keine Sprite-Flut
    const gold = rng() < 0.045;                                 // seltene Gold-Seele -> Champion
    const spr = new Sprite(orbTex); spr.anchor.set(0.5); spr.tint = gold ? 0xffd24a : 0x8fe39a; spr.scale.set(gold ? 0.62 : 0.42);
    const p = worldToIso(gx, gy); spr.x = p.x; spr.y = p.y - elevLift(sampleH(gx, gy)) - 4;
    fxLayer.addChild(spr); souls.push({ gx, gy, spr, gold });
  };
  // Seele eingesammelt -> König-XP; bei Stufenaufstieg +HP (sofort geheilt), +Schaden, +Größe (gedeckelt St. 6).
  const onPlayerSoul = (): void => {
    playerXP++;
    while (playerLevel < 6 && playerXP >= XP_TO_NEXT[playerLevel]) {
      playerXP -= XP_TO_NEXT[playerLevel]; playerLevel++;
      playerSizeMult = Math.min(1.3, 1 + (playerLevel - 1) * 0.05); playerDmgMult = 1 + (playerLevel - 1) * 0.08;
      if (playerKing >= 0 && ealive[playerKing]) { emaxhp[playerKing] += 28; ehp[playerKing] = Math.min(emaxhp[playerKing], ehp[playerKing] + 28); addPuff(ex[playerKing], ey[playerKing], 0xffd24a, 1.2); }
    }
  };
  // POWER-UPS: verstreute Buffs (0 Tempo · 1 Schaden · 2 Heilung · 3 Schild). Beim Aufsammeln neu platziert
  // (bleiben als Karten-Ressource). Nur der Spieler-König nutzt sie.
  const POW_COL = [0x49e0e0, 0xe05050, 0x6fe06f, 0x7fb0ff];
  interface Pow { gx: number; gy: number; type: number; spr: Sprite; }
  const pows: Pow[] = [];
  const placePow = (p: Pow): void => { const c = placeOnLand(); p.gx = c.gx; p.gy = c.gy; p.type = (rng() * 4) | 0; p.spr.tint = POW_COL[p.type]; const w = worldToIso(p.gx, p.gy); p.spr.x = w.x; p.spr.y = w.y - elevLift(sampleH(p.gx, p.gy)) - 6; };
  const spawnPows = (): void => {
    for (const p of pows) p.spr.destroy(); pows.length = 0;
    for (let i = 0; i < 12; i++) { const spr = new Sprite(orbTex); spr.anchor.set(0.5); spr.scale.set(0.7); fxLayer.addChild(spr); const p: Pow = { gx: 0, gy: 0, type: 0, spr }; placePow(p); pows.push(p); }
  };
  const spawnE = (gx: number, gy: number, f: number, ty: number, owner: number): number => {
    const i = freeTop > 0 ? freeStack[--freeTop] : nEnt++;
    ex[i] = gx; ey[i] = gy; prevX[i] = gx; prevY[i] = gy; evx[i] = 0; evy[i] = 0; emaxhp[i] = T_hp[ty] * FAC_HP[f]; ehp[i] = emaxhp[i]; ecd[i] = rng() * T_cd[ty]; eflash[i] = 0; eatk[i] = 0;
    efac[i] = f; etype[i] = ty; eowner[i] = owner; edecor[i] = 0; eking[i] = ty === 4 ? 1 : 0; eranged[i] = T_range[ty] > 20 || (ty === 5 && f === 1) ? 1 : 0; ealive[i] = 1; etarget[i] = -1; // Elf-Champion = Fernkämpfer
    const p = worldToIso(gx, gy); screenX[i] = p.x; footY[i] = p.y - elevLift(sampleH(gx, gy));
    return i;
  };
  // DEKO als Entity (sortiert mit Units, keine Sim): nur Position + Frame; bleibt über Runden erhalten.
  const spawnDecor = (gx: number, gy: number, dt: number): void => {
    const i = nEnt++;
    ex[i] = gx; ey[i] = gy; prevX[i] = gx; prevY[i] = gy; ealive[i] = 1; edecor[i] = dt + 1;
    efac[i] = 0; etype[i] = 0; eowner[i] = 255; eflash[i] = 0; eatk[i] = 0; etarget[i] = -1; eking[i] = 0; eranged[i] = 0;
    if (dt >= 5) { ehp[i] = 200; emaxhp[i] = 200; buildingIdx.push(i); }   // Gebäude: zerstörbar (Rekruten-Quelle)
    else if (dt < 3) { ehp[i] = TREE_HP_V; emaxhp[i] = TREE_HP_V; treeAt[(gx | 0) * N + (gy | 0)] = i; } // Baum: vom König fällbar
    const p = worldToIso(gx, gy); screenX[i] = p.x; footY[i] = p.y - elevLift(sampleH(gx, gy));
  };
  for (const dp of decorPlan) if (nEnt < CAP) spawnDecor(dp.gx, dp.gy, dp.dt);
  decorCount = nEnt;                                                    // Units spawnen ab hier; Deko bleibt unten
  const killE = (i: number): void => {
    if (!ealive[i]) return;
    if (edecor[i]) { // Gebäude/Deko zerstört: Gebäude (edecor>=6) droppt Rekruten-Seelen -> Armee wächst. KEIN Freelist (Deko-Slot bleibt reserviert).
      ealive[i] = 0;
      if (edecor[i] >= 6) { addPuff(ex[i], ey[i], 0xffd24a, 1.6); audio.play("collapse", ex[i], ey[i]); for (let s = 0; s < 5; s++) dropSoul(ex[i] + (rng() - 0.5) * 10, ey[i] + (rng() - 0.5) * 10); }
      return;
    }
    ealive[i] = 0; etarget[i] = -1; if (eking[i]) kingIdx[eowner[i]] = -1; audio.play(DEATH_SND[efac[i]], ex[i], ey[i]); deathFX(ex[i], ey[i], efac[i]); if (rng() < 0.5) dropSoul(ex[i], ey[i]); freeStack[freeTop++] = i;
  };
  // Adaptiv: erst inneres 3x3 (deckt Nahkampf), nur bei leer den äußeren 5x5-Ring -> meist 9 statt 25 Zellen.
  // FFA: Feind = anderer Owner (König-Team), nicht andere Fraktion -> mehrere Könige derselben Rasse sind Rivalen.
  const findEnemy = (i: number): number => {
    const cx = clampCell(ex[i]), cy = clampCell(ey[i]), uf = eowner[i], xi = ex[i], yi = ey[i];
    for (let R = 1; R <= 2; R++) {
      let best = -1, bestD = 1e9, scan = 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (R === 2 && dx > -2 && dx < 2 && dy > -2 && dy < 2) continue; // inneres 3x3 in R=2 überspringen (schon gescannt)
        const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GW) continue;
        for (let j = gridHead[ny * GW + nx]; j !== -1; j = gridNext[j]) {
          if (!ealive[j] || eowner[j] === uf) continue;
          const ddx = ex[j] - xi, ddy = ey[j] - yi, d = ddx * ddx + ddy * ddy;
          if (d < bestD) { bestD = d; best = j; }
          if (++scan >= 64) { dy = R + 1; dx = R + 1; break; }           // Scan-Budget gegen Mega-dichte Zellen ("nah genug" reicht)
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  };
  // Champion-CLEAVE: AoE-Hieb auf Gegner nahe dem Haupttreffer (Massen-Wucht; Champions sind selten -> billig).
  const cleave = (i: number, tg: number): void => {
    const ccx = clampCell(ex[tg]), ccy = clampCell(ey[tg]), splash = T_atk[5] * FAC_DMG[efac[i]] * 0.5, uf = eowner[i];
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const ng = ccx + ox, mg = ccy + oy; if (ng < 0 || mg < 0 || ng >= GW || mg >= GW) continue;
      for (let j = gridHead[mg * GW + ng]; j !== -1; j = gridNext[j]) {
        if (j === tg || !ealive[j] || eowner[j] === uf) continue;
        const dx = ex[j] - ex[tg], dy = ey[j] - ey[tg];
        if (dx * dx + dy * dy < 49) { ehp[j] -= splash; eflash[j] = 6; if (ehp[j] <= 0) killE(j); }
      }
    }
  };
  // KÖNIG-FX: Banner + HP-Balken als gepoolte Sprites (kein Per-Frame Graphics.clear mehr).
  // KÖNIG-FX: schlanker HP-Balken ÜBER dem Kopf, RAHMEN = Fraktionsfarbe (ersetzt die redundante Flagge —
  // der König trägt schon eine Krone). bg = Fraktions-Rahmen, fill = HP (grün->gelb->rot).
  interface KingFX { i: number; bg: Sprite; fill: Sprite; }
  const kingFX: KingFX[] = [];
  const addKingFX = (i: number, owner: number): void => {
    const bg = new Sprite(Texture.WHITE); bg.anchor.set(0.5, 0.5); bg.tint = TEAM_COL[owner]; bg.height = 6; bannersLayer.addChild(bg); // Rahmen = Team-Farbe

    const fill = new Sprite(Texture.WHITE); fill.anchor.set(0, 0.5); fill.height = 4; bannersLayer.addChild(fill);
    kingFX.push({ i, bg, fill });
  };
  // BATTLE-ROYALE-STURMZONE: sicherer Kreis schrumpft in Phasen; außerhalb Dauerschaden.
  let zoneX = MAP / 2, zoneY = MAP / 2, zoneR = 380, zoneTarget = 380, zoneTimer = 0;
  const zoneG = new Graphics(); zoneG.eventMode = "none"; world.addChild(zoneG); // ganz oben
  // BEFEHLS-MARKER (Rallypunkt bei ANGRIFF): roter Ziel-Ring in der Welt.
  const orderG = new Graphics(); orderG.eventMode = "none"; world.addChild(orderG);
  const drawOrderMarker = (): void => {
    orderG.clear(); if (orderMode !== 1 || !playerActive) return;
    const p = worldToIso(orderX, orderY), yy = p.y - elevLift(sampleH(orderX, orderY));
    const pulse = 12 + Math.sin(time * 5) * 3;
    orderG.circle(p.x, yy, pulse + 6).stroke({ color: 0xff5a3a, width: 4, alpha: 0.85 }).circle(p.x, yy, pulse).stroke({ color: 0xffd24a, width: 2.5, alpha: 0.9 });
    orderG.moveTo(p.x, yy - 4).lineTo(p.x, yy + 4).moveTo(p.x - 4, yy).lineTo(p.x + 4, yy).stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
  };
  // Bildschirm -> Grid (Iso invertiert, Höhe genähert): für Rechtsklick-Befehle.
  const screenToGrid = (clientX: number, clientY: number): { gx: number; gy: number } => {
    const rect = app.canvas.getBoundingClientRect();
    const wx = (clientX - rect.left - world.x) / world.scale.x, wy = (clientY - rect.top - world.y) / world.scale.y;
    const a = wx / HW, b = wy / HH;                                  // wx=(gx-gy)*HW, wy≈(gx+gy)*HH
    return { gx: Math.max(2, Math.min(MAP - 2, (a + b) / 2)), gy: Math.max(2, Math.min(MAP - 2, (b - a) / 2)) };
  };
  const drawZone = (): void => {
    const pts: number[] = [];
    for (let a = 0; a <= 72; a++) { const th = (a / 72) * Math.PI * 2; const p = worldToIso(zoneX + Math.cos(th) * zoneR, zoneY + Math.sin(th) * zoneR); pts.push(p.x, p.y); }
    zoneG.clear().poly(pts).stroke({ color: 0x8af0ff, width: 16, alpha: 0.55 }).poly(pts).stroke({ color: 0xffffff, width: 5, alpha: 0.9 });
  };
  drawZone();
  // MINIMAP (Bildschirm-Raum, unten rechts): Sturm-Kreis + König-Punkte -> Übersicht trotz Zoom auf den König.
  const mini = new Graphics(); mini.eventMode = "none"; app.stage.addChild(mini);
  const MINI = 170, MINI_PAD = 12;
  const drawMini = (): void => {
    mini.clear(); if (!playerActive) return;
    const ox = app.screen.width - MINI - MINI_PAD, oy = app.screen.height - MINI - MINI_PAD, sc = MINI / MAP;
    mini.rect(ox, oy, MINI, MINI).fill({ color: 0x0a1422, alpha: 0.72 }).stroke({ color: 0x3a5a86, width: 2 });
    mini.circle(ox + zoneX * sc, oy + zoneY * sc, zoneR * sc).stroke({ color: 0x8af0ff, width: 1.5, alpha: 0.85 });
    for (let p = 0; p < PLAYERS; p++) { const k = kingIdx[p]; if (k < 0) continue; const isP = k === playerKing; mini.circle(ox + ex[k] * sc, oy + ey[k] * sc, isP ? 4 : 2.2).fill(isP ? 0xffffff : TEAM_COL[eowner[k]]); }
  };
  // BALLISTISCHE PFEILE (Feel aus dem Original: Bogen-Wurf mit z-Höhe+Schwerkraft, dreht zur Flugrichtung,
  // Staub beim Einschlag). gx/gy homen aufs Ziel, z = Sinus-Bogen über die Flugdauer. tgt = Entity-ID.
  interface Arrow { sx: number; sy: number; tx: number; ty: number; gx: number; gy: number; tgt: number; dmg: number; age: number; T: number; apex: number; spr: Sprite; psx: number; psy: number; bolt: number; fac: number; }
  const arrows: Arrow[] = [];
  const ARROW_CAP = 1600;                                               // gleichzeitige Geschosse gedeckelt (Scale)
  const arrowTex = makeArrowTexture(app);
  const boltTex = FAC_PROJ.map((fp) => makeBoltTexture(app, fp.core, fp.glow)); // 6 Magier-Bolt-Texturen (Fraktionsfarbe)
  // Geschosse: Bogenschütze (ty 1) = ballistischer Pfeil; Magier (ty 6) = flach fliegender Fraktions-BOLT
  // (eigene Textur + Glüh-Spur + Fraktions-Treffer-FX). Beide homen aufs Ziel + z-Bogen.
  const fireArrow = (i: number, tgt: number): void => {
    if (arrows.length >= ARROW_CAP) return;
    const dx = ex[tgt] - ex[i], dy = ey[tgt] - ey[i], d = Math.hypot(dx, dy) || 1;
    const bolt = etype[i] === 6 ? 1 : 0, fac = efac[i];
    const spr = new Sprite(bolt ? boltTex[fac] : arrowTex); spr.anchor.set(0.5); if (bolt) spr.scale.set(1 + Math.min(0.5, d * 0.01)); arrowsLayer.addChild(spr);
    arrows.push({ sx: ex[i], sy: ey[i], tx: ex[tgt], ty: ey[tgt], gx: ex[i], gy: ey[i], tgt, dmg: T_atk[etype[i]] * FAC_DMG[fac] * (playerActive && i === playerKing ? playerDmgMult * (buffDmg > 0 ? 1.5 : 1) : 1) * (eowner[i] === PLAYER && hordeBuffDmg > 0 ? 1.35 : 1), age: 0, T: Math.max(0.28, d * 0.02 + 0.12), apex: bolt ? Math.min(22, 4 + d * 0.4) : Math.min(60, 12 + d * 1.1), spr, psx: 0, psy: 0, bolt, fac });
    if (bolt) audio.magic(ex[i], ey[i], fac); else audio.play("arrow", ex[i], ey[i]); // Magier: prozedurale Magie; Bogen: Pfeil-Sound
  };
  // RUNDE: PLAYERS Horden frisch spawnen (Gesamtzahl = reqUnits) + Sturm zurücksetzen.
  const newRound = (): void => {
    for (const kf of kingFX) { kf.bg.destroy(); kf.fill.destroy(); }
    kingFX.length = 0;
    for (const a of arrows) a.spr.destroy(); arrows.length = 0;
    for (const s of souls) s.spr.destroy(); souls.length = 0;
    nEnt = decorCount; freeTop = 0; ealive.fill(0, decorCount); kingIdx.fill(-1); // Deko (0..decorCount) bleibt erhalten
    for (let b = 0; b < buildingIdx.length; b++) { const i = buildingIdx[b]; ealive[i] = 1; ehp[i] = emaxhp[i]; } // Gebäude pro Runde neu aufbauen
    for (const p of pool) p.alpha = 0; lastDrawn = 0;
    zoneR = 380; zoneTarget = 380; zoneTimer = 0; drawZone();
    const perHorde = Math.max(1, Math.floor((reqUnits - PLAYERS) / PLAYERS));
    const spreadR = Math.min(110, Math.max(8, Math.sqrt(perHorde) * 1.5)); // Streuung skaliert mit Hordengröße -> keine 1000+-Units-pro-Zelle (findEnemy/Separation bezahlbar)
    for (let pi = 0; pi < PLAYERS; pi++) {
      const f = pi === PLAYER ? playerFaction : pi % 6, c = placeOnLand(); // owner = pi (König-Team); Spieler bekommt gewählte Fraktion
      const king = spawnE(c.gx, c.gy, f, 4, pi); kingIdx[pi] = king; addKingFX(king, pi);
      if (pi === PLAYER) { emaxhp[king] *= DIFF[difficulty].hp; ehp[king] = emaxhp[king]; } // Schwierigkeit -> Spieler-König-HP
      for (let i = 0; i < perHorde; i++) {
        const r = rng(), ty = r < 0.50 ? 0 : r < 0.68 ? 1 : r < 0.80 ? 2 : r < 0.90 ? 3 : 6; // ~10% Magier
        let gx = c.gx + (rng() - 0.5) * 2 * spreadR, gy = c.gy + (rng() - 0.5) * 2 * spreadR;
        if (!passable(gx, gy)) { gx = c.gx; gy = c.gy; }                  // nicht ins Wasser/Steilhang spawnen
        spawnE(gx, gy, f, ty, pi);
      }
    }
    playerKing = kingIdx[PLAYER]; camInit = false;                       // Kamera beim Rundenstart auf Spieler-König snappen
    playerXP = 0; playerLevel = 1; playerSizeMult = 1; playerDmgMult = 1; // König-Progression zurücksetzen
    dashCd = 0; shieldCd = 0; shieldTimer = 0; buffSpeed = 0; buffDmg = 0; eCd = 0; rCd = 0; hordeBuffSpeed = 0; hordeBuffDmg = 0; pkvx = 0; pkvy = 0; orderMode = 0; // Fähigkeiten + Buffs + Momentum + Befehl zurücksetzen
    spawnPows();                                                           // Power-Ups neu verteilen
  };
  let lastDrawn = 0;

  // --- PIXELATE (Pixel-Perfect-Camera): Welt in eine gesnappte LOW-RES-SCREEN-RT rendern, dann
  // NEAREST x PX hochskalieren. Block = PX BILDSCHIRM-px -> KONSTANT über alle Zooms (kein Pixelmatsch
  // beim Reinzoomen, anders als ein fester Welt-Block). Kamera pro Frame auf das Texel-Grid gesnappt
  // -> welt-verankert, kein Schwimmen beim Pannen. Quelle: Unity PixelPerfectCamera / yal.cc.
  const PX = 3;                                  // Bildschirm-px pro Pixel-Art-Pixel (konstant)
  let bakeRt: RenderTexture | null = null, bakeSprite: Sprite | null = null;
  let bakeThrottle = false;
  const makeBakeRT = (): void => {
    const w = Math.max(2, Math.ceil(app.screen.width / PX) + 1);   // +1 Pad-Texel (Subpixel-Rand)
    const h = Math.max(2, Math.ceil(app.screen.height / PX) + 1);
    bakeRt?.destroy(true);
    bakeRt = RenderTexture.create({ width: w, height: h, antialias: false });
    bakeRt.source.scaleMode = "nearest";
    if (!bakeSprite) { bakeSprite = new Sprite(bakeRt); bakeSprite.eventMode = "none"; bakeSprite.scale.set(PX); app.stage.addChild(bakeSprite); }
    else bakeSprite.texture = bakeRt;
  };
  if (pixelateBake) { makeBakeRT(); window.addEventListener("resize", makeBakeRT); }

  let dragging = false, lastX = 0, lastY = 0;
  app.canvas.style.touchAction = "none";
  app.canvas.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; dragging = true; lastX = e.clientX; lastY = e.clientY; }); // nur Linksklick pannt
  window.addEventListener("pointerup", () => { dragging = false; });
  // RECHTSKLICK = ANGRIFFS-MARSCH: Horde marschiert zum geklickten Punkt (greift Gegner unterwegs an).
  app.canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault(); if (!playerActive) return;
    const g = screenToGrid(e.clientX, e.clientY); orderX = g.gx; orderY = g.gy; orderMode = 1;
    audio.play("ui"); addPuff(orderX, orderY, 0xff5a3a, 1.0);
  });
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

  // O(n) COUNTING-SORT auf quantisierter foot-screen-Y (verallgemeinert das alte Bucket-Schema):
  // Tiefe = welche Unit in welchen festen Draw-Slot geschrieben wird (Slot-Array nie umsortiert).
  const KSORT = 2048, invSpan = KSORT / Y_SPAN;
  const sortCnt = new Int32Array(KSORT + 1), sortOrder = new Int32Array(CAP);
  const renderUnits = (): number => {
    // Sichtbarkeit (evis) kommt aus projectInterp -> hier nur noch sortieren + Slots schreiben.
    sortCnt.fill(0);
    let n = 0;
    for (let i = 0; i < nEnt; i++) { if (!evis[i]) continue; let b = ((footY[i] - Y_MIN) * invSpan) | 0; b = b < 0 ? 0 : b >= KSORT ? KSORT - 1 : b; sortCnt[b]++; n++; }
    let a = 0; for (let b = 0; b < KSORT; b++) { const c = sortCnt[b]; sortCnt[b] = a; a += c; }
    for (let i = 0; i < nEnt; i++) { if (!evis[i]) continue; let b = ((footY[i] - Y_MIN) * invSpan) | 0; b = b < 0 ? 0 : b >= KSORT ? KSORT - 1 : b; sortOrder[sortCnt[b]++] = i; }
    for (let k = 0; k < n; k++) {
      const u = sortOrder[k], p = pool[k];
      p.x = screenX[u]; p.y = footY[u];
      const di = edecor[u];
      if (di) {                                                                          // DEKO: eigener Frame/Anker/Skala, keine Anim
        const j = di - 1, dsc = DECOR_SCALE[j];
        p.texture = FRAMES[UNIT_FRAMES + j]; p.anchorY = DECOR_ANCHOR[j]; p.scaleX = dsc; p.scaleY = dsc; p.tint = 0xffffff; p.alpha = 1;
      } else {                                                                           // UNIT: Typ-Skala × Fraktions-Skala, Anim-Frame, Tönung
        const sc = T_scale[etype[u]] * FAC_SCALE[efac[u]] * UNIT_DRAW * (u === playerKing ? playerSizeMult : 1);
        p.anchorY = ANCHOR_Y; p.scaleX = sc; p.scaleY = sc;
        let fr: number;                                                                   // Pose: Angriff (Ausholen 4 -> Schlag 5) > Gang (0..3) > Idle (1)
        if (eatk[u] > 0) fr = eatk[u] > 8 ? 4 : 5;
        else { const moving = Math.abs(ex[u] - prevX[u]) + Math.abs(ey[u] - prevY[u]) > 0.05; fr = moving ? (((time * 8 + u * 0.7) | 0) & 3) : 1; }
        p.texture = FRAMES[unitFrame(efac[u], etype[u], fr)];
        p.tint = eflash[u] > 0 ? 0xff5555 : u === playerKing && shieldTimer > 0 ? 0x8fc4ff : TEAM_COL[eowner[u]]; p.alpha = 1; // Team-Farbe als Körper-Tint

      }
    }
    for (let k = n; k < lastDrawn; k++) pool[k].alpha = 0; // pensionierte Slots einmalig parken
    lastDrawn = n;
    return n;
  };

  // Benchmark: + / - spawnt/entfernt 1000 Units live (Engine-Stresstest).
  const aliveKings = (): number[] => kingFX.filter((kf) => ealive[kf.i]).map((kf) => kf.i);
  window.addEventListener("keydown", (e) => {
    if (e.key === "+" || e.key === "=") { const ks = aliveKings(); if (!ks.length) return;
      for (let n = 0; n < 1000 && (freeTop > 0 || nEnt < CAP); n++) { const ki = ks[(rng() * ks.length) | 0]; const r = rng(); const ty = r < 0.55 ? 0 : r < 0.73 ? 1 : r < 0.88 ? 2 : 3; spawnE(ex[ki] + (rng() - 0.5) * 30, ey[ki] + (rng() - 0.5) * 30, efac[ki], ty, eowner[ki]); } }
    else if (e.key === "-" || e.key === "_") { let removed = 0; for (let i = decorCount; i < nEnt && removed < 1000; i++) if (ealive[i] && !eking[i]) { killE(i); removed++; } }
  });

  // SPIELER-STEUERUNG: WASD/Pfeile bewegen den eigenen König (owner 0). Bildschirm-Richtung -> Iso-Grid.
  const keys = new Set<string>();
  let pInX = 0, pInY = 0; // normalisierte Grid-Bewegungsrichtung des Spieler-Königs (im Ticker gesetzt)
  // ── FRAKTIONS-FÄHIGKEITEN (E/R) ── jede Fraktion eigener Kit. Effekte zentriert am Spieler-König,
  // nutzen das (zuletzt im Tick gebaute) Spatial-Grid. AoE-Schaden / Heilen / Horden-Buff / Beschwören.
  const aoeDamage = (radius: number, dmg: number): void => {
    if (playerKing < 0 || !ealive[playerKing]) return;
    const cx = ex[playerKing], cy = ey[playerKing], r2 = radius * radius;
    const ccx = clampCell(cx), ccy = clampCell(cy), R = Math.ceil(radius / CELL) + 1;
    for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
      const ng = ccx + ox, mg = ccy + oy; if (ng < 0 || mg < 0 || ng >= GW || mg >= GW) continue;
      for (let j = gridHead[mg * GW + ng]; j !== -1; j = gridNext[j]) {
        if (!ealive[j] || eowner[j] === PLAYER || edecor[j]) continue;
        const dx = ex[j] - cx, dy = ey[j] - cy; if (dx * dx + dy * dy < r2) { ehp[j] -= dmg; eflash[j] = 6; if (ehp[j] <= 0) killE(j); }
      }
    }
    addPuff(cx, cy, FAC_PROJ[playerFaction].glow, radius / 18); addPuff(cx, cy, FAC_PROJ[playerFaction].core, radius / 26);
  };
  const healAllies = (radius: number, amt: number): void => {
    if (playerKing < 0 || !ealive[playerKing]) return;
    const cx = ex[playerKing], cy = ey[playerKing], r2 = radius * radius;
    const ccx = clampCell(cx), ccy = clampCell(cy), R = Math.ceil(radius / CELL) + 1;
    for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
      const ng = ccx + ox, mg = ccy + oy; if (ng < 0 || mg < 0 || ng >= GW || mg >= GW) continue;
      for (let j = gridHead[mg * GW + ng]; j !== -1; j = gridNext[j]) {
        if (!ealive[j] || eowner[j] !== PLAYER || edecor[j]) continue;
        const dx = ex[j] - cx, dy = ey[j] - cy; if (dx * dx + dy * dy < r2 && ehp[j] < emaxhp[j]) ehp[j] = Math.min(emaxhp[j], ehp[j] + amt);
      }
    }
    ehp[playerKing] = Math.min(emaxhp[playerKing], ehp[playerKing] + amt); addPuff(cx, cy, 0x6fe06f, 1.6);
  };
  const buffHorde = (dur: number): void => { hordeBuffSpeed = dur; hordeBuffDmg = dur; if (playerKing >= 0) addPuff(ex[playerKing], ey[playerKing], 0xffd24a, 1.8); };
  const raiseDead = (n: number): void => { if (playerKing < 0 || !ealive[playerKing]) return; const kx = ex[playerKing], ky = ey[playerKing]; for (let s = 0; s < n; s++) if (freeTop > 0 || nEnt < CAP) { spawnE(kx + (rng() - 0.5) * 24, ky + (rng() - 0.5) * 24, playerFaction, rng() < 0.7 ? 0 : 2, PLAYER); } addPuff(kx, ky, FAC_PROJ[playerFaction].glow, 1.8); };
  interface Abil { n: string; cd: number; go: () => void; }
  // E + R je Fraktion (0 Mensch .. 5 Riese). Schaden/Heilung/Buff/Beschwören passend zum Fraktions-Charakter.
  const ABIL: { e: Abil; r: Abil }[] = [
    { e: { n: "Heilruf", cd: 13, go: () => healAllies(72, 55) }, r: { n: "Schlachtruf", cd: 20, go: () => buffHorde(9) } },              // Mensch
    { e: { n: "Pfeilhagel", cd: 11, go: () => aoeDamage(52, 50) }, r: { n: "Segen", cd: 18, go: () => { healAllies(72, 32); buffHorde(7); } } }, // Elf
    { e: { n: "Wuchtschlag", cd: 10, go: () => aoeDamage(44, 80) }, r: { n: "Blutrausch", cd: 18, go: () => buffHorde(10) } },              // Ork
    { e: { n: "Erwecken", cd: 16, go: () => raiseDead(7) }, r: { n: "Seuche", cd: 14, go: () => aoeDamage(54, 46) } },                       // Untot
    { e: { n: "Sprengladung", cd: 12, go: () => aoeDamage(40, 100) }, r: { n: "Steinhaut", cd: 20, go: () => { shieldTimer = 8; if (playerKing >= 0) addPuff(ex[playerKing], ey[playerKing], 0x9aa890, 1.6); } } }, // Zwerg
    { e: { n: "Stampfer", cd: 10, go: () => aoeDamage(56, 80) }, r: { n: "Urzorn", cd: 20, go: () => { buffHorde(9); shieldTimer = Math.max(shieldTimer, 5); } } }, // Riese
  ];
  // DASH: Burst ~26 Grid in Laufrichtung (begehbar bleiben). SCHILD: -50% Schaden für 5s.
  // Richtung direkt aus den Tasten (nicht aus pInX -> funktioniert auch wenn Richtung+Space gleichzeitig kommen).
  const doDash = (): boolean => {
    if (playerKing < 0 || !ealive[playerKing]) return false;
    const ksx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
    const ksy = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
    let dx = ksx + ksy, dy = -ksx + ksy; const m = Math.hypot(dx, dy);
    if (m === 0) return false; dx /= m; dy /= m;
    let nx = ex[playerKing], ny = ey[playerKing];
    for (let s = 0; s < 26; s++) { const tx = nx + dx, ty = ny + dy; let moved = false; if (passable(tx, ny)) { nx = tx; moved = true; } if (passable(nx, ty)) { ny = ty; moved = true; } if (!moved) break; }
    ex[playerKing] = nx; ey[playerKing] = ny; prevX[playerKing] = nx; prevY[playerKing] = ny; // Teleport: Interpolation mitziehen
    addPuff(nx, ny, 0xffffff, 0.8); return true;
  };
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase(); keys.add(k);
    if (!playerActive) return;
    if ((k === " " || e.code === "Space") && dashCd <= 0) { if (doDash()) dashCd = 5; }
    else if (k === "q" && shieldCd <= 0 && playerKing >= 0 && ealive[playerKing]) { shieldTimer = 5; shieldCd = 10; addPuff(ex[playerKing], ey[playerKing], 0x7fb0ff, 1.2); }
    else if (k === "e" && eCd <= 0 && playerKing >= 0 && ealive[playerKing]) { const a = ABIL[playerFaction].e; a.go(); eCd = a.cd; audio.magic(ex[playerKing], ey[playerKing], playerFaction); } // E = Fraktions-Fähigkeit 1
    else if (k === "r" && rCd <= 0 && playerKing >= 0 && ealive[playerKing]) { const a = ABIL[playerFaction].r; a.go(); rCd = a.cd; audio.magic(ex[playerKing], ey[playerKing], playerFaction); } // R = Fraktions-Fähigkeit 2
    else if (k === "f") { orderMode = orderMode === 2 ? 0 : 2; audio.play("ui"); }     // F = RÜCKZUG an König (toggle)
    else if (k === "g") { orderMode = 0; audio.play("ui"); }                            // G = FOLGEN/Sammeln (Befehl aufheben)
  });
  window.addEventListener("keyup", (e) => { keys.delete(e.key.toLowerCase()); });

  // ── 30 Hz FIXED-STEP-SIM + RENDER-INTERPOLATION (Gaffer-Akkumulator) ──
  // Sim läuft 30x/s (DT_FIX=2 -> identisch zum alten 60fps-Tempo/Timing), Render interpoliert prevX->ex
  // pro Bildschirm-Frame -> glatt bei jeder Monitor-Hz UND ~2-5x weniger Sim-Last (Kampf/Suche/Separation).
  const DT_FIX = 2, HSTEP = 1000 / 30, STORM_DMG = 2.2;
  let simFrame = 0;
  const simTick = (): void => {
    simFrame++;
    // 1) Spatial-Grid neu aufbauen (nur lebende Units)
    gridHead.fill(-1);
    for (let i = decorCount; i < nEnt; i++) { if (!ealive[i]) continue; const c = clampCell(ey[i]) * GW + clampCell(ex[i]); gridNext[i] = gridHead[c]; gridHead[c] = i; }
    for (let b = 0; b < buildingIdx.length; b++) { const i = buildingIdx[b]; if (!ealive[i]) continue; const c = clampCell(ey[i]) * GW + clampCell(ex[i]); gridNext[i] = gridHead[c]; gridHead[c] = i; } // Gebäude angreifbar machen
    // 1b) Sturmzone in Phasen schrumpfen
    zoneTimer += HSTEP / 1000;
    if (zoneTimer > 38 && zoneTarget > 95) { zoneTimer = 0; zoneTarget *= 0.85; } // viel langsamer: ~40s Atempause/Stufe, mildere Schritte
    if (Math.abs(zoneR - zoneTarget) > 0.3) { zoneR += (zoneTarget - zoneR) * Math.min(1, 0.006 * DT_FIX); drawZone(); }
    const zr2 = zoneR * zoneR;
    buildKingFlow(kingIdx[PLAYER]);                              // Spieler-Horde: Pfad zum König JEDEN Tick frisch (kein Stuck/Verirren)
    buildKingFlow(kingIdx[1 + (simFrame % (PLAYERS - 1))]);      // übrige Könige Round-Robin
    // 2) Kampf + Bewegung (SoA, Index i; Deko 0..decorCount übersprungen)
    for (let i = decorCount; i < nEnt; i++) {
      if (!ealive[i]) continue;
      const isPlayer = playerActive && i === playerKing;
      const mine = eowner[i] === PLAYER;
      const ty = etype[i], sp = T_speed[ty] * FAC_SPD[efac[i]] * (isPlayer && buffSpeed > 0 ? 1.5 : 1) * (mine && hordeBuffSpeed > 0 ? 1.35 : 1);
      let tg = etarget[i];
      if (tg < 0 || !ealive[tg] || i % 32 === simFrame % 32) { const e = findEnemy(i); if (e >= 0) { etarget[i] = e; tg = e; } else if (tg >= 0 && !ealive[tg]) { etarget[i] = -1; tg = -1; } }
      let mvx = 0, mvy = 0;
      if (tg >= 0 && ealive[tg]) {
        const dx = ex[tg] - ex[i], dy = ey[tg] - ey[i], d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rng = ty === 5 && efac[i] === 1 ? 28 : T_range[ty];                          // Elf-Champion: große Reichweite
        if (d <= rng) {                                                                   // in Reichweite -> angreifen (auch Spieler)
          ecd[i] -= DT_FIX;
          if (ecd[i] <= 0) { ecd[i] = T_cd[ty]; if (eranged[i]) { fireArrow(i, tg); eatk[i] = 10; } else { eatk[i] = 14; audio.play("melee", ex[i], ey[i]); ehp[tg] -= T_atk[ty] * FAC_DMG[efac[i]] * (isPlayer ? playerDmgMult * (buffDmg > 0 ? 1.5 : 1) : 1) * (mine && hordeBuffDmg > 0 ? 1.35 : 1) * (tg === playerKing && shieldTimer > 0 ? 0.5 : 1); eflash[tg] = 6; if (ty === 5 && efac[i] === 2) cleave(i, tg); if (ehp[tg] <= 0) killE(tg); } } // Ork-Champion: Cleave
          if (eranged[i] && d < 16 && !isPlayer) { mvx = -dx / d * sp; mvy = -dy / d * sp; } // Fernkämpfer kitet
        } else if (!isPlayer) { mvx = dx / d * sp; mvy = dy / d * sp; }                   // hinlaufen (Spieler steuert selbst)
      }
      if (ty === 5 && efac[i] === 0 && (simFrame + i) % 20 === 0) {                        // Mensch-Champion (Paladin): Heil-Aura für Verbündete
        const cx = clampCell(ex[i]), cy = clampCell(ey[i]), uf = eowner[i];
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const ng = cx + ox, mg = cy + oy; if (ng < 0 || mg < 0 || ng >= GW || mg >= GW) continue;
          for (let j = gridHead[mg * GW + ng]; j !== -1; j = gridNext[j]) {
            if (!ealive[j] || eowner[j] !== uf) continue;
            const ddx = ex[j] - ex[i], ddy = ey[j] - ey[i];
            if (ddx * ddx + ddy * ddy < 144 && ehp[j] < emaxhp[j]) ehp[j] = Math.min(emaxhp[j], ehp[j] + 6);
          }
        }
      }
      if (!isPlayer && mvx === 0 && mvy === 0) {                                          // kein Kampf-Move -> Zielpunkt je Befehl ansteuern
        const k = kingIdx[eowner[i]];
        let gxT: number, gyT: number, hold: number, viaFlow: boolean;
        if (orderMode === 1 && mine) { gxT = orderX; gyT = orderY; hold = 9; viaFlow = false; }                // ANGRIFF: zum Rallypunkt marschieren
        else if (k >= 0 && k !== i) { gxT = ex[k]; gyT = ey[k]; hold = orderMode === 2 && mine ? 5 : 15; viaFlow = true; } // FOLGEN/RÜCKZUG: zum König (Flow umgeht Wasser/Berge)
        else { gxT = MAP / 2; gyT = MAP / 2; hold = 2; viaFlow = false; }                                      // König tot/verwaist -> Mitte
        const ddx = gxT - ex[i], ddy = gyT - ey[i], dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        if (dist > hold) {
          const approach = Math.min(1, (dist - hold) / 10);                                                    // Kraft rampt ein -> kein Überschwingen/Zittern
          let dirx = ddx / dist, diry = ddy / dist;
          if (viaFlow) {                                                                                       // Flow-Field: garantierter Weg um Hindernisse zum König zurück
            const fbase = eowner[i] * FW * FW; let fx = kingFlowX[fbase + flowCell(ex[i], ey[i])], fy = kingFlowY[fbase + flowCell(ex[i], ey[i])];
            if (fx === 0 && fy === 0 && dist > hold + 6) {                                                     // Sink-/Randzelle -> beste Nachbarzelle sampeln (nie endgültig stuck)
              const cx = (ex[i] / FCELL) | 0, cy = (ey[i] / FCELL) | 0;
              for (let nn = 0; nn < 8; nn++) { const ncx = cx + FNX[nn], ncy = cy + FNY[nn]; if (ncx < 0 || ncy < 0 || ncx >= FW || ncy >= FW) continue; const nf = fbase + ncy * FW + ncx; if (kingFlowX[nf] !== 0 || kingFlowY[nf] !== 0) { fx = FNX[nn] * 70; fy = FNY[nn] * 70; break; } }
            }
            if (fx !== 0 || fy !== 0) { const fm = Math.hypot(fx, fy) || 1; dirx = fx / fm; diry = fy / fm; }
          }
          const fsp = sp * approach * (orderMode === 2 && mine ? 1.18 : 0.95);                                 // Rückzug etwas schneller
          mvx = dirx * fsp; mvy = diry * fsp;
        }
      }
      if (isPlayer) { const tvx = pInX * sp, tvy = pInY * sp; pkvx += (tvx - pkvx) * 0.4; pkvy += (tvy - pkvy) * 0.4; mvx = pkvx; mvy = pkvy; } // Königs-Smoothing (nur Spieler-Input, NICHT von Units geschoben)
      // Sturm: außerhalb der Zone Dauerschaden; KI flieht rein, Spieler bleibt steuerbar.
      const odx = zoneX - ex[i], ody = zoneY - ey[i], od2 = odx * odx + ody * ody;
      if (od2 > zr2) {
        if (!isPlayer) { const od = Math.sqrt(od2) || 1; mvx = odx / od * sp; mvy = ody / od * sp; }
        ehp[i] -= STORM_DMG * (isPlayer && shieldTimer > 0 ? 0.5 : 1); eflash[i] = 4; if (ehp[i] <= 0) { killE(i); continue; }
      }
      // Separation: Abstoßung naher Units -> Front statt Pile. KÖNIGE SIND IMMUN -> der Spieler-König wird NIE
      // von seiner Horde geschoben (autoritäre Steuerung).
      if (!eking[i]) { const cx = clampCell(ex[i]), cy = clampCell(ey[i]); let px = 0, py = 0, n = 0;
        for (let dy = -1; dy <= 1 && n < 8; dy++) for (let dx = -1; dx <= 1 && n < 8; dx++) {
          const ng = cx + dx, mg = cy + dy; if (ng < 0 || mg < 0 || ng >= GW || mg >= GW) continue;
          for (let j = gridHead[mg * GW + ng]; j !== -1 && n < 8; j = gridNext[j]) {
            if (j === i || !ealive[j]) continue;
            const axx = ex[i] - ex[j], ayy = ey[i] - ey[j], a2 = axx * axx + ayy * ayy;
            if (a2 > 0.01 && a2 < 5.0) { const aa = Math.sqrt(a2); px += axx / aa; py += ayy / aa; n++; }
          }
        }
        if (n > 0) { mvx += px / n * sp * 0.5; mvy += py / n * sp * 0.5; } }
      // GESCHWINDIGKEITS-GLÄTTUNG pro Unit: Ziel-Velocity lerpen -> kein Zittern/Orbit am König (Spieler nutzt pkvx).
      if (!isPlayer) { evx[i] += (mvx - evx[i]) * 0.32; evy[i] += (mvy - evy[i]) * 0.32; mvx = evx[i]; mvy = evy[i]; }
      if (mvx !== 0 || mvy !== 0) { const nx = ex[i] + mvx * DT_FIX, ny = ey[i] + mvy * DT_FIX; if (passable(nx, ey[i])) ex[i] = nx; if (passable(ex[i], ny)) ey[i] = ny; }
      if (eflash[i] > 0) eflash[i] -= DT_FIX;
      if (eatk[i] > 0) eatk[i] -= DT_FIX;
    }
  };
  // Render-Projektion + FRUSTUM-CULL: interpolierte gx/gy -> iso screenX/footY, aber nur für SICHTBARE
  // Units (evis). Off-screen-Units überspringen das teure sampleH -> Projektion kostet O(sichtbar), nicht
  // O(gesamt). Plus billiges "Leben": Marsch-Hüpfer bei Bewegung + Pop beim Zuschlagen (kein Atlas-Frame).
  const projectInterp = (a: number): void => {
    const sc0 = world.scale.x, mP = 80;
    const vx0 = (-mP - world.x) / sc0, vx1 = (app.screen.width + mP - world.x) / sc0;
    const vy0 = (-mP - world.y) / sc0, vy1 = (app.screen.height + mP - world.y) / sc0 + ELEV; // +ELEV: Höhen-Lift hebt y
    for (let i = 0; i < nEnt; i++) {
      if (!ealive[i]) { evis[i] = 0; continue; }
      const ix = prevX[i] + (ex[i] - prevX[i]) * a, iy = prevY[i] + (ey[i] - prevY[i]) * a;
      const sx = (ix - iy) * HW, isoY = (ix + iy) * HH;                                        // billige iso-Pos (kein sampleH)
      if (sx < vx0 || sx > vx1 || isoY < vy0 || isoY > vy1) { evis[i] = 0; continue; }         // off-screen -> kein sampleH
      let fy = isoY - elevLift(sampleH(ix, iy));
      if (Math.abs(ex[i] - prevX[i]) + Math.abs(ey[i] - prevY[i]) > 0.05) fy -= Math.abs(Math.sin(time * 9 + i)) * 1.6; // Marsch-Hüpfer
      if (eatk[i] > 0) fy -= 2.2;                                                                                       // Zuschlag-Pop
      screenX[i] = sx; footY[i] = fy; evis[i] = 1;
    }
  };

  // ── MENÜ + SPIEL-ZUSTAND (DOM-Overlay über dem Canvas; Vorschau-Auto-Battle läuft dahinter) ──
  const FAC_NAMES = ["Menschen", "Elfen", "Orks", "Untote", "Zwerge", "Riesen"];
  const mstyle = document.createElement("style");
  mstyle.textContent = `
    #menu{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;font:14px/1.5 monospace;color:#cfe;background:rgba(4,10,20,.5);}
    #menu .panel{background:rgba(8,16,30,.94);border:2px solid #3a5a86;border-radius:10px;padding:26px 30px;max-width:540px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.6);}
    #menu h1{margin:0 0 6px;font-size:34px;letter-spacing:3px;color:#ffd24a;text-shadow:0 2px 0 #6a4a00;}
    #menu p{margin:6px 0 16px;color:#9fc;}
    #menu .row{display:flex;align-items:center;gap:8px;justify-content:center;margin:10px 0;flex-wrap:wrap;}
    #menu .row>span{width:104px;text-align:right;color:#8ab;}
    #menu button{font:13px monospace;color:#cfe;background:#16243c;border:1px solid #3a5a86;border-radius:6px;padding:8px 12px;cursor:pointer;}
    #menu button:hover{background:#1d3052;}
    #menu button.sel{background:#2c64a8;border-color:#7fb0ff;color:#fff;}
    #menu .play{display:block;width:100%;margin:18px auto 4px;padding:14px;font-size:18px;background:#2c7a3a;border-color:#5fd07a;color:#fff;letter-spacing:2px;}
    #menu .play:hover{background:#369048;}
    #menu .hint{font-size:12px;color:#789;margin-top:12px;}`;
  document.head.appendChild(mstyle);
  const overlay = document.createElement("div"); overlay.id = "menu"; document.body.appendChild(overlay);
  const mbtn = (label: string, on: string, sel: boolean): string => `<button data-on="${on}"${sel ? ' class="sel"' : ""}>${label}</button>`;
  const renderMenu = (): void => {
    overlay.innerHTML = `<div class="panel"><h1>HORDE.IO</h1>
      <p>Steuere deinen König, sammle Seelen, lass deine Horde wachsen — sei der letzte König.</p>
      <div class="row"><span>Fraktion</span>${FAC_NAMES.map((n, i) => mbtn(n, "fac" + i, playerFaction === i)).join("")}</div>
      <div class="row"><span>Schwierigkeit</span>${DIFF.map((d, i) => mbtn(d.label, "dif" + i, difficulty === i)).join("")}</div>
      <button class="play" data-on="play">SPIELEN</button>
      <p class="hint">WASD bewegen · Space Dash · Q Schild · E/R Fraktions-Fähigkeiten · Rechtsklick Angriff · F Rückzug · G Folgen · Seelen sammeln · Bäume fällt der König</p></div>`;
  };
  const showMenu = (): void => { gameState = "menu"; playerActive = false; audio.setAmbient(false); newRound(); overlay.style.display = "flex"; renderMenu(); };
  const startGame = (): void => { gameState = "playing"; playerActive = true; survT = 0; audio.start(); audio.setAmbient(true); newRound(); overlay.style.display = "none"; };
  const showOver = (title: string, sub: string): void => {
    if (gameState === "over") return; gameState = "over"; audio.setAmbient(false); overlay.style.display = "flex";
    overlay.innerHTML = `<div class="panel"><h1>${title}</h1><p>${sub}</p><button class="play" data-on="again">NOCHMAL</button><button data-on="menu" style="margin-top:8px">ZURÜCK ZUM MENÜ</button></div>`;
  };
  overlay.addEventListener("click", (e) => {
    const on = (e.target as HTMLElement).getAttribute?.("data-on"); if (!on) return;
    audio.start(); audio.play("ui");
    if (on.startsWith("fac")) { playerFaction = +on.slice(3); renderMenu(); }
    else if (on.startsWith("dif")) { difficulty = +on.slice(3); renderMenu(); }
    else if (on === "play" || on === "again") startGame();
    else if (on === "menu") showMenu();
  });

  // ── AUDIO-OPTIONEN (⚙ oben rechts): Master/Musik/SFX-Slider + Stumm; Werte persistiert (localStorage). ──
  const astyle = document.createElement("style");
  astyle.textContent = `
    #audiobtn{position:fixed;top:8px;right:10px;z-index:30;font-size:20px;line-height:1;width:38px;height:38px;
      background:rgba(8,16,30,.86);border:1px solid #3a5a86;border-radius:8px;color:#cfe;cursor:pointer;}
    #audiobtn:hover{background:#1d3052;}
    #audiopanel{position:fixed;top:52px;right:10px;z-index:30;display:none;width:230px;font:13px/1.5 monospace;color:#cfe;
      background:rgba(8,16,30,.96);border:1px solid #3a5a86;border-radius:10px;padding:14px 16px;box-shadow:0 10px 40px rgba(0,0,0,.6);}
    #audiopanel h2{margin:0 0 10px;font-size:15px;letter-spacing:2px;color:#ffd24a;}
    #audiopanel label{display:block;margin:9px 0 2px;color:#8ab;}
    #audiopanel input[type=range]{width:100%;accent-color:#7fb0ff;}
    #audiopanel .mute{display:flex;align-items:center;gap:8px;margin-top:12px;color:#9fc;cursor:pointer;}`;
  document.head.appendChild(astyle);
  const abtn = document.createElement("button"); abtn.id = "audiobtn"; abtn.textContent = "🔊"; abtn.title = "Audio-Optionen"; document.body.appendChild(abtn);
  const apanel = document.createElement("div"); apanel.id = "audiopanel"; document.body.appendChild(apanel);
  const pct = (v: number): number => Math.round(v * 100);
  apanel.innerHTML = `<h2>AUDIO</h2>
    <label>Gesamt <span id="vMaster">${pct(audio.master)}</span>%</label><input id="sMaster" type="range" min="0" max="100" value="${pct(audio.master)}">
    <label>Musik <span id="vMusic">${pct(audio.music)}</span>%</label><input id="sMusic" type="range" min="0" max="100" value="${pct(audio.music)}">
    <label>Effekte <span id="vSfx">${pct(audio.sfx)}</span>%</label><input id="sSfx" type="range" min="0" max="100" value="${pct(audio.sfx)}">
    <label class="mute"><input id="cMute" type="checkbox" ${audio.muted ? "checked" : ""}> Stumm</label>`;
  const $ = (id: string): HTMLElement => apanel.querySelector("#" + id) as HTMLElement;
  const sMaster = $("sMaster") as HTMLInputElement, sMusic = $("sMusic") as HTMLInputElement, sSfx = $("sSfx") as HTMLInputElement, cMute = $("cMute") as HTMLInputElement;
  const bindSlider = (el: HTMLInputElement, lab: string, key: "master" | "music" | "sfx"): void => {
    el.addEventListener("input", () => { const v = +el.value / 100; $(lab).textContent = `${el.value}`; audio.setVolumes({ [key]: v }); });
  };
  bindSlider(sMaster, "vMaster", "master"); bindSlider(sMusic, "vMusic", "music"); bindSlider(sSfx, "vSfx", "sfx");
  cMute.addEventListener("change", () => { audio.setVolumes({ muted: cMute.checked }); abtn.textContent = cMute.checked ? "🔇" : "🔊"; });
  abtn.textContent = audio.muted ? "🔇" : "🔊";
  abtn.addEventListener("click", () => { audio.start(); apanel.style.display = apanel.style.display === "block" ? "none" : "block"; });

  showMenu();

  let acc = 0, time = 0, frame = 0, victoryTimer = 0, simMs = 0, sortMs = 0, accSim = 0;
  app.ticker.add((t) => {
    const dms = Math.min(t.deltaMS, 100);
    const dtR = Math.min(t.deltaTime, 4); // Bildschirm-Frame-Einheiten für Echtzeit-FX (Pfeile/Poofs)
    time += dms / 1000; frame++;
    terrainShader.resources.terr.uniforms.uTime = time;
    // Spieler-König-Input: Bildschirm-Richtung (WASD/Pfeile) -> Iso-Grid-Richtung (rechts=+gx-gy, runter=+gx+gy).
    { const ksx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
      const ksy = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
      const gdx = ksx + ksy, gdy = -ksx + ksy, m = Math.hypot(gdx, gdy);
      if (m > 0) { pInX = gdx / m; pInY = gdy / m; } else { pInX = 0; pInY = 0; } }
    // Fähigkeits-Cooldowns + Buff-Timer + Überlebenszeit (Echtzeit)
    { const sdt = dms / 1000; if (dashCd > 0) dashCd = Math.max(0, dashCd - sdt); if (shieldCd > 0) shieldCd = Math.max(0, shieldCd - sdt); if (shieldTimer > 0) shieldTimer = Math.max(0, shieldTimer - sdt); if (buffSpeed > 0) buffSpeed = Math.max(0, buffSpeed - sdt); if (buffDmg > 0) buffDmg = Math.max(0, buffDmg - sdt); if (eCd > 0) eCd = Math.max(0, eCd - sdt); if (rCd > 0) rCd = Math.max(0, rCd - sdt); if (hordeBuffSpeed > 0) hordeBuffSpeed = Math.max(0, hordeBuffSpeed - sdt); if (hordeBuffDmg > 0) hordeBuffDmg = Math.max(0, hordeBuffDmg - sdt); if (gameState === "playing") survT += sdt; }
    // Fixed-Step-Sim: so viele 30Hz-Ticks wie nötig (max 5 gegen Spiral-of-Death).
    accSim += dms;
    let steps = 0;
    const tSim = performance.now();
    while (accSim >= HSTEP && steps < 5) { prevX.set(ex); prevY.set(ey); simTick(); accSim -= HSTEP; steps++; }
    if (steps === 5) accSim = 0;
    if (steps > 0) simMs = (performance.now() - tSim) / steps; // Kosten PRO 30Hz-Tick (0 auf Frames ohne Tick)
    const alpha = Math.min(1, accSim / HSTEP);
    // Ballistische Pfeile (Echtzeit): homen aufs Ziel, z = Sinus-Bogen; dreht zur Flugrichtung; Staub.
    for (let i = arrows.length - 1; i >= 0; i--) {
      const ar = arrows[i];
      ar.age += dms / 1000;
      if (ealive[ar.tgt]) { ar.tx = ex[ar.tgt]; ar.ty = ey[ar.tgt]; }                     // homing solange Ziel lebt
      const prog = Math.min(1, ar.age / ar.T);
      ar.gx = ar.sx + (ar.tx - ar.sx) * prog; ar.gy = ar.sy + (ar.ty - ar.sy) * prog;
      const z = Math.sin(prog * Math.PI) * ar.apex;
      const p = worldToIso(ar.gx, ar.gy), sy = p.y - elevLift(sampleH(ar.gx, ar.gy)) - z;
      ar.spr.x = p.x; ar.spr.y = sy;
      if (ar.bolt) { if ((frame & 1) === 0) addPuff(ar.gx, ar.gy, FAC_PROJ[ar.fac].glow, 0.3); } // Magier-Bolt: Glüh-Spur (nicht drehen -> Orb)
      else { if (ar.psx !== 0 || ar.psy !== 0) ar.spr.rotation = Math.atan2(sy - ar.psy, p.x - ar.psx); ar.psx = p.x; ar.psy = sy; } // Pfeil: zur Flugrichtung drehen
      if (prog >= 1) {
        if (ealive[ar.tgt]) { ehp[ar.tgt] -= ar.dmg * (ar.tgt === playerKing && shieldTimer > 0 ? 0.5 : 1); eflash[ar.tgt] = 6; if (ehp[ar.tgt] <= 0) killE(ar.tgt); }
        if (ar.bolt) hitFX(ar.gx, ar.gy, ar.fac); else addPuff(ar.gx, ar.gy, 0xffb050, 0.35);  // Fraktions-Treffer vs. oranger Pfeil-Funke
        ar.spr.destroy(); arrows.splice(i, 1);
      }
    }
    // Todes-Poofs + Loot-Orbs aufsteigen + verblassen (Echtzeit)
    for (let i = puffs.length - 1; i >= 0; i--) {
      const pf = puffs[i]; pf.life -= 0.045 * dtR; pf.spr.alpha = Math.max(0, pf.life) * 0.8;
      pf.spr.scale.set(0.5 + (1 - pf.life) * 0.6); pf.spr.y -= 0.3 * dtR;
      if (pf.life <= 0) { pf.spr.destroy(); puffs.splice(i, 1); }
    }
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i]; o.life -= 0.012 * dtR; o.spr.y -= 0.6 * dtR; o.spr.alpha = Math.max(0, o.life);
      if (o.life <= 0) { o.spr.destroy(); orbs.splice(i, 1); }
    }
    // SEELEN: zum Spieler-König magnetisieren (Sog) + einsammeln -> neuer Vasall (Horde wächst).
    if (playerKing >= 0 && ealive[playerKing] === 1) {
      const kx = ex[playerKing], ky = ey[playerKing], pf = efac[playerKing];
      for (let i = souls.length - 1; i >= 0; i--) {
        const s = souls[i], dx = kx - s.gx, dy = ky - s.gy, d2 = dx * dx + dy * dy;
        if (d2 < 64) {                                                   // eingesammelt (< 8 grid)
          if (s.gold) {                                                  // Gold-Seele -> Champion beschwören (+ extra XP)
            if (freeTop > 0 || nEnt < CAP) spawnE(kx + (rng() - 0.5) * 16, ky + (rng() - 0.5) * 16, pf, 5, PLAYER);
            onPlayerSoul(); onPlayerSoul(); addPuff(kx, ky, 0xffd24a, 1.5);
          } else {                                                       // grüne Seele -> Vasall + König-XP
            if (freeTop > 0 || nEnt < CAP) { const r = rng(), ty = r < 0.72 ? 0 : r < 0.86 ? 1 : r < 0.94 ? 2 : 6; spawnE(kx + (rng() - 0.5) * 16, ky + (rng() - 0.5) * 16, pf, ty, PLAYER); } // gel. Seele -> Vasall (auch Magier)
            onPlayerSoul();
          }
          s.spr.destroy(); souls.splice(i, 1); continue;
        }
        if (d2 < 6400) {                                                 // < 80 grid -> magnetisieren
          const d = Math.sqrt(d2) || 1, pull = 2.8 * dtR;
          s.gx += dx / d * pull; s.gy += dy / d * pull;
          const p = worldToIso(s.gx, s.gy); s.spr.x = p.x; s.spr.y = p.y - elevLift(sampleH(s.gx, s.gy)) - 4;
        }
      }
      // POWER-UPS aufsammeln (< 12 grid) -> Buff anwenden, dann neu verteilen (bleibt Karten-Ressource).
      for (const po of pows) {
        const dx = kx - po.gx, dy = ky - po.gy;
        if (dx * dx + dy * dy < 144) {
          if (po.type === 0) buffSpeed = 6; else if (po.type === 1) buffDmg = 6;
          else if (po.type === 2) ehp[playerKing] = Math.min(emaxhp[playerKing], ehp[playerKing] + 80);
          else shieldTimer = Math.max(shieldTimer, 5);
          addPuff(po.gx, po.gy, POW_COL[po.type], 1.0); placePow(po);
        }
      }
    }
    // KAMERA folgt dem Spieler-König (geglättet); beim Rundenstart hart snappen. Vor der Projektion,
    // damit der Frustum-Cull die gefolgte Kamera nutzt. Spieler tot -> einem lebenden König zuschauen.
    let camTarget = playerKing >= 0 && ealive[playerKing] === 1 ? playerKing : -1;
    if (camTarget < 0) for (let p = 0; p < PLAYERS; p++) if (kingIdx[p] >= 0) { camTarget = kingIdx[p]; break; }
    if (camTarget >= 0) {
      const playerKing = camTarget; // ab hier: Kamera-Ziel (Spieler oder zugeschauter König)
      const ix = prevX[playerKing] + (ex[playerKing] - prevX[playerKing]) * alpha, iy = prevY[playerKing] + (ey[playerKing] - prevY[playerKing]) * alpha;
      const psx = (ix - iy) * HW, psy = (ix + iy) * HH - elevLift(sampleH(ix, iy)), sc0 = world.scale.x;
      const tx = app.screen.width / 2 - psx * sc0, ty = app.screen.height / 2 - psy * sc0;
      if (!camInit) { world.x = tx; world.y = ty; camInit = true; } else { world.x += (tx - world.x) * 0.12; world.y += (ty - world.y) * 0.12; }
    }
    // AUDIO-LISTENER folgt der Kamera (Grid-Koordinaten -> Distanz-Gate). Schritt-Sound, solange der
    // Spieler-König läuft (play() self-throttlet auf den footstep-gap).
    if (camTarget >= 0) audio.setListener(ex[camTarget], ey[camTarget]);
    if (playerActive && playerKing >= 0 && ealive[playerKing] === 1 && (pInX !== 0 || pInY !== 0)) {
      audio.play("footstep", ex[playerKing], ey[playerKing]);
      // KÖNIG FÄLLT BÄUME: läuft der Spieler in einen Wald, hackt er den nächsten Baum vor sich weg -> Pfad öffnet sich.
      const kx = ex[playerKing], ky = ey[playerKing], fx = (kx + pInX * 2.5) | 0, fy = (ky + pInY * 2.5) | 0;
      let tr = -1;
      for (let dy = -1; dy <= 1 && tr < 0; dy++) for (let dx = -1; dx <= 1 && tr < 0; dx++) { const x = fx + dx, y = fy + dy; if (x < 0 || y < 0 || x >= N || y >= N) continue; const c = treeAt[x * N + y]; if (c >= 0 && ealive[c]) tr = c; }
      if (tr >= 0) {
        ehp[tr] -= 26 * dtR; addPuff(ex[tr], ey[tr], 0x6a4a2a, 0.35); if (frame % 8 === 0) audio.play("melee", kx, ky);
        if (ehp[tr] <= 0) { ealive[tr] = 0; unblockTree(ex[tr], ey[tr]); flowPass[flowCell(ex[tr], ey[tr])] = passable(ex[tr], ey[tr]) ? 1 : 0; addPuff(ex[tr], ey[tr], 0x3c7d2f, 1.1); audio.play("collapse", ex[tr], ey[tr], 0.6); if (rng() < 0.5) dropSoul(ex[tr], ey[tr]); }
      }
    }
    // RENDER: interpolierte Positionen -> Counting-Sort + Pool-Slots (EIN Draw-Call), dann König-FX.
    const tSort = performance.now();
    projectInterp(alpha);
    const drawn = renderUnits();
    sortMs = performance.now() - tSort;
    for (const kf of kingFX) {
      const i = kf.i, on = ealive[i] === 1 && evis[i] === 1; // off-screen Könige: FX aus (Pos wäre stale)
      kf.bg.visible = on; kf.fill.visible = on;
      if (!on) continue;
      const sc = T_scale[etype[i]] * FAC_SCALE[efac[i]] * UNIT_DRAW * (i === playerKing ? playerSizeMult : 1);
      const barY = footY[i] - 36 * sc - 5, w = i === playerKing ? 32 : 24;  // klar ÜBER dem Kopf (skaliert mit Königsgröße)
      const hpf = Math.max(0, ehp[i] / emaxhp[i]);
      kf.bg.x = screenX[i]; kf.bg.y = barY; kf.bg.width = w + 2;
      kf.fill.x = screenX[i] - w / 2; kf.fill.y = barY; kf.fill.width = w * hpf;
      kf.fill.tint = hpf > 0.5 ? 0x6fe06f : hpf > 0.25 ? 0xe0c040 : 0xe05050;
    }
    drawMini(); drawOrderMarker();
    // PIXELATE (nur ?style=bake): Welt gesnappt in Low-Res-RT, dann crisp hochskalieren (welt-verankert).
    if (pixelateBake && bakeRt && bakeSprite) {
      bakeThrottle = !bakeThrottle;
      if (bakeThrottle || drawn < 6000) {
        const camX = world.x, camY = world.y, zx = world.scale.x;
        const snapX = Math.round(camX / PX) * PX, snapY = Math.round(camY / PX) * PX;
        world.renderable = true; bakeSprite.visible = false;
        world.scale.set(zx / PX); world.x = snapX / PX; world.y = snapY / PX;
        app.renderer.render({ container: world, target: bakeRt, clear: true });
        world.scale.set(zx); world.x = camX; world.y = camY;
        bakeSprite.x = camX - snapX; bakeSprite.y = camY - snapY;
        bakeSprite.visible = true; world.renderable = false;
      }
    }
    acc += t.deltaMS;
    if (acc > 250) {
      acc = 0;
      let kingsAlive = 0; for (let p = 0; p < PLAYERS; p++) if (kingIdx[p] >= 0) kingsAlive++;
      let total = 0, myHorde = 0; for (let i = decorCount; i < nEnt; i++) if (ealive[i]) { total++; if (eowner[i] === PLAYER) myHorde++; }
      const pAlive = playerKing >= 0 && ealive[playerKing] === 1;
      const me = pAlive ? `Du: Lv${playerLevel} · ${Math.max(0, ehp[playerKing]) | 0}/${emaxhp[playerKing] | 0} HP · Horde ${myHorde}` : `besiegt (Zuschauer)`;
      const dashS = dashCd > 0 ? `${Math.ceil(dashCd)}s` : "●", shieldS = shieldTimer > 0 ? `aktiv ${Math.ceil(shieldTimer)}s` : shieldCd > 0 ? `${Math.ceil(shieldCd)}s` : "●";
      const buffs = (buffSpeed > 0 ? " ⚡Tempo" : "") + (buffDmg > 0 ? " ⚔Schaden" : "");
      const cmd = ["Folgen", "⚔ANGRIFF", "🛡RÜCKZUG"][orderMode];
      const ab = ABIL[playerFaction], eS = eCd > 0 ? `${Math.ceil(eCd)}s` : "●", rS = rCd > 0 ? `${Math.ceil(rCd)}s` : "●";
      const hb = (hordeBuffSpeed > 0 || hordeBuffDmg > 0) ? " ★Buff" : "";
      hud.textContent = `Horde.IO — ${me} · Könige ${kingsAlive}/${PLAYERS} · ${total} Units · Befehl: ${cmd} (Rechtsklick/F/G) · Dash(Space) ${dashS} · Schild(Q) ${shieldS} · ${ab.e.n}(E) ${eS} · ${ab.r.n}(R) ${rS}${buffs}${hb} · ${app.ticker.FPS.toFixed(0)} FPS (sim ${simMs.toFixed(1)}) · Sturm R${zoneR | 0}`;
      const roundOver = kingsAlive <= 1;
      if (playerActive && gameState === "playing" && (roundOver || !pAlive)) {
        const place = pAlive ? 1 : kingsAlive + 1, tsec = survT | 0;
        showOver(pAlive ? "SIEG!" : "BESIEGT", `Platz ${place}/${PLAYERS} · Lv${playerLevel} · Horde ${myHorde} · ${(tsec / 60) | 0}:${`${tsec % 60}`.padStart(2, "0")} überlebt`);
      } else if (!playerActive && roundOver) {
        victoryTimer += 0.25; if (victoryTimer >= 5) { victoryTimer = 0; newRound(); } // Menü-Vorschau: Auto-Neustart
      } else victoryTimer = 0;
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
function makeArrowTexture(app: Application): Texture {
  const gr = new Graphics();
  gr.moveTo(-6, 0).lineTo(3, 0).stroke({ color: 0x4a3318, width: 2 });   // Schaft
  gr.poly([7, 0, 1, -3, 1, 3]).fill(0x2a1d0e);                            // Spitze
  const t = app.renderer.generateTexture({ target: gr, antialias: true });
  gr.destroy();
  return t;
}
// Magier-BOLT: leuchtender Orb je Fraktion — weiche Glüh-Hülle + heller Kern (Farbe = Fraktions-Identität).
function makeBoltTexture(app: Application, core: number, glow: number): Texture {
  const gr = new Graphics();
  gr.circle(0, 0, 8).fill({ color: glow, alpha: 0.30 });                  // weiche Aura
  gr.circle(0, 0, 4.5).fill({ color: glow, alpha: 0.72 });               // Hülle
  gr.circle(0, 0, 2.4).fill({ color: core, alpha: 1 });                  // heißer Kern
  const t = app.renderer.generateTexture({ target: gr, antialias: true });
  gr.destroy();
  return t;
}
function makePuffTexture(app: Application): Texture {
  const gr = new Graphics();
  gr.circle(0, 0, 7).fill({ color: 0xffffff, alpha: 0.5 });
  gr.circle(-2, -1, 4).fill({ color: 0xffffff, alpha: 0.5 });
  gr.circle(3, 1, 4).fill({ color: 0xffffff, alpha: 0.5 });               // Wölkchen-Form
  const t = app.renderer.generateTexture({ target: gr, antialias: true });
  gr.destroy();
  return t;
}
function makeBannerTexture(app: Application, color: number): Texture {
  const gr = new Graphics();
  gr.rect(-1, 0, 2, 28).fill(0x4a3318);                                    // Stange
  gr.poly([1, 0, 14, 4, 1, 11]).fill(color).stroke({ color: 0x161a22, width: 1, alpha: 0.7 }); // Wimpel
  gr.circle(0, -1, 2).fill(0xffd24a);                                      // Knauf
  const t = app.renderer.generateTexture({ target: gr, antialias: true });
  gr.destroy();
  return t;
}

main();
