// Horde.IO — Iso-Spike (PixiJS v8).
//
// Standalone-Beweis der Maxed-Out-Richtung: ISOMETRISCHE 45°-Ansicht (2:1) als reine
// 2D-Projektion + prozedurales Heightmap-Terrain (Wasser/Sand/Gras/Hügel/Fels/Schnee mit
// Klippen) + eine HORDE aus tausenden Units mit Tiefensortierung. KEIN echtes 3D, kein
// Spiel-Code — nur die visuelle Linse, die später den Cartesian-Sim rendern wird.
//
// Aufrufen: http://localhost:5173/iso-spike.html  (Drag = Pan, Mausrad = Zoom)

import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";

const TILE_W = 64;
const TILE_H = 32; // 2:1 dimetric
const HW = TILE_W / 2;
const HH = TILE_H / 2;
const MAP = 60; // 60x60 Kacheln
const UNIT_COUNT = 4000;
const ELEV = 70; // max. Screen-Y-Lift für erhöhtes Gelände

// ---- deterministisches Value-Noise (fBm) -> kohärentes Terrain ----
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
  for (let i = 0; i < 4; i++) { a += vnoise(x * f, y * f) * amp; f *= 2; amp *= 0.5; }
  return a;
}
function heightAt(gx: number, gy: number): number {
  return fbm(gx * 0.05 + 10, gy * 0.05 + 10);
}
function worldToIso(gx: number, gy: number): { x: number; y: number } {
  return { x: (gx - gy) * HW, y: (gx + gy) * HH };
}
function biomeColor(h: number): number {
  if (h < 0.30) return 0x244f86;       // tiefes Wasser
  if (h < 0.37) return 0x3a73b8;       // flaches Wasser
  if (h < 0.41) return 0xd8c27a;       // Sand
  if (h < 0.60) return 0x4a8c3a;       // Gras
  if (h < 0.74) return 0x3c6e2e;       // Hügel
  if (h < 0.88) return 0x8a8378;       // Fels
  return 0xe8e8ee;                     // Schnee
}
function elevLift(h: number): number {
  return Math.max(0, h - 0.41) * ELEV;
}
function darken(col: number, f: number): number {
  const r = ((col >> 16) & 0xff) * f, g = ((col >> 8) & 0xff) * f, b = (col & 0xff) * f;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

function makeUnitTexture(app: Application, color: number): Texture {
  // Kleiner Krieger: Schatten + Körper + Kopf, dunkle Outline (liest sich als Pixel-Chip).
  const g = new Graphics();
  g.ellipse(0, 0, 5, 2.5).fill({ color: 0x000000, alpha: 0.35 });
  g.roundRect(-4, -13, 8, 12, 2).fill(color).stroke({ color: 0x141414, width: 1 });
  g.circle(0, -15, 3.2).fill(0xf0d0a0).stroke({ color: 0x141414, width: 1 });
  const tex = app.renderer.generateTexture({ target: g, antialias: false });
  tex.source.scaleMode = "nearest";
  g.destroy();
  return tex;
}

async function main(): Promise<void> {
  const app = new Application();
  await app.init({ background: 0x0d0d1a, resizeTo: window, antialias: false });
  document.getElementById("app")!.appendChild(app.canvas);

  const world = new Container();
  app.stage.addChild(world);
  world.scale.set(0.7);
  world.x = app.screen.width / 2;
  world.y = app.screen.height * 0.25;

  // ---- Terrain einmal backen (back-to-front nach gx+gy), mit Klippen-Seitenflächen ----
  const terrain = new Graphics();
  for (let d = 0; d <= 2 * (MAP - 1); d++) {
    for (let gx = Math.max(0, d - (MAP - 1)); gx <= Math.min(d, MAP - 1); gx++) {
      const gy = d - gx;
      const h = heightAt(gx, gy);
      const p = worldToIso(gx, gy);
      const lift = elevLift(h);
      const cx = p.x;
      const cy = p.y - lift;
      const col = biomeColor(h);
      if (lift > 1) {
        terrain.poly([cx - HW, cy, cx, cy + HH, cx, cy + HH + lift, cx - HW, cy + lift]).fill(darken(col, 0.62));
        terrain.poly([cx, cy + HH, cx + HW, cy, cx + HW, cy + lift, cx, cy + HH + lift]).fill(darken(col, 0.46));
      }
      terrain.poly([cx, cy - HH, cx + HW, cy, cx, cy + HH, cx - HW, cy]).fill(col);
    }
  }
  world.addChild(terrain);

  // ---- Unit-Texturen je Fraktion (gebacken -> geteilt -> batchbar) ----
  const factionColors = [0x4a90d9, 0x47b04a, 0x9a6b3f]; // Mensch / Elf / Ork
  const unitTextures = factionColors.map((c) => makeUnitTexture(app, c));

  const unitsLayer = new Container();
  unitsLayer.sortableChildren = true; // Tiefensortierung per zIndex = gx+gy
  world.addChild(unitsLayer);

  interface U { gx: number; gy: number; vx: number; vy: number; spr: Sprite; }
  const units: U[] = [];
  for (let i = 0; i < UNIT_COUNT; i++) {
    const spr = new Sprite(unitTextures[i % 3]);
    spr.anchor.set(0.5, 0.85);
    const ang = Math.random() * Math.PI * 2;
    const sp = 0.008 + Math.random() * 0.02;
    units.push({ gx: Math.random() * MAP, gy: Math.random() * MAP, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, spr });
    unitsLayer.addChild(spr);
  }

  // ---- Kamera: Drag-Pan + Mausrad-Zoom ----
  let dragging = false, lastX = 0, lastY = 0;
  app.canvas.style.touchAction = "none";
  app.canvas.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener("pointerup", () => { dragging = false; });
  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    world.x += e.clientX - lastX; world.y += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
  });
  app.canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const s = e.deltaY < 0 ? 1.1 : 0.9;
    world.scale.x = Math.max(0.2, Math.min(3, world.scale.x * s));
    world.scale.y = world.scale.x;
  }, { passive: false });

  const hud = document.getElementById("hud")!;
  let acc = 0;
  app.ticker.add((t) => {
    const dt = t.deltaTime;
    for (const u of units) {
      u.gx += u.vx * dt; u.gy += u.vy * dt;
      if (u.gx < 0 || u.gx > MAP) { u.vx = -u.vx; u.gx = Math.max(0, Math.min(MAP, u.gx)); }
      if (u.gy < 0 || u.gy > MAP) { u.vy = -u.vy; u.gy = Math.max(0, Math.min(MAP, u.gy)); }
      const p = worldToIso(u.gx, u.gy);
      u.spr.x = p.x;
      u.spr.y = p.y - elevLift(heightAt(u.gx, u.gy));
      u.spr.zIndex = u.gx + u.gy;
    }
    acc += t.deltaMS;
    if (acc > 250) {
      acc = 0;
      hud.textContent =
        `Horde.IO — Iso Spike (Pixi v8) · ${UNIT_COUNT} Units · ${app.ticker.FPS.toFixed(0)} FPS · Drag = Pan, Mausrad = Zoom`;
    }
  });
}

main();
