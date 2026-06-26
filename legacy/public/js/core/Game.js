import { CONFIG } from "./config.js";
import { Unit } from "../entities/Unit.js";
import * as Utils from "../utils/utils.js";
import { Renderer } from "./Renderer.js";
import { InputHandler } from "./InputHandler.js";
import { SoundManager } from "./SoundManager.js";
import { AssetManager } from "./AssetManager.js";
import { SpatialGrid } from './SpatialGrid.js'; // Import SpatialGrid

export class Game {

  constructor() {
    // Canvas und Kontext
    this.canvas = document.getElementById("gameCanvas");
    this.ctx = this.canvas.getContext("2d");

    // Logische Größe (CSS-Pixel)
    this.logicalWidth = window.innerWidth;
    this.logicalHeight = window.innerHeight;

    // Spielzustand
    this.units = [];         // Alle Einheiten (lokal und remote)
    this.buildings = [];     // Gebäude
    this.souls = [];
    this.obstacles = [];
    this.powerUps = [];
    this.projectiles = [];
    this.playerKing = null;
    this.playerFaction = null;
    this.nextTeamId = 1;
    this.gameOver = false;
    this.gameTime = 0;
    this.lastTime = 0;
    this.fps = 0;
    this.fpsCount = 0;
    this.fpsTime = 0;
    this.activeVisualEffects = [];
    this.floatingTexts = [];
    this.lastCombatEventTime = 0;
    this.recentCombatEvents = 0;
    this.combatEventDecayTimer = 0;
    this.grid = new SpatialGrid(CONFIG.worldWidth, CONFIG.worldHeight, 150); // Initialize SpatialGrid

    // Kamera und View
    this.cameraX = 0;
    this.cameraY = 0;
    this.viewWidth = 0;
    this.viewHeight = 0;

    // Safe-Zone
    this.safeZoneState = "delay";
    this.safeZoneTimer = 0;
    this.safeZoneCurrent = { centerX: CONFIG.worldWidth / 2, centerY: CONFIG.worldHeight / 2, radius: 7000 };
    this.safeZoneTarget = { centerX: CONFIG.worldWidth / 2, centerY: CONFIG.worldHeight / 2, radius: 7000 };

    // Zeit und Bewegung
    this.timeOfDay = 0;
    this.lastKingX = 0;
    this.lastKingY = 0;
    this.kingStationaryTime = 0;

    // Multiplayer
    this.isMultiplayerMode = false;
    this.socket = null;
    this.remotePlayers = {}; // Remote-Spieler-Daten, synchronisiert über Socket

    // Joystick
    this.joystickVector = { x: 0, y: 0 };

    // Mobile-Erkennung
    this.isMobile = /Mobi|Android/i.test(navigator.userAgent);
    // Kein zusätzlicher Zoom – Originalgröße
    this.gameZoom = 1.0;
    this.hudScale = 1.0;

    // Assets laden
    AssetManager.loadAssets();
    this.assets = AssetManager.assets;
    // Sicherstellen, dass der Slash-Sprite vorhanden ist
    this.slashImage = this.assets.slash;

    // Initialisiere Submodule
    this.inputHandler = new InputHandler(this);
    this.soundManager = new SoundManager(this); // Pass game instance
    this.renderer = new Renderer(this);

    // Fenster-Events (Resize, Orientationchange)
    window.addEventListener("resize", () => {
      this.resizeCanvas();
      this.resizeTouchControls();
    });
    window.addEventListener("orientationchange", () => {
      this.resizeCanvas();
      this.resizeTouchControls();
    });
    this.resizeCanvas();
    this.resizeTouchControls();

    // Menü-Events
    this.setupMenuEvents();

    // Game Over – Neustart
    document.getElementById("restartButton").addEventListener("click", () => {
      if (this.soundManager) this.soundManager.playSound('ui_click');
      this.initGame(this.playerFaction);
      this.gameOver = false;
      this.lastTime = performance.now();
      requestAnimationFrame((ts) => this.gameLoop(ts));
    });
  }

  resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * ratio;
    this.canvas.height = window.innerHeight * ratio;
    this.canvas.style.width = window.innerWidth + "px";
    this.canvas.style.height = window.innerHeight + "px";
    this.logicalWidth = window.innerWidth;
    this.logicalHeight = window.innerHeight;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(ratio, ratio);
  }

  resizeTouchControls() {
    let scale = 0.4;
    let containerSize = 420 * scale;
    let knobSize = 210 * scale;
    let actionButtonSize = 252 * scale;
    let actionFontSize = 50 * scale;
    const joystickContainer = document.getElementById("joystickContainer");
    const joystickKnob = document.getElementById("joystickKnob");
    joystickContainer.style.width = containerSize + "px";
    joystickContainer.style.height = containerSize + "px";
    joystickKnob.style.width = knobSize + "px";
    joystickKnob.style.height = knobSize + "px";
    document.querySelectorAll("#actionButtons button").forEach(btn => {
      btn.style.width = actionButtonSize + "px";
      btn.style.height = actionButtonSize + "px";
      btn.style.fontSize = actionFontSize + "px";
    });
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen();
      } else if (document.documentElement.webkitRequestFullscreen) {
        document.documentElement.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  }

  updateRemotePlayers() {
    Object.keys(this.remotePlayers).forEach(id => {
      const remoteData = this.remotePlayers[id];
      let remoteUnit = this.units.find(u => u.isRemote && u.remoteId === id);
      if (remoteUnit) {
        remoteUnit.x = remoteData.x;
        remoteUnit.y = remoteData.y;
      } else {
        remoteUnit = new Unit(remoteData.x, remoteData.y, remoteData.faction, "king");
        remoteUnit.remoteId = id;
        remoteUnit.isRemote = true;
        this.units.push(remoteUnit);
      }
    });
    this.units = this.units.filter(u => {
      if (u.isRemote) {
        return this.remotePlayers[u.remoteId] !== undefined;
      }
      return true;
    });
  }

  setupMenuEvents() {
    // Titelbildschirm
    const bgMusic = document.getElementById("bgMusic");
    const titleScreen = document.getElementById("titleScreen");
    titleScreen.addEventListener("click", () => {
      if (this.soundManager) this.soundManager.playSound('ui_click', null, null, 1.0, true);
      bgMusic.play().catch(err => console.log(err));
      titleScreen.style.opacity = "0";
      setTimeout(() => {
        titleScreen.style.display = "none";
        const mainMenu = document.getElementById("mainMenu");
        mainMenu.style.display = "flex";
        setTimeout(() => { mainMenu.style.opacity = "1"; }, 10);
      }, 1000);
    });

    // Hauptmenü – Singleplayer
    document.getElementById("btn-singleplayer").addEventListener("click", () => {
      if (this.soundManager) this.soundManager.playSound('ui_click', null, null, 1.0, true);
      this.isMultiplayerMode = false;
      document.getElementById("mainMenu").style.display = "none";
      document.getElementById("mainMenu").style.opacity = "0";
      document.getElementById("selectionMenu").style.display = "flex";
    });

    // Hauptmenü – Multiplayer
    document.getElementById("btn-multiplayer").addEventListener("click", () => {
      if (this.soundManager) this.soundManager.playSound('ui_click', null, null, 1.0, true);
      this.isMultiplayerMode = true;
      this.socket = io();
      // Registrierung der Socket-Events
      this.socket.on("currentPlayers", (players) => {
        for (let id in players) {
          if (id !== this.socket.id) {
            this.remotePlayers[id] = players[id];
          }
        }
      });
      this.socket.on("newPlayer", (playerInfo) => {
        this.remotePlayers[playerInfo.id] = playerInfo;
      });
      this.socket.on("playerMoved", (playerInfo) => {
        if (this.remotePlayers[playerInfo.id]) {
          this.remotePlayers[playerInfo.id].x = playerInfo.x;
          this.remotePlayers[playerInfo.id].y = playerInfo.y;
        }
      });
      this.socket.on("playerDisconnected", (playerId) => {
        delete this.remotePlayers[playerId];
      });
      // Warten: Der Server schickt "showCharacterSelection", wenn mindestens 2 Spieler im Multiplayer sind.
      this.socket.on("showCharacterSelection", () => {
        // Wartebildschirm ausblenden, Charakterauswahl anzeigen
        document.getElementById("lobbyScreen").style.display = "none";
        document.getElementById("selectionMenu").style.display = "flex";
      });
      // "startGame": Wird später gesendet, wenn alle Spieler bereit sind.
      this.socket.on("startGame", () => {
        // Starte den Spielzustand
        this.initGame(this.playerFaction);
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen();
        } else if (document.documentElement.webkitRequestFullscreen) {
          document.documentElement.webkitRequestFullscreen();
        }
        this.lastTime = performance.now();
        requestAnimationFrame((ts) => this.gameLoop(ts));
      });
      document.getElementById("mainMenu").style.display = "none";
      document.getElementById("mainMenu").style.opacity = "0";
      // Zeige den Wartebildschirm an
      document.getElementById("lobbyScreen").style.display = "flex";
      // Sende NICHT sofort "lobbyReady" – wir warten auf die Charakterauswahl!
      this.canvas.style.pointerEvents = "none";
    });

    // Optionen-Menü
    document.getElementById("btn-options").addEventListener("click", () => {
      if (this.soundManager) this.soundManager.playSound('ui_click', null, null, 1.0, true);
      document.getElementById("mainMenu").style.display = "none";
      document.getElementById("mainMenu").style.opacity = "0";
      document.getElementById("optionsMenu").style.display = "flex";
      this.canvas.style.pointerEvents = "none";
    });

    // Zurück aus dem Optionen-Menü
    document.getElementById("btn-back").addEventListener("click", () => {
      if (this.soundManager) this.soundManager.playSound('ui_click', null, null, 1.0, true);
      document.getElementById("optionsMenu").style.display = "none";
      document.getElementById("mainMenu").style.display = "flex";
      setTimeout(() => { 
        document.getElementById("mainMenu").style.opacity = "1";
        this.canvas.style.pointerEvents = "auto";
      }, 10);
    });

    document.getElementById("mainMenuButton").addEventListener("click", () => {
      if (this.soundManager) this.soundManager.playSound('ui_click', null, null, 1.0, true);
      document.getElementById("gameOverMenu").style.display = "none";
      const mainMenu = document.getElementById("mainMenu");
      mainMenu.style.display = "flex";
      mainMenu.style.opacity = "0";
      setTimeout(() => { mainMenu.style.opacity = "1"; }, 10);
    });

    // In der Charakterauswahl: Sobald ein Spieler einen Charakter auswählt,
    // sendet der Client "characterSelected" und dann "lobbyReady".
    document.querySelectorAll("#selectionMenu button").forEach(btn => {
      btn.addEventListener("click", () => {
        if (this.soundManager) this.soundManager.playSound('ui_click', null, null, 1.0, true);
        const selected = btn.getAttribute("data-faction");
        document.getElementById("selectionMenu").style.display = "none";
        document.getElementById("gameUI").style.display = "none";
        this.playerFaction = selected;
        if (this.isMultiplayerMode && this.socket) {
          this.socket.emit("characterSelected", { faction: selected });
          this.socket.emit("lobbyReady");
          // Warten auf "startGame" vom Server.
        } else {
          this.initGame(selected);
          if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen();
          } else if (document.documentElement.webkitRequestFullscreen) {
            document.documentElement.webkitRequestFullscreen();
          }
          this.lastTime = performance.now();
          requestAnimationFrame((ts) => this.gameLoop(ts));
        }
      });
    });
  }

  initGame(selectedFaction) {
    this.units = [];
    this.buildings = [];
    this.souls = [];
    this.obstacles = [];
    this.powerUps = [];
    this.projectiles = [];
    this.nextTeamId = 1;
    this.gameOver = false;
    this.lastKingX = 0;
    this.lastKingY = 0;
    this.kingStationaryTime = 0;
    this.gameTime = 0;
    document.getElementById("gameOverMenu").style.display = "none";
    this.safeZoneState = "delay";
    this.safeZoneTimer = 0;
    this.safeZoneCurrent = { centerX: CONFIG.worldWidth / 2, centerY: CONFIG.worldHeight / 2, radius: 7000 };
    this.safeZoneTarget = { centerX: CONFIG.worldWidth / 2, centerY: CONFIG.worldHeight / 2, radius: 7000 };

    if (!this.isMultiplayerMode) {
      // Singleplayer: Erzeuge komplette Welt (Spieler, KI, Gebäude, etc.)
      const totalKings = 11;
      const margin = 200;
      const L1 = CONFIG.worldWidth - 2 * margin;
      const L2 = CONFIG.worldHeight - 2 * margin;
      const perimeter = 2 * (L1 + L2);
      const spacing = perimeter / totalKings;
      const kingPositions = [];
      for (let i = 0; i < totalKings; i++) {
        let d = i * spacing;
        let pos;
        if (d < L1) { pos = { x: margin + d, y: margin }; }
        else if (d < L1 + L2) { pos = { x: CONFIG.worldWidth - margin, y: margin + (d - L1) }; }
        else if (d < L1 + L2 + L1) { pos = { x: CONFIG.worldWidth - margin - (d - (L1 + L2)), y: CONFIG.worldHeight - margin }; }
        else { pos = { x: margin, y: CONFIG.worldHeight - margin - (d - (2 * L1 + L2)) }; }
        kingPositions.push(pos);
      }
      let playerIndex = Math.floor(Math.random() * totalKings);
      this.playerKing = new Unit(kingPositions[playerIndex].x, kingPositions[playerIndex].y, selectedFaction, "king");
      this.units.push(this.playerKing);
      for (let i = 0; i < 10; i++) { this.units.push(Utils.spawnVassal(this.playerKing)); }
      const factions = ["human", "elf", "orc"];
      for (let i = 0; i < totalKings; i++) {
        if (i === playerIndex) continue;
        let faction = factions[Math.floor(Math.random() * factions.length)];
        let aiKing = new Unit(kingPositions[i].x, kingPositions[i].y, faction, "king");
        this.units.push(aiKing);
        for (let j = 0; j < 10; j++) { this.units.push(Utils.spawnVassal(aiKing)); }
      }
    } else {
      // Multiplayer: Erzeuge nur den lokalen Spieler.
      this.playerKing = new Unit(CONFIG.worldWidth / 2, CONFIG.worldHeight / 2, selectedFaction, "king");
      this.playerKing.isLocal = true;
      this.units.push(this.playerKing);
      for (let i = 0; i < 10; i++) { this.units.push(Utils.spawnVassal(this.playerKing)); }
      this.socket.emit("playerJoined", { x: this.playerKing.x, y: this.playerKing.y, faction: selectedFaction });
    }
    // Beide Modi: Erzeuge statische Weltobjekte (Buildings, Obstacles) – idealerweise basierend auf einem gemeinsamen Seed.
    Utils.generateObstacles(this);
    if (this.grid) {
        this.obstacles.forEach(o => this.grid.addEntity(o));
    }
    
    Utils.generateBuildingClusters(this);
    if (this.grid) {
        this.buildings.forEach(b => this.grid.addEntity(b));
    }

    // Add initial units to the grid (playerKing, AI kings, and their initial vassals)
    if (this.grid) {
        this.units.forEach(u => this.grid.addEntity(u));
    }
  }

  update(deltaTime) {
    if (this.gameOver) return;
    this.updateTime(deltaTime);
    this.gameTime += deltaTime;

    if (this.playerKing) {
      let dxKing = this.playerKing.x - this.lastKingX;
      let dyKing = this.playerKing.y - this.lastKingY;
      let distKing = Math.hypot(dxKing, dyKing);
      if (distKing < 5) {
        this.kingStationaryTime += deltaTime;
        if (this.kingStationaryTime >= CONFIG.formationUpdateInterval) {
          this.units.forEach(u => {
            if (u.unitType !== "king") {
              u.formationOffset = Utils.recalcFormationOffset(u, this.units, this.playerKing);
            }
          });
          this.kingStationaryTime = 0;
        }
      } else {
        this.kingStationaryTime = 0;
        this.lastKingX = this.playerKing.x;
        this.lastKingY = this.playerKing.y;
      }
    }

    if (this.isMultiplayerMode) {
      this.updateRemotePlayers(); // Note: Remote players are added to this.units, ensure they are added to grid too
                                 // This logic might need adjustment if remote players are not immediately in this.units
                                 // or if they are added/removed frequently without grid updates.
                                 // For now, assuming they are handled like other units once in this.units.
    }

    this.units.forEach(unit => unit.update(deltaTime, this)); // unit.update should call grid.updateEntity(this)
    
    this.projectiles.forEach(proj => proj.update(deltaTime, this)); // proj.update should call grid.updateEntity(this)
    
    // Remove expired projectiles and from grid
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
        if (this.projectiles[i].expired) {
            if (this.grid) {
                this.grid.removeEntity(this.projectiles[i]);
            }
            this.projectiles.splice(i, 1);
        }
    }

    Utils.resolveUnitUnitCollisions(this);
    Utils.resolveUnitBuildingCollisions(this);
    Utils.resolveUnitObstacleCollisions(this);
    this.updateSafeZone(deltaTime);
    Utils.applySafeZoneDamage(this, deltaTime);
    Utils.handlePowerUps(this, deltaTime);
    Utils.handleSouls(this);
    Utils.handleBuildings(this);
    Utils.resolveUnitCollisions(this);
    Utils.applySeparationForce(this, deltaTime);
    
    if (!this.playerKing || this.playerKing.hp <= 0) {
      this.gameOver = true;
      Utils.showGameOverMenu("Verloren");
    } else if (!this.isMultiplayerMode) {
      let enemyKings = this.units.filter(u => u.unitType === "king" && u !== this.playerKing);
      if (enemyKings.length === 0) {
        this.gameOver = true;
        Utils.showGameOverMenu("Gewonnen");
      }
    }
    
    if (this.isMultiplayerMode && this.socket && this.playerKing) {
      this.socket.emit("playerMoved", { x: this.playerKing.x, y: this.playerKing.y });
    }

    // Update active visual effects
    for (let i = this.activeVisualEffects.length - 1; i >= 0; i--) {
      const particle = this.activeVisualEffects[i];
      particle.life -= deltaTime;
      if (particle.life <= 0) {
        this.activeVisualEffects.splice(i, 1);
      } else {
        particle.x += particle.vx * (deltaTime / 16);
        particle.y += particle.vy * (deltaTime / 16);
        particle.alpha = Math.max(0, particle.life / particle.maxLife);
      }
    }

    // Update floating texts
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const textEffect = this.floatingTexts[i];
      textEffect.life -= deltaTime;
      if (textEffect.life <= 0) {
        this.floatingTexts.splice(i, 1);
      } else {
        textEffect.currentY -= textEffect.riseSpeed * (deltaTime / 16);
        textEffect.alpha = Math.max(0, textEffect.life / textEffect.maxLife);
      }
    }

    // Decay Recent Combat Events
    this.combatEventDecayTimer += deltaTime;
    if (this.combatEventDecayTimer >= 1000) { // Every second
        if (this.recentCombatEvents > 0) {
            this.recentCombatEvents = Math.max(0, this.recentCombatEvents - 1); // Decay by 1 per second
        }
        this.combatEventDecayTimer = 0;
    }

    // Calculate Target War Volume
    const maxEventsForMaxVolume = 10;
    const maxUnitsForMaxVolume = 50;
    let eventVolumeFactor = Math.min(1, this.recentCombatEvents / maxEventsForMaxVolume);
    let unitVolumeFactor = Math.min(1, this.units.length / maxUnitsForMaxVolume);
    let targetWarVolume = Math.min(1, (eventVolumeFactor + unitVolumeFactor) / 2) * 0.7; 

    if (this.recentCombatEvents === 0 && this.units.length < 10) {
        targetWarVolume = 0;
    }
    
    if (this.soundManager) {
        this.soundManager.setWarAmbienceVolume(targetWarVolume);
    }
  }

  notifyCombatEvent() {
    this.recentCombatEvents++;
    this.lastCombatEventTime = this.gameTime;
  }

  spawnVisualEffect(x, y, color, count = 10, lifetime = 300, particleSize = 2, speed = 1) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const currentSpeed = Math.random() * speed; // Vary speed for each particle
      this.activeVisualEffects.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * currentSpeed,
        vy: Math.sin(angle) * currentSpeed,
        life: lifetime,
        maxLife: lifetime,
        color: color, // {r, g, b}
        size: particleSize,
        alpha: 1.0
      });
    }
  }

  spawnFloatingText(text, x, y, color = {r:255, g:255, b:255}, duration = 1500, size = 16, riseSpeed = 0.5) {
    this.floatingTexts.push({
      text: text,
      x: x,
      y: y,
      currentY: y,
      color: color,
      life: duration,
      maxLife: duration,
      alpha: 1.0,
      size: size,
      riseSpeed: riseSpeed
    });
  }

  updateTime(deltaTime) {
    this.timeOfDay = (this.timeOfDay + deltaTime / 60000) % 1;
  }

  updateSafeZone(deltaTime) {
    if (this.safeZoneState === "delay") {
      this.safeZoneTimer += deltaTime;
      if (this.safeZoneTimer >= CONFIG.safeZoneDelay) {
        this.safeZoneCurrent = { centerX: CONFIG.worldWidth / 2, centerY: CONFIG.worldHeight / 2, radius: 7000 };
        this.safeZoneTarget.centerX = this.safeZoneCurrent.centerX + (Math.random() - 0.5) * this.safeZoneCurrent.radius * 0.5;
        this.safeZoneTarget.centerY = this.safeZoneCurrent.centerY + (Math.random() - 0.5) * this.safeZoneCurrent.radius * 0.5;
        this.safeZoneTarget.radius = Math.max(this.safeZoneCurrent.radius * 0.6, CONFIG.safeZoneMinRadius);
        this.safeZoneState = "shrinking";
        this.safeZoneTimer = 0;
      }
    } else if (this.safeZoneState === "shrinking") {
      let shrinkAmount = CONFIG.safeZoneShrinkRate * deltaTime;
      if (this.safeZoneCurrent.radius - shrinkAmount > this.safeZoneTarget.radius) {
        this.safeZoneCurrent.radius -= shrinkAmount;
        this.safeZoneCurrent.centerX += (this.safeZoneTarget.centerX - this.safeZoneCurrent.centerX) * (shrinkAmount / (this.safeZoneCurrent.radius - this.safeZoneTarget.radius + shrinkAmount));
        this.safeZoneCurrent.centerY += (this.safeZoneTarget.centerY - this.safeZoneCurrent.centerY) * (shrinkAmount / (this.safeZoneCurrent.radius - this.safeZoneTarget.radius + shrinkAmount));
      } else {
        this.safeZoneCurrent.radius = this.safeZoneTarget.radius;
        this.safeZoneCurrent.centerX = this.safeZoneTarget.centerX;
        this.safeZoneCurrent.centerY = this.safeZoneTarget.centerY;
        this.safeZoneState = "pause";
        this.safeZoneTimer = 0;
      }
    } else if (this.safeZoneState === "pause") {
      this.safeZoneTimer += deltaTime;
      let pauseDuration = (this.safeZoneCurrent.radius > CONFIG.safeZoneMinRadius) ? CONFIG.safeZonePauseDuration : CONFIG.safeZoneMovePauseDuration;
      if (this.safeZoneTimer >= pauseDuration) {
        if (this.safeZoneCurrent.radius > CONFIG.safeZoneMinRadius) {
          this.safeZoneState = "shrinking";
          this.safeZoneTimer = 0;
          this.safeZoneTarget.centerX = this.safeZoneCurrent.centerX + (Math.random() - 0.5) * this.safeZoneCurrent.radius * 0.5;
          this.safeZoneTarget.centerY = this.safeZoneCurrent.centerY + (Math.random() - 0.5) * this.safeZoneCurrent.radius * 0.5;
          this.safeZoneTarget.radius = Math.max(this.safeZoneCurrent.radius * 0.6, CONFIG.safeZoneMinRadius);
        } else {
          this.safeZoneState = "moving";
          this.safeZoneTimer = 0;
          this.safeZoneTarget.centerX = this.safeZoneCurrent.centerX + (Math.random() - 0.5) * this.safeZoneCurrent.radius * 0.5;
          this.safeZoneTarget.centerY = this.safeZoneCurrent.centerY + (Math.random() - 0.5) * this.safeZoneCurrent.radius * 0.5;
          this.safeZoneTarget.radius = this.safeZoneCurrent.radius;
        }
      }
    } else if (this.safeZoneState === "moving") {
      let moveAmount = CONFIG.safeZoneMoveRate * deltaTime;
      let dx = this.safeZoneTarget.centerX - this.safeZoneCurrent.centerX;
      let dy = this.safeZoneTarget.centerY - this.safeZoneCurrent.centerY;
      let dist = Math.hypot(dx, dy);
      if (dist > moveAmount) {
        this.safeZoneCurrent.centerX += (dx / dist) * moveAmount;
        this.safeZoneCurrent.centerY += (dy / dist) * moveAmount;
      } else {
        this.safeZoneCurrent.centerX = this.safeZoneTarget.centerX;
        this.safeZoneCurrent.centerY = this.safeZoneTarget.centerY;
        this.safeZoneState = "pause";
        this.safeZoneTimer = 0;
      }
    }
  }

  gameLoop(timestamp) {
    try {
      let deltaTime = timestamp - this.lastTime;
      this.lastTime = timestamp;
      this.update(deltaTime);
      this.renderer.draw();
      this.fpsCount++;
      this.fpsTime += deltaTime;
      if (this.fpsTime >= 1000) {
        this.fps = this.fpsCount;
        this.fpsCount = 0;
        this.fpsTime = 0;
      }
    } catch (e) {
      console.error("Fehler im Spiel-Loop:", e);
    }
    if (!this.gameOver) {
      requestAnimationFrame((ts) => this.gameLoop(ts));
    }
  }
}
