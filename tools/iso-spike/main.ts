// Horde.IO — Iso-Spike v4 (PixiJS v8).
//
// Terrain mit DETAIL: das Gouraud-Mesh wird jetzt im Fragment-Shader (a) per HILLSHADING
// (Normalen aus der Heightmap) beleuchtet -> Berge/Hänge mit Licht+Schatten, Spitzen lesbar;
// (b) mit prozeduralem DETAIL-GRAIN texturiert statt flach verwaschen; (c) ANIMIERTES Wasser
// (Schimmer/Funkeln). Flüsse graben monoton bergab bis Meer/Kartenrand (keine Pfützen).
// Berge + Wasser unbegehbar -> Engpässe. Weiterhin reine Präsentation über (gx,gy).
//
// Aufruf: http://localhost:5173/iso-spike.html  (Drag=Pan, Rad=Zoom, Klick Gebäude=looten)

import { Application, Container, Sprite, Texture, Assets, Geometry, Buffer, BufferUsage, Mesh, Shader, GlProgram, Graphics, RenderTexture } from "pixi.js";

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
// begehbar = nicht Wasser, nicht Hochgebirge UND nicht zu steil (Steilhang/Klippe blockt wie Wasser).
const passable = (fx: number, fy: number): boolean => {
  const h = sampleH(fx, fy);
  if (h < WATER || h > MOUNTAIN || slopeAt(fx, fy) >= STEEP) return false;
  const ix = Math.max(0, Math.min(N - 1, Math.floor(fx))), iy = Math.max(0, Math.min(N - 1, Math.floor(fy)));
  return WET[ix * N + iy] <= 0.0005; // Flüsse/Seen blockieren Units wie Wasser (emergent)
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
function makeUnitTex(faction: string, type: string): Texture {
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
  const cv = document.createElement("canvas"); cv.width = UW; cv.height = UH;
  const ctx = cv.getContext("2d")!; ctx.imageSmoothingEnabled = false;
  const img = ctx.createImageData(UW, UH), d = img.data;
  for (let i = 0; i < out.length; i++) { const c = out[i]; if (c === 0) continue; const o = i * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(cv); tex.source.scaleMode = "nearest"; return tex;
}
function buildUnitTextures(): Record<string, Texture> {
  const out: Record<string, Texture> = {};
  for (const f of ["human", "elf", "orc"]) for (const t of ["warrior", "archer", "spearman", "brute", "king"]) out[`${f}_${t}`] = makeUnitTex(f, t);
  return out;
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

  // GAMEPLAY: Horden-Kampf mit Unit-TYPEN. Jede Unit: Fraktion (0-2) + Typ (0-4) mit eigenem
  // HP/Angriff/Reichweite/Tempo/Cooldown. Verhalten: Gegner suchen -> ran bzw. Fernkampf -> Schaden ->
  // sterben. Typen: 0 Krieger 1 Bogenschütze(Fern,Pfeile) 2 Speer(Reichweite) 3 Brute(zäh,langsam) 4 König.
  interface U { gx: number; gy: number; spr: Sprite; bk: number; f: number; ty: number; hp: number; atk: number; range: number; cd: number; cdMax: number; speed: number; flash: number; tint: number; king: boolean; dead: boolean; target: U | null; }
  let units: U[] = [];
  const T = [
    { hp: 50, atk: 6, range: 5, cd: 26, speed: 0.22, scale: 1.5 },    // 0 Krieger (Nahkampf)
    { hp: 30, atk: 8, range: 64, cd: 50, speed: 0.20, scale: 1.45 },  // 1 Bogenschütze (Fernkampf/Pfeile)
    { hp: 58, atk: 8, range: 11, cd: 32, speed: 0.20, scale: 1.6 },   // 2 Speerträger (Reichweite)
    { hp: 135, atk: 16, range: 6, cd: 44, speed: 0.13, scale: 2.1 },  // 3 Brute (zäh, langsam)
    { hp: 340, atk: 20, range: 6, cd: 30, speed: 0.14, scale: 2.7 },  // 4 König (Anführer)
  ];
  const FAC = ["human", "elf", "orc"] as const, TYNAME = ["warrior", "archer", "spearman", "brute", "king"] as const;
  const UNIT_TEX = buildUnitTextures();                                  // 15 EIGENE Pixel-Art-Texturen (Fraktion x Typ)
  const TYPE_TINT = [0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff];  // Fraktionsfarbe in die Textur gebacken -> kein Tint
  const unitTex = (f: number, ty: number): Texture => UNIT_TEX[`${FAC[f]}_${TYNAME[ty]}`];
  function spawn(gx: number, gy: number, f: number, ty: number): void {
    const st = T[ty], tint = TYPE_TINT[ty];
    const spr = new Sprite(unitTex(f, ty)); spr.anchor.set(0.5, 0.82); spr.scale.set(st.scale); spr.tint = tint;
    const p = worldToIso(gx, gy), sy = p.y - elevLift(sampleH(gx, gy)); spr.x = p.x; spr.y = sy;
    const bk = bucketOf(sy); buckets[bk].addChild(spr);
    units.push({ gx, gy, spr, bk, f, ty, hp: st.hp, atk: st.atk, range: st.range, cd: Math.random() * st.cd, cdMax: st.cd, speed: st.speed, flash: 0, tint, king: ty === 4, dead: false, target: null });
  }
  for (let pi = 0; pi < PLAYERS; pi++) {
    const f = pi % 3, c = placeOnLand();
    spawn(c.gx, c.gy, f, 4); // König
    for (let i = 0; i < HORDE; i++) { const r = Math.random(); const ty = r < 0.55 ? 0 : r < 0.73 ? 1 : r < 0.88 ? 2 : 3; spawn(c.gx + (Math.random() - 0.5) * 14, c.gy + (Math.random() - 0.5) * 14, f, ty); }
  }
  // Spatial-Grid (verkettete Liste pro Zelle) -> schnelle Gegnersuche bei 8000+ Units (kein O(n^2)).
  const CELL = 18, GW = Math.ceil(MAP / CELL) + 1;
  const gridHead = new Int32Array(GW * GW), gridNext = new Int32Array(units.length);
  const cellIdx = (gx: number, gy: number): number => Math.max(0, Math.min(GW - 1, (gy / CELL) | 0)) * GW + Math.max(0, Math.min(GW - 1, (gx / CELL) | 0));
  // Todes-Effekt: fraktionsfarbener Staub-Poof, wenn eine Unit fällt -> Schlachtfeld "raucht".
  const FACTION_COL = [0x9fb8ff, 0x8fe39a, 0xe2795a]; // Menschen blau · Elfen grün · Orks rot
  interface Puff { spr: Sprite; life: number; }
  const puffs: Puff[] = [];
  const puffTex = makePuffTexture(app);
  const addPuff = (gx: number, gy: number, tint: number): void => {
    const spr = new Sprite(puffTex); spr.anchor.set(0.5); spr.tint = tint; spr.scale.set(0.5);
    const p = worldToIso(gx, gy); spr.x = p.x; spr.y = p.y - elevLift(sampleH(gx, gy)) - 6;
    buckets[NB - 1].addChild(spr); puffs.push({ spr, life: 1 });
  };
  const kill = (v: U): void => { v.dead = true; addPuff(v.gx, v.gy, FACTION_COL[v.f]); v.spr.destroy(); };
  const findEnemy = (u: U): U | null => {
    const cx = Math.max(0, Math.min(GW - 1, (u.gx / CELL) | 0)), cy = Math.max(0, Math.min(GW - 1, (u.gy / CELL) | 0));
    let best: U | null = null, bestD = 1e9;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GW) continue;
      for (let j = gridHead[ny * GW + nx]; j !== -1; j = gridNext[j]) {
        const v = units[j]; if (v.dead || v.f === u.f) continue;
        const ddx = v.gx - u.gx, ddy = v.gy - u.gy, d = ddx * ddx + ddy * ddy;
        if (d < bestD) { bestD = d; best = v; }
      }
    }
    return best;
  };
  // BATTLE-ROYALE-STURMZONE: sicherer Kreis schrumpft in Phasen; außerhalb Dauerschaden -> Units
  // fliehen rein, Nachzügler sterben -> erzwingt den Zusammenstoß (kein Minuten-Warten).
  let zoneX = MAP / 2, zoneY = MAP / 2, zoneR = 320, zoneTarget = 320, zoneTimer = 0;
  const zoneG = new Graphics(); zoneG.eventMode = "none"; world.addChild(zoneG); // über Terrain+Units
  const drawZone = (): void => {
    const pts: number[] = [];
    for (let a = 0; a <= 72; a++) { const th = (a / 72) * Math.PI * 2; const p = worldToIso(zoneX + Math.cos(th) * zoneR, zoneY + Math.sin(th) * zoneR); pts.push(p.x, p.y); }
    zoneG.clear().poly(pts).stroke({ color: 0x8af0ff, width: 16, alpha: 0.55 }).poly(pts).stroke({ color: 0xffffff, width: 5, alpha: 0.9 });
  };
  drawZone();
  // FERNKAMPF-PROJEKTILE: Bogenschützen feuern Pfeile, die zum Ziel fliegen und beim Einschlag Schaden machen.
  interface Proj { gx: number; gy: number; tgt: U; dmg: number; spr: Sprite; }
  const projs: Proj[] = [];
  const arrowTex = makeArrowTexture(app);
  const fireArrow = (u: U, tg: U): void => {
    const spr = new Sprite(arrowTex); spr.anchor.set(0.5); buckets[NB - 1].addChild(spr);
    projs.push({ gx: u.gx, gy: u.gy, tgt: tg, dmg: u.atk, spr });
  };

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

  let acc = 0, time = 0, frame = 0;
  app.ticker.add((t) => {
    const dt = t.deltaTime;
    time += t.deltaMS / 1000; frame++;
    terrainShader.resources.terr.uniforms.uTime = time;
    // 1) Spatial-Grid neu aufbauen (nur lebende Units)
    gridHead.fill(-1);
    for (let i = 0; i < units.length; i++) { const u = units[i]; if (u.dead) continue; const c = cellIdx(u.gx, u.gy); gridNext[i] = gridHead[c]; gridHead[c] = i; }
    // 1b) Sturmzone in Phasen schrumpfen
    zoneTimer += t.deltaMS / 1000;
    if (zoneTimer > 14 && zoneTarget > 60) { zoneTimer = 0; zoneTarget *= 0.66; }
    if (Math.abs(zoneR - zoneTarget) > 0.3) { zoneR += (zoneTarget - zoneR) * Math.min(1, 0.012 * dt); drawZone(); }
    const zr2 = zoneR * zoneR;
    // 2) Kampf + Bewegung
    for (let i = 0; i < units.length; i++) {
      const u = units[i]; if (u.dead) continue;
      if (!u.target || u.target.dead || i % 16 === frame % 16) { const e = findEnemy(u); if (e) u.target = e; } // Ziel suchen/auffrischen (gestaffelt)
      const sp = u.speed;
      let mvx = 0, mvy = 0;
      const tg = u.target;
      if (tg && !tg.dead) {
        const dx = tg.gx - u.gx, dy = tg.gy - u.gy, d = Math.hypot(dx, dy) || 1;
        if (u.range > 20 && d < 16) { mvx = -dx / d * sp; mvy = -dy / d * sp; }          // Bogenschütze kitet (Abstand halten)
        else if (d <= u.range) {
          u.cd -= dt;
          if (u.cd <= 0) { u.cd = u.cdMax; if (u.range > 20) fireArrow(u, tg); else { tg.hp -= u.atk; tg.flash = 6; if (tg.hp <= 0) kill(tg); } } // Fern: Pfeil, sonst Nahkampf
        } else { mvx = dx / d * sp; mvy = dy / d * sp; }                                 // hinlaufen
      } else { const dx = MAP / 2 - u.gx, dy = MAP / 2 - u.gy, d = Math.hypot(dx, dy) || 1; mvx = dx / d * sp * 0.6; mvy = dy / d * sp * 0.6; } // kein Gegner -> zur Mitte
      // Sturm: außerhalb der sicheren Zone -> rein fliehen (überschreibt Kampf) + Dauerschaden
      const odx = zoneX - u.gx, ody = zoneY - u.gy, od2 = odx * odx + ody * ody;
      if (od2 > zr2) {
        const od = Math.sqrt(od2) || 1; mvx = odx / od * sp; mvy = ody / od * sp;
        if (frame % 3 === 0) { u.hp -= 7; u.flash = 4; if (u.hp <= 0) { kill(u); continue; } }
      }
      if (mvx !== 0 || mvy !== 0) { const nx = u.gx + mvx * dt, ny = u.gy + mvy * dt; if (passable(nx, u.gy)) u.gx = nx; if (passable(u.gx, ny)) u.gy = ny; }
      if (u.flash > 0) { u.flash -= dt; u.spr.tint = 0xff5555; } else u.spr.tint = u.tint; // Treffer-Blitz, sonst Typ-Tönung
      const p = worldToIso(u.gx, u.gy), sy = p.y - elevLift(sampleH(u.gx, u.gy));
      u.spr.x = p.x; u.spr.y = sy;
      const bk = bucketOf(sy);
      if (bk !== u.bk) { buckets[bk].addChild(u.spr); u.bk = bk; } // Eimerwechsel = neue Tiefe (global)
    }
    // 3) Tote periodisch aus dem Array entfernen (Sprites sind schon zerstört)
    if (frame % 30 === 0) { for (let i = 0; i < units.length; i++) if (units[i].dead) { units = units.filter((u) => !u.dead); break; } }
    // 3b) Pfeile fliegen zum Ziel + Einschlag
    for (let i = projs.length - 1; i >= 0; i--) {
      const pr = projs[i];
      if (pr.tgt.dead) { pr.spr.destroy(); projs.splice(i, 1); continue; }
      const dx = pr.tgt.gx - pr.gx, dy = pr.tgt.gy - pr.gy, d = Math.hypot(dx, dy) || 1, step = 2.2 * dt;
      if (d <= step + 2) { pr.tgt.hp -= pr.dmg; pr.tgt.flash = 6; if (pr.tgt.hp <= 0) kill(pr.tgt); pr.spr.destroy(); projs.splice(i, 1); continue; }
      pr.gx += dx / d * step; pr.gy += dy / d * step;
      const p = worldToIso(pr.gx, pr.gy), sy = p.y - elevLift(sampleH(pr.gx, pr.gy)) - 7;
      pr.spr.x = p.x; pr.spr.y = sy; pr.spr.rotation = Math.atan2((dx + dy) * HH, (dx - dy) * HW); // iso-Flugrichtung
    }
    // 3c) Todes-Poofs aufsteigen + verblassen
    for (let i = puffs.length - 1; i >= 0; i--) {
      const pf = puffs[i]; pf.life -= 0.045 * dt; pf.spr.alpha = Math.max(0, pf.life) * 0.8;
      pf.spr.scale.set(0.5 + (1 - pf.life) * 0.6); pf.spr.y -= 0.3 * dt;
      if (pf.life <= 0) { pf.spr.destroy(); puffs.splice(i, 1); }
    }
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i]; o.life -= 0.012 * dt; o.spr.y -= 0.6 * dt; o.spr.alpha = Math.max(0, o.life);
      if (o.life <= 0) { o.spr.destroy(); orbs.splice(i, 1); }
    }
    // PIXELATE Option A: Welt gesnappt in die Low-Res-RT rendern, dann nur den crispen Buffer zeigen.
    if (pixelateBake && bakeRt && bakeSprite) {
      bakeThrottle = !bakeThrottle;
      if (bakeThrottle || units.length < 4000) {       // 30-Hz-Throttle bei Last
        const camX = world.x, camY = world.y, zx = world.scale.x;
        const snapX = Math.round(camX / PX) * PX, snapY = Math.round(camY / PX) * PX; // Kamera auf Texel-Grid -> kein Schwimmen
        world.renderable = true; bakeSprite.visible = false;
        world.scale.set(zx / PX); world.x = snapX / PX; world.y = snapY / PX;          // Welt 1/PX in die RT
        app.renderer.render({ container: world, target: bakeRt, clear: true });
        world.scale.set(zx); world.x = camX; world.y = camY;                            // echte Kamera zurück
        bakeSprite.x = camX - snapX; bakeSprite.y = camY - snapY;                       // Subpixel-glatter Rest-Offset
        bakeSprite.visible = true; world.renderable = false;                            // Haupt-Pass: nur crispe Pixel-Buffer
      }
    }
    acc += t.deltaMS;
    if (acc > 250) {
      acc = 0;
      const cnt = [0, 0, 0]; for (const u of units) if (!u.dead) cnt[u.f]++;
      const names = ["Menschen", "Elfen", "Orks"];
      const remaining = cnt.filter((c) => c > 0).length;
      const status = remaining <= 1 ? ` · SIEG: ${names[cnt.findIndex((c) => c > 0)] ?? "—"}` : "";
      hud.textContent = `Horde.IO — ${cnt[0] + cnt[1] + cnt[2]} Krieger · ${names.map((n, i) => `${n} ${cnt[i]}`).join(" · ")}${status} · Sturm R${zoneR | 0} · ${app.ticker.FPS.toFixed(0)} FPS`;
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

main();
