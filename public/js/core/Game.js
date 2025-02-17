// public/js/core/Game.js
import { CONFIG } from "./config.js";
import { Unit } from "../entities/Unit.js";
import * as Utils from "../utils/utils.js";
import { Renderer } from "./Renderer.js";
import { InputHandler } from "./InputHandler.js";
import { SoundManager } from "./SoundManager.js";
import { AssetManager } from "./AssetManager.js";
import MapGenerator from "../mapgenerator/mapgenerator.js";
import * as THREE from "https://unpkg.com/three@0.128.0/build/three.module.js";

export class Game {
  constructor() {
    this.canvas = document.getElementById("gameCanvas");
    this.logicalWidth = window.innerWidth;
    this.logicalHeight = window.innerHeight;
    
    // Spielzustand
    this.units = [];
    this.buildings = [];
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
    
    // Safe-Zone (X-Z-Ebene)
    this.safeZoneState = "delay";
    this.safeZoneTimer = 0;
    this.safeZoneCurrent = { centerX: CONFIG.worldWidth / 2, centerZ: CONFIG.worldHeight / 2, radius: 7000 };
    this.safeZoneTarget = { centerX: CONFIG.worldWidth / 2, centerZ: CONFIG.worldHeight / 2, radius: 7000 };
    
    this.timeOfDay = 0;
    this.lastKingPos = new THREE.Vector2(0, 0);
    this.kingStationaryTime = 0;
    
    // Multiplayer
    this.isMultiplayerMode = false;
    this.socket = null;
    this.remotePlayers = {};
    
    // Joystick
    this.joystickVector = { x: 0, y: 0 };
    
    this.isMobile = /Mobi|Android/i.test(navigator.userAgent);
    this.gameZoom = 1.0;
    this.hudScale = 1.0;
    
    // Assets laden
    AssetManager.loadAssets();
    this.assets = AssetManager.assets;
    this.slashImage = this.assets.slash;
    
    // Initialisiere Submodule
    this.inputHandler = new InputHandler(this);
    this.soundManager = new SoundManager();
    this.renderer = new Renderer(this);
    
    // Integration des neuen MapGenerators:
    this.mapGenerator = new MapGenerator();
    this.renderer.scene.add(this.mapGenerator.getMap());
    
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
    
    this.setupMenuEvents();
    
    document.getElementById("restartButton").addEventListener("click", () => {
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
    if (this.renderer && this.renderer.setSize) {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
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
        remoteUnit.position.x = remoteData.x;
        remoteUnit.position.z = remoteData.y; // Netzwerk: y entspricht Z
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
    
    document.getElementById("btn-singleplayer").addEventListener("click", () => {
      this.isMultiplayerMode = false;
      document.getElementById("mainMenu").style.display = "none";
      document.getElementById("mainMenu").style.opacity = "0";
      document.getElementById("selectionMenu").style.display = "flex";
    });
    
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
      this.socket.on("showCharacterSelection", () => {
        document.getElementById("lobbyScreen").style.display = "none";
        document.getElementById("selectionMenu").style.display = "flex";
      });
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
      this.canvas.style.pointerEvents = "none";
    });
    
    document.getElementById("btn-options").addEventListener("click", () => {
      document.getElementById("mainMenu").style.display = "none";
      document.getElementById("mainMenu").style.opacity = "0";
      document.getElementById("optionsMenu").style.display = "flex";
      this.canvas.style.pointerEvents = "none";
    });
    
    document.getElementById("btn-back").addEventListener("click", () => {
      document.getElementById("optionsMenu").style.display = "none";
      document.getElementById("mainMenu").style.display = "flex";
      setTimeout(() => { 
        document.getElementById("mainMenu").style.opacity = "1";
        this.canvas.style.pointerEvents = "auto";
      }, 10);
    });
    
    document.getElementById("mainMenuButton").addEventListener("click", () => {
      document.getElementById("gameOverMenu").style.display = "none";
      const mainMenu = document.getElementById("mainMenu");
      mainMenu.style.display = "flex";
      mainMenu.style.opacity = "0";
      setTimeout(() => { mainMenu.style.opacity = "1"; }, 10);
    });
    
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
  
  initGame(selectedFaction) {
    this.units = [];
    this.buildings = [];
    this.souls = [];
    this.obstacles = [];
    this.powerUps = [];
    this.projectiles = [];
    this.nextTeamId = 1;
    this.gameOver = false;
    this.lastKingPos.set(0, 0);
    this.kingStationaryTime = 0;
    this.gameTime = 0;
    document.getElementById("gameOverMenu").style.display = "none";
    this.safeZoneState = "delay";
    this.safeZoneTimer = 0;
    this.safeZoneCurrent = { centerX: CONFIG.worldWidth / 2, centerZ: CONFIG.worldHeight / 2, radius: 7000 };
    this.safeZoneTarget = { centerX: CONFIG.worldWidth / 2, centerZ: CONFIG.worldHeight / 2, radius: 7000 };
    
    if (!this.isMultiplayerMode) {
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
        if (d < L1) { 
          pos = new THREE.Vector3(margin + d, 0, margin);
        } else if (d < L1 + L2) { 
          pos = new THREE.Vector3(CONFIG.worldWidth - margin, 0, margin + (d - L1));
        } else if (d < L1 + L2 + L1) { 
          pos = new THREE.Vector3(CONFIG.worldWidth - margin - (d - (L1 + L2)), 0, CONFIG.worldHeight - margin);
        } else { 
          pos = new THREE.Vector3(margin, 0, CONFIG.worldHeight - margin - (d - (2 * L1 + L2)));
        }
        kingPositions.push(pos);
      }
      let playerIndex = Math.floor(Math.random() * totalKings);
      this.playerKing = new Unit(kingPositions[playerIndex].x, kingPositions[playerIndex].z, selectedFaction, "king");
      this.playerKing.isLocal = true;
      this.units.push(this.playerKing);
      for (let i = 0; i < 10; i++) { 
        this.units.push(Utils.spawnVassal(this.playerKing)); 
      }
      const factions = ["human", "elf", "orc"];
      for (let i = 0; i < totalKings; i++) {
        if (i === playerIndex) continue;
        let faction = factions[Math.floor(Math.random() * factions.length)];
        let aiKing = new Unit(kingPositions[i].x, kingPositions[i].z, faction, "king");
        this.units.push(aiKing);
        for (let j = 0; j < 10; j++) { 
          this.units.push(Utils.spawnVassal(aiKing)); 
        }
      }
    } else {
      this.playerKing = new Unit(CONFIG.worldWidth / 2, CONFIG.worldHeight / 2, selectedFaction, "king");
      this.playerKing.isLocal = true;
      this.units.push(this.playerKing);
      for (let i = 0; i < 10; i++) { 
        this.units.push(Utils.spawnVassal(this.playerKing)); 
      }
      this.socket.emit("playerJoined", { x: this.playerKing.position.x, y: this.playerKing.position.z, faction: selectedFaction });
    }
    Utils.generateObstacles(this);
    Utils.generateBuildingClusters(this);
  }
  
  update(deltaTime) {
    if (this.gameOver) return;
    this.updateTime(deltaTime);
    this.gameTime += deltaTime;
    
    if (this.playerKing) {
      let currentKingPos = new THREE.Vector2(this.playerKing.position.x, this.playerKing.position.z);
      let distKing = currentKingPos.distanceTo(this.lastKingPos);
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
        this.lastKingPos.copy(currentKingPos);
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
      this.socket.emit("playerMoved", { x: this.playerKing.position.x, y: this.playerKing.position.z });
    }
  }
  
  updateTime(deltaTime) {
    this.timeOfDay = (this.timeOfDay + deltaTime / 60000) % 1;
  }
  
  updateSafeZone(deltaTime) {
    if (this.safeZoneState === "delay") {
      this.safeZoneTimer += deltaTime;
      if (this.safeZoneTimer >= CONFIG.safeZoneDelay) {
        this.safeZoneCurrent = { centerX: CONFIG.worldWidth / 2, centerZ: CONFIG.worldHeight / 2, radius: 7000 };
        this.safeZoneTarget.centerX = this.safeZoneCurrent.centerX + (Math.random() - 0.5) * this.safeZoneCurrent.radius * 0.5;
        this.safeZoneTarget.centerZ = this.safeZoneCurrent.centerZ + (Math.random() - 0.5) * this.safeZoneCurrent.radius * 0.5;
        this.safeZoneTarget.radius = Math.max(this.safeZoneCurrent.radius * 0.6, CONFIG.safeZoneMinRadius);
        this.safeZoneState = "shrinking";
        this.safeZoneTimer = 0;
      }
    } else if (this.safeZoneState === "shrinking") {
      let shrinkAmount = CONFIG.safeZoneShrinkRate * deltaTime;
      if (this.safeZoneCurrent.radius - shrinkAmount > this.safeZoneTarget.radius) {
        this.safeZoneCurrent.radius -= shrinkAmount;
        this.safeZoneCurrent.centerX += (this.safeZoneTarget.centerX - this.safeZoneCurrent.centerX) * (shrinkAmount / (this.safeZoneCurrent.radius - this.safeZoneTarget.radius + shrinkAmount));
        this.safeZoneCurrent.centerZ += (this.safeZoneTarget.centerZ - this.safeZoneCurrent.centerZ) * (shrinkAmount / (this.safeZoneCurrent.radius - this.safeZoneTarget.radius + shrinkAmount));
      } else {
        this.safeZoneCurrent.radius = this.safeZoneTarget.radius;
        this.safeZoneCurrent.centerX = this.safeZoneTarget.centerX;
        this.safeZoneCurrent.centerZ = this.safeZoneTarget.centerZ;
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
          this.safeZoneTarget.centerZ = this.safeZoneCurrent.centerZ + (Math.random() - 0.5) * this.safeZoneCurrent.radius * 0.5;
          this.safeZoneTarget.radius = Math.max(this.safeZoneCurrent.radius * 0.6, CONFIG.safeZoneMinRadius);
        } else {
          this.safeZoneState = "moving";
          this.safeZoneTimer = 0;
          this.safeZoneTarget.centerX = this.safeZoneCurrent.centerX + (Math.random() - 0.5) * this.safeZoneCurrent.radius * 0.5;
          this.safeZoneTarget.centerZ = this.safeZoneCurrent.centerZ + (Math.random() - 0.5) * this.safeZoneCurrent.radius * 0.5;
          this.safeZoneTarget.radius = this.safeZoneCurrent.radius;
        }
      }
    } else if (this.safeZoneState === "moving") {
      let moveAmount = CONFIG.safeZoneMoveRate * deltaTime;
      let dx = this.safeZoneTarget.centerX - this.safeZoneCurrent.centerX;
      let dz = this.safeZoneTarget.centerZ - this.safeZoneCurrent.centerZ;
      let dist = Math.hypot(dx, dz);
      if (dist > moveAmount) {
        this.safeZoneCurrent.centerX += (dx / dist) * moveAmount;
        this.safeZoneCurrent.centerZ += (dz / dist) * moveAmount;
      } else {
        this.safeZoneCurrent.centerX = this.safeZoneTarget.centerX;
        this.safeZoneCurrent.centerZ = this.safeZoneTarget.centerZ;
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
