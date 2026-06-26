/* eslint-disable */
// =============================================================================
//  Horde.IO – LPC-Sprite-Builder
// -----------------------------------------------------------------------------
//  Setzt animierte Fraktions-Sprites aus den modularen Layern des
//  "Universal LPC Spritesheet Character Generator" (CC-BY-SA 3.0 / GPL 3.0 /
//  OGA-BY 3.0) zusammen und erzeugt fertige Single-Row-Sheets unter
//  public/sprites/anim/, passend zu src/config/spriteConfig.ts.
//
//  Pro Einheit:  [ idle | walk | attack | death ]  als eine 64px-Reihe.
//  Es wird jeweils die "Down"-Richtung (Blick zur Kamera) verwendet.
//
//  Aufruf:  node tools/build-lpc-sprites.cjs
// =============================================================================
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const RAW =
  "https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/master/spritesheets";
const FS = 64;
const DOWN_ROW = 2; // Reihen: up(0) left(1) DOWN(2) right(3)

// Frame-Anzahl + Reihen je LPC-Animation
const ANIM = {
  idle: { frames: 2, rows: 4 },
  walk: { frames: 9, rows: 4 },
  slash: { frames: 6, rows: 4 },
  shoot: { frames: 13, rows: 4 },
  hurt: { frames: 6, rows: 1 },
};

const OUT_DIR = path.join(__dirname, "..", "public", "sprites", "anim");

// --- Download-Cache --------------------------------------------------------
const cache = new Map();
const missing = new Set();
async function getBuf(url) {
  if (cache.has(url)) return cache.get(url);
  const res = await fetch(url);
  if (!res.ok) {
    missing.add(url.replace(RAW + "/", ""));
    cache.set(url, null);
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  cache.set(url, buf);
  return buf;
}

// --- Down-Reihe extrahieren (+ optional Recolor) ---------------------------
// Robust gegen uneinheitliche Sheet-Maße: Richtung aus echter Höhe ableiten,
// Breite auf die Soll-Framezahl der Animation klemmen.
async function downRowBuf(raw, anim, recolor) {
  const meta = await sharp(raw).metadata();
  const rowsActual = Math.max(1, Math.round(meta.height / FS));
  const top = (rowsActual >= 4 ? DOWN_ROW : 0) * FS;
  const W = ANIM[anim].frames * FS;
  const width = Math.min(meta.width, W);
  let pipe = sharp(raw).extract({ left: 0, top, width, height: FS });
  if (recolor) pipe = pipe.modulate(recolor);
  return pipe.png().toBuffer();
}

// --- URL-Builder pro Layer-Typ ---------------------------------------------
const body = (base) => (anim) => `${RAW}/${base}/${anim}.png`;
const SWORD = { walk: "walk", slash: "attack_slash", hurt: "hurt" };
const sword = (anim) => (SWORD[anim] ? `${RAW}/weapon/sword/longsword/${SWORD[anim]}/longsword.png` : null);
const bowBg = (anim) =>
  anim === "shoot" ? `${RAW}/weapon/ranged/bow/normal/universal/shoot/background.png` : anim === "walk" ? `${RAW}/weapon/ranged/bow/normal/walk/background.png` : null;
const bowFg = (anim) =>
  anim === "shoot" ? `${RAW}/weapon/ranged/bow/normal/universal/shoot/foreground.png` : anim === "walk" ? `${RAW}/weapon/ranged/bow/normal/walk/foreground.png` : null;

// Fraktions-Recolors (sharp.modulate: hue rotiert, sat/brightness skalieren)
const ORC_SKIN = { hue: 95, saturation: 1.25, brightness: 0.92 }; // Tan -> Grün
const ELF_HAIR = { hue: 15, saturation: 0.5, brightness: 1.45 }; // Ingwer -> blond (Elf vom Mensch abheben)
const ORC_HORN = { brightness: 0.6, saturation: 0.5 }; // grelles Gold -> dunkles Horn

// --- Fraktions-/Stufen-Definitionen ----------------------------------------
// torso-Stufen
const ARMOUR = {
  king: "torso/armour/plate/male",
  l3: "torso/armour/legion/male",
  l2: "torso/armour/leather/male",
  l1: "torso/armour/leather/male",
};

function buildLayers(faction, tier) {
  const archer = tier === "l1";
  const skin = faction === "orc" ? ORC_SKIN : null;
  const layers = [];
  // Bogen hinter dem Körper
  if (archer) layers.push({ z: 5, recolor: null, url: bowBg });
  // Körper (Haut)
  layers.push({ z: 10, recolor: skin, url: body("body/bodies/male") });
  // Kopf: Body-Basis ist im Universal-LPC kopflos (modulare Köpfe) -> eigener Layer.
  // Menschen-Kopf für alle Fraktionen + identischer Haut-Recolor wie der Körper,
  // damit Kopf- und Körperton exakt zusammenpassen (Ork via ORC_SKIN ins Grüne).
  layers.push({ z: 12, recolor: skin, url: body("head/heads/human/male") });
  // Kopf-Extras
  if (faction === "elf") layers.push({ z: 15, recolor: skin, url: body("head/ears/elven/adult") });
  if (faction === "orc") layers.push({ z: 15, recolor: ORC_HORN, url: body("head/horns/curled/adult") });
  // Beine
  layers.push({ z: 20, recolor: null, url: body("legs/pants/male") });
  // Rüstung
  layers.push({ z: 30, recolor: null, url: body(ARMOUR[tier]) });
  // Haare (Elf blond zur klaren Fraktions-Unterscheidung)
  if (faction === "human") layers.push({ z: 40, recolor: null, url: body("hair/bangsshort/adult") });
  if (faction === "elf") layers.push({ z: 40, recolor: ELF_HAIR, url: body("hair/bangslong/adult") });
  // Waffe
  if (archer) layers.push({ z: 55, recolor: null, url: bowFg });
  else layers.push({ z: 50, recolor: null, url: sword });
  return layers.sort((a, b) => a.z - b.z);
}

// --- eine Animations-Strip bauen -------------------------------------------
async function buildStrip(layers, anim) {
  const W = ANIM[anim].frames * FS;
  const comps = [];
  for (const layer of layers) {
    const url = layer.url(anim);
    if (!url) continue;
    const raw = await getBuf(url);
    if (!raw) continue;
    comps.push({ input: await downRowBuf(raw, anim, layer.recolor), left: 0, top: 0 });
  }
  return sharp({ create: { width: W, height: FS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(comps)
    .png()
    .toBuffer();
}

// --- ganze Einheit -> Sheet + Frame-Bereiche -------------------------------
async function buildUnit(faction, tier) {
  const archer = tier === "l1";
  const seq = archer ? ["idle", "walk", "shoot", "hurt"] : ["idle", "walk", "slash", "hurt"];
  const logical = ["idle", "walk", "attack", "death"];
  const layers = buildLayers(faction, tier);

  let totalW = 0;
  const comps = [];
  const ranges = {};
  let frame = 0;
  for (let i = 0; i < seq.length; i++) {
    const a = seq[i];
    const strip = await buildStrip(layers, a);
    comps.push({ input: strip, left: totalW, top: 0 });
    const n = ANIM[a].frames;
    ranges[logical[i]] = { start: frame, end: frame + n - 1 };
    frame += n;
    totalW += n * FS;
  }
  const key = `${faction}_${tier}`;
  const outPath = path.join(OUT_DIR, `${key}.png`);
  await sharp({ create: { width: totalW, height: FS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(comps)
    .png()
    .toFile(outPath);
  return { key, archer, frames: frame, ranges };
}

// --- main ------------------------------------------------------------------
(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const factions = ["human", "elf", "orc"];
  const tiers = ["king", "l1", "l2", "l3"];
  const results = [];
  for (const f of factions) {
    for (const t of tiers) {
      const r = await buildUnit(f, t);
      results.push(r);
      console.log(`✓ ${r.key.padEnd(10)} ${String(r.frames).padStart(2)} frames  idle ${r.ranges.idle.start}-${r.ranges.idle.end}  walk ${r.ranges.walk.start}-${r.ranges.walk.end}  attack ${r.ranges.attack.start}-${r.ranges.attack.end}  death ${r.ranges.death.start}-${r.ranges.death.end}`);
    }
  }
  // spriteConfig-Snippet ausgeben
  const fr = (a, sheetArcher) => {
    const r = a;
    return r;
  };
  const lines = results.map((r) => {
    const atkFr = r.archer ? 16 : 14;
    return `  ${r.key}: {
    path: "sprites/anim/${r.key}.png",
    frameWidth: 64, frameHeight: 64,
    anims: {
      idle:   { start: ${r.ranges.idle.start}, end: ${r.ranges.idle.end}, frameRate: 3,  repeat: -1 },
      walk:   { start: ${r.ranges.walk.start}, end: ${r.ranges.walk.end}, frameRate: 12, repeat: -1 },
      attack: { start: ${r.ranges.attack.start}, end: ${r.ranges.attack.end}, frameRate: ${atkFr}, repeat: 0 },
      death:  { start: ${r.ranges.death.start}, end: ${r.ranges.death.end}, frameRate: 9,  repeat: 0 },
    },
  },`;
  });
  fs.writeFileSync(path.join(__dirname, "real-sheets.snippet.txt"), lines.join("\n"));
  console.log("\n--- REAL_SHEETS snippet -> tools/real-sheets.snippet.txt ---");
  if (missing.size) {
    console.log(`\n⚠ ${missing.size} fehlende Layer-Dateien (übersprungen):`);
    for (const m of missing) console.log("   404:", m);
  }
})();
