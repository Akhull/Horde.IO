// public/js/core/Renderer.js
// Dieser Renderer initialisiert die PixiJS-Anwendung für hardwarebeschleunigtes Rendering (WebGL)
// und fügt das automatisch von PIXI erzeugte Canvas dem DOM-Container "gameCanvasContainer" hinzu.

console.log("Checkpoint 0: Starting Renderer.js");

import { CONFIG } from "./config.js";
console.log("Checkpoint 1: CONFIG importiert");

export class Renderer {
  constructor(game) {
    console.log("Checkpoint 2: Renderer-Konstruktor gestartet");
    this.game = game;

    // Erstelle die PixiJS-Anwendung OHNE den "view"-Parameter,
    // sodass PIXI automatisch ein Canvas erstellt.
    this.app = new PIXI.Application({
      width: game.logicalWidth,
      height: game.logicalHeight,
      backgroundColor: 0x225522,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    console.log("Checkpoint 3: PIXI Application erstellt");

    // Debug: Überprüfe, ob das automatisch erzeugte Canvas existiert.
    try {
      console.log("Checkpoint 4: PIXI view (Canvas):", this.app.view);
      console.log("Checkpoint 5: Ist view ein HTMLCanvasElement?", this.app.view instanceof HTMLCanvasElement);
      console.log("Checkpoint 6: Canvas tagName:", this.app.view.tagName);
    } catch (e) {
      console.error("Fehler beim Zugriff auf this.app.view:", e);
    }

    // Aktivieren der Interaktion (für Maus-/Touch-Events)
    this.app.stage.interactive = true;
    console.log("Checkpoint 7: Stage interaktiv geschaltet");

    // Finde den DOM-Container und hänge das von PIXI selbst erzeugte Canvas ein.
    const container = document.getElementById("gameCanvasContainer");
    if (!container) {
      throw new Error("Element with id 'gameCanvasContainer' not found in the DOM.");
    }
    container.innerHTML = "";
    container.appendChild(this.app.view);
    console.log("Checkpoint 8: Canvas im DOM-Container eingefügt");

    // Erstelle den Hauptcontainer für Spielobjekte (Spielwelt)
    this.gameContainer = new PIXI.Container();
    this.app.stage.addChild(this.gameContainer);
    console.log("Checkpoint 9: GameContainer erstellt und hinzugefügt");

    // Erstelle einen separaten Container für HUD/UI
    this.uiContainer = new PIXI.Container();
    this.app.stage.addChild(this.uiContainer);
    console.log("Checkpoint 10: UIContainer erstellt und hinzugefügt");
  }

  clearScene() {
    this.gameContainer.removeChildren();
    this.uiContainer.removeChildren();
    console.log("Checkpoint 11: clearScene() ausgeführt");
  }

  draw() {
    const game = this.game;
    console.log("Checkpoint 12: draw() gestartet");

    if (game.playerKing) {
      game.viewWidth = game.isMobile ? game.logicalWidth / game.gameZoom : game.logicalWidth;
      game.viewHeight = game.isMobile ? game.logicalHeight / game.gameZoom : game.logicalHeight;
      game.cameraX = game.playerKing.x - game.viewWidth / 2;
      game.cameraY = game.playerKing.y - game.viewHeight / 2;
      game.cameraX = Math.max(0, Math.min(CONFIG.worldWidth - game.viewWidth, game.cameraX));
      game.cameraY = Math.max(0, Math.min(CONFIG.worldHeight - game.viewHeight, game.cameraY));
    } else {
      game.cameraX = 0;
      game.cameraY = 0;
    }
    console.log("Checkpoint 13: Kamera berechnet");

    this.gameContainer.x = -game.cameraX;
    this.gameContainer.y = -game.cameraY;
    console.log("Checkpoint 14: GameContainer verschoben");

    this.clearScene();

    this.drawGround();
    console.log("Checkpoint 15: Boden gezeichnet");

    game.obstacles.forEach(o => {
      const obstacle = new PIXI.Graphics();
      obstacle.beginFill(0x888888);
      obstacle.drawRect(o.x, o.y, o.width, o.height);
      obstacle.endFill();
      this.gameContainer.addChild(obstacle);
    });
    console.log("Checkpoint 16: Hindernisse gezeichnet");

    game.buildings.forEach(b => {
      if (game.assets.building) {
        const sprite = new PIXI.Sprite(PIXI.Texture.from(game.assets.building.src));
        sprite.x = b.x;
        sprite.y = b.y;
        sprite.width = b.width;
        sprite.height = b.height;
        this.gameContainer.addChild(sprite);
      }
    });
    console.log("Checkpoint 17: Gebäude gezeichnet");

    game.souls.forEach(s => {
      const soul = new PIXI.Graphics();
      const fillColor = s.soulType === "green" ? 0x00ff00 : (s.soulType === "blue" ? 0x00ffff : 0xff00ff);
      soul.beginFill(fillColor);
      soul.drawRect(s.x, s.y, s.width, s.height);
      soul.endFill();
      this.gameContainer.addChild(soul);
    });
    console.log("Checkpoint 18: Seelen gezeichnet");

    game.powerUps.forEach(p => {
      const powerUp = new PIXI.Graphics();
      const fillColor = p.effectType === "speed" ? 0xffff00 : 0xffa500;
      powerUp.beginFill(fillColor);
      powerUp.drawRect(p.x, p.y, p.width, p.height);
      powerUp.endFill();
      this.gameContainer.addChild(powerUp);
    });
    console.log("Checkpoint 19: PowerUps gezeichnet");

    game.projectiles.forEach(proj => {
      if (game.assets.arrow) {
        const sprite = new PIXI.Sprite(PIXI.Texture.from(game.assets.arrow.src));
        sprite.x = proj.x;
        sprite.y = proj.y;
        sprite.width = proj.width || 10;
        sprite.height = proj.height || 10;
        this.gameContainer.addChild(sprite);
      }
    });
    console.log("Checkpoint 20: Projektile gezeichnet");

    game.units.forEach(u => {
      let texture;
      if (u.unitType === "king") {
        texture = PIXI.Texture.from(game.assets.factions[u.faction].king.src);
      } else if (u.unitType === "vassal") {
        texture = PIXI.Texture.from(game.assets.factions[u.faction].vassal.src);
      } else if (u.unitType === "archer") {
        texture = PIXI.Texture.from(game.assets.factions[u.faction].archer.src);
      } else {
        texture = PIXI.Texture.WHITE;
      }
      const sprite = new PIXI.Sprite(texture);
      sprite.x = u.x;
      sprite.y = u.y;
      sprite.width = u.width || 40;
      sprite.height = u.height || 40;
      this.gameContainer.addChild(sprite);
    });
    console.log("Checkpoint 21: Einheiten gezeichnet");

    this.drawNonKingHealthBars();
    this.drawSafeZone();
    this.drawKingHealthBars();
    console.log("Checkpoint 22: Zusätzliche Elemente gezeichnet");

    this.drawMinimap();
    console.log("Checkpoint 23: Minimap gezeichnet");

    this.drawHUD();
    console.log("Checkpoint 24: HUD gezeichnet");

    if (game.isMultiplayerMode && game.socket) {
      for (let id in game.remotePlayers) {
        const rp = game.remotePlayers[id];
        if (game.assets.factions[rp.faction] && game.assets.factions[rp.faction].king) {
          const sprite = new PIXI.Sprite(PIXI.Texture.from(game.assets.factions[rp.faction].king.src));
          sprite.x = rp.x;
          sprite.y = rp.y;
          sprite.width = 40 * 1.3;
          sprite.height = 40 * 1.3;
          this.gameContainer.addChild(sprite);
        }
      }
      console.log("Checkpoint 25: Multiplayer-Spieler gezeichnet");
    }

    console.log("Checkpoint 26: draw() abgeschlossen");
  }

  drawGround() {
    const game = this.game;
    const brightness = 0.5 + 0.5 * Math.abs(Math.sin(game.timeOfDay * Math.PI));
    if (game.assets.ground) {
      const texture = PIXI.Texture.from(game.assets.ground.src);
      const tilingSprite = new PIXI.TilingSprite(texture, game.logicalWidth, game.logicalHeight);
      tilingSprite.tilePosition.x = game.cameraX;
      tilingSprite.tilePosition.y = game.cameraY;
      tilingSprite.alpha = brightness;
      this.gameContainer.addChild(tilingSprite);
    } else {
      const bg = new PIXI.Graphics();
      bg.beginFill(0x225522);
      bg.drawRect(game.cameraX, game.cameraY, game.logicalWidth, game.logicalHeight);
      bg.endFill();
      this.gameContainer.addChild(bg);
    }
    console.log("Checkpoint Ground: drawGround() abgeschlossen");
  }

  drawSafeZone() {
    const game = this.game;
    if (game.safeZoneState !== "delay") {
      const graphics = new PIXI.Graphics();
      graphics.lineStyle(4, 0xFF0000);
      graphics.drawCircle(game.safeZoneCurrent.centerX, game.safeZoneCurrent.centerY, game.safeZoneCurrent.radius);
      this.gameContainer.addChild(graphics);
      if (
        game.safeZoneCurrent.radius !== game.safeZoneTarget.radius ||
        game.safeZoneCurrent.centerX !== game.safeZoneTarget.centerX ||
        game.safeZoneCurrent.centerY !== game.safeZoneTarget.centerY
      ) {
        const targetGraphics = new PIXI.Graphics();
        targetGraphics.lineStyle(2, 0xFF0000);
        if (targetGraphics.setLineDash) {
          targetGraphics.setLineDash([10, 5]);
        }
        targetGraphics.drawCircle(game.safeZoneTarget.centerX, game.safeZoneTarget.centerY, game.safeZoneTarget.radius);
        this.gameContainer.addChild(targetGraphics);
      }
    }
    console.log("Checkpoint SafeZone: drawSafeZone() abgeschlossen");
  }

  drawMinimap() {
    const game = this.game;
    const margin = 10;
    const minimapWidth = 200;
    const minimapHeight = 200;
    const minimapContainer = new PIXI.Container();
    minimapContainer.x = game.logicalWidth - minimapWidth - margin;
    minimapContainer.y = margin;
    
    const bg = new PIXI.Graphics();
    bg.beginFill(0x225522);
    bg.drawRect(0, 0, minimapWidth, minimapHeight);
    bg.endFill();
    minimapContainer.addChild(bg);
    
    const scale = minimapWidth / CONFIG.worldWidth;
    
    game.obstacles.forEach(o => {
      const obs = new PIXI.Graphics();
      obs.beginFill(0x888888);
      obs.drawRect(o.x * scale, o.y * scale, o.width * scale, o.height * scale);
      obs.endFill();
      minimapContainer.addChild(obs);
    });
    
    game.buildings.forEach(b => {
      const building = new PIXI.Graphics();
      building.beginFill(0x808080);
      const markerW = b.width * 1.75 * scale;
      const markerH = b.height * 1.75 * scale;
      building.drawRect((b.x - markerW / (2 * scale)) * scale, (b.y - markerH / (2 * scale)) * scale, markerW, markerH);
      building.endFill();
      minimapContainer.addChild(building);
    });
    
    game.units.forEach(u => {
      const unit = new PIXI.Graphics();
      unit.beginFill(u.team === game.playerKing?.team ? 0x00ff00 : 0xff0000);
      const markerW = (u.width || 40) * 1.75 * scale;
      const markerH = (u.height || 40) * 1.75 * scale;
      unit.drawRect((u.x - markerW / (2 * scale)) * scale, (u.y - markerH / (2 * scale)) * scale, markerW, markerH);
      unit.endFill();
      minimapContainer.addChild(unit);
    });
    
    game.souls.forEach(s => {
      const soul = new PIXI.Graphics();
      soul.beginFill(s.soulType === "green" ? 0x00ff00 : (s.soulType === "blue" ? 0x00ffff : 0xff00ff));
      soul.drawRect(s.x * scale, s.y * scale, s.width * scale, s.height * scale);
      soul.endFill();
      minimapContainer.addChild(soul);
    });
    
    game.powerUps.forEach(p => {
      const pu = new PIXI.Graphics();
      pu.beginFill(p.effectType === "speed" ? 0xffff00 : 0xffa500);
      pu.drawRect(p.x * scale, p.y * scale, p.width * scale, p.height * scale);
      pu.endFill();
      minimapContainer.addChild(pu);
    });
    
    const safeZoneGraphics = new PIXI.Graphics();
    safeZoneGraphics.lineStyle(2, 0xff0000);
    safeZoneGraphics.drawCircle(game.safeZoneCurrent.centerX * scale, game.safeZoneCurrent.centerY * scale, game.safeZoneCurrent.radius * scale);
    minimapContainer.addChild(safeZoneGraphics);
    
    const viewport = new PIXI.Graphics();
    viewport.lineStyle(2, 0xffffff);
    viewport.drawRect(game.cameraX * scale, game.cameraY * scale, game.viewWidth * scale, game.viewHeight * scale);
    minimapContainer.addChild(viewport);
    
    this.uiContainer.addChild(minimapContainer);
    console.log("Checkpoint Minimap: drawMinimap() abgeschlossen");
  }

  drawNonKingHealthBars() {
    console.log("Checkpoint HealthBars: drawNonKingHealthBars() abgeschlossen");
  }

  drawKingHealthBars() {
    console.log("Checkpoint HealthBars: drawKingHealthBars() abgeschlossen");
  }

  drawHUD() {
    const game = this.game;
    const style = new PIXI.TextStyle({
      fontFamily: 'Cinzel',
      fontSize: 24,
      fill: 'white',
    });
    const fpsText = new PIXI.Text(`FPS: ${game.fps}`, style);
    fpsText.x = 10;
    fpsText.y = game.logicalHeight - 40;
    this.uiContainer.addChild(fpsText);

    const totalSeconds = Math.floor(game.gameTime / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const timerTextStr = ("0" + minutes).slice(-2) + ":" + ("0" + seconds).slice(-2);
    const timerText = new PIXI.Text(timerTextStr, { fontFamily: 'Arial', fontSize: 20, fill: 'white' });
    timerText.anchor.set(0.5, 0);
    timerText.x = game.logicalWidth / 2;
    timerText.y = 30;
    this.uiContainer.addChild(timerText);
    console.log("Checkpoint HUD: drawHUD() abgeschlossen");
  }
}
