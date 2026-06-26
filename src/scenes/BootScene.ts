import Phaser from "phaser";
import { FACTIONS } from "../config/gameConfig";
import { preloadSheets, setupAnimations } from "../systems/animations";

// Lädt alle Assets (Sprites, Sounds, Menühintergründe) und erzeugt prozedurale
// Texturen (Gras-Boden, Partikel), damit keine externen URLs nötig sind.
export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload(): void {
    this.buildLoadingBar();

    const A = "assets/";

    // Fraktions-Sprites (Mensch/Elf/Ork je König + 3 Stufen)
    const factionDirs: Record<string, string> = { human: "Mensch", elf: "Elf", orc: "Orc" };
    for (const f of FACTIONS) {
      const dir = `${A}sprites/Units/${factionDirs[f]}/`;
      this.load.image(`${f}_king`, `${dir}King.png`);
      // Achtung: Original-Dateinamen haben uneinheitliche Gross/Kleinschreibung
      this.load.image(`${f}_l1`, `${dir}${f === "human" ? "Level 1" : "level 1"}.png`);
      this.load.image(`${f}_l2`, `${dir}level 2.png`);
      this.load.image(`${f}_l3`, `${dir}level 3.png`);
    }

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

    // Menü-Hintergründe
    this.load.image("bg_title", `${A}images/TitleScreen.png`);
    this.load.image("bg_menu", `${A}images/MainMenu.png`);
    this.load.image("bg_options", `${A}images/options.png`);
    this.load.image("bg_selection", `${A}images/selectionmenu.png`);

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
    setupAnimations(this); // Demo-Charakter erzeugen + Animationen registrieren
    this.scene.start("Title");
  }

  private buildLoadingBar(): void {
    const { width, height } = this.scale;
    const barW = Math.min(420, width * 0.6);
    const x = width / 2 - barW / 2;
    const y = height / 2;
    const box = this.add.graphics();
    const bar = this.add.graphics();
    const label = this.add
      .text(width / 2, y - 30, "Horde.IO wird geladen …", { fontFamily: "Cinzel, serif", fontSize: "22px", color: "#ffffff" })
      .setOrigin(0.5);

    box.fillStyle(0x000000, 0.6).fillRect(x - 4, y - 4, barW + 8, 28);
    this.load.on("progress", (p: number) => {
      bar.clear().fillStyle(0xc9a227, 1).fillRect(x, y, barW * p, 20);
    });
    this.load.once("complete", () => {
      bar.destroy();
      box.destroy();
      label.destroy();
    });
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
}
