import Phaser from "phaser";
import { addCoverBackground, makeButton } from "./ui";

// Hauptmenü: Singleplayer, Optionen, (Multiplayer – Hinweis).
export class MenuScene extends Phaser.Scene {
  constructor() {
    super("Menu");
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.fadeIn(400, 0, 0, 0);
    addCoverBackground(this, "bg_menu");

    this.add
      .text(width / 2, height * 0.22, "Horde of Kings", {
        fontFamily: "Cinzel, serif",
        fontSize: "56px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setShadow(2, 2, "#000000", 6);

    makeButton(this, width / 2, height * 0.45, "Singleplayer", () => this.scene.start("Selection"));
    makeButton(this, width / 2, height * 0.56, "Optionen", () => this.scene.start("Options"));
    makeButton(this, width / 2, height * 0.67, "Multiplayer", () => this.showMultiplayerNotice());
  }

  private showMultiplayerNotice(): void {
    const { width, height } = this.scale;
    const note = this.add
      .text(width / 2, height * 0.78, "Multiplayer folgt – Singleplayer ist die vollständige Erfahrung.", {
        fontFamily: "Cinzel, serif",
        fontSize: "20px",
        color: "#ffe9a8",
        align: "center",
      })
      .setOrigin(0.5)
      .setShadow(1, 1, "#000000", 4);
    this.tweens.add({ targets: note, alpha: 0, delay: 2200, duration: 600, onComplete: () => note.destroy() });
  }
}
