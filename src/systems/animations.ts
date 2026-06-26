import Phaser from "phaser";
import {
  REAL_SHEETS,
  DEMO_SHEET,
  DEMO_SHEET_KEY,
  DEMO_FRAME_SIZE,
  DEMO_FRAME_COUNT,
  USE_DEMO_SPRITES,
  type SheetDef,
  type AnimName,
} from "../config/spriteConfig";

// Eindeutiger Animations-Key aus Sheet-Key + Animationsname.
export function animKey(sheetKey: string, name: AnimName): string {
  return `${sheetKey}__${name}`;
}

export interface ResolvedSheet {
  sheetKey: string;
  textureKey: string;
  isDemo: boolean;
}

// Ermittelt das passende Sheet für einen spriteKey:
// eigenes Sheet > Demo-Charakter > kein Sheet (statischer Fallback).
export function resolveUnitSheet(spriteKey: string): ResolvedSheet | null {
  if (REAL_SHEETS[spriteKey]) {
    return { sheetKey: spriteKey, textureKey: spriteKey, isDemo: false };
  }
  if (USE_DEMO_SPRITES) {
    return { sheetKey: "demo", textureKey: DEMO_SHEET_KEY, isDemo: true };
  }
  return null;
}

// Lädt alle in REAL_SHEETS eingetragenen Sprite-Sheets (in BootScene.preload aufrufen).
export function preloadSheets(scene: Phaser.Scene): void {
  for (const [key, def] of Object.entries(REAL_SHEETS)) {
    if (!def.path) continue;
    scene.load.spritesheet(key, def.path, { frameWidth: def.frameWidth, frameHeight: def.frameHeight });
  }
}

// Erzeugt Demo-Textur (falls aktiv) und registriert alle Animationen
// (in BootScene.create aufrufen).
export function setupAnimations(scene: Phaser.Scene): void {
  if (USE_DEMO_SPRITES && !scene.textures.exists(DEMO_SHEET_KEY)) {
    createDemoTexture(scene);
  }
  if (USE_DEMO_SPRITES) registerAnims(scene, "demo", DEMO_SHEET_KEY, DEMO_SHEET);
  for (const [spriteKey, def] of Object.entries(REAL_SHEETS)) {
    registerAnims(scene, spriteKey, spriteKey, def);
  }
}

function registerAnims(scene: Phaser.Scene, sheetKey: string, textureKey: string, def: SheetDef): void {
  (Object.keys(def.anims) as AnimName[]).forEach((name) => {
    const a = def.anims[name]!;
    const key = animKey(sheetKey, name);
    if (scene.anims.exists(key)) return;
    const frames: Phaser.Types.Animations.AnimationFrame[] = [];
    for (let i = a.start; i <= a.end; i++) frames.push({ key: textureKey, frame: i });
    scene.anims.create({ key, frames, frameRate: a.frameRate, repeat: a.repeat });
  });
}

// ---------------------------------------------------------------------------
//  Prozeduraler Demo-Charakter: ein kleiner Krieger in 12 Frames.
//  Graustufig gezeichnet, damit ihn Phasers Tint pro Fraktion einfärben kann.
// ---------------------------------------------------------------------------
function createDemoTexture(scene: Phaser.Scene): void {
  const FW = DEMO_FRAME_SIZE;
  const tex = scene.textures.createCanvas(DEMO_SHEET_KEY, FW * DEMO_FRAME_COUNT, FW);
  if (!tex) return;
  const ctx = tex.getContext();
  for (let i = 0; i < DEMO_FRAME_COUNT; i++) {
    ctx.save();
    ctx.translate(i * FW, 0);
    drawDemoFrame(ctx, i);
    ctx.restore();
    tex.add(i, 0, i * FW, 0, FW, FW);
  }
  tex.refresh();
}

function drawDemoFrame(ctx: CanvasRenderingContext2D, i: number): void {
  const FW = DEMO_FRAME_SIZE;
  const cx = FW / 2;
  const groundY = FW - 7;

  let bodyY = 0;
  let legSwing = 0;
  let armAngle = Math.PI * 0.12;
  let rot = 0;
  let alpha = 1;

  if (i <= 1) {
    // Idle: sanftes Atmen
    bodyY = i === 0 ? 0 : -1.4;
  } else if (i <= 5) {
    // Laufen: Beine wechseln, Körper wippt
    const ph = ((i - 2) / 4) * Math.PI * 2;
    legSwing = Math.sin(ph) * 6;
    bodyY = -Math.abs(Math.cos(ph)) * 2;
    armAngle = Math.PI * 0.12 + Math.sin(ph) * 0.5;
  } else if (i <= 8) {
    // Angriff: ausholen -> durchschwingen
    const t = (i - 6) / 2;
    armAngle = -Math.PI * 0.55 + t * (Math.PI * 1.15);
    bodyY = -1 + t;
  } else {
    // Tod: umkippen + ausblenden
    const t = (i - 9) / 2;
    rot = t * (Math.PI * 0.48);
    alpha = 1 - t * 0.5;
    bodyY = t * 4;
  }

  drawFighter(ctx, cx, groundY, bodyY, legSwing, armAngle, rot, alpha);
}

function drawFighter(
  ctx: CanvasRenderingContext2D,
  cx: number,
  groundY: number,
  bodyY: number,
  legSwing: number,
  armAngle: number,
  rot: number,
  alpha: number
): void {
  const outline = "#4a3b2e";
  const skin = "#efe9df";
  const cloth = "#e9e4da";

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const hipY = groundY - 12;
  ctx.translate(cx, hipY);
  ctx.rotate(rot);

  // Beine (am Hüftpunkt verankert)
  ctx.strokeStyle = outline;
  ctx.lineWidth = 4;
  leg(ctx, legSwing);
  leg(ctx, -legSwing);

  // Oberkörper (wippt mit bodyY)
  ctx.save();
  ctx.translate(0, bodyY);

  // Rumpf
  roundRect(ctx, -4, -14, 8, 15, 3);
  ctx.fillStyle = cloth;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = outline;
  ctx.stroke();

  // Kopf
  ctx.beginPath();
  ctx.arc(0, -19, 5, 0, Math.PI * 2);
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.stroke();

  // Arm + Waffe (von der Schulter)
  ctx.save();
  ctx.translate(0, -12);
  ctx.rotate(armAngle);
  ctx.strokeStyle = "#d9d2c6";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 9);
  ctx.stroke();
  ctx.strokeStyle = "#aab4c0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 9);
  ctx.lineTo(0, 21);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
  ctx.restore();
}

function leg(ctx: CanvasRenderingContext2D, dx: number): void {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(dx, 12);
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
