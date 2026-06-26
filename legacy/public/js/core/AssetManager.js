// public/js/core/AssetManager.js
export const AssetManager = {
  assets: {
    souls: {
      green: new Image(),
      blue: new Image(),
      purple: new Image()
    },
    buildings: {
      barn: new Image(),
      house: new Image(),
      tower: new Image()
    },
    factions: {
      human: { king: new Image(), level1: new Image(), level2: new Image(), level3: new Image() },
      elf:   { king: new Image(), level1: new Image(), level2: new Image(), level3: new Image() },
      orc:   { king: new Image(), level1: new Image(), level2: new Image(), level3: new Image() }
    },
    arrow: new Image(),
    ground: new Image(),
    slash: new Image(),  // Slash-Sprite
    forest: new Image()  // Neuer Eintrag für das Forest-Asset
  },
  loadAssets() {
    // Souls
    this.assets.souls.green.src = "assets/sprites/Collectables/Green.png";
    this.assets.souls.blue.src  = "assets/sprites/Collectables/Blue.png";
    this.assets.souls.purple.src = "assets/sprites/Collectables/Purple.png";
    // Buildings
    this.assets.buildings.barn.src  = "assets/sprites/Buildings/Barn.png";
    this.assets.buildings.house.src = "assets/sprites/Buildings/House.png";
    this.assets.buildings.tower.src = "assets/sprites/Buildings/Tower.png";
    // Factions
    this.assets.factions.human.king.src   = "assets/sprites/Units/Mensch/King.png";
    this.assets.factions.human.level1.src   = "assets/sprites/Units/Mensch/Level 1.png";
    this.assets.factions.human.level2.src   = "assets/sprites/Units/Mensch/level 2.png";
    this.assets.factions.human.level3.src   = "assets/sprites/Units/Mensch/level 3.png";

    this.assets.factions.elf.king.src     = "assets/sprites/Units/Elf/King.png";
    this.assets.factions.elf.level1.src     = "assets/sprites/Units/Elf/level 1.png";
    this.assets.factions.elf.level2.src     = "assets/sprites/Units/Elf/level 2.png";
    this.assets.factions.elf.level3.src     = "assets/sprites/Units/Elf/level 3.png";

    this.assets.factions.orc.king.src     = "assets/sprites/Units/Orc/King.png";
    this.assets.factions.orc.level1.src     = "assets/sprites/Units/Orc/level 1.png";
    this.assets.factions.orc.level2.src     = "assets/sprites/Units/Orc/level 2.png";
    this.assets.factions.orc.level3.src     = "assets/sprites/Units/Orc/level 3.png";

    // Weitere Assets
    this.assets.arrow.src = "assets/sprites/ATTACKS/Arrow.png";
    this.assets.ground.src = "https://opengameart.org/sites/default/files/grass_0.png";
    // Slash-Sprite laden
    this.assets.slash.src = "assets/sprites/ATTACKS/slash.png";
    // Forest-Asset laden (neuer Pfad)
    this.assets.forest.src = "assets/sprites/Trees/angepasst/Forest dark.PNG";
  }
};
