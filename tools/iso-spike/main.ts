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

const TILE_W = 32, TILE_H = 16, HW = TILE_W / 2, HH = TILE_H / 2;
const MAP = 720, N = MAP + 1; // große Insel (16-Spieler-Battle-Royale)
const ELEV = 150;           // Screen-Y-Lift (markante Berge)
const NORM_K = 26;          // Höhen->Slope-Skala für die Beleuchtung
const WATER = 0.38, MOUNTAIN = 0.80; // höhere Block-Schwelle -> weniger gesperrte Fläche, mehr Pässe
const STEEP = 0.05;                  // Hang steiler als das -> unbegehbar (Klippe/Steilhang blockt wie Wasser)
const PLAYERS = 16, HORDE = 520, BUILDINGS = 520, TREES = 2200;
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
  // Begehbarkeits-Bitmap EINMAL vorberechnen (nicht Wasser/Hochgebirge/Steilhang/Fluss) -> O(1) im Tick.
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const k = i * N + j, h = H[k];
    PASS[k] = h >= WATER && h <= MOUNTAIN && slopeAt(i, j) < STEEP && WET[k] <= 0.0005 ? 1 : 0;
  }
}
// Droplet-basierte hydraulische Erosion (Sebastian-Lague-Muster): jeder Tropfen folgt dem
// Gefälle, trägt Sediment, erodiert bergab und lagert in Senken ab -> dendritische Täler/Flüsse.
function erode(drops: number): void {
  const inertia = 0.04, capF = 3.6, minSlope = 0.01, erodeR = 0.34, depositR = 0.28, evap = 0.018, grav = 5, life = 36;
  for (let d = 0; d < drops; d++) {
    let x = 1 + Math.random() * (N - 3), y = 1 + Math.random() * (N - 3);
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
const PAL: Record<string, Palette> = {
  human: palette(0x4f7bb0, 0xe0a07a, 0xffd24a),          // Stahlblau + Pfirsich-Haut
  elf: palette(0x4caf6a, 0xdcc0a4, 0xeadf9a),            // Smaragd + blasse Haut
  orc: palette(0xb0413a, 0x5e8f4f, 0xd8b34a, 0x5e636b),  // Karmesin + grüne Haut, dunkles Eisen
};
const OUTLINE: RGB = hexRGB(0x161a22), GOLD: RGB = hexRGB(0xffd24a);
const UW = 24, UH = 28, UCX = UW >> 1;
interface Pen { m: (x: number, y: number, c: RGB) => void; r: (x: number, y: number, c: RGB) => void; }
function makePen(buf: (RGB | 0)[]): Pen {
  const set = (x: number, y: number, c: RGB): void => { if (x >= 0 && x < UW && y >= 0 && y < UH) buf[y * UW + x] = c; };
  const m = (x: number, y: number, c: RGB): void => { set(x, y, c); set(UW - 1 - x, y, c); }; // gespiegelt -> Körper-Symmetrie
  return { m, r: set }; // r = roh (asymmetrische Waffen)
}
function drawBody(p: Pen, P: Palette, bodyW: number, torsoTop = 11, footY = 25): void {
  const half = bodyW >> 1;
  for (let y = 6; y <= 10; y++) for (let x = UCX - 2; x <= UCX; x++) p.m(x, y, P.skin[2]); // Kopf
  p.m(UCX - 2, 8, P.skin[3]); p.m(UCX - 1, 7, P.skin[3]); p.r(UCX - 1, 9, OUTLINE); p.r(UCX, 9, OUTLINE);
  for (let x = UCX - 2; x <= UCX; x++) p.m(x, 5, P.metal[2]);                            // Helm-Kappe
  for (let y = torsoTop; y <= footY - 4; y++) {                                          // Torso (oben hell)
    const tt = (y - torsoTop) / Math.max(1, footY - 4 - torsoTop), si = tt < 0.25 ? 3 : tt < 0.7 ? 2 : 1;
    for (let x = UCX - half; x <= UCX + half; x++) p.m(x, y, x === UCX - half || x === UCX + half ? P.cloth[0] : P.cloth[si]);
  }
  for (let x = UCX - half; x <= UCX + half; x++) p.m(x, footY - 4, P.accent);            // Gürtel
  for (let y = footY - 3; y <= footY; y++) { p.m(UCX - 2, y, P.cloth[0]); p.m(UCX, y, P.cloth[1]); } // Beine
}
function drawWarrior(p: Pen, P: Palette): void {
  drawBody(p, P, 7);
  for (let y = 13; y <= 19; y++) for (let x = 3; x <= 6; x++) p.r(x, y, x === 3 ? P.accent : P.metal[1]); // Rundschild links
  p.r(5, 16, P.metal[3]);
  for (let y = 4; y <= 15; y++) p.r(UW - 5, y, P.metal[3]); p.r(UW - 6, 13, P.metal[2]); p.r(UW - 4, 13, P.metal[2]); p.r(UW - 5, 16, P.accent); // Schwert rechts
}
function drawArcher(p: Pen, P: Palette): void {
  drawBody(p, P, 6);
  const bx = UW - 5, wood = P.cloth[0];
  const arc: [number, number][] = [[bx - 1, 5], [bx, 6], [bx, 7], [bx, 8], [bx, 9], [bx, 10], [bx, 11], [bx, 12], [bx, 13], [bx, 14], [bx, 15], [bx - 1, 16]];
  for (const [x, y] of arc) p.r(x, y, wood);                                             // Bogen-Bogen
  for (let y = 6; y <= 15; y++) p.r(bx - 2, y, shade(0x9aa3b0, -0.1));                    // Sehne
  p.r(bx - 3, 10, P.accent); p.r(bx - 4, 10, P.metal[2]);                                // Pfeil
}
function drawSpearman(p: Pen, P: Palette): void {
  drawBody(p, P, 6);
  const sx = UW - 6;
  for (let y = 1; y <= 22; y++) p.r(sx, y, P.metal[2]);                                  // langer Speer (hoch raus)
  p.r(sx, 0, P.accent); p.r(sx - 1, 2, P.accent); p.r(sx + 1, 2, P.accent);              // Speerspitze
}
function drawBrute(p: Pen, P: Palette): void {
  drawBody(p, P, 9, 10, 26);
  for (let y = 10; y <= 18; y++) p.m(UCX - 5, y, P.cloth[1]);                            // breitere Schultern
  for (let y = 4; y <= 16; y++) p.r(UW - 4, y, P.cloth[0]);                              // Axt-Stiel
  for (let y = 4; y <= 8; y++) for (let x = UW - 3; x <= UW - 1; x++) p.r(x, y, P.metal[2]); // Axt-Kopf
  p.r(UW - 1, 5, P.metal[3]); p.r(UW - 1, 7, P.metal[3]);
}
function drawKing(p: Pen, P: Palette): void {
  drawBody(p, P, 8, 10, 26);
  for (let y = 11; y <= 22; y++) { p.r(UCX - 5, y, P.accent); p.r(UCX - 6, y, shade(0xd8b34a, -0.35)); } // Umhang links
  for (let x = UCX - 3; x <= UCX + 2; x++) p.m(x, 4, GOLD);                              // Kronen-Band
  p.r(UCX - 3, 3, GOLD); p.r(UCX - 1, 2, GOLD); p.r(UCX + 1, 3, GOLD); p.r(UCX, 2, GOLD); // Zacken
  for (let y = 8; y <= 18; y++) p.r(UW - 5, y, P.metal[2]); p.r(UW - 5, 7, GOLD);        // Zepter
}
const DRAW: Record<string, (p: Pen, P: Palette) => void> = { warrior: drawWarrior, archer: drawArcher, spearman: drawSpearman, brute: drawBrute, king: drawKing };
// Eine Zelle (Fraktion x Typ) als roher (RGB|0)[]-Puffer inkl. Outline + Boden-Schatten.
function renderUnitCell(faction: string, type: string): (RGB | 0)[] {
  const P = PAL[faction], buf: (RGB | 0)[] = new Array(UW * UH).fill(0);
  DRAW[type](makePen(buf), P);
  const filled = (i: number): boolean => i >= 0 && i < buf.length && buf[i] !== 0;
  const out = buf.slice();
  for (let y = 0; y < UH; y++) for (let x = 0; x < UW; x++) {                            // 1px Outline-Pass
    const i = y * UW + x; if (buf[i] !== 0) continue;
    if ((x > 0 && filled(i - 1)) || (x < UW - 1 && filled(i + 1)) || (y > 0 && filled(i - UW)) || (y < UH - 1 && filled(i + UW))) out[i] = OUTLINE;
  }
  const sh: [number, number, number][] = [[UCX - 3, 26, 6], [UCX - 2, 27, 4]];           // Boden-Schatten
  for (const [sx, sy, sw] of sh) for (let x = sx; x < sx + sw; x++) { const i = sy * UW + x; if (out[i] === 0) out[i] = shade(0x161a22, 0.15); }
  return out;
}
// ATLAS: alle 15 Zellen (3 Fraktionen x 5 Typen) auf EINE TextureSource backen -> ParticleContainer
// kann ALLE Units in EINEM Draw-Call zeichnen. frame[fac*5+type] -> Sub-Texture. frameId = fac*5+ty.
const FAC_ORDER = ["human", "elf", "orc"] as const;
const TY_ORDER = ["warrior", "archer", "spearman", "brute", "king"] as const;
function buildUnitAtlas(): Texture[] {
  const COLS = FAC_ORDER.length * TY_ORDER.length, AW = COLS * UW;
  const cv = document.createElement("canvas"); cv.width = AW; cv.height = UH;
  const ctx = cv.getContext("2d")!; ctx.imageSmoothingEnabled = false;
  const img = ctx.createImageData(AW, UH), d = img.data;
  let col = 0;
  for (const f of FAC_ORDER) for (const t of TY_ORDER) {
    const cell = renderUnitCell(f, t), ox = col * UW;
    for (let y = 0; y < UH; y++) for (let x = 0; x < UW; x++) {
      const c = cell[y * UW + x]; if (c === 0) continue;
      const o = (y * AW + ox + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    col++;
  }
  ctx.putImageData(img, 0, 0);
  const src = Texture.from(cv).source; src.scaleMode = "nearest";
  const frames: Texture[] = [];
  for (let i = 0; i < COLS; i++) frames.push(new Texture({ source: src, frame: new Rectangle(i * UW, 0, UW, UH) }));
  return frames; // index = fac*5 + type
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
  buildHeight(terrace);
  const world = new Container();
  app.stage.addChild(world);
  world.scale.set(zoom);
  const cc = worldToIso(MAP / 2, MAP / 2);
  world.x = app.screen.width / 2 - cc.x * zoom;
  world.y = app.screen.height / 2 - (cc.y - elevLift(sampleH(MAP / 2, MAP / 2))) * zoom;
  world.addChild(buildTerrainMesh());
  terrainShader.resources.terr.uniforms.uStyle = styleId;

  // GLOBALE Z-REGEL via SCREEN-Y-BUCKETS: jedes Asset kommt in den Eimer seiner Fuss-screen-Y.
  // Eimer liegen in FIXER Reihenfolge (oben im Bild=hinten ... unten=vorne) -> korrekte Tiefe OHNE
  // per-frame Vollsortierung (sortableChildren auf 8000+ Sprites = 3 FPS Batch-Rebuild). Batches stabil.
  // Gilt fuer ALLE Inhalte ueber place()/spawn() -> auch kuenftige Assets automatisch korrekt.
  const NB = 1100;
  const layer = new Container();
  world.addChild(layer);
  const buckets: Container[] = [];
  for (let i = 0; i < NB; i++) { const c = new Container(); buckets.push(c); layer.addChild(c); }
  const Y_MIN = -ELEV - 40, Y_SPAN = 2 * MAP * HH + ELEV + 120;
  const bucketOf = (screenY: number): number => Math.max(0, Math.min(NB - 1, ((screenY - Y_MIN) / Y_SPAN * NB) | 0));
  // trockenes Land? (kein Fluss/See/Ozean) -> nichts spawnt im Wasser
  const dry = (gx: number, gy: number): boolean => WET[Math.max(0, Math.min(N - 1, Math.floor(gx))) * N + Math.max(0, Math.min(N - 1, Math.floor(gy)))] <= 0.0005;
  function placeOnLand(): { gx: number; gy: number } {
    for (let i = 0; i < 80; i++) {
      const gx = 6 + Math.random() * (MAP - 12), gy = 6 + Math.random() * (MAP - 12), h = sampleH(gx, gy);
      if (h >= WATER + 0.03 && h <= MOUNTAIN - 0.02 && slopeAt(gx, gy) < STEEP && dry(gx, gy)) return { gx, gy };
    }
    return { gx: MAP / 2, gy: MAP / 2 };
  }
  function place(spr: Sprite, gx: number, gy: number): void {
    const p = worldToIso(gx, gy), sy = p.y - elevLift(sampleH(gx, gy));
    spr.x = p.x; spr.y = sy; buckets[bucketOf(sy)].addChild(spr);
  }

  // WÄLDER: Bäume clustern in Wald-Zonen (forestMask) auf Gras -> echte Waldflächen statt random.
  const treeT = [tex.tree1, tex.tree2, tex.tree3], rockT = [tex.rock1, tex.rock2];
  let tPlaced = 0, tGuard = 0;
  while (tPlaced < TREES && tGuard < TREES * 25) {
    tGuard++;
    const gx = 6 + Math.random() * (MAP - 12), gy = 6 + Math.random() * (MAP - 12);
    const h = sampleH(gx, gy);
    if (h < WATER + 0.04 || h > 0.70 || slopeAt(gx, gy) > 0.06 || !dry(gx, gy)) continue;
    if (forestMask(gx, gy) < 0.52) continue; // nur in Wald-Zonen -> Cluster
    const s = new Sprite(treeT[(Math.random() * 3) | 0]);
    s.anchor.set(0.5, 0.9); s.scale.set(0.6); s.zIndex = 0; place(s, gx, gy); tPlaced++;
  }
  // STEINE: am Bergfuß / höherem felsigem Gelände gestreut.
  for (let i = 0; i < TREES * 0.2; i++) {
    let gx = 0, gy = 0, ok = false;
    for (let k = 0; k < 25; k++) { gx = 6 + Math.random() * (MAP - 12); gy = 6 + Math.random() * (MAP - 12); if (sampleH(gx, gy) > 0.58 && sampleH(gx, gy) < 0.9) { ok = true; break; } }
    if (!ok) continue;
    const s = new Sprite(rockT[i % 2]); s.anchor.set(0.5, 0.9); s.scale.set(0.28); s.zIndex = 0; place(s, gx, gy);
  }

  const bTex = [tex.barn, tex.house, tex.tower, tex.barracks];
  interface Orb { spr: Sprite; life: number; }
  const orbs: Orb[] = [];
  let buildingsLeft = 0;
  const orbTex = makeOrbTexture(app);
  const addBuilding = (gx: number, gy: number): void => {
    const s = new Sprite(bTex[(Math.random() * 4) | 0]);
    s.anchor.set(0.5, 0.88); s.scale.set(0.58); s.zIndex = 1; s.eventMode = "static"; s.cursor = "pointer";
    s.on("pointerdown", (e) => {
      e.stopPropagation();
      const orb = new Sprite(orbTex); orb.anchor.set(0.5); orb.x = s.x; orb.y = s.y - 12; orb.tint = 0xffd24a; orb.scale.set(0.5);
      buckets[NB - 1].addChild(orb); orbs.push({ spr: orb, life: 1 }); s.destroy(); buildingsLeft--; // FX immer vorne
    });
    place(s, gx, gy); buildingsLeft++;
  };
  // STÄDTE: Zentren auf flachem Gras (nie Berg/uneben), dann Gebäude drumherum clustern.
  const towns: { gx: number; gy: number }[] = [];
  for (let g = 0; g < 20000 && towns.length < 26; g++) {
    const gx = 14 + Math.random() * (MAP - 28), gy = 14 + Math.random() * (MAP - 28);
    const h = sampleH(gx, gy);
    if (h > 0.43 && h < 0.58 && slopeAt(gx, gy) < 0.022 && dry(gx, gy) && towns.every((t) => Math.hypot(t.gx - gx, t.gy - gy) > 34)) towns.push({ gx, gy });
  }
  for (const t of towns) {
    let n = 0, g2 = 0;
    const target = Math.ceil(BUILDINGS / Math.max(1, towns.length));
    while (n < target && g2 < 800) {
      g2++;
      const a = Math.random() * Math.PI * 2, r = Math.random() * 20;
      const gx = t.gx + Math.cos(a) * r, gy = t.gy + Math.sin(a) * r;
      const h = sampleH(gx, gy);
      if (h < 0.42 || h > 0.62 || slopeAt(gx, gy) > 0.03 || !dry(gx, gy)) continue; // flach + Gras, trocken, nie Berg/uneben
      addBuilding(gx, gy); n++;
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
  ];
  const T_hp = Float32Array.from(T, (s) => s.hp), T_atk = Float32Array.from(T, (s) => s.atk);
  const T_range = Float32Array.from(T, (s) => s.range), T_cd = Float32Array.from(T, (s) => s.cd);
  const T_speed = Float32Array.from(T, (s) => s.speed), T_scale = Float32Array.from(T, (s) => s.scale);
  const FACTION_COL = [0x9fb8ff, 0x8fe39a, 0xe2795a]; // Menschen blau · Elfen grün · Orks rot

  // Unit-Anzahl per ?units=N skalierbar (Benchmark) — Default = 16 Horden wie bisher.
  const reqUnits = Math.max(PLAYERS * 4, parseInt(params.get("units") ?? "", 10) || PLAYERS * (HORDE + 1));
  const CAP = reqUnits + 64;                                            // SoA-Kapazität inkl. Headroom
  // — SoA-Felder (Index i = Entity-ID). Kein Objekt-Pointer mehr (target = Int32-ID), kein GC. —
  const ex = new Float32Array(CAP), ey = new Float32Array(CAP);         // Welt gx/gy (Sim-Stand nach letztem Tick)
  const prevX = new Float32Array(CAP), prevY = new Float32Array(CAP);   // gx/gy vor dem letzten Tick (Render-Interpolation)
  const screenX = new Float32Array(CAP), footY = new Float32Array(CAP); // iso-Render-Pos (footY = Sort-Key)
  const ehp = new Float32Array(CAP), emaxhp = new Float32Array(CAP), ecd = new Float32Array(CAP), eflash = new Float32Array(CAP), eatk = new Float32Array(CAP);
  const efac = new Uint8Array(CAP), etype = new Uint8Array(CAP), eking = new Uint8Array(CAP), eranged = new Uint8Array(CAP), ealive = new Uint8Array(CAP), evis = new Uint8Array(CAP);
  const eowner = new Uint8Array(CAP);   // König-/Team-ID (0..PLAYERS-1). FFA: anderer Owner = Feind. efac = nur Optik.
  const etarget = new Int32Array(CAP);
  const PLAYER = 0;                      // owner 0 = der Spieler-König
  const kingIdx = new Int32Array(PLAYERS).fill(-1); // Entity-ID des Königs je Owner (-1 = tot) -> Horde folgt IHM
  let playerKing = -1, camInit = false;
  let playerActive = false;                          // false = Menü-Vorschau-Auto-Battle; true = Spieler steuert
  let playerFaction = Math.max(0, Math.min(2, parseInt(params.get("fac") ?? "", 10) || 0)); // 0 Mensch 1 Elf 2 Ork
  let difficulty = 1;                                // 0 Leicht .. 3 Hardcore
  const DIFF = [{ label: "Leicht", hp: 1.7 }, { label: "Normal", hp: 1.0 }, { label: "Schwer", hp: 0.72 }, { label: "Hardcore", hp: 0.5 }];
  let gameState: "menu" | "playing" | "over" = "menu";
  let nEnt = 0;                                                         // höchster je belegter Index +1
  const freeStack = new Int32Array(CAP); let freeTop = 0;               // O(1) Tod/Spawn (keine .filter-Kompaktierung)

  // ATLAS-Frames + ParticleContainer-Pool. dynamicProperties: position(x,y) + vertex(scale/anchor) +
  // uvs(welches Frame) + color(tint/alpha) ändern sich pro Slot/Frame (Slot-Inhalt = jeweils andere Unit).
  const FRAMES = buildUnitAtlas();
  const frameOf = (f: number, ty: number): number => f * 5 + ty;
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

  const bannerTex = FACTION_COL.map((c) => makeBannerTexture(app, c));  // Fraktions-Banner an Königen
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
  // SEELEN (Kern-Loop): gefallene Units lassen NAHE dem Spieler-König eine Seele fallen; der König
  // sammelt sie ein -> seine Horde wächst (kämpfen -> Seelen -> größere Horde). Nur nahe Spawns, gedeckelt.
  interface Soul { gx: number; gy: number; spr: Sprite; }
  const souls: Soul[] = [];
  const SOUL_CAP = 500;
  const dropSoul = (gx: number, gy: number): void => {
    if (souls.length >= SOUL_CAP || playerKing < 0 || !ealive[playerKing]) return;
    const dx = gx - ex[playerKing], dy = gy - ey[playerKing];
    if (dx * dx + dy * dy > 250 * 250) return;                          // nur nahe dem Spieler -> keine Sprite-Flut
    const spr = new Sprite(orbTex); spr.anchor.set(0.5); spr.tint = 0x8fe39a; spr.scale.set(0.42);
    const p = worldToIso(gx, gy); spr.x = p.x; spr.y = p.y - elevLift(sampleH(gx, gy)) - 4;
    fxLayer.addChild(spr); souls.push({ gx, gy, spr });
  };
  const spawnE = (gx: number, gy: number, f: number, ty: number, owner: number): number => {
    const i = freeTop > 0 ? freeStack[--freeTop] : nEnt++;
    ex[i] = gx; ey[i] = gy; prevX[i] = gx; prevY[i] = gy; ehp[i] = T_hp[ty]; emaxhp[i] = T_hp[ty]; ecd[i] = Math.random() * T_cd[ty]; eflash[i] = 0; eatk[i] = 0;
    efac[i] = f; etype[i] = ty; eowner[i] = owner; eking[i] = ty === 4 ? 1 : 0; eranged[i] = T_range[ty] > 20 ? 1 : 0; ealive[i] = 1; etarget[i] = -1;
    const p = worldToIso(gx, gy); screenX[i] = p.x; footY[i] = p.y - elevLift(sampleH(gx, gy));
    return i;
  };
  const killE = (i: number): void => { if (!ealive[i]) return; ealive[i] = 0; etarget[i] = -1; if (eking[i]) kingIdx[eowner[i]] = -1; addPuff(ex[i], ey[i], FACTION_COL[efac[i]]); dropSoul(ex[i], ey[i]); freeStack[freeTop++] = i; };
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
  // KÖNIG-FX: Banner + HP-Balken als gepoolte Sprites (kein Per-Frame Graphics.clear mehr).
  interface KingFX { i: number; banner: Sprite; bg: Sprite; fill: Sprite; }
  const kingFX: KingFX[] = [];
  const addKingFX = (i: number, f: number): void => {
    const banner = new Sprite(bannerTex[f]); banner.anchor.set(0.12, 1); banner.scale.set(1.4); bannersLayer.addChild(banner);
    const bg = new Sprite(Texture.WHITE); bg.anchor.set(0, 0.5); bg.tint = 0x101418; bg.width = 22; bg.height = 4; bannersLayer.addChild(bg);
    const fill = new Sprite(Texture.WHITE); fill.anchor.set(0, 0.5); fill.height = 4; bannersLayer.addChild(fill);
    kingFX.push({ i, banner, bg, fill });
  };
  // BATTLE-ROYALE-STURMZONE: sicherer Kreis schrumpft in Phasen; außerhalb Dauerschaden.
  let zoneX = MAP / 2, zoneY = MAP / 2, zoneR = 320, zoneTarget = 320, zoneTimer = 0;
  const zoneG = new Graphics(); zoneG.eventMode = "none"; world.addChild(zoneG); // ganz oben
  const drawZone = (): void => {
    const pts: number[] = [];
    for (let a = 0; a <= 72; a++) { const th = (a / 72) * Math.PI * 2; const p = worldToIso(zoneX + Math.cos(th) * zoneR, zoneY + Math.sin(th) * zoneR); pts.push(p.x, p.y); }
    zoneG.clear().poly(pts).stroke({ color: 0x8af0ff, width: 16, alpha: 0.55 }).poly(pts).stroke({ color: 0xffffff, width: 5, alpha: 0.9 });
  };
  drawZone();
  // BALLISTISCHE PFEILE (Feel aus dem Original: Bogen-Wurf mit z-Höhe+Schwerkraft, dreht zur Flugrichtung,
  // Staub beim Einschlag). gx/gy homen aufs Ziel, z = Sinus-Bogen über die Flugdauer. tgt = Entity-ID.
  interface Arrow { sx: number; sy: number; tx: number; ty: number; gx: number; gy: number; tgt: number; dmg: number; age: number; T: number; apex: number; spr: Sprite; psx: number; psy: number; }
  const arrows: Arrow[] = [];
  const ARROW_CAP = 1600;                                               // gleichzeitige Pfeile gedeckelt (Scale)
  const arrowTex = makeArrowTexture(app);
  const fireArrow = (i: number, tgt: number): void => {
    if (arrows.length >= ARROW_CAP) return;
    const dx = ex[tgt] - ex[i], dy = ey[tgt] - ey[i], d = Math.hypot(dx, dy) || 1;
    const spr = new Sprite(arrowTex); spr.anchor.set(0.5); arrowsLayer.addChild(spr);
    arrows.push({ sx: ex[i], sy: ey[i], tx: ex[tgt], ty: ey[tgt], gx: ex[i], gy: ey[i], tgt, dmg: T_atk[etype[i]], age: 0, T: Math.max(0.28, d * 0.02 + 0.12), apex: Math.min(60, 12 + d * 1.1), spr, psx: 0, psy: 0 });
  };
  // RUNDE: PLAYERS Horden frisch spawnen (Gesamtzahl = reqUnits) + Sturm zurücksetzen.
  const newRound = (): void => {
    for (const kf of kingFX) { kf.banner.destroy(); kf.bg.destroy(); kf.fill.destroy(); }
    kingFX.length = 0;
    for (const a of arrows) a.spr.destroy(); arrows.length = 0;
    for (const s of souls) s.spr.destroy(); souls.length = 0;
    nEnt = 0; freeTop = 0; ealive.fill(0); kingIdx.fill(-1);
    for (const p of pool) p.alpha = 0; lastDrawn = 0;
    zoneR = 320; zoneTarget = 320; zoneTimer = 0; drawZone();
    const perHorde = Math.max(1, Math.floor((reqUnits - PLAYERS) / PLAYERS));
    const spreadR = Math.min(110, Math.max(8, Math.sqrt(perHorde) * 1.5)); // Streuung skaliert mit Hordengröße -> keine 1000+-Units-pro-Zelle (findEnemy/Separation bezahlbar)
    for (let pi = 0; pi < PLAYERS; pi++) {
      const f = pi === PLAYER ? playerFaction : pi % 3, c = placeOnLand(); // owner = pi (König-Team); Spieler bekommt gewählte Fraktion
      const king = spawnE(c.gx, c.gy, f, 4, pi); kingIdx[pi] = king; addKingFX(king, f);
      if (pi === PLAYER) { emaxhp[king] *= DIFF[difficulty].hp; ehp[king] = emaxhp[king]; } // Schwierigkeit -> Spieler-König-HP
      for (let i = 0; i < perHorde; i++) {
        const r = Math.random(), ty = r < 0.55 ? 0 : r < 0.73 ? 1 : r < 0.88 ? 2 : 3;
        let gx = c.gx + (Math.random() - 0.5) * 2 * spreadR, gy = c.gy + (Math.random() - 0.5) * 2 * spreadR;
        if (!passable(gx, gy)) { gx = c.gx; gy = c.gy; }                  // nicht ins Wasser/Steilhang spawnen
        spawnE(gx, gy, f, ty, pi);
      }
    }
    playerKing = kingIdx[PLAYER]; camInit = false;                       // Kamera beim Rundenstart auf Spieler-König snappen
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
      const u = sortOrder[k], p = pool[k], sc = T_scale[etype[u]];
      p.x = screenX[u]; p.y = footY[u]; p.scaleX = sc; p.scaleY = sc;
      p.texture = FRAMES[frameOf(efac[u], etype[u])];
      p.tint = eflash[u] > 0 ? 0xff5555 : 0xffffff; p.alpha = 1;
    }
    for (let k = n; k < lastDrawn; k++) pool[k].alpha = 0; // pensionierte Slots einmalig parken
    lastDrawn = n;
    return n;
  };

  // Benchmark: + / - spawnt/entfernt 1000 Units live (Engine-Stresstest).
  const aliveKings = (): number[] => kingFX.filter((kf) => ealive[kf.i]).map((kf) => kf.i);
  window.addEventListener("keydown", (e) => {
    if (e.key === "+" || e.key === "=") { const ks = aliveKings(); if (!ks.length) return;
      for (let n = 0; n < 1000 && (freeTop > 0 || nEnt < CAP); n++) { const ki = ks[(Math.random() * ks.length) | 0]; const r = Math.random(); const ty = r < 0.55 ? 0 : r < 0.73 ? 1 : r < 0.88 ? 2 : 3; spawnE(ex[ki] + (Math.random() - 0.5) * 30, ey[ki] + (Math.random() - 0.5) * 30, efac[ki], ty, eowner[ki]); } }
    else if (e.key === "-" || e.key === "_") { let removed = 0; for (let i = 0; i < nEnt && removed < 1000; i++) if (ealive[i] && !eking[i]) { killE(i); removed++; } }
  });

  // SPIELER-STEUERUNG: WASD/Pfeile bewegen den eigenen König (owner 0). Bildschirm-Richtung -> Iso-Grid.
  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => { keys.add(e.key.toLowerCase()); });
  window.addEventListener("keyup", (e) => { keys.delete(e.key.toLowerCase()); });
  let pInX = 0, pInY = 0; // normalisierte Grid-Bewegungsrichtung des Spieler-Königs (im Ticker gesetzt)

  // ── 30 Hz FIXED-STEP-SIM + RENDER-INTERPOLATION (Gaffer-Akkumulator) ──
  // Sim läuft 30x/s (DT_FIX=2 -> identisch zum alten 60fps-Tempo/Timing), Render interpoliert prevX->ex
  // pro Bildschirm-Frame -> glatt bei jeder Monitor-Hz UND ~2-5x weniger Sim-Last (Kampf/Suche/Separation).
  const DT_FIX = 2, HSTEP = 1000 / 30, STORM_DMG = 4.5;
  let simFrame = 0;
  const simTick = (): void => {
    simFrame++;
    // 1) Spatial-Grid neu aufbauen (nur lebende Units)
    gridHead.fill(-1);
    for (let i = 0; i < nEnt; i++) { if (!ealive[i]) continue; const c = clampCell(ey[i]) * GW + clampCell(ex[i]); gridNext[i] = gridHead[c]; gridHead[c] = i; }
    // 1b) Sturmzone in Phasen schrumpfen
    zoneTimer += HSTEP / 1000;
    if (zoneTimer > 14 && zoneTarget > 60) { zoneTimer = 0; zoneTarget *= 0.66; }
    if (Math.abs(zoneR - zoneTarget) > 0.3) { zoneR += (zoneTarget - zoneR) * Math.min(1, 0.012 * DT_FIX); drawZone(); }
    const zr2 = zoneR * zoneR;
    // 2) Kampf + Bewegung (SoA, Index i)
    for (let i = 0; i < nEnt; i++) {
      if (!ealive[i]) continue;
      const ty = etype[i], sp = T_speed[ty], isPlayer = playerActive && i === playerKing;
      let tg = etarget[i];
      if (tg < 0 || !ealive[tg] || i % 32 === simFrame % 32) { const e = findEnemy(i); if (e >= 0) { etarget[i] = e; tg = e; } else if (tg >= 0 && !ealive[tg]) { etarget[i] = -1; tg = -1; } }
      let mvx = 0, mvy = 0;
      if (tg >= 0 && ealive[tg]) {
        const dx = ex[tg] - ex[i], dy = ey[tg] - ey[i], d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d <= T_range[ty]) {                                                           // in Reichweite -> angreifen (auch Spieler)
          ecd[i] -= DT_FIX;
          if (ecd[i] <= 0) { ecd[i] = T_cd[ty]; if (eranged[i]) fireArrow(i, tg); else { eatk[i] = 5; ehp[tg] -= T_atk[ty]; eflash[tg] = 6; if (ehp[tg] <= 0) killE(tg); } }
          if (eranged[i] && d < 16 && !isPlayer) { mvx = -dx / d * sp; mvy = -dy / d * sp; } // Bogenschütze kitet
        } else if (!isPlayer) { mvx = dx / d * sp; mvy = dy / d * sp; }                   // hinlaufen (Spieler steuert selbst)
      }
      if (!isPlayer && mvx === 0 && mvy === 0) {                                          // kein Kampf-Move -> der eigenen König-Horde folgen
        const k = kingIdx[eowner[i]];
        if (k >= 0 && k !== i) { const dx = ex[k] - ex[i], dy = ey[k] - ey[i], dd = dx * dx + dy * dy; if (dd > 100) { const d = Math.sqrt(dd); mvx = dx / d * sp * 0.9; mvy = dy / d * sp * 0.9; } }
        else { const dx = MAP / 2 - ex[i], dy = MAP / 2 - ey[i], d = Math.sqrt(dx * dx + dy * dy) || 1; mvx = dx / d * sp * 0.6; mvy = dy / d * sp * 0.6; } // König (oder verwaist) -> Mitte
      }
      if (isPlayer) { mvx = pInX * sp; mvy = pInY * sp; }                                 // Spieler-Input überschreibt Bewegung
      // Sturm: außerhalb der Zone Dauerschaden; KI flieht rein, Spieler bleibt steuerbar.
      const odx = zoneX - ex[i], ody = zoneY - ey[i], od2 = odx * odx + ody * ody;
      if (od2 > zr2) {
        if (!isPlayer) { const od = Math.sqrt(od2) || 1; mvx = odx / od * sp; mvy = ody / od * sp; }
        ehp[i] -= STORM_DMG; eflash[i] = 4; if (ehp[i] <= 0) { killE(i); continue; }
      }
      // Separation: Abstoßung naher Units -> Front statt Punkt-Pile (auf 8 Nachbarn gedeckelt)
      { const cx = clampCell(ex[i]), cy = clampCell(ey[i]); let px = 0, py = 0, n = 0;
        for (let dy = -1; dy <= 1 && n < 8; dy++) for (let dx = -1; dx <= 1 && n < 8; dx++) {
          const ng = cx + dx, mg = cy + dy; if (ng < 0 || mg < 0 || ng >= GW || mg >= GW) continue;
          for (let j = gridHead[mg * GW + ng]; j !== -1 && n < 8; j = gridNext[j]) {
            if (j === i || !ealive[j]) continue;
            const axx = ex[i] - ex[j], ayy = ey[i] - ey[j], a2 = axx * axx + ayy * ayy;
            if (a2 > 0.01 && a2 < 6.25) { const aa = Math.sqrt(a2); px += axx / aa; py += ayy / aa; n++; }
          }
        }
        if (n > 0) { mvx += px / n * sp * 0.7; mvy += py / n * sp * 0.7; } }
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
  const FAC_NAMES = ["Menschen", "Elfen", "Orks"];
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
      <p class="hint">WASD / Pfeile bewegen · bei deiner Horde bleiben · grüne Seelen einsammeln</p></div>`;
  };
  const showMenu = (): void => { gameState = "menu"; playerActive = false; newRound(); overlay.style.display = "flex"; renderMenu(); };
  const startGame = (): void => { gameState = "playing"; playerActive = true; newRound(); overlay.style.display = "none"; };
  const showOver = (title: string, sub: string): void => {
    if (gameState === "over") return; gameState = "over"; overlay.style.display = "flex";
    overlay.innerHTML = `<div class="panel"><h1>${title}</h1><p>${sub}</p><button class="play" data-on="again">NOCHMAL</button><button data-on="menu" style="margin-top:8px">ZURÜCK ZUM MENÜ</button></div>`;
  };
  overlay.addEventListener("click", (e) => {
    const on = (e.target as HTMLElement).getAttribute?.("data-on"); if (!on) return;
    if (on.startsWith("fac")) { playerFaction = +on.slice(3); renderMenu(); }
    else if (on.startsWith("dif")) { difficulty = +on.slice(3); renderMenu(); }
    else if (on === "play" || on === "again") startGame();
    else if (on === "menu") showMenu();
  });
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
      if (ar.psx !== 0 || ar.psy !== 0) ar.spr.rotation = Math.atan2(sy - ar.psy, p.x - ar.psx);
      ar.psx = p.x; ar.psy = sy;
      if (prog >= 1) {
        if (ealive[ar.tgt]) { ehp[ar.tgt] -= ar.dmg; eflash[ar.tgt] = 6; if (ehp[ar.tgt] <= 0) killE(ar.tgt); }
        addPuff(ar.gx, ar.gy, 0xffb050, 0.35);                                            // oranger Treffer-Funke
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
          if (freeTop > 0 || nEnt < CAP) { const r = Math.random(), ty = r < 0.78 ? 0 : r < 0.92 ? 1 : 2; spawnE(kx + (Math.random() - 0.5) * 16, ky + (Math.random() - 0.5) * 16, pf, ty, PLAYER); }
          s.spr.destroy(); souls.splice(i, 1); continue;
        }
        if (d2 < 6400) {                                                 // < 80 grid -> magnetisieren
          const d = Math.sqrt(d2) || 1, pull = 2.8 * dtR;
          s.gx += dx / d * pull; s.gy += dy / d * pull;
          const p = worldToIso(s.gx, s.gy); s.spr.x = p.x; s.spr.y = p.y - elevLift(sampleH(s.gx, s.gy)) - 4;
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
    // RENDER: interpolierte Positionen -> Counting-Sort + Pool-Slots (EIN Draw-Call), dann König-FX.
    const tSort = performance.now();
    projectInterp(alpha);
    const drawn = renderUnits();
    sortMs = performance.now() - tSort;
    for (const kf of kingFX) {
      const i = kf.i, on = ealive[i] === 1 && evis[i] === 1; // off-screen Könige: FX aus (Pos wäre stale)
      kf.banner.visible = on; kf.bg.visible = on; kf.fill.visible = on;
      if (!on) continue;
      kf.banner.x = screenX[i]; kf.banner.y = footY[i] - 50;
      const hpf = Math.max(0, ehp[i] / emaxhp[i]);
      kf.bg.x = screenX[i] - 11; kf.bg.y = footY[i] - 44;
      kf.fill.x = screenX[i] - 11; kf.fill.y = footY[i] - 44; kf.fill.width = 22 * hpf;
      kf.fill.tint = hpf > 0.5 ? 0x6fe06f : hpf > 0.25 ? 0xe0c040 : 0xe05050;
    }
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
      let total = 0, myHorde = 0; for (let i = 0; i < nEnt; i++) if (ealive[i]) { total++; if (eowner[i] === PLAYER) myHorde++; }
      const pAlive = playerKing >= 0 && ealive[playerKing] === 1;
      const me = pAlive ? `Du: ${Math.max(0, ehp[playerKing]) | 0} HP · Horde ${myHorde}` : `besiegt (Zuschauer)`;
      hud.textContent = `Horde.IO — ${me} · Könige ${kingsAlive}/${PLAYERS} · ${total} Units · WASD bewegen · ${app.ticker.FPS.toFixed(0)} FPS (sim ${simMs.toFixed(1)}/sort ${sortMs.toFixed(1)}) · Sturm R${zoneR | 0}`;
      const roundOver = kingsAlive <= 1;
      if (playerActive && gameState === "playing" && (roundOver || !pAlive)) {
        showOver(pAlive ? "SIEG!" : "BESIEGT", pAlive ? `Letzter König — Horde ${myHorde}` : `Deine Horde fiel · Könige übrig ${kingsAlive}`);
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
