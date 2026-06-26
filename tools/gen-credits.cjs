/* eslint-disable */
// Erzeugt CREDITS-LPC.md aus der LPC-CREDITS.csv, beschränkt auf die in
// tools/build-lpc-sprites.cjs tatsächlich verwendeten Layer-Familien.
const fs = require("fs");
const path = require("path");

const CSV = "https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/master/CREDITS.csv";

const PREFIXES = {
  "Körper-Basis (male)": "body/bodies/male/",
  "Elfen-Ohren": "head/ears/elven/adult/",
  "Ork-Hörner": "head/horns/curled/adult/",
  "Hose": "legs/pants/male/",
  "Rüstung – Platte (König)": "torso/armour/plate/male/",
  "Rüstung – Legion (Stufe 3)": "torso/armour/legion/male/",
  "Rüstung – Leder (Stufe 1/2)": "torso/armour/leather/male/",
  "Haare – kurz (Mensch)": "hair/bangsshort/adult/",
  "Haare – lang (Elf)": "hair/bangslong/adult/",
  "Waffe – Langschwert": "weapon/sword/longsword/",
  "Waffe – Bogen": "weapon/ranged/bow/normal/",
};

// Minimaler CSV-Zeilenparser (Felder können in "..." Kommas enthalten).
function parseLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

(async () => {
  const csv = await (await fetch(CSV)).text();
  const lines = csv.split(/\r?\n/).filter(Boolean);
  lines.shift(); // header

  const sets = {};
  for (const name of Object.keys(PREFIXES)) sets[name] = { authors: new Set(), licenses: new Set(), urls: new Set() };

  for (const line of lines) {
    const [file, , authors, licenses, urls] = parseLine(line);
    for (const [name, pref] of Object.entries(PREFIXES)) {
      if (file.startsWith(pref)) {
        authors && authors.split(",").forEach((a) => a.trim() && sets[name].authors.add(a.trim()));
        licenses && licenses.split(",").forEach((l) => l.trim() && sets[name].licenses.add(l.trim()));
        urls && urls.split(",").forEach((u) => u.trim() && sets[name].urls.add(u.trim()));
      }
    }
  }

  let md = `# Credits – Charakter-Sprites (LPC)

Die animierten Einheiten-Sprites unter \`public/sprites/anim/\` wurden mit
\`tools/build-lpc-sprites.cjs\` aus modularen Layern des
**[Universal LPC Spritesheet Character Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator)**
zusammengesetzt (Down-Richtung, idle/walk/attack/death; Ork-Haut grün eingefärbt).

**Lizenzen:** Alle verwendeten Layer stehen unter **CC-BY-SA 3.0** und/oder **GPL 3.0**
(teils zusätzlich OGA-BY 3.0). Damit ist die kommerzielle Nutzung erlaubt; es gilt
**Namensnennung** (diese Datei) und für veränderte Grafik **Share-Alike** (CC-BY-SA).

---
`;

  for (const [name, s] of Object.entries(sets)) {
    if (!s.authors.size) {
      md += `\n## ${name}\n_(keine CSV-Treffer – bitte manuell prüfen: \`${PREFIXES[name]}\`)_\n`;
      continue;
    }
    md += `\n## ${name}\n`;
    md += `- **Pfad:** \`${PREFIXES[name]}\`\n`;
    md += `- **Autoren:** ${[...s.authors].join(", ")}\n`;
    md += `- **Lizenzen:** ${[...s.licenses].join(", ")}\n`;
    md += `- **Quellen:**\n${[...s.urls].map((u) => `  - ${u}`).join("\n")}\n`;
  }

  fs.writeFileSync(path.join(__dirname, "..", "CREDITS-LPC.md"), md);
  console.log("CREDITS-LPC.md geschrieben.");
})();
