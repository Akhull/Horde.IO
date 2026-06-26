import { defineConfig } from "vite";

// Die Spiel-Assets (Sprites, Sounds, Musik) liegen weiterhin im Original
// unter legacy/public/assets und werden über einen Symlink in public/assets
// eingebunden. So existiert nur EINE Asset-Quelle – das alte Projekt bleibt
// unangetastet, das neue greift verlustfrei darauf zu.
export default defineConfig({
  base: "./",
  server: {
    port: 5173,
    open: true,
    // Symlinks ausserhalb der Projektwurzel (legacy/) für den Dev-Server erlauben
    fs: { allow: [".."] },
  },
  build: {
    target: "es2020",
    outDir: "dist",
  },
});
