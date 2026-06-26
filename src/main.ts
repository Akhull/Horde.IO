import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { TitleScene } from "./scenes/TitleScene";
import { MenuScene } from "./scenes/MenuScene";
import { OptionsScene } from "./scenes/OptionsScene";
import { SelectionScene } from "./scenes/SelectionScene";
import { GameScene } from "./scenes/GameScene";
import { HUDScene } from "./scenes/HUDScene";
import { GameOverScene } from "./scenes/GameOverScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#111111",
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  render: { antialias: true, roundPixels: false },
  scene: [
    BootScene,
    TitleScene,
    MenuScene,
    OptionsScene,
    SelectionScene,
    GameScene,
    HUDScene,
    GameOverScene,
  ],
};

const game = new Phaser.Game(config);

// Standard-Lautstärken (werden in den Optionen verändert).
game.registry.set("musicVolume", 0.5);
game.registry.set("sfxVolume", 0.5);

// Für Debugging/Tests von aussen erreichbar.
(globalThis as unknown as { __horde?: Phaser.Game }).__horde = game;
