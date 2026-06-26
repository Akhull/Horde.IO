// Reine, Phaser-freie Schwierigkeits-Logik: erzeugt aus den Basis-AI-Persönlichkeiten
// + dem gewählten DIFFICULTY-Multiplikator eine NEUE, skalierte Laufzeit-Kopie.
// KRITISCH: Die `as const`-Objekte (AI.personalities, DIFFICULTY) werden NIE
// in-place verändert – sonst würden Werte über Runden/Instanzen hinweg leaken.
// Diese Datei ist absichtlich ohne Phaser-Abhängigkeit, damit sie testbar bleibt.

import { AI, DIFFICULTY } from "../config/gameConfig";
import type { AIPersonality, Difficulty } from "../config/gameConfig";

// Laufzeit-Form eines Persönlichkeits-Tiers (gleiche Felder wie AI.personalities,
// aber als veränderbare Kopie). So kann jeder KI-König seine skalierten Werte
// tragen, ohne die globale Konfiguration anzufassen.
export interface PersonalityTier {
  aggroRange: number;
  retreatHpFactor: number;
  regroupHpFactor: number;
  soulGreed: number;
  soulRange: number;
  finishHpRatio: number;
  powerUpDesire: number;
}

// Komplettes Laufzeit-Set aller Persönlichkeiten für die gewählte Schwierigkeit.
export type ScaledPersonalities = Record<AIPersonality, PersonalityTier>;

// Skaliert eine einzelne Basis-Persönlichkeit mit den Schwierigkeits-Faktoren.
// aiAggression macht den König mutiger (grössere Aggro-Reichweite, kämpft länger,
// finisht früher); aiSoulGreed steuert die Sammel-Gier. Werte werden defensiv
// geklemmt, damit Faktoren > 1 keine unsinnigen Wahrscheinlichkeiten (>1) erzeugen.
function scaleTier(base: (typeof AI.personalities)[AIPersonality], aiAggression: number, aiSoulGreed: number): PersonalityTier {
  return {
    // Mut/Aggression: weiter jagen, später fliehen, früher zurückkehren, eher finishen.
    aggroRange: base.aggroRange * aiAggression,
    soulRange: base.soulRange, // Suchradius bleibt – nur die Gier (Wahrscheinlichkeit) skaliert
    // retreatHpFactor sinkt mit mehr Aggression (flieht erst bei weniger HP).
    retreatHpFactor: clamp01(base.retreatHpFactor / aiAggression),
    // regroupHpFactor sinkt ebenfalls (kehrt früher in den Kampf zurück).
    regroupHpFactor: clamp01(base.regroupHpFactor / aiAggression),
    // finishHpRatio steigt mit Aggression (greift Gegner-König früher als "Finish" an).
    finishHpRatio: clamp01(base.finishHpRatio * aiAggression),
    soulGreed: clamp01(base.soulGreed * aiSoulGreed),
    powerUpDesire: base.powerUpDesire, // Power-Up-Gewichtung bleibt persönlichkeitsabhängig
  };
}

// Erzeugt für die gewählte Schwierigkeit eine frische, tief kopierte Tabelle aller
// Persönlichkeiten. Nichts wird in-place geändert -> kein Leak zwischen Runden.
export function buildScaledPersonalities(difficulty: Difficulty): ScaledPersonalities {
  const d = DIFFICULTY[difficulty];
  const out = {} as ScaledPersonalities;
  for (const key of Object.keys(AI.personalities) as AIPersonality[]) {
    out[key] = scaleTier(AI.personalities[key], d.aiAggression, d.aiSoulGreed);
  }
  return out;
}

// Klemmt einen Faktor-/Wahrscheinlichkeitswert auf [0, 1].
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
