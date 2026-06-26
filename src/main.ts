import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { GameScene } from "./scenes/GameScene";
import { setGame } from "./ui/controller";
import { initUI } from "./ui";

// Phaser rendert nur noch die Spielwelt (Boot lädt Assets, Game spielt). Sämtliche
// UI (Menüs, HUD, Pause) liegt als DOM-Overlay darüber – siehe src/ui.
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#0c0a07",
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  render: { antialias: true, roundPixels: false },
  scene: [BootScene, GameScene],
};

const game = new Phaser.Game(config);

// Standard-Lautstärken (werden in den Optionen verändert).
game.registry.set("musicVolume", 0.5);
game.registry.set("sfxVolume", 0.5);

// Engine an die UI-Steuerschicht übergeben und das DOM-UI aufbauen.
setGame(game);
initUI();

// Für Debugging/Tests von aussen erreichbar.
(globalThis as unknown as { __horde?: Phaser.Game }).__horde = game;
