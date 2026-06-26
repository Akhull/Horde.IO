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
const MAP = 600, N = MAP + 1; // 4x größer (16-Spieler-Battle-Royale)
const ELEV = 150;           // Screen-Y-Lift (markante Berge)
const NORM_K = 26;          // Höhen->Slope-Skala für die Beleuchtung
const WATER = 0.38, MOUNTAIN = 0.80; // höhere Block-Schwelle -> weniger gesperrte Fläche, mehr Pässe
const PLAYERS = 16, HORDE = 520, BUILDINGS = 520, TREES = 2200, BANDS = 170;
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
  const n = fbm(i * 0.014 + 7, j * 0.014 + 7, 5);
  const ridge = 1 - Math.abs(fbm(i * 0.010 + 51, j * 0.010 + 51, 4) * 2 - 1);
  const dx = (i / MAP) * 2 - 1, dy = (j / MAP) * 2 - 1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // Ozean-Ring NUR am Rand (dist>0.72); Inneres bleibt FLACH -> kein zentraler Berg-Dom mehr.
  const edge = 1 - Math.max(0, Math.min(1, (dist - 0.72) / 0.28));
  const h = (n * 0.6 + ridge * ridge * 0.34) * edge + edge * 0.16 - 0.03;
  return Math.max(0, Math.min(1, h));
}
function buildHeight(terrace: boolean): void {
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) H[i * N + j] = baseHeight(i, j);
  erode(180000); // hydraulische Erosion: Wassertropfen graben dendritische Täler bergab ->
  // natürliche Fluss-/Drainage-Netze direkt aus der Heightmap (kein Carving-Hack, keine Pfützen).
  for (let k = 0; k < N * N; k++) H[k] = Math.max(0, Math.min(1, H[k]));
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
const passable = (fx: number, fy: number): boolean => { const h = sampleH(fx, fy); return h >= WATER && h <= MOUNTAIN; };
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
  const nrm = new Float32Array(N * N * 3), wld = new Float32Array(N * N * 2), hgt = new Float32Array(N * N), flow = new Float32Array(N * N * 2);
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
    flow[2 * k] = -(HG(i + 1, j) - HG(i - 1, j)) * 12; flow[2 * k + 1] = -(HG(i, j + 1) - HG(i, j - 1)) * 12; // Fließrichtung = bergab
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
      aFlow: { buffer: buf(flow, "flow"), format: "float32x2", stride: 8, offset: 0 },
    },
    indexBuffer: new Buffer({ data: new Uint32Array(idx), label: "idx", usage: BufferUsage.INDEX | BufferUsage.COPY_DST }),
  });
  const glProgram = new GlProgram({
    vertex: `
      attribute vec2 aPosition; attribute vec3 aColor; attribute vec3 aNormal; attribute vec2 aWorld; attribute float aHeight; attribute vec2 aFlow;
      varying vec3 vColor; varying vec3 vNormal; varying vec2 vWorld; varying float vHeight; varying vec2 vFlow;
      uniform mat3 uProjectionMatrix; uniform mat3 uWorldTransformMatrix; uniform mat3 uTransformMatrix;
      void main() {
        gl_Position = vec4((uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix*vec3(aPosition,1.0)).xy, 0.0, 1.0);
        vColor = aColor; vNormal = aNormal; vWorld = aWorld; vHeight = aHeight; vFlow = aFlow;
      }`,
    fragment: `
      precision mediump float;
      varying vec3 vColor; varying vec3 vNormal; varying vec2 vWorld; varying float vHeight; varying vec2 vFlow;
      uniform float uTime; uniform vec3 uLight; uniform float uStyle; // 0 real | 1 pixel | 2 voxel | 3 cel
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
        // ---- WASSER (Tiefe + Brandung am Ufer + Flussrichtung) ----
        if (vHeight < 0.382) {
          float shoreT = clamp((vHeight - 0.33) / 0.052, 0.0, 1.0);     // 0 tief ... 1 Ufer
          vec3 col = mix(vec3(0.05,0.16,0.38), vec3(0.16,0.45,0.70), shoreT);
          // Strömung: Rippeln entlang der Fließrichtung vFlow (Seen still, Flüsse sichtbar fließend)
          float fmag = clamp(length(vFlow), 0.0, 1.0);
          vec2 fdir = fmag > 0.001 ? normalize(vFlow) : vec2(0.7, 0.7);
          float flowR = sin(dot(vWorld, fdir) * 2.4 - uTime * (1.5 + fmag * 6.0));
          col += 0.05 * flowR * (0.5 + fmag);
          // Brandung: weiße Wellen, die zum Ufer laufen
          float wave = sin((vWorld.x + vWorld.y) * 0.8 - uTime * 2.4);
          float foam = smoothstep(0.78, 1.0, shoreT) * smoothstep(0.0, 0.6, wave);
          col = mix(col, vec3(0.85,0.93,1.0), foam * 0.7);
          if (uStyle > 0.5 && uStyle < 2.5) col = floor(col * 8.0 + 0.5) / 8.0; // pixel/voxel quantisieren
          gl_FragColor = vec4(col, 1.0); return;
        }
        // ---- LAND ----
        if (uStyle < 0.5) { // realistisch
          float shade = 0.42 + 0.78*diff;
          float grain = 0.8 + 0.42*(vn(vWorld*1.6)*0.55 + vn(vWorld*6.0)*0.3);
          gl_FragColor = vec4(vColor*shade*grain, 1.0); return;
        }
        vec3 b = biome(vHeight);
        if (uStyle < 1.5) { // pixel: saubere Biome + Dithering + Toon
          float shade = 0.66 + 0.34*floor(diff*3.0+0.5)/3.0;
          float dth = h2(floor(vWorld*1.0));
          b *= dth > 0.62 ? 1.08 : (dth < 0.30 ? 0.90 : 1.0);
          gl_FragColor = vec4(b*shade, 1.0); return;
        }
        if (uStyle < 2.5) { // voxel: Block-Look (Tops hell, Waende dunkel) + harte Quantisierung
          float shade = (0.5 + 0.5*clamp(nB.z,0.0,1.0)) * (0.82 + 0.22*step(0.5, diff));
          gl_FragColor = vec4(floor(b*shade*5.0+0.5)/5.0, 1.0); return;
        }
        // cel: illustriert -> 3 Toon-Baender, sattere Farben
        float shade = diff > 0.55 ? 1.0 : (diff > 0.25 ? 0.82 : 0.64);
        gl_FragColor = vec4(pow(b, vec3(0.85)) * shade, 1.0); return;
      }`,
  });
  terrainShader = new Shader({
    glProgram,
    resources: { terr: { uTime: { value: 0, type: "f32" }, uLight: { value: new Float32Array([-0.5, -0.62, 0.6]), type: "vec3<f32>" }, uStyle: { value: 0, type: "f32" } } },
  });
  return new Mesh({ geometry, shader: terrainShader });
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const style = params.get("style") ?? "real"; // real | pixel | voxel | cel
  const zoom = parseFloat(params.get("zoom") ?? "0.4");
  const styleMap: Record<string, number> = { real: 0, pixel: 1, voxel: 2, cel: 3 };
  const styleId = styleMap[style] ?? 0;
  const lowRes = style === "pixel" || style === "voxel"; // niedrige Aufloesung -> Pixel-Look
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
  if (lowRes) for (const tt of Object.values(tex)) tt.source.scaleMode = "nearest";

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

  // WÄLDER: Bäume clustern in Wald-Zonen (forestMask) auf Gras -> echte Waldflächen statt random.
  const treeT = [tex.tree1, tex.tree2, tex.tree3], rockT = [tex.rock1, tex.rock2];
  let tPlaced = 0, tGuard = 0;
  while (tPlaced < TREES && tGuard < TREES * 25) {
    tGuard++;
    const gx = 6 + Math.random() * (MAP - 12), gy = 6 + Math.random() * (MAP - 12);
    const h = sampleH(gx, gy);
    if (h < WATER + 0.04 || h > 0.70 || slopeAt(gx, gy) > 0.06) continue;
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
      (s.parent ?? bandParent).addChild(orb); orbs.push({ spr: orb, life: 1 }); s.destroy(); buildingsLeft--;
    });
    place(s, gx, gy); buildingsLeft++;
  };
  // STÄDTE: Zentren auf flachem Gras (nie Berg/uneben), dann Gebäude drumherum clustern.
  const towns: { gx: number; gy: number }[] = [];
  for (let g = 0; g < 20000 && towns.length < 26; g++) {
    const gx = 14 + Math.random() * (MAP - 28), gy = 14 + Math.random() * (MAP - 28);
    const h = sampleH(gx, gy);
    if (h > 0.43 && h < 0.58 && slopeAt(gx, gy) < 0.022 && towns.every((t) => Math.hypot(t.gx - gx, t.gy - gy) > 34)) towns.push({ gx, gy });
  }
  for (const t of towns) {
    let n = 0, g2 = 0;
    const target = Math.ceil(BUILDINGS / Math.max(1, towns.length));
    while (n < target && g2 < 800) {
      g2++;
      const a = Math.random() * Math.PI * 2, r = Math.random() * 20;
      const gx = t.gx + Math.cos(a) * r, gy = t.gy + Math.sin(a) * r;
      const h = sampleH(gx, gy);
      if (h < 0.42 || h > 0.62 || slopeAt(gx, gy) > 0.03) continue; // flach + Gras, nie Berg/uneben
      addBuilding(gx, gy); n++;
    }
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
    spawn(c.gx, c.gy, f.k, 0.65);
    for (let i = 0; i < HORDE; i++) spawn(c.gx + (Math.random() - 0.5) * 12, c.gy + (Math.random() - 0.5) * 12, f.u, 0.38);
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
