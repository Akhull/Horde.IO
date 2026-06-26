import Phaser from "phaser";
import { Entity } from "./Entity";
import { DEPTH, TOWER, BARRACKS } from "../config/gameConfig";
import type { BuildingType } from "../types";
import type { GameScene } from "../scenes/GameScene";

// Gebäude (Scheune/Haus/Turm). Werden von Einheiten angegriffen und droppen beim
// Zerstören eine Seele. Türme feuern zusätzlich auf nahe Einheiten (siehe systems/combat).
export class Building extends Entity {
  buildingType: BuildingType;
  hp = 100;
  // Maximal-HP des Gebäudes (typabhängig) – speist die Healthbar-Breite in sync().
  // Bewusst gespeichert statt fest 100, damit die Kaserne (BARRACKS.hp) korrekt skaliert.
  maxHp = 100;
  // Turm-Feuertakt (ms hochzählend); für Nicht-Türme ungenutzt.
  fireTimer = 0;
  // Kaserne-Rekruten-Takt (ms hochzählend); nur von "barracks" genutzt (s. systems/combat).
  spawnTimer = 0;
  private flashFrames = 0;
  private sprite: Phaser.GameObjects.Image;
  private barBg: Phaser.GameObjects.Rectangle;
  private barFill: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number, buildingType: BuildingType) {
    super(x, y, 60, 60);
    this.buildingType = buildingType;
    // HP/maxHp typabhängig: Kaserne ist zäher (lohnendes Objektiv), Rest behält 100.
    if (buildingType === "barracks") {
      this.hp = BARRACKS.hp;
      this.maxHp = BARRACKS.hp;
    }
    // Türme zeitlich versetzt starten, damit nicht alle gleichzeitig feuern.
    if (buildingType === "tower") this.fireTimer = Math.random() * TOWER.fireInterval;
    // Kasernen zeitlich versetzt starten, damit nicht alle gleichzeitig emittieren
    // (gleicher Trick wie beim Turm-fireTimer).
    if (buildingType === "barracks") this.spawnTimer = Math.random() * BARRACKS.spawnInterval;

    this.sprite = scene.add
      .image(this.centerX, this.centerY, buildingType)
      .setDisplaySize(this.width, this.height)
      .setDepth(DEPTH.building);

    this.barBg = scene.add
      .rectangle(this.x, this.y - 7, this.width, 5, 0x000000)
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.healthbar);
    this.barFill = scene.add
      .rectangle(this.x, this.y - 7, this.width, 5, 0xff0000)
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.healthbar);
  }

  // Treffer-Eingang: HP abziehen + kurzer Aufleucht-Flash (srcX/srcY ungenutzt –
  // Gebäude werden nicht zurückgestoßen). Signatur passt zu ProjectileTarget.
  takeDamage(amount: number, _srcX: number, _srcY: number, _scene: GameScene): void {
    if (this.hp <= 0) return;
    this.hp -= amount;
    this.flashFrames = 5;
  }

  sync(): void {
    if (this.flashFrames > 0) {
      this.sprite.setTintFill(0xffffff);
      this.flashFrames--;
      if (this.flashFrames === 0) this.sprite.clearTint();
    }
    this.barFill.width = this.width * Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
  }

  destroyView(): void {
    this.sprite.destroy();
    this.barBg.destroy();
    this.barFill.destroy();
  }
}
