import type { GridEntity } from "../types";

// Basisklasse aller Spielobjekte. x/y ist – wie im Original – die LINKE OBERE Ecke.
// Die eigentliche Darstellung übernehmen Phaser-GameObjects in den Unterklassen.
export abstract class Entity implements GridEntity {
  x: number;
  y: number;
  width: number;
  height: number;
  _gridCells: Set<Set<GridEntity>> = new Set();
  dead = false;

  constructor(x: number, y: number, width: number, height: number) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }

  get centerX(): number {
    return this.x + this.width / 2;
  }

  get centerY(): number {
    return this.y + this.height / 2;
  }

  intersects(other: { x: number; y: number; width: number; height: number }): boolean {
    return !(
      this.x + this.width < other.x ||
      this.x > other.x + other.width ||
      this.y + this.height < other.y ||
      this.y > other.y + other.height
    );
  }

  // Aktualisiert die Phaser-Darstellung anhand der Logikposition.
  abstract sync(): void;
  // Entfernt alle Phaser-GameObjects.
  abstract destroyView(): void;
}
