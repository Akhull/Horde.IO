// Asset-Katalog-Generator für Horde.IO.
//
// Scannt public/assets/kenney (physisch legacy/public/assets/kenney), liest die
// Pixelmaße direkt aus dem PNG-Header (IHDR, keine Bild-Lib nötig) und parst die
// Kenney-XML-Atlanten (<TextureAtlas><SubTexture …/>) auf ihre Frame-Namen.
//
// Erzeugt unter tools/asset-catalog/:
//   index.json   – maschinenlesbarer Gesamtindex (Pack-Summaries + Tint-Basen)
//   index.md     – Überblick + Lade-/Tint-Anleitung für Menschen & den asset-librarian
//   <pack>.md    – pro Pack: Kategorien, Atlas-Frames, vollständige Sprite-Liste
//
// Lauf:  node tools/build-asset-catalog.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
// Realer Ort der Assets (das public/assets-Junction zeigt hierher).
const ROOT = path.join(REPO, "legacy", "public", "assets", "kenney");
// Web-Pfad-Präfix, mit dem Phaser die Dateien lädt (public/ ist das Web-Root).
const WEB_BASE = "assets/kenney";
const OUT_DIR = path.join(__dirname, "asset-catalog");

// Sprite-Namen, die sich als weiße/neutrale Tint-Basis eignen (1 Textur → N Farben).
const TINT_BASE_RE = /^(circle|light|flare|magic|spark|glow|dot|orb|ball|gem|coin|ring|star|window|muzzle)/i;

/** Liest die Pixelmaße aus dem PNG-Header (Bytes 16–24, Big-Endian). */
function pngSize(absPath) {
  let fd;
  try {
    fd = fs.openSync(absPath, "r");
    const buf = Buffer.alloc(24);
    const read = fs.readSync(fd, buf, 0, 24, 0);
    if (read < 24 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Parst einen Kenney-TextureAtlas (XML) → Liste von { name, w, h }. */
function parseAtlas(absPath) {
  const xml = fs.readFileSync(absPath, "utf8");
  const frames = [];
  const re = /<SubTexture\s+name="([^"]+)"[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/g;
  let m;
  while ((m = re.exec(xml))) frames.push({ name: m[1], w: +m[2], h: +m[3] });
  const img = /imagePath="([^"]+)"/.exec(xml);
  return { image: img ? img[1] : null, frames };
}

/** Rekursiver Datei-Walk, sortiert für deterministische Ausgabe. */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

const toWeb = (abs) => WEB_BASE + "/" + path.relative(ROOT, abs).split(path.sep).join("/");
const mdEsc = (s) => s.replace(/\|/g, "\\|");

if (!fs.existsSync(ROOT)) {
  console.error(`Asset-Ordner nicht gefunden: ${ROOT}`);
  process.exit(1);
}

// ---- Scan -----------------------------------------------------------------
const packDirs = fs
  .readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const packs = [];
for (const pack of packDirs) {
  const files = walk(path.join(ROOT, pack));
  const images = [];
  const atlases = [];
  const categories = {};
  let license = null;

  for (const abs of files) {
    const rel = path.relative(path.join(ROOT, pack), abs).split(path.sep);
    const file = rel[rel.length - 1];
    const category = rel.length > 1 ? rel.slice(0, -1).join("/") : ".";
    const ext = path.extname(file).toLowerCase();

    if (ext === ".png") {
      const size = pngSize(abs) || { w: 0, h: 0 };
      images.push({
        name: path.basename(file, ".png"),
        file: toWeb(abs),
        category,
        w: size.w,
        h: size.h,
        tintBase: TINT_BASE_RE.test(file),
      });
      categories[category] = (categories[category] || 0) + 1;
    } else if (ext === ".xml") {
      const { frames } = parseAtlas(abs);
      if (frames.length) atlases.push({ file: toWeb(abs), category, frameCount: frames.length, frames });
    } else if (/license/i.test(file)) {
      license = toWeb(abs);
    }
  }

  packs.push({
    name: pack,
    imageCount: images.length,
    frameCount: atlases.reduce((s, a) => s + a.frameCount, 0),
    categories,
    atlases,
    license,
    tintBases: images.filter((i) => i.tintBase).map((i) => i.file),
    images,
  });
}

// ---- index.json -----------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
const totals = {
  packCount: packs.length,
  imageCount: packs.reduce((s, p) => s + p.imageCount, 0),
  frameCount: packs.reduce((s, p) => s + p.frameCount, 0),
};
const index = {
  note: "Auto-generiert von tools/build-asset-catalog.mjs – nicht von Hand editieren.",
  webBase: WEB_BASE,
  totals,
  packs: packs.map((p) => ({
    name: p.name,
    imageCount: p.imageCount,
    frameCount: p.frameCount,
    categories: p.categories,
    atlases: p.atlases.map((a) => ({ file: a.file, frameCount: a.frameCount })),
    license: p.license,
    tintBases: p.tintBases,
  })),
};
fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(index, null, 2));

// ---- index.md -------------------------------------------------------------
const indexMd = [];
indexMd.push("# Horde.IO – Kenney Asset-Katalog");
indexMd.push("");
indexMd.push("> Auto-generiert von `tools/build-asset-catalog.mjs`. Lauf: `node tools/build-asset-catalog.mjs`.");
indexMd.push("");
indexMd.push(`**${totals.packCount} Packs · ${totals.imageCount} PNGs · ${totals.frameCount} Atlas-Frames.** Alle CC0.`);
indexMd.push("");
indexMd.push("## Laden in Phaser");
indexMd.push("```ts");
indexMd.push("// Einzelnes PNG:");
indexMd.push('this.load.image("orb", "assets/kenney/particle-pack/PNG (Transparent)/light_03.png");');
indexMd.push("// Atlas (Spritesheet + Kenney-XML) → einzelne Frames per Name ansprechbar:");
indexMd.push('this.load.atlasXML("td", ".../Tilesheet/towerDefense_tilesheet.png", ".../towerDefense_tilesheet.xml");');
indexMd.push('this.add.image(x, y, "td", "towerDefense_tile001.png");');
indexMd.push("```");
indexMd.push("");
indexMd.push("## Einfärben (1 Sprite → N Farben)");
indexMd.push("Weiße/neutrale Sprites lassen sich zur Laufzeit gratis tönen — keine Farb-Varianten als Datei nötig:");
indexMd.push("```ts");
indexMd.push("sprite.setTint(0x4ade80); // GPU-Multiply, pro Instanz");
indexMd.push("```");
indexMd.push("Tint *multipliziert*, funktioniert also nur auf hellen Quellen sauber. Geeignete Basis-Sprites sind je Pack unter **Tint-Basen** gelistet.");
indexMd.push("");
indexMd.push("## Packs");
indexMd.push("");
indexMd.push("| Pack | PNGs | Frames | Tint-Basen | Doc |");
indexMd.push("| --- | ---: | ---: | ---: | --- |");
for (const p of packs) {
  indexMd.push(`| ${p.name} | ${p.imageCount} | ${p.frameCount} | ${p.tintBases.length} | [${p.name}.md](./${p.name}.md) |`);
}
indexMd.push("");
fs.writeFileSync(path.join(OUT_DIR, "index.md"), indexMd.join("\n"));

// ---- <pack>.md ------------------------------------------------------------
for (const p of packs) {
  const md = [];
  md.push(`# ${p.name}`);
  md.push("");
  md.push(`**${p.imageCount} PNGs · ${p.frameCount} Atlas-Frames.** Lizenz: ${p.license ? `\`${p.license}\`` : "CC0"}.`);
  md.push("");

  if (p.tintBases.length) {
    md.push("## Tint-Basen (weiß/neutral → beliebig einfärbbar)");
    for (const f of p.tintBases) md.push(`- \`${f}\``);
    md.push("");
  }

  if (p.atlases.length) {
    md.push("## Atlas-Sheets");
    for (const a of p.atlases) {
      md.push(`### \`${a.file}\` (${a.frameCount} Frames)`);
      md.push("");
      md.push(a.frames.map((f) => f.name).join(", "));
      md.push("");
    }
  }

  md.push("## Einzel-Sprites nach Kategorie");
  const byCat = {};
  for (const img of p.images) (byCat[img.category] ||= []).push(img);
  for (const cat of Object.keys(byCat).sort()) {
    const list = byCat[cat];
    md.push("");
    md.push(`### ${cat === "." ? "(Wurzel)" : mdEsc(cat)} — ${list.length}`);
    md.push("");
    md.push("| Sprite | px | Pfad |");
    md.push("| --- | --- | --- |");
    for (const img of list) {
      md.push(`| ${mdEsc(img.name)} | ${img.w}×${img.h} | \`${img.file}\` |`);
    }
  }
  md.push("");
  fs.writeFileSync(path.join(OUT_DIR, `${p.name}.md`), md.join("\n"));
}

console.log(`✓ Katalog: ${totals.packCount} Packs, ${totals.imageCount} PNGs, ${totals.frameCount} Frames → ${path.relative(REPO, OUT_DIR)}`);
