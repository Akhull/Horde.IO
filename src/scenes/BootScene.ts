import Phaser from "phaser";
import { bus } from "../ui/bus";

// Lädt alle Assets (statische Kenney-Sprites, Sounds) und erzeugt die wenigen
// rein prozeduralen Texturen (Pfeil, Slash, Gefahren-Vignette), für die es im
// medieval-rts-Pack kein Gegenstück gibt.
export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload(): void {
    // Ladefortschritt ans DOM-Overlay melden (treibt den Balken im Lade-Screen).
    this.load.on("progress", (p: number) => bus.emit("loadProgress", p));
    this.load.once("complete", () => bus.emit("loadProgress", 1));

    const A = "assets/";
    // Kenney medieval-rts (Retina = 128px-Quellen) als Basisverzeichnisse.
    const U = `${A}kenney/medieval-rts/PNG/Retina/Unit`;
    const S = `${A}kenney/medieval-rts/PNG/Retina/Structure`;
    const T = `${A}kenney/medieval-rts/PNG/Retina/Tile`;
    const P = `${A}kenney/particle-pack/PNG (Transparent)`;

    // Fraktions-Einheiten (Mensch=blau, Elf=grün, Ork=grau). Faktionsfarbe ist ins
    // Sprite gebacken -> KEIN Tint. Texture-Key = spriteKey, den Unit.ts berechnet.
    this.load.image("human_king", `${U}/medievalUnit_05.png`);
    this.load.image("human_l1", `${U}/medievalUnit_02.png`);
    this.load.image("human_l2", `${U}/medievalUnit_03.png`);
    this.load.image("human_l3", `${U}/medievalUnit_04.png`);
    this.load.image("elf_king", `${U}/medievalUnit_17.png`);
    this.load.image("elf_l1", `${U}/medievalUnit_14.png`);
    this.load.image("elf_l2", `${U}/medievalUnit_15.png`);
    this.load.image("elf_l3", `${U}/medievalUnit_16.png`);
    this.load.image("orc_king", `${U}/medievalUnit_23.png`);
    this.load.image("orc_l1", `${U}/medievalUnit_20.png`);
    this.load.image("orc_l2", `${U}/medievalUnit_21.png`);
    this.load.image("orc_l3", `${U}/medievalUnit_22.png`);

    // Gebäude
    this.load.image("barn", `${S}/medievalStructure_19.png`);
    this.load.image("house", `${S}/medievalStructure_17.png`);
    this.load.image("tower", `${S}/medievalStructure_12.png`);

    // Boden-/Terrain-Kacheln (als TileSprite genutzt). "grass" behält seinen Key,
    // damit der GameScene-Boden + die Tag/Nacht-Tönung unangetastet bleiben.
    this.load.image("grass", `${T}/medievalTile_57.png`);
    this.load.image("water", `${T}/medievalTile_27.png`);
    this.load.image("forest", `${T}/medievalTile_46.png`);

    // Boden-Variations-Kacheln (nahtlos, 100% deckend) für die Decor-Flecken in
    // systems/decor.ts – brechen die monotone Gras-Fläche auf (Erde/Pflaster/Sand/
    // dunkleres Gras). Werden als kleine TileSprite-"Lichtungen/Felder" gestreut.
    const E = `${A}kenney/medieval-rts/PNG/Retina/Environment`;
    this.load.image("patch_dirt", `${T}/medievalTile_13.png`);
    this.load.image("patch_cobble", `${T}/medievalTile_15.png`);
    this.load.image("patch_sand", `${T}/medievalTile_01.png`);
    this.load.image("patch_grass_dark", `${T}/medievalTile_58.png`);

    // Dekorative, rein optische Props (transparent, nicht kollidierend) – Bäume,
    // Büsche, Felsen, Baumstamm. Gestreut über die offene Welt (systems/decor.ts),
    // damit das Feld lebt statt leer zu wirken. Werden NICHT getönt (Kenney-Art ist
    // bereits voll koloriert).
    this.load.image("decor_tree_big", `${E}/medievalEnvironment_03.png`);
    this.load.image("decor_cypress", `${E}/medievalEnvironment_01.png`);
    this.load.image("decor_pine", `${E}/medievalEnvironment_02.png`);
    this.load.image("decor_bush", `${E}/medievalEnvironment_12.png`);
    this.load.image("decor_bush2", `${E}/medievalEnvironment_19.png`);
    this.load.image("decor_shrub", `${E}/medievalEnvironment_21.png`);
    this.load.image("decor_rock_grey", `${E}/medievalEnvironment_07.png`);
    this.load.image("decor_boulder_grey", `${E}/medievalEnvironment_08.png`);
    this.load.image("decor_pebble", `${E}/medievalEnvironment_06.png`);
    this.load.image("decor_rock_brown", `${E}/medievalEnvironment_14.png`);
    this.load.image("decor_boulder_brown", `${E}/medievalEnvironment_15.png`);
    this.load.image("decor_log", `${E}/medievalEnvironment_05.png`);

    // Partikel-/Pickup-Basen aus dem particle-pack (near-weiss -> pro Instanz getönt).
    // "orb" (Seelen + Partikel), "powerup" (Pickup-Glow), "dot" (Effekt-Partikel).
    this.load.image("orb", `${P}/circle_05.png`);
    this.load.image("powerup", `${P}/light_03.png`);
    this.load.image("dot", `${P}/circle_05.png`);
    // Stern-Funke für den Belohnungs-Moment (Champion-Beschwörung / Vasall-Level-3):
    // ein einmaliger ADD-Blend-Sparkle, der hochskaliert und ausblendet (Unit.ts).
    this.load.image("sparkle", `${P}/star_01.png`);

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
  }

  create(): void {
    // Pfeil + Slash gibt es im medieval-rts-Pack nicht -> prozedural erzeugen
    // (weiss, damit sie auf der dunklen Welt lesbar sind).
    this.makeArrowTexture();
    this.makeSlashTexture();
    this.makeVignetteTexture();
    // Assets fertig -> das DOM-UI zeigt jetzt den Titelbildschirm.
    bus.emit("bootReady", undefined);
  }

  // Prozeduraler Pfeil: weisser Schaft + Dreiecks-Spitze, zeigt nach +x. Das
  // Projectile rotiert ihn zur Flugrichtung (setRotation in Projectile.sync).
  private makeArrowTexture(): void {
    const W = 32;
    const H = 10;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    // Schaft (mittiges Band)
    g.fillRect(0, H / 2 - 1.5, W - 10, 3);
    // Spitze (Dreieck nach rechts)
    g.fillTriangle(W - 12, 0, W - 12, H, W, H / 2);
    g.generateTexture("arrow", W, H);
    g.destroy();
  }

  // Prozeduraler Slash: dünner weisser Sichel-Bogen. spawnSlash skaliert/rotiert/
  // tweent ihn beim Nahkampftreffer.
  private makeSlashTexture(): void {
    const S = 40;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.lineStyle(5, 0xffffff, 1);
    // Bogen von ~ -55° bis +55° (offene Sichel) um die Mitte.
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 4, Phaser.Math.DegToRad(-55), Phaser.Math.DegToRad(55), false);
    g.strokePath();
    g.generateTexture("slash", S, S);
    g.destroy();
  }

  // Radialer roter Vignette-Verlauf (transparente Mitte -> rote Ränder) für den
  // Schaden-/Gefahren-Flash. Reine UI-Overlay-Textur ohne medieval-rts-Pendant,
  // bleibt darum prozedural. Wird in der GameScene bildschirmfest skaliert.
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
