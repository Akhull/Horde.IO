import { Unit } from "../entities/Unit";
import { Soul } from "../entities/Soul";
import { spawnVassal } from "./worldgen";
import { FEEDBACK } from "../config/gameConfig";
import type { SoulType } from "../types";
import type { GameScene } from "../scenes/GameScene";

// Erzeugt beim Tod einer Einheit ggf. eine Seele (Vasallen nur zu 50%).
export function spawnSoulFromUnit(scene: GameScene, unit: Unit): void {
  if (unit.unitType === "vassal" && Math.random() < 0.5) return;
  let soulType: SoulType;
  if (unit.unitType === "king") soulType = "purple";
  else if (unit.level === 1) soulType = "green";
  else if (unit.level === 2) soulType = "blue";
  else soulType = "purple";
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
      // Todes-Effekt: Partikel-Ausbruch; bei Königen zusätzlich Kamera-Shake (wenn sichtbar).
      const count = u.unitType === "king" ? 26 : u.unitType === "archer" ? 8 : 12;
      scene.spawnVisualEffect(u.centerX, u.centerY, { r: 150, g: 20, b: 20 }, count, 360, 3, 1.4);
      if (u.unitType === "king" && scene.isOnScreen(u.centerX, u.centerY)) {
        scene.screenShake(160, FEEDBACK.kingDeathShake);
      }
      spawnSoulFromUnit(scene, u);
      scene.grid.removeEntity(u);
      u.dead = true;
      u.destroyView();
      scene.units.splice(i, 1);
    }
  }
}

// Safe-Zone-Schaden für Einheiten ausserhalb des Kreises (Schild halbiert den Schaden).
export function applySafeZoneDamage(scene: GameScene, deltaTime: number): void {
  const sz = scene.safeZoneCurrent;
  for (const u of scene.units) {
    const dist = Math.hypot(u.centerX - sz.centerX, u.centerY - sz.centerY);
    if (dist > sz.radius) {
      let dmg = 0.05 * deltaTime;
      if (u.isShieldActive) dmg *= 0.5;
      u.hp -= dmg;
    }
  }
  removeDeadUnits(scene);
}

// Power-Ups einsammeln (Tempo oder Schild für den Spielerkönig).
export function handlePowerUps(scene: GameScene): void {
  const king = scene.playerKing;
  if (!king) return;
  for (let i = scene.powerUps.length - 1; i >= 0; i--) {
    const p = scene.powerUps[i];
    if (!king.intersects(p)) continue;
    if (p.effectType === "speed") {
      king.speed *= 1.5;
      scene.time.delayedCall(p.duration, () => (king.speed /= 1.5));
      scene.spawnVisualEffect(p.centerX, p.centerY, { r: 255, g: 215, b: 0 }, 15, 400, 3, 1.2);
    } else {
      if (king.isShieldActive) king.shieldTimer += p.duration;
      else {
        king.isShieldActive = true;
        king.shieldTimer = p.duration;
      }
      scene.spawnVisualEffect(p.centerX, p.centerY, { r: 0, g: 191, b: 255 }, 15, 400, 3, 1.2);
    }
    p.destroyView();
    scene.powerUps.splice(i, 1);
  }
}

// Seelen einsammeln: grün = neuer Vasall, blau/lila = Level-up passender Vasallen.
export function handleSouls(scene: GameScene): void {
  for (let i = scene.souls.length - 1; i >= 0; i--) {
    const soul = scene.souls[i];
    let collected = false;
    let collector: Unit;

    for (const unit of scene.units) {
      if (Math.hypot(unit.centerX - soul.centerX, unit.centerY - soul.centerY) >= 40) continue;
      collector = unit;
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
      }
    }

    if (collected) {
      const color =
        soul.soulType === "green"
          ? { r: 0, g: 200, b: 0 }
          : soul.soulType === "blue"
          ? { r: 0, g: 100, b: 255 }
          : { r: 150, g: 0, b: 150 };
      scene.spawnVisualEffect(soul.centerX, soul.centerY, color, 10, 300, 2, 1);
      scene.grid.removeEntity(soul);
      soul.destroyView();
      scene.souls.splice(i, 1);
    }
  }
}

// Zerstörte Gebäude (HP <= 0) lassen je nach Typ eine Seele fallen.
export function handleBuildings(scene: GameScene): void {
  for (let i = scene.buildings.length - 1; i >= 0; i--) {
    const b = scene.buildings[i];
    if (b.hp > 0) continue;
    const soulType: SoulType = b.buildingType === "barn" ? "green" : b.buildingType === "house" ? "blue" : "purple";
    const soul = new Soul(scene, b.x, b.y, soulType);
    scene.souls.push(soul);
    scene.grid.addEntity(soul);
    scene.grid.removeEntity(b);
    b.destroyView();
    scene.buildings.splice(i, 1);
  }
}
