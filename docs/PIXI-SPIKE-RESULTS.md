# Pixi-Iso-Spike — Ergebnis (S4-P0)

**Verdikt: GO.** PixiJS v8, echte 45°-Iso-Ansicht (2:1 dimetric) als reine 2D-Projektion
über prozeduralem fBm-Heightmap-Terrain (Wasser/Sand/Gras/Hügel/Fels/Schnee mit Klippen)
+ 4000 tiefensortierte Unit-Sprites, Drag-Pan + Mausrad-Zoom.

- **Performance:** ~**196 FPS bei 4000 Units** — und das mit einem *regulären* Sprite-Container,
  also **vor** dem ParticleContainer-Batch-Pfad. Klarer Headroom Richtung 8000. Der megaLoad-
  Batch-Pfad (siehe `ENGINE-LEARNINGS.md`) ist die nächste Optimierung, nicht nötig für den Beweis.
- **Optik:** kohärente Geografie statt Zufalls-Rechtecke; der 45°-RTS-Look trägt sofort.
- **Architektur bestätigt:** Iso ist eine reine Render-Projektion (`worldToIso(gx,gy)`),
  Tiefensortierung per `zIndex = gx+gy`, Terrain aus deterministischem Noise. Genau der
  Sim/Render-Split aus `MAXED-DIRECTION.md` — null Spiel-Logik im Render.

**Konsequenz:** Die Iso-Render-Migration (S4) ist technisch grün. Nächste Schritte am Render-Strom:
Sprite→ParticleContainer-Pfad (megaLoad ≥1000) für 8000+, dann den Renderer an die Headless-`World`
anbinden (statt der Spike-eigenen Demo-Units).

Dateien: `tools/iso-spike/main.ts` + `iso-spike.html`. Aufruf: **http://localhost:5173/iso-spike.html**
