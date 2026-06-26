// Zentrale Spielkonstanten – 1:1 aus dem alten public/js/core/config.js übernommen,
// erweitert um Einheiten-Werte, die im Original über die Unit-Klasse verstreut waren.

export const CONFIG = {
  worldWidth: 9000,
  worldHeight: 9000,

  // Safe-Zone (Battle-Royale-Schrumpfkreis)
  safeZoneDelay: 120000,
  safeZonePauseDuration: 30000,
  safeZoneMovePauseDuration: 15000,
  safeZoneShrinkRate: 0.05,
  safeZoneMoveRate: 0.05,
  safeZoneMinRadius: 250,
  safeZoneStartRadius: 7000,

  // König-Fähigkeiten
  dashCooldown: 5000,
  dashDistance: 200,
  shieldAbilityCooldown: 10000,
  shieldAbilityDuration: 5000,

  formationUpdateInterval: 10000,
} as const;

// Einheiten-Grundwerte (im Original in Unit.js hartkodiert)
export const UNIT_STATS = {
  king: { hp: 300, speed: 1.35 * 1.88, size: 40 * 1.3 },
  archer: { hp: 100, speed: 1.2 * 1.88, size: 40, attackCooldown: 2000, attackRange: 300 },
  vassal: {
    hp: 100,
    speed: 1.35 * 0.95 * 1.88,
    sizeByLevel: { 1: 40, 2: 40 * 1.1, 3: 40 * 1.2 } as Record<number, number>,
  },
} as const;

export const FACTIONS = ["human", "elf", "orc"] as const;

// Tiefen-Ebenen für die Phaser-Darstellung (z-Sortierung)
export const DEPTH = {
  ground: -100,
  obstacle: -50,
  building: 0,
  soul: 5,
  powerup: 6,
  shadow: 8,
  unit: 10,
  healthbar: 20,
  slash: 25,
  projectile: 30,
  safezone: 40,
  fx: 50,
  floatingText: 60,
} as const;
