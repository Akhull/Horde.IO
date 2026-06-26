// Reine, Phaser-freie Kamera-/Eskalations-Mathematik. Steuert, wie sich die Schlacht ÜBER
// DEN MATCH-VERLAUF aufbaut: ruhiger Start, leichtes Wackeln nur in großen Schlachten und
// ein episches Beben im finalen Duell – plus die mit der Phase mitwachsende Lautstärke der
// Kriegs-Ambience/Schlacht-Musik. Hier liegen nur die deterministischen Skalar-Kurven (kein
// Math.random – der Zufalls-Shake-Offset selbst lebt Phaser-gekoppelt in GameScene), damit
// alles ohne Browser-Umgebung testbar bleibt. Keine Allokationen.

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Frame-raten-unabhängiger Glättungs-Anteil für ein exponentielles Nachziehen (Kamera-Follow,
// Shake-Stärke). per16 ist der Anteil, um den pro 60-FPS-Frame (16.67 ms) zum Ziel gerückt
// wird; bei längeren Frames wächst alpha entsprechend, damit die Glättung gleich "schnell"
// bleibt (sonst zöge die Kamera bei niedriger FPS sichtbar träger nach).
export function frameLerpAlpha(dt: number, per16: number): number {
  if (per16 <= 0) return 0;
  if (per16 >= 1) return 1;
  return 1 - Math.pow(1 - per16, dt / 16.6667);
}

// Match-Phase aus der Zahl lebender Könige: 0 = frühe, ruhige Phase (>= earlyKings Könige am
// Leben), 1 = episches Finale (<= finalKings Könige), linear dazwischen. So beginnt das Match
// ruhig und eskaliert automatisch, je weiter das Feld zusammenschrumpft. earlyKings > finalKings.
export function battlePhaseFactor(kingsAlive: number, earlyKings: number, finalKings: number): number {
  if (earlyKings <= finalKings) return kingsAlive <= finalKings ? 1 : 0;
  return clamp01((earlyKings - kingsAlive) / (earlyKings - finalKings));
}

// Clash-Intensität aus der On-Screen-Kampfaktivität (recentCombatEvents): 0 unter threshold,
// rampt linear bis 1 bei threshold+range. So reagiert die Eskalation NUR auf echtes Gemetzel –
// selbst im Finale wackelt nichts, solange die Horden sich noch nicht bekriegen.
export function clashIntensity(events: number, threshold: number, range: number): number {
  if (events <= threshold) return 0;
  if (range <= 0) return 1;
  return clamp01((events - threshold) / range);
}

// Ziel-Shake-Amplitude in Pixeln. Skaliert mit der Clash-Intensität (kein Kampf -> kein Shake)
// und schwillt mit der Phase von baselinePx (Spitze einer großen Frühschlacht) auf epicPx
// (Spitze im finalen Duell) an. Bewusst klein gehalten – "leicht shaken", kein Erdbeben.
export function battleShakeAmplitude(phase: number, clash: number, baselinePx: number, epicPx: number): number {
  return clash * lerp(baselinePx, epicPx, clamp01(phase));
}

// Ziel-Lautstärke der Kriegs-Ambience/Schlacht-Musik (0..1, vor Master-SFX-Skalierung).
// Intensität aus Kampf-Events + Truppenmenge, gedeckelt von einer mit der Phase wachsenden
// Decke: leiser, ruhiger Start (ambienceEarlyCeiling) -> lauter, epischer Endkampf
// (ambienceFinalCeiling). Die "totale Stille bei null Kampf"-Regel sitzt im Aufrufer.
export function warAmbienceTarget(
  events: number,
  unitCount: number,
  phase: number,
  cfg: {
    ambienceEventRef: number;
    ambienceUnitRef: number;
    ambienceEarlyCeiling: number;
    ambienceFinalCeiling: number;
  },
): number {
  const eventFactor = Math.min(1, events / cfg.ambienceEventRef);
  const unitFactor = Math.min(1, unitCount / cfg.ambienceUnitRef);
  const intensity = (eventFactor + unitFactor) / 2;
  const ceiling = lerp(cfg.ambienceEarlyCeiling, cfg.ambienceFinalCeiling, clamp01(phase));
  return clamp01(intensity * ceiling);
}
