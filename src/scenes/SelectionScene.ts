import Phaser from "phaser";
import { FACTIONS } from "../config/gameConfig";
import type { Faction } from "../types";
import { addCoverBackground } from "./ui";

const LABELS: Record<Faction, string> = { human: "Mensch", elf: "Elf", orc: "Ork" };

// Fraktionsauswahl: König-Sprite + Name. Klick startet das Spiel.
export class SelectionScene extends Phaser.Scene {
  constructor() {
    super("Selection");
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.fadeIn(300, 0, 0, 0);
    addCoverBackground(this, "bg_selection");

    this.add
      .text(width / 2, height * 0.18, "Wähle deinen Archetyp", {
        fontFamily: "Cinzel, serif",
        fontSize: "40px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setShadow(2, 2, "#000000", 6);

    const spacing = Math.min(280, width / 3.4);
    FACTIONS.forEach((faction, i) => {
      const x = width / 2 + (i - 1) * spacing;
      this.makeCard(x, height * 0.52, faction);
    });
  }

  private makeCard(x: number, y: number, faction: Faction): void {
    const card = this.add.rectangle(x, y, 220, 260, 0x1a120a, 0.78).setStrokeStyle(3, 0xc9a227);
    const sprite = this.add.image(x, y - 20, `${faction}_king`).setOrigin(0.5);
    const maxDim = 130;
    sprite.setScale(Math.min(maxDim / sprite.width, maxDim / sprite.height));
    this.add
      .text(x, y + 95, LABELS[faction], { fontFamily: "Cinzel, serif", fontSize: "26px", color: "#ffe9a8" })
      .setOrigin(0.5);

    card.setInteractive({ useHandCursor: true });
    card.on("pointerover", () => this.tweens.add({ targets: [card, sprite], scale: 1.06, duration: 120 }));
    card.on("pointerout", () => this.tweens.add({ targets: [card, sprite], scale: 1.0, duration: 120 }));
    card.on("pointerdown", () => {
      this.sound.play("ui_click", { volume: this.registry.get("sfxVolume") as number });
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.cameras.main.once("camerafadeoutcomplete", () => {
        this.scene.start("Game", { faction });
      });
    });
  }
}
