import Phaser from "phaser";
import { addCoverBackground } from "./ui";

// Titelbildschirm: Klick startet Musik und führt ins Hauptmenü.
export class TitleScene extends Phaser.Scene {
  constructor() {
    super("Title");
  }

  create(): void {
    const { width, height } = this.scale;
    addCoverBackground(this, "bg_title");

    this.add
      .text(width / 2, height * 0.32, "Horde of Kings", {
        fontFamily: "Cinzel, serif",
        fontSize: "64px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setShadow(2, 2, "#000000", 6);

    const hint = this.add
      .text(width / 2, height * 0.62, "Klicke, um zu starten", {
        fontFamily: "Cinzel, serif",
        fontSize: "30px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setShadow(0, 0, "#ffffff", 8);

    this.tweens.add({ targets: hint, alpha: 0.3, duration: 900, yoyo: true, repeat: -1 });

    this.input.once("pointerdown", () => {
      // Hintergrundmusik starten (Autoplay erst nach User-Geste erlaubt)
      if (!this.sound.get("music")) {
        const music = this.sound.add("music", { loop: true, volume: this.registry.get("musicVolume") as number });
        music.play();
      }
      this.sound.play("ui_click", { volume: this.registry.get("sfxVolume") as number });
      this.cameras.main.fadeOut(500, 0, 0, 0);
      this.cameras.main.once("camerafadeoutcomplete", () => this.scene.start("Menu"));
    });
  }
}
