// public/js/ui/OptionsMenu.js
export class OptionsMenu {
    constructor(game) {
      this.game = game;
      this.setupEventHandlers();
    }
    
    setupEventHandlers() {
      const musicSlider = document.getElementById("musicVolumeSlider");
      const sfxSlider = document.getElementById("sfxVolumeSlider");
      
      if (musicSlider) {
        musicSlider.addEventListener("input", () => {
          const volume = musicSlider.value / 100;
          this.game.soundManager.setMusicVolume(volume);
        });
      }
      
      if (sfxSlider) {
        sfxSlider.addEventListener("input", () => {
          const volume = sfxSlider.value / 100;
          this.game.soundManager.setSFXVolume(volume);
        });
      }
      
      const btnBack = document.getElementById("btn-back");
      if (btnBack) {
        btnBack.addEventListener("click", () => {
          document.getElementById("optionsMenu").style.display = "none";
          document.getElementById("mainMenu").style.display = "flex";
          setTimeout(() => { document.getElementById("mainMenu").style.opacity = "1"; }, 10);
        });
      }
    }
  }
  