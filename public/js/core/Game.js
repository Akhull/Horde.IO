// public/js/core/Game.js
import { CONFIG } from "./config.js";
import { Unit } from "../entities/Unit.js";
import * as Utils from "../utils/utils.js";
import { Renderer } from "./Renderer.js";
import { InputHandler } from "./InputHandler.js";
import { SoundManager } from "./SoundManager.js";
import { AssetManager } from "./AssetManager.js";

export class Game {
  constructor() {
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

    // Joystick-Vektor (für mobile Steuerung)
    this.joystickVector = { x: 0, y: 0 };

    // Mobile-Erkennung und Zoom
    this.isMobile = /Mobi|Android/i.test(navigator.userAgent);
    this.gameZoom = 1.0;
    this.hudScale = 1.0;

    // Assets laden
    AssetManager.loadAssets();
    this.assets = AssetManager.assets;
    // Sicherstellen, dass der Slash-Sprite vorhanden ist
    this.slashImage = this.assets.slash;

    // Initialisiere Submodule
    this.inputHandler = new InputHandler(this);
    this.soundManager = new SoundManager();
    // Neuer Renderer, der PixiJS für hardwarebeschleunigtes Rendering nutzt
    this.renderer = new Renderer(this);

    // Resizing und Touch-Control-Setup
    window.addEventListener("resize", () => {
      this.resizeGame();
      this.resizeTouchControls();
    });
    window.addEventListener("orientationchange", () => {
      this.resizeGame();
      this.resizeTouchControls();
    });
    this.resizeGame();
    this.resizeTouchControls();

    // Initialisiere Menü-Events
    this.setupMenuEvents();

    // Game Over – Neustart
    document.getElementById("restartButton").addEventListener("click", () => {
      this.initGame(this.playerFaction);
      this.gameOver = false;
      this.lastTime = performance.now();
      requestAnimationFrame((ts) => this.gameLoop(ts));
    });
  }

  // Aktualisiert die logische Größe und resized die PixiJS-Anwendung
  resizeGame() {
    this.logicalWidth = window.innerWidth;
    this.logicalHeight = window.innerHeight;
    if (this.renderer && this.renderer.app) {
      this.renderer.app.renderer.resize(this.logicalWidth, this.logicalHeight);
    }
  }

  // Passt Touch-Control-Elemente an
  resizeTouchControls() {
    const scale = 0.4;
    const containerSize = 420 * scale;
    const knobSize = 210 * scale;
    const actionButtonSize = 252 * scale;
    const actionFontSize = 50 * scale;
    const joystickContainer = document.getElementById("joystickContainer");
    const joystickKnob = document.getElementById("joystickKnob");
    if (joystickContainer && joystickKnob) {
      joystickContainer.style.width = containerSize + "px";
      joystickContainer.style.height = containerSize + "px";
      joystickKnob.style.width = knobSize + "px";
      joystickKnob.style.height = knobSize + "px";
    }
    document.querySelectorAll("#actionButtons button").forEach(btn => {
      btn.style.width = actionButtonSize + "px";
      btn.style.height = actionButtonSize + "px";
      btn.style.fontSize = actionFontSize + "px";
    });
  }

  // Umschalten in den Vollbildmodus
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

  // Aktualisiert die Positionen der Remote-Spieler
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
    this.units = this.units.filter(u => (u.isRemote ? this.remotePlayers[u.remoteId] !== undefined : true));
  }

  // Initialisiert Menü- und UI-Interaktionen
  setupMenuEvents() {
    // Titelbildschirm: Start des Spiels
    const bgMusic = document.getElementById("bgMusic");
    const titleScreen = document.getElementById("titleScreen");
    titleScreen.addEventListener("click", () => {
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
      this.isMultiplayerMode = false;
      document.getElementById("mainMenu").style.display = "none";
      document.getElementById("mainMenu").style.opacity = "0";
      document.getElementById("selectionMenu").style.display = "flex";
    });

    // Hauptmenü – Multiplayer
    document.getElementById("btn-multiplayer").addEventListener("click", () => {
      this.isMultiplayerMode = true;
      this.socket = io();
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
      // Sobald mindestens zwei Spieler verbunden sind, wechsle in die Charakterauswahl
      this.socket.on("showCharacterSelection", () => {
        document.getElementById("lobbyScreen").style.display = "none";
        document.getElementById("selectionMenu").style.display = "flex";
      });
      // Starte das Spiel, wenn alle Spieler bereit sind
      this.socket.on("startGame", () => {
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
      document.getElementById("lobbyScreen").style.display = "flex";
      const container = document.getElementById("gameCanvasContainer");
      if (container) container.style.pointerEvents = "none";
    });

    // Optionen-Menü öffnen
    document.getElementById("btn-options").addEventListener("click", () => {
      document.getElementById("mainMenu").style.display = "none";
      document.getElementById("mainMenu").style.opacity = "0";
      document.getElementById("optionsMenu").style.display = "flex";
      const container = document.getElementById("gameCanvasContainer");
      if (container) container.style.pointerEvents = "none";
    });

    // Zurück aus dem Optionen-Menü
    document.getElementById("btn-back").addEventListener("click", () => {
      document.getElementById("optionsMenu").style.display = "none";
      document.getElementById("mainMenu").style.display = "flex";
      setTimeout(() => { 
        document.getElementById("mainMenu").style.opacity = "1"; 
        const container = document.getElementById("gameCanvasContainer");
        if (container) container.style.pointerEvents = "auto";
      }, 10);
    });

    document.getElementById("mainMenuButton").addEventListener("click", () => {
      document.getElementById("gameOverMenu").style.display = "none";
      const mainMenu = document.getElementById("mainMenu");
      mainMenu.style.display = "flex";
      mainMenu.style.opacity = "0";
      setTimeout(() => { mainMenu.style.opacity = "1"; }, 10);
    });

    // In der Charakterauswahl: Sobald ein Spieler einen Charakter auswählt, starte das Spiel
    document.querySelectorAll("#selectionMenu button").forEach(btn => {
      btn.addEventListener("click", () => {
        const selected = btn.getAttribute("data-faction");
        document.getElementById("selectionMenu").style.display = "none";
        document.getElementById("gameUI").style.display = "none";
        this.playerFaction = selected;
        if (this.isMultiplayerMode && this.socket) {
          this.socket.emit("characterSelected", { faction: selected });
          this.socket.emit("lobbyReady");
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

  // Initialisiert das Spiel (Einheiten, Gebäude, statische Objekte etc.)
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
      // Singleplayer: Erzeuge vollständige Welt (Spieler, KI, Gebäude etc.)
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
      for (let i = 0; i < 10; i++) { 
        this.units.push(Utils.spawnVassal(this.playerKing)); 
      }
      const factions = ["human", "elf", "orc"];
      for (let i = 0; i < totalKings; i++) {
        if (i === playerIndex) continue;
        let faction = factions[Math.floor(Math.random() * factions.length)];
        let aiKing = new Unit(kingPositions[i].x, kingPositions[i].y, faction, "king");
        this.units.push(aiKing);
        for (let j = 0; j < 10; j++) { 
          this.units.push(Utils.spawnVassal(aiKing)); 
        }
      }
    } else {
      // Multiplayer: Erzeuge nur den lokalen Spieler
      this.playerKing = new Unit(CONFIG.worldWidth / 2, CONFIG.worldHeight / 2, selectedFaction, "king");
      this.playerKing.isLocal = true;
      this.units.push(this.playerKing);
      for (let i = 0; i < 10; i++) { 
        this.units.push(Utils.spawnVassal(this.playerKing)); 
      }
      this.socket.emit("playerJoined", { x: this.playerKing.x, y: this.playerKing.y, faction: selectedFaction });
    }
    // Beide Modi: Erzeuge statische Weltobjekte (Obstacles, Gebäude) – basierend auf einem gemeinsamen Seed
    Utils.generateObstacles(this);
    Utils.generateBuildingClusters(this);
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
      this.updateRemotePlayers();
    }

    this.units.forEach(unit => unit.update(deltaTime, this));
    this.projectiles.forEach(proj => proj.update(deltaTime));
    this.projectiles = this.projectiles.filter(proj => !proj.expired);

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
      // Nutze den neuen Renderer, der die PixiJS-Anwendung steuert
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
