import Phaser from "phaser";
import { preloadSheets, setupAnimations } from "../systems/animations";
import { bus } from "../ui/bus";

// Lädt alle Assets (Sprites, Sounds, Menühintergründe) und erzeugt prozedurale
// Texturen (Gras-Boden, Partikel), damit keine externen URLs nötig sind.
export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload(): void {
    // Ladefortschritt ans DOM-Overlay melden (treibt den Balken im Lade-Screen).
    this.load.on("progress", (p: number) => bus.emit("loadProgress", p));
    this.load.once("complete", () => bus.emit("loadProgress", 1));

    const A = "assets/";

    // Fraktions-Einheiten (Mensch/Elf/Ork je König + 3 Stufen) kommen jetzt als
    // animierte LPC-Sprite-Sheets über preloadSheets() / REAL_SHEETS (s. unten).

    // Gebäude
    this.load.image("barn", `${A}sprites/Buildings/Barn.png`);
    this.load.image("house", `${A}sprites/Buildings/House.png`);
    this.load.image("tower", `${A}sprites/Buildings/Tower.png`);

    // Seelen (Collectables)
    this.load.image("soul_green", `${A}sprites/Collectables/Green.png`);
    this.load.image("soul_blue", `${A}sprites/Collectables/Blue.png`);
    this.load.image("soul_purple", `${A}sprites/Collectables/Purple.png`);

    // Angriffe / Deko
    this.load.image("arrow", `${A}sprites/ATTACKS/Arrow.png`);
    this.load.image("slash", `${A}sprites/ATTACKS/slash.png`);
    this.load.image("forest", `${A}sprites/Trees/angepasst/Forest dark.PNG`);

    // Menü-Hintergründe werden vom DOM-UI direkt als CSS-Bilder geladen
    // (siehe src/ui) – Phaser muss sie nicht mehr in den Texturspeicher ziehen.

    // Sounds
    this.load.audio("melee_l1", `${A}audiosfx/Attack/Melee/Mellee metalic 1.mp3`);
    this.load.audio("melee_l2", `${A}audiosfx/Attack/Melee/Mellee metalic 2.mp3`);
    this.load.audio("melee_l3", `${A}audiosfx/Attack/Melee/Mellee metalic 3.mp3`);
    this.load.audio("death_human", `${A}audiosfx/Dieing/Humans/DieSound 1.mp3`);
    this.load.audio("death_elf", `${A}audiosfx/Dieing/Elfs/ElfsDie 1.mp3`);
    this.load.audio("death_orc", `${A}audiosfx/Dieing/Orcs/OrcDie 1.mp3`);
    this.load.audio("arrow_shot", `${A}audiosfx/Attack/Arrow Shot/Arrow Shot 1.mp3`);
    this.load.audio("footstep", `${A}audiosfx/StepSound/Stepsound.mp3`);
    this.load.audio("ui_click", `${A}audiosfx/Building Colapse/Building Cilapse 1.mp3`);
    this.load.audio("war_ambience", `${A}audiosfx/Medieval Fight Ambient Dynamic Sound/MedievalFightAmbientLoop.mp3`);
    this.load.audio("music", `${A}music/Theme Music.mp3`);

    // Eigene animierte Sprite-Sheets (falls in spriteConfig hinterlegt)
    preloadSheets(this);
  }

  create(): void {
    this.makeGrassTexture();
    this.makeDotTexture();
    this.makeVignetteTexture();
    this.makeGoldSoulTexture();
    setupAnimations(this); // Demo-Charakter erzeugen + Animationen registrieren
    // Assets + Animationen fertig -> das DOM-UI zeigt jetzt den Titelbildschirm.
    bus.emit("bootReady", undefined);
  }

  // Prozedurale, kachelbare Gras-Textur (ersetzt die externe opengameart-URL des Originals).
  private makeGrassTexture(): void {
    const size = 64;
    const tex = this.textures.createCanvas("grass", size, size);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.fillStyle = "#2f5d2a";
    ctx.fillRect(0, 0, size, size);
    const shades = ["#356b2f", "#295226", "#3c7536", "#244b22"];
    for (let i = 0; i < 420; i++) {
      ctx.fillStyle = shades[(Math.random() * shades.length) | 0];
      const x = (Math.random() * size) | 0;
      const y = (Math.random() * size) | 0;
      ctx.fillRect(x, y, 2, 2);
    }
    tex.refresh();
  }

  // Gold-Orb (legendäre Seele): leuchtender Goldverlauf mit hellem Kern.
  // Prozedural erzeugt, da es dafür (anders als grün/blau/lila) kein PNG-Asset gibt.
  private makeGoldSoulTexture(): void {
    const S = 48;
    const tex = this.textures.createCanvas("soul_gold", S, S);
    if (!tex) return;
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
    g.addColorStop(0, "#fff7cc");
    g.addColorStop(0.35, "#ffd700");
    g.addColorStop(0.72, "#e6a400");
    g.addColorStop(1, "rgba(230,164,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.fill();
    tex.refresh();
  }

  // Kleine weisse Kreis-Textur für Partikel-Effekte.
  private makeDotTexture(): void {
    const tex = this.textures.createCanvas("dot", 16, 16);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(8, 8, 8, 0, Math.PI * 2);
    ctx.fill();
    tex.refresh();
  }

  // Radialer roter Vignette-Verlauf (transparente Mitte -> rote Ränder) für den
  // Schaden-/Gefahren-Flash. Wird in der GameScene bildschirmfest skaliert.
  private makeVignetteTexture(): void {
    const W = 256;
    const H = 256;
    const tex = this.textures.createCanvas("vignette", W, H);
    if (!tex) return;
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(W / 2, H / 2, W * 0.28, W / 2, H / 2, W * 0.62);
    g.addColorStop(0, "rgba(200,0,0,0)");
    g.addColorStop(0.7, "rgba(200,0,0,0.35)");
    g.addColorStop(1, "rgba(170,0,0,1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    tex.refresh();
  }
}
