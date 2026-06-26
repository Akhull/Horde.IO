// Gemeinsame Typen für das gesamte Spiel.

export type Faction = "human" | "elf" | "orc";
export type UnitType = "king" | "vassal" | "archer";
export type SoulType = "green" | "blue" | "purple";
export type BuildingType = "barn" | "house" | "tower";
export type ObstacleType = "forest" | "water";
export type PowerUpType = "speed" | "shield";

// Achsen-orientierte Bounding-Box. x/y ist – wie im Originalcode – die LINKE OBERE Ecke.
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  _gridCells?: Set<Set<GridEntity>>;
}

export type GridEntity = Box & { dead?: boolean };

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface SafeZoneCircle {
  centerX: number;
  centerY: number;
  radius: number;
}
