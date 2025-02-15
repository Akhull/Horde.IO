// public/js/core/SoundManager.js

export class SoundManager {
  constructor() {
    this.bgMusic = document.getElementById("bgMusic");
    if (this.bgMusic) {
      // Setze die initiale Lautstärke (50%)
      this.bgMusic.volume = 0.5;
      this.initVolumeSlider();
    }
  }

  initVolumeSlider() {
    const musicSlider = document.getElementById("musicVolumeSlider");
    if (musicSlider && this.bgMusic) {
      // Synchronisiere den Slider mit der aktuellen Lautstärke
      musicSlider.value = this.bgMusic.volume * 100;
      musicSlider.addEventListener("input", () => {
        this.setMusicVolume(musicSlider.value / 100);
      });
    }
  }

  setMusicVolume(volume) {
    if (this.bgMusic) {
      this.bgMusic.volume = volume;
    }
  }

  setSFXVolume(volume) {
    // Falls du separate Audio-Elemente für Soundeffekte hast,
    // passe hier die Lautstärke an. Momentan als Platzhalter:
    console.log("Set SFX volume to", volume);
  }
}
