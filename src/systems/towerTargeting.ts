// Reine, Phaser-freie Zielwahl-Logik für Türme (eigene Datei, damit sie ohne
// Phaser/Browser-Umgebung testbar bleibt).

// Kandidat für Turm-Beschuss: alles mit Mittelpunkt und HP.
export interface TowerTargetCandidate {
  centerX: number;
  centerY: number;
  hp: number;
  dead?: boolean;
}

// Wählt das nächstgelegene lebende Ziel innerhalb der Reichweite (exklusiv).
// Gibt null zurück, wenn nichts in Reichweite ist.
export function pickTowerTarget<T extends TowerTargetCandidate>(
  cx: number,
  cy: number,
  candidates: Iterable<T>,
  range: number
): T | null {
  let best: T | null = null;
  let bestDist = range;
  for (const c of candidates) {
    if (c.dead || c.hp <= 0) continue;
    const d = Math.hypot(c.centerX - cx, c.centerY - cy);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}
