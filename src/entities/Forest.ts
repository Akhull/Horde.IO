import Phaser from "phaser";
import { Entity } from "./Entity";
import { DEPTH } from "../config/gameConfig";

// Waldfläche: gekacheltes Wald-Sprite als undurchdringliches Hindernis.
export class Forest extends Entity {
  readonly type = "forest" as const;
  private tile: Phaser.GameObjects.TileSprite;

  constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number) {
    super(x, y, width, height);

    const tex = scene.textures.get("forest");
    const src = tex.getSourceImage();
    const desiredTileWidth = 210;
    const scale = src.width > 0 ? desiredTileWidth / src.width : 1;

    this.tile = scene.add
      .tileSprite(x, y, width, height, "forest")
      .setOrigin(0, 0)
      .setTileScale(scale, scale)
      .setDepth(DEPTH.obstacle);
  }

  sync(): void {
    /* statisch */
  }

  destroyView(): void {
    this.tile.destroy();
  }
}
