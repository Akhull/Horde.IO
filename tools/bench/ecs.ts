// ECS-Modell (Miniplex) desselben Simulations-Hot-Paths.
//
// Datenlayout: schlanke Komponenten { position, velocity, target }. Die archetypische
// Query (world.with(...)) hält ALLE passenden Entitäten in EINEM gepackten Array –
// das ist der strukturelle Unterschied zum OOP-Lauf (gestreute, breite Instanzen).
// Die Systeme laufen über query.entities und führen EXAKT dieselbe Logik aus.
//
// Die SpatialGrid erwartet GridEntity (x/y/width/height/_gridCells/_visit). Wir lassen
// die `position`-Komponente selbst GridEntity implementieren – so teilen sich BEIDE
// Implementierungen dieselbe Broad-Phase, und der Benchmark misst nur das Datenlayout.

import { World } from "miniplex";
import { SpatialGrid } from "../../src/systems/SpatialGrid";
import type { GridEntity } from "../../src/types";
import {
  SpawnRecord,
  UNIT_SIZE,
  UNIT_SPEED,
  SEPARATION_DESIRED,
  SEPARATION_STRENGTH,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  CELL_SIZE,
} from "./shared";

// Position-Komponente == GridEntity. Hält die Broad-Phase-Felder, damit die echte
// SpatialGrid unverändert funktioniert. width/height sind fix (Vasallengröße).
export interface Position extends GridEntity {
  x: number;
  y: number;
  width: number;
  height: number;
  _gridCells: Set<Set<GridEntity>>;
  _visit: number;
  dead: boolean;
}

export interface Velocity {
  speed: number;
  facing: 1 | -1;
}

export interface Target {
  x: number;
  y: number;
  isLeader: boolean;
  // Referenz auf die Position-Komponente des Anführers (Vasall folgt ihr).
  // Bei Anführern zeigt sie auf die eigene Position.
  leaderPos: Position;
}

export interface Entity {
  position: Position;
  velocity: Velocity;
  target: Target;
}

const sepScratch: GridEntity[] = [];

export interface EcsWorld {
  world: World<Entity>;
  grid: SpatialGrid;
}

// Baut die ECS-Welt deterministisch aus den geteilten Spawn-Datensätzen.
export function buildEcsWorld(records: SpawnRecord[]): EcsWorld {
  const world = new World<Entity>();
  const grid = new SpatialGrid(WORLD_WIDTH, WORLD_HEIGHT, CELL_SIZE);

  // Positions-Komponenten zuerst erzeugen, damit Anführer-Referenzen gültig sind.
  const positions: Position[] = new Array(records.length);
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    positions[i] = {
      x: r.x,
      y: r.y,
      width: UNIT_SIZE,
      height: UNIT_SIZE,
      _gridCells: new Set(),
      _visit: 0,
      dead: false,
    };
  }

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    world.add({
      position: positions[i],
      velocity: { speed: UNIT_SPEED, facing: 1 },
      target: {
        x: r.targetX,
        y: r.targetY,
        isLeader: r.isLeader,
        leaderPos: positions[r.leaderIndex],
      },
    });
  }

  for (let i = 0; i < positions.length; i++) grid.addEntity(positions[i]);
  return { world, grid };
}

// Bewegungs- + Separations-System über die archetypische Query. Identische Logik wie
// OopUnit.update, nur über gepackte Komponenten-Referenzen statt fette Instanzen.
const HALF = UNIT_SIZE / 2;

export function stepEcs(ecs: EcsWorld, _dt: number): void {
  const { world, grid } = ecs;
  // Archetyp-Query: alle Entitäten mit position+velocity+target. .entities ist ein
  // gepacktes Array -> kontinuierliche Iteration, der Kern-Vorteil von ECS.
  const query = world.with("position", "velocity", "target");
  const entities = query.entities;

  const desired = SEPARATION_DESIRED;
  const desiredSq = desired * desired;

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const pos = e.position;
    const tgt = e.target;
    const vel = e.velocity;

    // 1.+2. Bewegung zum Ziel.
    let gx: number;
    let gy: number;
    if (tgt.isLeader) {
      gx = tgt.x;
      gy = tgt.y;
      const ddx = gx - pos.x;
      const ddy = gy - pos.y;
      if (ddx * ddx + ddy * ddy < 100) {
        tgt.x = (pos.x * 1.3 + WORLD_WIDTH * 0.37) % WORLD_WIDTH;
        tgt.y = (pos.y * 1.7 + WORLD_HEIGHT * 0.53) % WORLD_HEIGHT;
        gx = tgt.x;
        gy = tgt.y;
      }
    } else {
      const lp = tgt.leaderPos;
      gx = lp.x + HALF;
      gy = lp.y + HALF;
    }

    const cx = pos.x + HALF;
    const cy = pos.y + HALF;
    const dx = gx - cx;
    const dy = gy - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 5) {
      const inv = vel.speed / d;
      pos.x += dx * inv;
      pos.y += dy * inv;
      vel.facing = dx < 0 ? -1 : 1;
    }

    // 3.+4. Separation.
    let fx = 0;
    let fy = 0;
    let count = 0;
    const ax = pos.x;
    const ay = pos.y;
    const neighbors = grid.getPotentialCollidersInto(pos, sepScratch);
    for (let j = 0; j < neighbors.length; j++) {
      const b = neighbors[j];
      if (b === pos) continue;
      const sdx = ax - b.x;
      const sdy = ay - b.y;
      const dSq = sdx * sdx + sdy * sdy;
      if (dSq > 0 && dSq < desiredSq) {
        const sd = Math.sqrt(dSq);
        fx += (sdx / sd) * (desired - sd);
        fy += (sdy / sd) * (desired - sd);
        count++;
      }
    }

    // 5. Separation integrieren.
    if (count > 0) {
      pos.x += (fx / count) * SEPARATION_STRENGTH;
      pos.y += (fy / count) * SEPARATION_STRENGTH;
    }
  }

  // Grid neu indizieren (wie scene.grid.updateEntity nach allen Updates).
  for (let i = 0; i < entities.length; i++) {
    grid.updateEntity(entities[i].position);
  }
}
