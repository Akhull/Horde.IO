import { defineConfig } from "vitest/config";

// Eigenständige Vitest-Config NUR für den OOP-vs-ECS-Benchmark. Die Haupt-Config
// (vitest.config.ts) beschränkt include auf src/**; der Benchmark liegt bewusst
// self-contained unter tools/bench/ und braucht daher seinen eigenen include-Glob.
// node-Umgebung, keine Globals nötig außer den explizit importierten vitest-APIs.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tools/bench/**/*.bench.ts"],
    globals: false,
    // Großzügiges Timeout: 5 Entitätenzahlen × (Warmup + 600 getimte Frames) je 2 Modelle.
    testTimeout: 300000,
    // Einzelner Fork, kein Isolate -> stabilere, weniger verrauschte Timings.
    pool: "forks",
    poolOptions: {
      // --expose-gc gibt dem Runner ein global.gc() für saubere heapΔ-Signale
      // (vor jeder Messung wird GC angestoßen). execArgv wird hier ergänzt, nicht
      // ersetzt (die CLI-Variante --poolOptions...execArgv überschrieb die von
      // vitest benötigten Worker-Argumente und blockierte den Fork).
      forks: { singleFork: true, isolate: false, execArgv: ["--expose-gc"] },
    },
  },
});
