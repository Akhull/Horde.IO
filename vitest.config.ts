import { defineConfig } from "vitest/config";

// Die Spiel-Systeme (SpatialGrid, SafeZone, …) sind bewusst Phaser-frei und
// deterministisch – darum laufen die Unit-Tests in der schnellen node-Umgebung
// ohne Browser/Canvas. Tests liegen co-lokal neben dem Code (*.test.ts).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    globals: false,
  },
});
