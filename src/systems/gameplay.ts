import { Unit } from "../entities/Unit";
import { Soul } from "../entities/Soul";
import { spawnVassal, spawnChampion } from "./worldgen";
import { LEGENDARY, KING_PROGRESSION } from "../config/gameConfig";
import type { SoulType } from "../types";
import type { GameScene } from "../scenes/GameScene";

// Wahrscheinlichkeit, dass ein lila Drop zu einem legendären Gold-Orb aufgewertet
// wird – sorgt für einen seltenen, aber farmbaren Gold-Trickle abseits von Königstoden.
const GOLD_UPGRADE_CHANCE = 0.12;

// Erzeugt beim Tod einer Einheit ggf. eine Seele (Vasallen nur zu 50%).
export function spawnSoulFromUnit(scene: GameScene, unit: Unit): void {
  if (unit.unitType === "vassal" && Math.random() < 0.5) return;
  let soulType: SoulType;
  // König- und Champion-Tode sind die großen Belohnungen -> garantiert Gold.
  if (unit.unitType === "king" || unit.unitType === "champion") soulType = "gold";
  else if (unit.level === 1) soulType = "green";
  else if (unit.level === 2) soulType = "blue";
  else soulType = "purple";
  // Seltene Aufwertung lila -> gold, damit Gold auch ohne Königstod farmbar bleibt.
  if (soulType === "purple" && Math.random() < GOLD_UPGRADE_CHANCE) soulType = "gold";
  const soul = new Soul(scene, unit.x, unit.y, soulType);
  scene.souls.push(soul);
  scene.grid.addEntity(soul);
}

// Entfernt tote Einheiten (HP <= 0), lässt eine Seele fallen und räumt das Grid auf.
// Der Spielerkönig wird hier bewusst NICHT entfernt – das übernimmt der Game-Over-Fluss.
export function removeDeadUnits(scene: GameScene): void {
  for (let i = scene.units.length - 1; i >= 0; i--) {
    const u = scene.units[i];
    if (u.hp <= 0) {
      if (u === scene.playerKing) continue;
      // Todes-Effekt: roter Partikel-Kern für JEDE Einheit. Der König-Shake liegt NICHT mehr hier,
      // sondern besitzt jetzt komplett der Königstöter-Finisher (onKingKilled -> kingKillCinematic),
      // damit es keine zwei überlappenden Shakes gibt. Der rote Kern bleibt – er bildet zusammen
      // mit der Gold-Schale des Finishers einen geschichteten Explosions-Look.
      const count = u.unitType === "king" ? 26 : u.unitType === "champion" ? 18 : u.unitType === "archer" ? 8 : 12;
      scene.spawnVisualEffect(u.centerX, u.centerY, { r: 150, g: 20, b: 20 }, count, 360, 3, 1.4);
      spawnSoulFromUnit(scene, u);
      scene.grid.removeEntity(u);
      u.dead = true;
      u.destroyView();
      scene.units.splice(i, 1);
      // König gefallen: GameScene informieren (Hit-Stop + Kill-Feed + Finisher-FX). Vasallen-Tode
      // werden bewusst NICHT gemeldet, um Kill-Feed/Wucht nicht zu überfluten.
      if (u.unitType === "king") {
        const kingsLeft = scene.units.filter((k) => k.unitType === "king").length;
        // nearPlayer = der Königstod geschah nahe (<600px) am eigenen König -> der Spieler war
        // ins Geschehen verwickelt und soll einen stärkeren Screen-Flash sehen. Der echte Killer
        // ist aus removeDeadUnits nicht zuverlässig bestimmbar (Tod aus vielen Quellen), daher
        // dient die Nähe als billiger, treffsicherer "Wow-für-den-Spieler"-Indikator.
        const pk = scene.playerKing;
        const nearPlayer = pk != null && Math.hypot(u.centerX - pk.centerX, u.centerY - pk.centerY) < 600;
        scene.onKingKilled(u.faction, kingsLeft, u.centerX, u.centerY, nearPlayer);
      }
    }
  }
}

// Seelen-Magnetismus: Seelen driften sanft zum nächsten passenden Sammler in kurzer
// Reichweite, damit Einsammeln befriedigender wirkt. Reichweite klein (SOUL_MAGNET_RANGE),
// Nachbarschaftssuche über die SpatialGrid -> kein O(n²) über alle Einheiten.
const SOUL_MAGNET_RANGE = 80; // px – Anziehungsradius
const SOUL_MAGNET_SPEED = 0.18; // Lerp-Faktor pro 16ms-Schritt Richtung Sammler

export function applySoulMagnetism(scene: GameScene, deltaTime: number): void {
  const step = deltaTime / 16;
  for (const soul of scene.souls) {
    // Kandidaten nur aus den umliegenden Grid-Zellen (Broad-Phase) holen.
    const near = scene.grid.getEntitiesInBoundingBox(
      soul.centerX - SOUL_MAGNET_RANGE,
      soul.centerY - SOUL_MAGNET_RANGE,
      SOUL_MAGNET_RANGE * 2,
      SOUL_MAGNET_RANGE * 2,
    );
    let best: Unit | null = null;
    let bestDist = SOUL_MAGNET_RANGE;
    for (const e of near) {
      if (!(e instanceof Unit) || e.dead) continue;
      // Nur Sammler, die diese Seele auch verwerten können (grün: jeder; blau: Lvl-1-Vasall; lila: Lvl-2-Vasall).
      if (!canCollectSoul(e, soul.soulType)) continue;
      const d = Math.hypot(e.centerX - soul.centerX, e.centerY - soul.centerY);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    if (!best) continue;
    // Sanftes, mit der Nähe zunehmendes Heranziehen (am Rand kaum, nah am Sammler stark).
    const pull = SOUL_MAGNET_SPEED * (1 - bestDist / SOUL_MAGNET_RANGE) * step;
    soul.x += (best.centerX - soul.centerX) * pull;
    soul.y += (best.centerY - soul.centerY) * pull;
    scene.grid.updateEntity(soul);
  }
}

// Kann diese Einheit die Seele verwerten? (Spiegelt die Regeln aus handleSouls wider.)
function canCollectSoul(unit: Unit, soulType: SoulType): boolean {
  if (soulType === "green") return true;
  if (soulType === "gold") return unit.unitType === "king"; // legendär: nur Könige beschwören Champions
  if (soulType === "blue") return unit.unitType === "vassal" && unit.level === 1;
  return unit.unitType === "vassal" && unit.level === 2; // purple
}

// Safe-Zone-Schaden für Einheiten ausserhalb des Kreises (Schild halbiert den Schaden).
// Hot-Path: squared-Distanzvergleich statt Math.hypot (nur Vergleich, kein echter Abstand
// nötig). removeDeadUnits wird nur aufgerufen, wenn es überhaupt eine tote Einheit gibt –
// derselbe Effekt wie der bedingungslose Aufruf zuvor (removeDeadUnits ist bei 0 Toten
// ein reiner No-Op-Scan), aber ohne die O(N)-König-Zählung pro Frame im Normalfall.
export function applySafeZoneDamage(scene: GameScene, deltaTime: number): void {
  const sz = scene.safeZoneCurrent;
  const rSq = sz.radius * sz.radius;
  let anyDead = false;
  for (const u of scene.units) {
    const dx = u.centerX - sz.centerX;
    const dy = u.centerY - sz.centerY;
    if (dx * dx + dy * dy > rSq) {
      let dmg = 0.05 * deltaTime;
      if (u.isShieldActive) dmg *= 0.5;
      // Rüstungs-Power-Up reduziert auch den Zonenschaden; kombiniert sich
      // multiplikativ mit der Schild-Halbierung (0.5 × armorDamageFactor).
      dmg *= u.armorDamageFactor;
      u.hp -= dmg;
    }
    if (u.hp <= 0) anyDead = true;
  }
  if (anyDead) removeDeadUnits(scene);
}

// Power-Ups einsammeln (Tempo oder Schild). Jetzt für JEDEN König – Spieler wie
// KI –, damit der Spieler kein unverdientes Dauer-Speed/Schild-Monopol hat.
// Broad-Phase: pro Power-Up nur die Einheiten der umliegenden Grid-Zellen prüfen
// (kein O(Power-Ups × Einheiten)). Erster überlappender König gewinnt das Power-Up.
export function handlePowerUps(scene: GameScene): void {
  for (let i = scene.powerUps.length - 1; i >= 0; i--) {
    const p = scene.powerUps[i];
    const near = scene.grid.getEntitiesInBoundingBox(p.x - p.width, p.y - p.height, p.width * 3, p.height * 3);
    let taker: Unit | null = null;
    for (const e of near) {
      if (e instanceof Unit && e.unitType === "king" && !e.dead && e.intersects(p)) {
        taker = e;
        break;
      }
    }
    if (!taker) continue;

    if (p.effectType === "speed") {
      taker.applySpeedBoost(p.duration);
      scene.spawnVisualEffect(p.centerX, p.centerY, { r: 255, g: 215, b: 0 }, 15, 400, 3, 1.2);
    } else if (p.effectType === "damage") {
      // Schadens-Boost: rot-oranger Funkenausbruch passend zur Orb-Farbe.
      taker.applyDamageBoost(p.duration);
      scene.spawnVisualEffect(p.centerX, p.centerY, { r: 255, g: 87, b: 34 }, 15, 400, 3, 1.2);
    } else if (p.effectType === "armor") {
      // Rüstungs-Boost: stahl-blaugrauer Funkenausbruch passend zur Orb-Farbe.
      taker.applyArmorBoost(p.duration);
      scene.spawnVisualEffect(p.centerX, p.centerY, { r: 154, g: 167, b: 180 }, 15, 400, 3, 1.2);
    } else if (p.effectType === "lifesteal") {
      // Lifesteal-Boost: blutroter Funkenausbruch passend zur Orb-Farbe.
      taker.applyLifesteal(p.duration);
      scene.spawnVisualEffect(p.centerX, p.centerY, { r: 176, g: 0, b: 32 }, 15, 400, 3, 1.2);
    } else if (p.effectType === "regen") {
      // Regen-Boost: smaragdgrüner Heil-Funkenausbruch passend zur Orb-Farbe.
      taker.applyRegen(p.duration);
      scene.spawnVisualEffect(p.centerX, p.centerY, { r: 46, g: 204, b: 113 }, 15, 400, 3, 1.2);
    } else if (p.effectType === "steady") {
      // Steady-Boost: erdbraun-steinerner Staubausbruch passend zur Orb-Farbe (standfest).
      taker.applySteady(p.duration);
      scene.spawnVisualEffect(p.centerX, p.centerY, { r: 139, g: 90, b: 43 }, 15, 400, 3, 1.2);
    } else {
      taker.applyShieldPowerUp(p.duration);
      scene.spawnVisualEffect(p.centerX, p.centerY, { r: 0, g: 191, b: 255 }, 15, 400, 3, 1.2);
    }
    p.destroyView();
    scene.powerUps.splice(i, 1);
  }
}

// Einsammel-Radius (px). Squared-Vergleich vermeidet Math.hypot im Hot-Path.
const SOUL_COLLECT_RANGE = 40;
const SOUL_COLLECT_RANGE_SQ = SOUL_COLLECT_RANGE * SOUL_COLLECT_RANGE;

// Seelen einsammeln: grün = neuer Vasall, blau/lila = Level-up passender Vasallen.
//
// Broad-Phase über die SpatialGrid: nur Einheiten in den umliegenden Zellen kommen
// als Sammler in Frage (statt O(Seelen × Einheiten) linear über ALLE Einheiten).
// WICHTIG für Verhaltens-Identität: Bei mehreren möglichen Sammlern im Radius muss
// derselbe Sammler gewählt werden wie zuvor (erster passender in scene.units-
// Einfügereihenfolge, dann break). Deshalb wird die Grid-Trefferliste in ein Set
// gelegt und scene.units in Originalreihenfolge durchlaufen – fernliegende Einheiten
// werden per O(1)-Set-Lookup übersprungen, ohne Math.hypot.
export function handleSouls(scene: GameScene): void {
  for (let i = scene.souls.length - 1; i >= 0; i--) {
    const soul = scene.souls[i];
    let collected = false;
    let collector: Unit;
    // König, dem die König-XP dieser Seele zufällt (null bis zum Einsammeln gesetzt).
    let collectorKing: Unit | null = null;

    // Kandidaten nur aus den Grid-Zellen um den Einsammel-Radius (Broad-Phase).
    const near = scene.grid.getEntitiesInBoundingBox(
      soul.centerX - SOUL_COLLECT_RANGE,
      soul.centerY - SOUL_COLLECT_RANGE,
      SOUL_COLLECT_RANGE * 2,
      SOUL_COLLECT_RANGE * 2,
    );
    if (near.length === 0) continue;
    const candidates = near.length === 1 ? null : new Set(near);

    for (const unit of scene.units) {
      // Schnellfilter: nur Einheiten, die die Broad-Phase tatsächlich geliefert hat.
      // (Kein dead-Check – das Original prüfte ihn hier ebenfalls nicht; removeDeadUnits
      //  läuft erst nach handleSouls, Verhalten bleibt damit identisch.)
      if (candidates ? !candidates.has(unit) : unit !== near[0]) continue;
      const ddx = unit.centerX - soul.centerX;
      const ddy = unit.centerY - soul.centerY;
      if (ddx * ddx + ddy * ddy >= SOUL_COLLECT_RANGE_SQ) continue;
      collector = unit;
      // Der König des Sammlers: ein König ist sein eigener Anführer (king.leader === king),
      // Vasallen/Archer/Champion verweisen über .leader auf ihren König.
      collectorKing = collector.unitType === "king" ? collector : collector.leader;
      if (soul.soulType === "green") {
        const v = spawnVassal(scene, unit.leader);
        scene.units.push(v);
        scene.grid.addEntity(v);
        if (collector.team === scene.playerKing?.team)
          scene.spawnFloatingText("+1 Vasall", collector.centerX, collector.y, { r: 0, g: 255, b: 0 });
        collected = true;
        break;
      } else if (soul.soulType === "blue" && unit.unitType === "vassal" && unit.level === 1) {
        unit.setLevel(2);
        if (collector.team === scene.playerKing?.team)
          scene.spawnFloatingText("Level Up!", collector.centerX, collector.y, { r: 255, g: 215, b: 0 }, 1500, 18);
        collected = true;
        break;
      } else if (soul.soulType === "purple" && unit.unitType === "vassal" && unit.level === 2) {
        unit.setLevel(3);
        if (collector.team === scene.playerKing?.team)
          scene.spawnFloatingText("Level Up!", collector.centerX, collector.y, { r: 255, g: 215, b: 0 }, 1500, 18);
        collected = true;
        break;
      } else if (soul.soulType === "gold" && unit.unitType === "king") {
        // Legendärer Gold-Orb: der König beschwört einen Champion in sein Gefolge.
        const champ = spawnChampion(scene, unit);
        scene.units.push(champ);
        scene.grid.addEntity(champ);
        scene.spawnVisualEffect(unit.centerX, unit.centerY, { r: 255, g: 215, b: 0 }, 24, 520, 4, 1.7);
        if (collector.team === scene.playerKing?.team)
          scene.spawnFloatingText(`⚡ ${LEGENDARY[unit.faction].name}!`, collector.centerX, collector.y, { r: 255, g: 215, b: 0 }, 1700, 22);
        collected = true;
        break;
      }
    }

    if (collected) {
      const color =
        soul.soulType === "green"
          ? { r: 0, g: 200, b: 0 }
          : soul.soulType === "blue"
          ? { r: 0, g: 100, b: 255 }
          : soul.soulType === "gold"
          ? { r: 255, g: 215, b: 0 }
          : { r: 150, g: 0, b: 150 };
      scene.spawnVisualEffect(soul.centerX, soul.centerY, color, 10, 300, 2, 1);
      scene.grid.removeEntity(soul);
      soul.destroyView();
      scene.souls.splice(i, 1);

      // König-Progression: der König levelt off JEDER Seele, die sein Team erntet – nicht
      // nur Gold. So wächst der Anführer parallel zur dicht wachsenden Horde mit. XP nach
      // Seltenheit (seltenere Seele = mehr XP). Gilt symmetrisch für Spieler- UND KI-König.
      if (collectorKing) collectorKing.gainKingXp(KING_PROGRESSION.xpPerSoul[soul.soulType], scene);
    }
  }
}

// Zerstörte Gebäude (HP <= 0) lassen je nach Typ eine Seele fallen.
export function handleBuildings(scene: GameScene): void {
  for (let i = scene.buildings.length - 1; i >= 0; i--) {
    const b = scene.buildings[i];
    if (b.hp > 0) continue;
    let soulType: SoulType = b.buildingType === "barn" ? "green" : b.buildingType === "house" ? "blue" : "purple";
    // Türme (lila) können selten einen legendären Gold-Orb fallen lassen.
    if (soulType === "purple" && Math.random() < GOLD_UPGRADE_CHANCE) soulType = "gold";
    const soul = new Soul(scene, b.x, b.y, soulType);
    scene.souls.push(soul);
    scene.grid.addEntity(soul);
    scene.grid.removeEntity(b);
    b.destroyView();
    scene.buildings.splice(i, 1);
  }
}
