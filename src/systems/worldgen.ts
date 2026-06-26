import { CONFIG } from "../config/gameConfig";
import { Unit } from "../entities/Unit";
import { Building } from "../entities/Building";
import { Obstacle } from "../entities/Obstacle";
import { Forest } from "../entities/Forest";
import { PowerUp } from "../entities/PowerUp";
import type { BuildingType, PowerUpType } from "../types";
import type { GameScene } from "../scenes/GameScene";

// Erzeugt einen Vasallen oder Bogenschützen nahe dem Anführer (20% Bogenschütze).
export function spawnVassal(scene: GameScene, leader: Unit): Unit {
  const x = leader.x + (Math.random() - 0.5) * 50;
  const y = leader.y + (Math.random() - 0.5) * 50;
  const type = Math.random() < 0.2 ? "archer" : "vassal";
  return new Unit(scene, x, y, leader.faction, type, 1, leader);
}

// Beschwört einen Champion (legendäre Spezialeinheit) nahe dem König – aus einem Gold-Orb.
export function spawnChampion(scene: GameScene, king: Unit): Unit {
  const x = king.x + (Math.random() - 0.5) * 60;
  const y = king.y + (Math.random() - 0.5) * 60;
  return new Unit(scene, x, y, king.faction, "champion", 1, king);
}

function isAreaClear(x: number, y: number, w: number, h: number, obstacles: { x: number; y: number; width: number; height: number }[]): boolean {
  for (const o of obstacles) {
    if (!(x + w < o.x || x > o.x + o.width || y + h < o.y || y > o.y + o.height)) return false;
  }
  return true;
}

// 20 Hindernisse: 70% Wald, sonst Wasser.
export function generateObstacles(scene: GameScene): void {
  for (let i = 0; i < 20; i++) {
    const w = 200 + Math.random() * 600;
    const h = 200 + Math.random() * 600;
    const x = Math.random() * (CONFIG.worldWidth - w);
    const y = Math.random() * (CONFIG.worldHeight - h);
    const obs = Math.random() < 0.7 ? new Forest(scene, x, y, w, h) : new Obstacle(scene, x, y, w, h);
    scene.obstacles.push(obs);
    scene.grid.addEntity(obs);
  }
}

// 80 Gebäudecluster mit je 10–20 Gebäuden.
export function generateBuildingClusters(scene: GameScene): void {
  for (let i = 0; i < 80; i++) {
    const centerX = Math.random() * (CONFIG.worldWidth - 800) + 400;
    const centerY = Math.random() * (CONFIG.worldHeight - 800) + 400;
    if (!isAreaClear(centerX - 50, centerY - 50, 100, 100, scene.obstacles)) continue;
    const numBuildings = Math.floor(Math.random() * 11) + 10;
    const cluster: Building[] = [];
    for (let j = 0; j < numBuildings; j++) {
      let valid = false;
      let attempt = 0;
      let x = 0;
      let y = 0;
      while (!valid && attempt < 10) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 150;
        x = centerX + Math.cos(angle) * radius;
        y = centerY + Math.sin(angle) * radius;
        valid = true;
        for (const b of cluster) {
          if (x < b.x + b.width + 20 && x + 60 > b.x - 20 && y < b.y + b.height + 20 && y + 60 > b.y - 20) {
            valid = false;
            break;
          }
        }
        if (!isAreaClear(x, y, 60, 60, scene.obstacles)) valid = false;
        attempt++;
      }
      if (valid) {
        const r = Math.random();
        const type: BuildingType = r < 0.5 ? "barn" : r < 0.8 ? "house" : "tower";
        const b = new Building(scene, x, y, type);
        cluster.push(b);
        scene.buildings.push(b);
        scene.grid.addEntity(b);
      }
    }
  }
}

// Verstreut Power-Ups über die Welt (im Original war nur die Aufsammel-Logik vorhanden).
export function generatePowerUps(scene: GameScene): void {
  for (let i = 0; i < 25; i++) {
    const x = Math.random() * CONFIG.worldWidth;
    const y = Math.random() * CONFIG.worldHeight;
    // Sechs gleich wahrscheinliche Power-Up-Typen: Tempo, Schild, Schaden, Rüstung,
    // Lifesteal, Regen (je ~1/6 -> Schwellen in 1/6-Schritten).
    const r = Math.random();
    const type: PowerUpType =
      r < 1 / 6
        ? "speed"
        : r < 2 / 6
          ? "shield"
          : r < 3 / 6
            ? "damage"
            : r < 4 / 6
              ? "armor"
              : r < 5 / 6
                ? "lifesteal"
                : "regen";
    scene.powerUps.push(new PowerUp(scene, x, y, type));
  }
}
