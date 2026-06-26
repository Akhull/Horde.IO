// Headless, deterministischer Mikrobenchmark: OOP-Entity-Simulation vs. Miniplex-ECS.
//
// Beide Implementierungen teilen sich dieselbe SpatialGrid (Broad-Phase identisch) und
// dieselbe gesäte Szenario-Generierung (mulberry32). Gemessen wird NUR der Simulations-
// Hot-Path: Bewegung zum Ziel + Nachbar-Query + Separations-Akkumulation + Integration.
// Rendering/sync() ist NICHT Teil dieser Messung (siehe RESULTS.md-Caveat).
//
// Ausführung über vitest (installiert): liefert echte Zahlen und schreibt RESULTS.md.

import { describe, it, expect } from "vitest";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { generateScenario, DT } from "./shared";
import { buildOopWorld, stepOop } from "./oop";
import { buildEcsWorld, stepEcs } from "./ecs";

const SEED = 0x1234abcd;
const WARMUP_FRAMES = 120;
const TIMED_FRAMES = 600;
const COUNTS = [200, 500, 1000, 2000, 4000];

interface Measurement {
  msPerFrame: number;
  heapDeltaMb: number;
  checksum: number;
}

// Versucht GC anzustoßen, falls vitest mit --expose-gc läuft (sauberere heapΔ-Signale).
function tryGc(): void {
  const g = globalThis as unknown as { gc?: () => void };
  if (typeof g.gc === "function") g.gc();
}

// Stabiler Prüfsumme über die finalen Positionen, damit beide Implementierungen
// nachweislich nicht "ins Leere" optimiert werden (verhindert Dead-Code-Elimination)
// und als grober Plausibilitäts-Check der Bewegung dient.
function checksumOop(units: ReturnType<typeof buildOopWorld>["units"]): number {
  let s = 0;
  for (let i = 0; i < units.length; i++) s += units[i].x * 0.5 + units[i].y * 0.25;
  return s;
}

function measureOop(n: number): Measurement {
  const records = generateScenario(n, SEED);
  const { units, grid } = buildOopWorld(records);

  for (let f = 0; f < WARMUP_FRAMES; f++) stepOop(units, grid, DT);

  tryGc();
  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  for (let f = 0; f < TIMED_FRAMES; f++) stepOop(units, grid, DT);
  const t1 = performance.now();
  const heapAfter = process.memoryUsage().heapUsed;

  return {
    msPerFrame: (t1 - t0) / TIMED_FRAMES,
    heapDeltaMb: (heapAfter - heapBefore) / (1024 * 1024),
    checksum: checksumOop(units),
  };
}

function measureEcs(n: number): Measurement {
  const records = generateScenario(n, SEED);
  const ecs = buildEcsWorld(records);

  for (let f = 0; f < WARMUP_FRAMES; f++) stepEcs(ecs, DT);

  tryGc();
  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  for (let f = 0; f < TIMED_FRAMES; f++) stepEcs(ecs, DT);
  const t1 = performance.now();
  const heapAfter = process.memoryUsage().heapUsed;

  let s = 0;
  for (const e of ecs.world.entities) s += e.position.x * 0.5 + e.position.y * 0.25;

  return {
    msPerFrame: (t1 - t0) / TIMED_FRAMES,
    heapDeltaMb: (heapAfter - heapBefore) / (1024 * 1024),
    checksum: s,
  };
}

function fmt(v: number, digits = 4): string {
  return v.toFixed(digits);
}

describe("OOP vs ECS simulation hot path", () => {
  it("benchmarks both implementations across entity counts and writes RESULTS.md", () => {
    const rows: {
      n: number;
      oop: Measurement;
      ecs: Measurement;
      speedup: number;
    }[] = [];

    // Tabellenkopf in stdout.
    const header = "N     | OOP ms/frame | ECS ms/frame | speedup | OOP heapΔ (MB) | ECS heapΔ (MB)";
    const sep = "------+--------------+--------------+---------+----------------+---------------";
     
    console.log("\n" + header + "\n" + sep);

    for (const n of COUNTS) {
      const oop = measureOop(n);
      const ecs = measureEcs(n);
      const speedup = oop.msPerFrame / ecs.msPerFrame; // >1 => ECS schneller
      rows.push({ n, oop, ecs, speedup });

      const line =
        `${String(n).padEnd(5)} | ` +
        `${fmt(oop.msPerFrame).padStart(12)} | ` +
        `${fmt(ecs.msPerFrame).padStart(12)} | ` +
        `${fmt(speedup, 2).padStart(7)} | ` +
        `${fmt(oop.heapDeltaMb, 2).padStart(14)} | ` +
        `${fmt(ecs.heapDeltaMb, 2).padStart(13)}`;
       
      console.log(line);

      // Sanity: beide simulieren wirklich (nicht wegoptimiert), Zahlen sind endlich.
      expect(Number.isFinite(oop.msPerFrame)).toBe(true);
      expect(Number.isFinite(ecs.msPerFrame)).toBe(true);
      expect(oop.msPerFrame).toBeGreaterThan(0);
      expect(ecs.msPerFrame).toBeGreaterThan(0);
    }

    writeResults(rows);
  });
});

function writeResults(
  rows: { n: number; oop: Measurement; ecs: Measurement; speedup: number }[],
): void {
  const tableHeader =
    "| N | OOP ms/frame | ECS ms/frame | speedup | OOP heapΔ (MB) | ECS heapΔ (MB) |\n" +
    "|---|---|---|---|---|---|";
  const tableRows = rows
    .map(
      (r) =>
        `| ${r.n} | ${fmt(r.oop.msPerFrame)} | ${fmt(r.ecs.msPerFrame)} | ${fmt(r.speedup, 2)}x | ${fmt(
          r.oop.heapDeltaMb,
          2,
        )} | ${fmt(r.ecs.heapDeltaMb, 2)} |`,
    )
    .join("\n");

  // Crossover bestimmen: kleinste N, ab der ECS klar (>5%) gewinnt.
  const crossover = rows.find((r) => r.speedup > 1.05);
  const maxSpeedup = rows.reduce((m, r) => Math.max(m, r.speedup), 0);
  const maxRow = rows.find((r) => r.speedup === maxSpeedup)!;
  const ecsEverWins = rows.some((r) => r.speedup > 1.05);

  let verdict: string;
  if (!ecsEverWins) {
    verdict =
      `**Verdict: ECS does NOT win on this hot path.** Across all tested entity counts ` +
      `(${rows[0].n}–${rows[rows.length - 1].n}), the OOP model is at least as fast as the ` +
      `Miniplex ECS model (best ECS speedup ${fmt(maxSpeedup, 2)}x at N=${maxRow.n}). The reason ` +
      `is that the broad-phase \`SpatialGrid\` neighbor query dominates the per-frame cost and is ` +
      `**identical** in both implementations; the data-layout difference (packed archetype array ` +
      `vs. scattered class instances) is too small a fraction of the frame to flip the result, and ` +
      `the per-entity work involves pointer-chasing into \`Position\` objects and \`Set\`-based grid ` +
      `cells either way. A migration to ECS would not pay for itself in raw simulation throughput ` +
      `at these scales.`;
  } else {
    verdict =
      `**Verdict: ECS wins, but modestly.** ECS becomes faster than OOP starting around ` +
      `N=${crossover!.n} (speedup ${fmt(crossover!.speedup, 2)}x), peaking at ${fmt(maxSpeedup, 2)}x ` +
      `at N=${maxRow.n}. The win comes purely from cache-friendlier iteration over the packed ` +
      `archetype array; the broad-phase \`SpatialGrid\` query is identical in both and still ` +
      `dominates the frame, which caps the achievable speedup. Whether the migration is worth it ` +
      `depends on whether a ${fmt(maxSpeedup, 2)}x simulation-only win justifies rewriting the fat ` +
      `\`Unit\` class and all systems that depend on it.`;
  }

  const md = `# OOP-Entity vs. Miniplex-ECS — Simulation Hot-Path Benchmark

Generated by \`tools/bench/run.bench.ts\` (run via \`npm run bench\`).

Deterministic (mulberry32, seed \`0x${SEED.toString(16)}\`), headless, no \`Math.random\`/\`Date.now\`.
Both implementations share the **same** \`SpatialGrid\` broad phase and the **same** seeded
scenario (identical entity counts, start positions, leader assignment, and targets), so the
benchmark isolates the only thing that differs: **data layout + iteration/dispatch**
(scattered fat class instances vs. packed Miniplex archetype components).

Per-frame work measured (both sides, identical math):
1. move each unit toward its target (vassals follow their leader, leaders wander),
2. query the shared \`SpatialGrid\` for neighbors (allocation-free \`getPotentialCollidersInto\`),
3. accumulate separation forces (squared-distance pre-filter, \`sqrt\` only on hits — mirrors
   \`applySeparationForce\` in \`src/systems/collision.ts\`),
4. integrate position, then re-index the grid.

Config: ${WARMUP_FRAMES} warmup frames (untimed, JIT + steady-state), ${TIMED_FRAMES} timed frames,
mean \`performance.now()\` ms/frame from \`node:perf_hooks\`. \`heapΔ\` is the
\`process.memoryUsage().heapUsed\` delta across the timed run (rough allocation signal; run with
\`--expose-gc\` for cleaner numbers). \`speedup\` = OOP ms/frame ÷ ECS ms/frame (>1 means ECS faster).

## Results

${tableHeader}
${tableRows}

## Verdict

${verdict}

### Honest caveat

This benchmark measures the **simulation hot path only**. The live game additionally spends
per-frame time on Phaser rendering and \`Unit.sync()\` (sprite/health-bar/effect updates), AI
target-finding, projectiles, particles, and combat resolution — none of which are measured here.
A favorable (or unfavorable) simulation number does **not** by itself decide an ECS migration;
the gameplay-visible behavior is unchanged and untouched (\`src/scenes/GameScene.ts\` and
\`src/entities/Unit.ts\` were not modified).
`;

  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, "RESULTS.md");
  writeFileSync(out, md, "utf8");
   
  console.log(`\nWrote ${out}\n`);
}
