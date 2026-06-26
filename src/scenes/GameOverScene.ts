import Phaser from "phaser";
import type { Faction } from "../types";
import { makeButton } from "./ui";

interface GameOverData {
  message: string;
  faction: Faction;
}

// Game-Over-Overlay: Sieg/Niederlage, Neustart oder zurück ins Hauptmenü.
export class GameOverScene extends Phaser.Scene {
  constructor() {
    super("GameOver");
  }

  create(data: GameOverData): void {
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.8);

    const won = data.message.toLowerCase().includes("gewonnen");
    this.add
      .text(width / 2, height * 0.34, data.message, {
        fontFamily: "Cinzel, serif",
        fontSize: "64px",
        color: won ? "#ffe9a8" : "#ff6b6b",
      })
      .setOrigin(0.5)
      .setShadow(2, 2, "#000000", 6);

    makeButton(this, width / 2, height * 0.54, "Neu starten", () => {
      this.scene.start("Game", { faction: data.faction });
    });
    makeButton(this, width / 2, height * 0.65, "Hauptmenü", () => {
      this.scene.start("Menu");
    });
  }
}
