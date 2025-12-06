export const CONFIG = {
  worldWidth: 4000,
  worldHeight: 4000,
  dashCooldown: 5000,
  dashDistance: 150,
  shieldAbilityCooldown: 10000,
  shieldAbilityDuration: 3000,
  safeZoneDelay: 60000,
  safeZoneShrinkRate: 15,
  safeZoneMinRadius: 800,
  safeZonePauseDuration: 10000,
  safeZoneMoveRate: 10,
  safeZoneMovePauseDuration: 10000,
  formationUpdateInterval: 250 // ms
};

export class MapGenerator {
    static generateMap() {
        const obstacles = [];
        const buildings = [];
        const numObstacles = 20;

        for (let i = 0; i < numObstacles; i++) {
            let rand = Math.random();
            let type = (rand < 0.7) ? "forest" : "water";
            let w = 200 + Math.random() * 600;
            let h = 200 + Math.random() * 600;
            let x = Math.random() * (CONFIG.worldWidth - w);
            let y = Math.random() * (CONFIG.worldHeight - h);

            // In the server we just store the data structure
            obstacles.push({ x, y, width: w, height: h, type });
        }

        const numClusters = 80;
        for (let i = 0; i < numClusters; i++) {
            let centerX = Math.random() * (CONFIG.worldWidth - 800) + 400;
            let centerY = Math.random() * (CONFIG.worldHeight - 800) + 400;

            if (!this.isAreaClear(centerX - 50, centerY - 50, 100, 100, obstacles)) continue;

            let numBuildings = Math.floor(Math.random() * 11) + 10;
            let clusterBuildings = [];
            for (let j = 0; j < numBuildings; j++) {
                let valid = false, attempt = 0, x, y;
                while (!valid && attempt < 10) {
                    let angle = Math.random() * Math.PI * 2;
                    let radius = Math.random() * 150;
                    x = centerX + Math.cos(angle) * radius;
                    y = centerY + Math.sin(angle) * radius;
                    valid = true;
                    for (let b of clusterBuildings) {
                        if (x < b.x + b.width + 20 && x + 60 > b.x - 20 &&
                            y < b.y + b.height + 20 && y + 60 > b.y - 20) {
                            valid = false;
                            break;
                        }
                    }
                    if (!this.isAreaClear(x, y, 60, 60, obstacles)) valid = false;
                    attempt++;
                }
                if (valid) {
                    let r = Math.random();
                    let type = (r < 0.5) ? "barn" : (r < 0.8 ? "house" : "tower");
                    // Assuming building width/height is 60 as per client code
                    let building = { x, y, width: 60, height: 60, type };
                    clusterBuildings.push(building);
                    buildings.push(building);
                }
            }
        }

        return { obstacles, buildings };
    }

    static isAreaClear(x, y, width, height, obstacles) {
        for (let obs of obstacles) {
            if (!(x + width < obs.x || x > obs.x + obs.width || y + height < obs.y || y > obs.y + obs.height)) {
                return false;
            }
        }
        return true;
    }
}
