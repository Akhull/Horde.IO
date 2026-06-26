// Gemeinsame Typen für das gesamte Spiel.

export type Faction = "human" | "elf" | "orc";
export type UnitType = "king" | "vassal" | "archer" | "champion";
// Orb-Raritäten (Fortnite-Stil): grün < blau < lila < gold.
// gold = legendärer Orb -> nur der König sammelt ihn ein und beschwört einen Champion.
export type SoulType = "green" | "blue" | "purple" | "gold";
export type BuildingType = "barn" | "house" | "tower";
export type ObstacleType = "forest" | "water";
export type PowerUpType = "speed" | "shield" | "damage";

// Achsen-orientierte Bounding-Box. x/y ist – wie im Originalcode – die LINKE OBERE Ecke.
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  _gridCells?: Set<Set<GridEntity>>;
  // Besuchsstempel für allokationsfreie Deduplizierung in SpatialgGrid-Queries
  // (getPotentialCollidersInto/getEntitiesInBoundingBoxInto). Intern, nicht Gameplay.
  _visit?: number;
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
