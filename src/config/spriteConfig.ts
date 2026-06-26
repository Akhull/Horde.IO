import type { SoulType } from "../types";

// ===========================================================================
//  Sprite-Konfiguration (statische Kenney-Sprites)
// ===========================================================================
//
//  Die Einheiten-/Gebäude-Texturen kommen direkt als statische PNGs aus dem
//  Kenney-medieval-rts-Pack (Faktionsfarben sind ins Sprite gebacken -> kein
//  Tint). Es gibt kein Sprite-Sheet-/Animationssystem mehr; die einzige
//  verbleibende Tabelle hier ist die Orb-Einfärbung der Seelen.
// ===========================================================================

// Orb-Einfärbung (Tint) pro Seelen-Rarität. Eine einzige near-weisse Orb-Textur
// (particle-pack "orb") wird zur Laufzeit per setTint in diese Farben getönt –
// kein eigenes PNG pro Farbe nötig. Neue Rarität = eine Zeile (+ SoulType-Typ).
export const ORB_TINT: Record<SoulType, number> = {
  green: 0x4ade80, // Vasall (häufig)
  blue: 0x3b82f6, // Level-up auf 2
  purple: 0xa855f7, // Level-up auf 3
  gold: 0xffd700, // legendär (Champion)
};
