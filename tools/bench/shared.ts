// Geteilte, deterministische Bausteine für den OOP-vs-ECS-Mikrobenchmark.
//
// WICHTIG: KEIN Math.random, KEIN Date.now. Alle Zufallswerte stammen aus mulberry32,
// damit OOP- und ECS-Lauf bei gleichem Seed/Entitätenzahl EXAKT dieselbe Welt
// (Startpositionen, Ziele, Anführer-Zuordnung) simulieren. So isoliert der Benchmark
// die einzige relevante Variable: Datenlayout + Iteration/Dispatch.

import { CONFIG } from "../../src/config/gameConfig";
import { mulberry32 } from "../../src/sim/rng";

// mulberry32 lebt jetzt als geteilte Quelle in src/sim/rng.ts (eine Implementierung
// für Sim-Kern + Benchmark). Hier nur re-exportiert, damit der Benchmark byte-identisch
// dieselbe Welt erzeugt wie zuvor.
export { mulberry32 };

export const WORLD_WIDTH = CONFIG.worldWidth;
export const WORLD_HEIGHT = CONFIG.worldHeight;

// Zellengröße der Broad-Phase. Im Spiel wird die SpatialGrid mit einer an die
// Einheitengröße angelehnten Zelle betrieben; 100 px liegt in derselben Größenordnung
// wie die größten Einheiten (~78 px) und hält die Nachbar-Trefferlisten realistisch.
export const CELL_SIZE = 100;

// Einheiten-Grundwerte für den Benchmark (nahe an UNIT_STATS.vassal: 40 px, ~2.4 px/frame).
export const UNIT_SIZE = 40;
export const UNIT_SPEED = 2.411; // entspricht UNIT_STATS.vassal.speed
export const SEPARATION_DESIRED = 30; // 1:1 aus applySeparationForce
export const SEPARATION_STRENGTH = 0.05; // 1:1 aus applySeparationForce
export const DT = 16.6667; // ein 60-FPS-Frame in ms (für zeitbasierte Felder)

// Ein einzelner Welt-Datensatz: rohe Startwerte, die BEIDE Implementierungen
// identisch konsumieren. Anführer (leaderIndex) bilden lose "Horden" nach – wie im
// Spiel folgen Vasallen einem König. Das gibt der Bewegung ein realistisches Ziel.
export interface SpawnRecord {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  leaderIndex: number; // Index des Anführers in der Liste (== self, wenn König)
  isLeader: boolean;
}

// Erzeugt N Spawn-Datensätze deterministisch aus dem Seed.
// Struktur ahmt das Spiel nach: ein Bruchteil der Einheiten sind "Könige" (Anführer),
// der Rest sind Vasallen, die je einem Anführer zugeordnet werden. Jeder Anführer hat
// ein Wanderziel; Vasallen erben das Ziel ihres Anführers (Formation/Sammelbewegung).
export function generateScenario(n: number, seed: number): SpawnRecord[] {
  const rand = mulberry32(seed);
  const records: SpawnRecord[] = new Array(n);

  // ~1 Anführer pro 25 Einheiten (entspricht grob König + ~24er-Horde im Spiel),
  // mindestens 1. Anführer kommen zuerst, damit Vasallen auf gültige Indizes zeigen.
  const leaderCount = Math.max(1, Math.floor(n / 25));

  for (let i = 0; i < leaderCount; i++) {
    const x = rand() * WORLD_WIDTH;
    const y = rand() * WORLD_HEIGHT;
    records[i] = {
      x,
      y,
      targetX: rand() * WORLD_WIDTH,
      targetY: rand() * WORLD_HEIGHT,
      leaderIndex: i,
      isLeader: true,
    };
  }

  for (let i = leaderCount; i < n; i++) {
    // Anführer deterministisch zuordnen und nahe bei ihm spawnen (Horde-Cluster),
    // damit Nachbar-Queries realistisch befüllt sind (nicht gleichmäßig dünn).
    const leaderIndex = Math.floor(rand() * leaderCount);
    const leader = records[leaderIndex];
    // Streuung um den Anführer (Clustergröße ~ ein paar Zellen).
    const spreadX = (rand() - 0.5) * 400;
    const spreadY = (rand() - 0.5) * 400;
    const x = clamp(leader.x + spreadX, 0, WORLD_WIDTH - UNIT_SIZE);
    const y = clamp(leader.y + spreadY, 0, WORLD_HEIGHT - UNIT_SIZE);
    records[i] = {
      x,
      y,
      targetX: leader.targetX,
      targetY: leader.targetY,
      leaderIndex,
      isLeader: false,
    };
  }

  return records;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
