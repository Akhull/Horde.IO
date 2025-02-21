// public/js/core/AssetManager.js
import * as THREE from "https://unpkg.com/three@0.128.0/build/three.module.js";

export const AssetManager = {
  assets: {
    souls: {
      green: null,
      blue: null,
      purple: null
    },
    buildings: {
      barn: null,
      house: null,
      tower: null
    },
    factions: {
      human: { king: null, level1: null, level2: null, level3: null },
      elf:   { king: null, level1: null, level2: null, level3: null },
      orc:   { king: null, level1: null, level2: null, level3: null }
    },
    arrow: null,
    ground: null,
    slash: null,
    forest: null
  },
  loadAssets() {
    const manager = new THREE.LoadingManager();
    manager.onProgress = function(item, loaded, total) {
      // Update des Ladebalkens (als Prozentsatz)
      if (window.updateLoadingProgress) {
        window.updateLoadingProgress(loaded / total);
      }
    };
    manager.onLoad = function() {
      // Alle Assets sind geladen
      if (window.onAssetsLoaded) {
        window.onAssetsLoaded();
      }
    };
    const loader = new THREE.TextureLoader(manager);
    // Souls
    this.assets.souls.green = loader.load("assets/sprites/Collectables/Green.png");
    this.assets.souls.blue  = loader.load("assets/sprites/Collectables/Blue.png");
    this.assets.souls.purple = loader.load("assets/sprites/Collectables/Purple.png");
    // Buildings
    this.assets.buildings.barn  = loader.load("assets/sprites/Buildings/Barn.png");
    this.assets.buildings.house = loader.load("assets/sprites/Buildings/House.png");
    this.assets.buildings.tower = loader.load("assets/sprites/Buildings/Tower.png");
    // Factions
    this.assets.factions.human.king   = loader.load("assets/sprites/Units/Mensch/King.png");
    this.assets.factions.human.level1 = loader.load("assets/sprites/Units/Mensch/Level 1.png");
    this.assets.factions.human.level2 = loader.load("assets/sprites/Units/Mensch/level 2.png");
    this.assets.factions.human.level3 = loader.load("assets/sprites/Units/Mensch/level 3.png");

    this.assets.factions.elf.king     = loader.load("assets/sprites/Units/Elf/King.png");
    this.assets.factions.elf.level1   = loader.load("assets/sprites/Units/Elf/level 1.png");
    this.assets.factions.elf.level2   = loader.load("assets/sprites/Units/Elf/level 2.png");
    this.assets.factions.elf.level3   = loader.load("assets/sprites/Units/Elf/level 3.png");

    this.assets.factions.orc.king     = loader.load("assets/sprites/Units/Orc/King.png");
    this.assets.factions.orc.level1   = loader.load("assets/sprites/Units/Orc/level 1.png");
    this.assets.factions.orc.level2   = loader.load("assets/sprites/Units/Orc/level 2.png");
    this.assets.factions.orc.level3   = loader.load("assets/sprites/Units/Orc/level 3.png");

    // Additional Assets
    this.assets.arrow  = loader.load("assets/sprites/ATTACKS/Arrow.png");
    
    this.assets.slash  = loader.load("assets/sprites/ATTACKS/slash.png");
    // Forest Asset
    this.assets.forest = loader.load("assets/sprites/Trees/angepasst/Forest dark.PNG");
  }
};
