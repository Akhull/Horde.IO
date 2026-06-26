// Horde.IO — Iso-Spike v2 (PixiJS v8).
//
// Ausbaustufe der Maxed-Out-Richtung: GRÖSSERE Welt, nahtloseres Terrain (kontinuierliche
// Höhen-Farbrampe statt harter Biome-Stufen), WASSER UNBEGEHBAR, ~7000 Units in 12 Horden
// (Tiefen-Bänder statt teurem Per-Frame-Sort), ECHTE Kenney-CC0-Sprites (Units/Gebäude/Bäume)
// und ANKLICKBARE, zerstörbare Loot-Gebäude.
//
// Immer noch reine PRÄSENTATION: Iso ist nur eine Render-Linse über kartesischen (gx,gy).
// Aufruf: http://localhost:5173/iso-spike.html   (Drag = Pan, Mausrad = Zoom, Klick Gebäude = looten)

import { Application, Container, Graphics, Sprite, Texture, Assets } from "pixi.js";

const TILE_W = 32;
const TILE_H = 16; // 2:1
const HW = TILE_W / 2;
const HH = TILE_H / 2;
const MAP = 140; // 140x140 Kacheln (deutlich größer als v1)
const ELEV = 54; // max. Screen-Y-Lift
const PLAYERS = 12; // "Könige"/Spieler, jeder mit einer Horde
const HORDE = 560; // Units pro Horde -> ~6720 + 12 Könige
const BUILDINGS = 260;
const TREES = 700;
const WATER_LEVEL = 0.4; // h darunter = Wasser (unbegehbar)
const BANDS = 110; // Tiefen-Bänder für Sortier-freie Tiefenordnung

const ASSET = "/assets/kenney/medieval-rts/PNG/Retina";

// ---- deterministisches fBm-Value-Noise ----
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const v00 = hash(x0, y0), v10 = hash(x0 + 1, y0), v01 = hash(x0, y0 + 1), v11 = hash(x0 + 1, y0 + 1);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
}
function fbm(x: number, y: number): number {
  let a = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 5; i++) { a += vnoise(x * f, y * f) * amp; f *= 2; amp *= 0.5; }
  return a;
}
// Insel-Bias: zum Rand hin abfallen -> zusammenhängende Landmasse + Küsten ringsum.
function heightAt(gx: number, gy: number): number {
  const n = fbm(gx * 0.035 + 7, gy * 0.035 + 7);
  const dx = (gx / MAP) * 2 - 1, dy = (gy / MAP) * 2 - 1;
  const edge = 1 - Math.min(1, (dx * dx + dy * dy) * 0.85);
  return Math.max(0, Math.min(1, n * 0.7 + edge * 0.45));
}
function worldToIso(gx: number, gy: number): { x: number; y: number } {
  return { x: (gx - gy) * HW, y: (gx + gy) * HH };
}
function elevLift(h: number): number {
  return Math.max(0, h - WATER_LEVEL) * ELEV;
}

// ---- kontinuierliche Höhen-Farbrampe (glatte Übergänge statt harter Stufen) ----
const RAMP: [number, number][] = [
  [0.0, 0x18406e], [0.30, 0x265f9a], [0.37, 0x3f86bd], [0.4, 0xd6c489],
  [0.45, 0x4f9a3f], [0.62, 0x3c7d2f], [0.72, 0x6f6a44], [0.82, 0x8a8378],
  [0.92, 0xa9a39a], [1.0, 0xeef0f5],
];
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return ((ar + (br - ar) * t) << 16) | ((ag + (bg - ag) * t) << 8) | (ab + (bb - ab) * t);
}
function rampColor(h: number): number {
  for (let i = 1; i < RAMP.length; i++) {
    if (h <= RAMP[i][0]) {
      const [h0, c0] = RAMP[i - 1], [h1, c1] = RAMP[i];
      return lerpColor(c0, c1, (h - h0) / (h1 - h0 || 1));
    }
  }
  return RAMP[RAMP.length - 1][1];
}
function darken(col: number, f: number): number {
  return (Math.round(((col >> 16) & 0xff) * f) << 16) | (Math.round(((col >> 8) & 0xff) * f) << 8) | Math.round((col & 0xff) * f);
}

async function main(): Promise<void> {
  const hud = document.getElementById("hud")!;
  hud.textContent = "Lade Assets…";

  const app = new Application();
  await app.init({ background: 0x0c1018, resizeTo: window, antialias: false });
  document.getElementById("app")!.appendChild(app.canvas);

  // ---- echte Kenney-CC0-Sprites laden ----
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

  const world = new Container();
  app.stage.addChild(world);
  world.scale.set(0.4);
  world.x = app.screen.width / 2;
  world.y = 70;

  // ---- Terrain einmal backen (back-to-front), kontinuierliche Farbe + Klippen ----
  hud.textContent = "Baue Terrain…";
  const terrain = new Graphics();
  for (let d = 0; d <= 2 * (MAP - 1); d++) {
    for (let gx = Math.max(0, d - (MAP - 1)); gx <= Math.min(d, MAP - 1); gx++) {
      const gy = d - gx;
      const h = heightAt(gx, gy);
      const p = worldToIso(gx, gy);
      const lift = elevLift(h);
      const cx = p.x, cy = p.y - lift;
      const col = rampColor(h);
      if (lift > 0.5) {
        terrain.poly([cx - HW, cy, cx, cy + HH, cx, cy + HH + lift, cx - HW, cy + lift]).fill(darken(col, 0.6));
        terrain.poly([cx, cy + HH, cx + HW, cy, cx + HW, cy + lift, cx, cy + HH + lift]).fill(darken(col, 0.45));
      }
      terrain.poly([cx, cy - HH, cx + HW, cy, cx, cy + HH, cx - HW, cy]).fill(col);
    }
  }
  world.addChild(terrain);

  // ---- Tiefen-Bänder: je ein Container, sortierfrei (zIndex nur 1x über die ~110 Bänder) ----
  const bandParent = new Container();
  bandParent.sortableChildren = true;
  world.addChild(bandParent);
  const bands: Container[] = [];
  const bandSize = (2 * MAP) / BANDS;
  for (let i = 0; i < BANDS; i++) { const c = new Container(); c.zIndex = i; bands.push(c); bandParent.addChild(c); }
  const bandOf = (gx: number, gy: number): number => Math.max(0, Math.min(BANDS - 1, Math.floor((gx + gy) / bandSize)));

  function placeOnLand(): { gx: number; gy: number } {
    for (let i = 0; i < 40; i++) {
      const gx = 6 + Math.random() * (MAP - 12), gy = 6 + Math.random() * (MAP - 12);
      if (heightAt(gx, gy) >= WATER_LEVEL + 0.02) return { gx, gy };
    }
    return { gx: MAP / 2, gy: MAP / 2 };
  }

  // ---- Bäume (Deko) auf Land streuen ----
  const treeTex = [tex.tree1, tex.tree2, tex.tree3];
  for (let i = 0; i < TREES; i++) {
    const { gx, gy } = placeOnLand();
    const h = heightAt(gx, gy);
    if (h > 0.8) continue; // keine Bäume auf Fels/Schnee
    const s = new Sprite(treeTex[i % 3]);
    s.anchor.set(0.5, 0.9);
    s.scale.set(0.16);
    const p = worldToIso(gx, gy);
    s.x = p.x; s.y = p.y - elevLift(h);
    s.zIndex = 0;
    bands[bandOf(gx, gy)].addChild(s);
  }

  // ---- zerstörbare Loot-Gebäude (anklickbar) ----
  const bTex = [tex.barn, tex.house, tex.tower, tex.barracks];
  interface Orb { spr: Sprite; life: number; }
  const orbs: Orb[] = [];
  let buildingsLeft = 0;
  const orbTex = makeOrbTexture(app);
  for (let i = 0; i < BUILDINGS; i++) {
    const { gx, gy } = placeOnLand();
    const h = heightAt(gx, gy);
    if (h < WATER_LEVEL + 0.03 || h > 0.78) continue;
    const s = new Sprite(bTex[i % 4]);
    s.anchor.set(0.5, 0.88);
    s.scale.set(0.34);
    const p = worldToIso(gx, gy);
    s.x = p.x; s.y = p.y - elevLift(h);
    s.zIndex = 1;
    s.eventMode = "static";
    s.cursor = "pointer";
    s.on("pointerdown", (e) => {
      e.stopPropagation();
      // looten: Gebäude weg + Gold-Orb steigt auf
      const orb = new Sprite(orbTex);
      orb.anchor.set(0.5);
      orb.x = s.x; orb.y = s.y - 12; orb.tint = 0xffd24a;
      orb.scale.set(0.5);
      (s.parent ?? bandParent).addChild(orb);
      orbs.push({ spr: orb, life: 1 });
      s.destroy();
      buildingsLeft--;
    });
    bands[bandOf(gx, gy)].addChild(s);
    buildingsLeft++;
  }

  // ---- 12 Horden (je ein König + HORDE Units), echte Fraktions-Sprites ----
  const factions = [
    { u: tex.humanU, k: tex.humanK }, { u: tex.elfU, k: tex.elfK }, { u: tex.orcU, k: tex.orcK },
  ];
  interface U { gx: number; gy: number; vx: number; vy: number; spr: Sprite; band: number; }
  const units: U[] = [];
  function spawnUnit(gx: number, gy: number, t: Texture, scale: number): U {
    const spr = new Sprite(t);
    spr.anchor.set(0.5, 0.82);
    spr.scale.set(scale);
    const ang = Math.random() * Math.PI * 2, sp = 0.006 + Math.random() * 0.016;
    const u: U = { gx, gy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, spr, band: bandOf(gx, gy) };
    bands[u.band].addChild(spr);
    units.push(u);
    return u;
  }
  for (let pi = 0; pi < PLAYERS; pi++) {
    const f = factions[pi % 3];
    const c = placeOnLand();
    spawnUnit(c.gx, c.gy, f.k, 0.2); // König (größer)
    for (let i = 0; i < HORDE; i++) {
      spawnUnit(c.gx + (Math.random() - 0.5) * 14, c.gy + (Math.random() - 0.5) * 14, f.u, 0.12);
    }
  }

  // ---- Kamera: Drag-Pan + Mausrad-Zoom ----
  let dragging = false, lastX = 0, lastY = 0, moved = 0;
  app.canvas.style.touchAction = "none";
  app.canvas.addEventListener("pointerdown", (e) => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener("pointerup", () => { dragging = false; });
  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
    world.x += e.clientX - lastX; world.y += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
  });
  app.canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const s = e.deltaY < 0 ? 1.12 : 0.89;
    world.scale.x = Math.max(0.12, Math.min(2.5, world.scale.x * s));
    world.scale.y = world.scale.x;
  }, { passive: false });

  let acc = 0;
  app.ticker.add((t) => {
    const dt = t.deltaTime;
    for (const u of units) {
      let nx = u.gx + u.vx * dt, ny = u.gy + u.vy * dt;
      // Wasser unbegehbar: ins Wasser/aus der Karte -> abprallen, auf Land bleiben.
      if (nx < 2 || nx > MAP - 2 || heightAt(nx, u.gy) < WATER_LEVEL) { u.vx = -u.vx; nx = u.gx; }
      if (ny < 2 || ny > MAP - 2 || heightAt(u.gx, ny) < WATER_LEVEL) { u.vy = -u.vy; ny = u.gy; }
      u.gx = nx; u.gy = ny;
      const p = worldToIso(nx, ny);
      u.spr.x = p.x;
      u.spr.y = p.y - elevLift(heightAt(nx, ny));
      const nb = bandOf(nx, ny);
      if (nb !== u.band) { bands[nb].addChild(u.spr); u.band = nb; } // reparent statt sortieren
    }
    // Loot-Orbs aufsteigen + ausblenden
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i];
      o.life -= 0.012 * dt; o.spr.y -= 0.6 * dt; o.spr.alpha = Math.max(0, o.life);
      if (o.life <= 0) { o.spr.destroy(); orbs.splice(i, 1); }
    }
    acc += t.deltaMS;
    if (acc > 250) {
      acc = 0;
      hud.textContent =
        `Horde.IO — Iso Spike v2 · ${units.length} Units · ${PLAYERS} Horden · ${buildingsLeft} Gebäude · ` +
        `${app.ticker.FPS.toFixed(0)} FPS · Drag=Pan, Rad=Zoom, Klick Gebäude=looten`;
    }
  });
}

function makeOrbTexture(app: Application): Texture {
  const g = new Graphics();
  g.circle(0, 0, 7).fill(0xffffff).stroke({ color: 0x6a4a00, width: 1.5 });
  const t = app.renderer.generateTexture({ target: g, antialias: true });
  g.destroy();
  return t;
}

main();
