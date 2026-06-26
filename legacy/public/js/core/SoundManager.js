// public/js/core/SoundManager.js

export class SoundManager {
  constructor(game) { // Added game parameter
    this.game = game; // Store game instance
    this.bgMusic = document.getElementById("bgMusic");
    if (this.bgMusic) {
      this.bgMusic.volume = 0.5; // Default background music volume
      this.initMusicVolumeSlider();
    }

    this.sfxCache = {};
    this.sfxVolume = 0.5; // Default SFX volume set to 50%
    
    // Initialize warAmbienceAudio before initSfxVolumeSlider
    this.warAmbienceAudio = new Audio();
    this.warAmbienceAudio.loop = true;
    this.warAmbienceAudio.src = 'assets/audiosfx/Medieval Fight Ambient Dynamic Sound/MedievalFightAmbientLoop.mp3';
    this.warAmbienceAudio.load();
    this.currentWarAmbienceVolume = 0; // Stores the target volume before master SFX scaling
    
    this.initSfxVolumeSlider();
    this.preloadSounds();
  }

  initMusicVolumeSlider() {
    const musicSlider = document.getElementById("musicVolumeSlider");
    if (musicSlider) {
      musicSlider.value = this.bgMusic.volume * 100;
      musicSlider.addEventListener("input", () => {
        this.bgMusic.volume = musicSlider.value / 100;
      });
    }
  }

  initSfxVolumeSlider() {
    const sfxSlider = document.getElementById("sfxVolumeSlider");
    if (sfxSlider) {
      // Set initial slider value based on sfxVolume
      sfxSlider.value = this.sfxVolume * 100;
      // Update sfxVolume when slider changes
      sfxSlider.addEventListener("input", () => {
        this.sfxVolume = sfxSlider.value / 100;
        this.setWarAmbienceVolume(this.currentWarAmbienceVolume); // Re-apply war ambience volume
      });
      // Also update sfxVolume from initial slider value if different from default
      // This handles cases where the slider might have a persisted value e.g. from localStorage in a fuller implementation
      this.sfxVolume = sfxSlider.value / 100;
      // Set initial war ambience volume based on the (possibly persisted) sfxVolume
      this.setWarAmbienceVolume(this.currentWarAmbienceVolume);
    }
  }

  setWarAmbienceVolume(targetVolume) {
    if (!this.warAmbienceAudio || typeof this.warAmbienceAudio.volume === 'undefined') { 
        console.warn("War ambience audio not ready or 'volume' property is undefined, cannot set volume."); 
        return; 
    }

    targetVolume = Math.max(0, Math.min(1, targetVolume)); // Clamp targetVolume
    this.currentWarAmbienceVolume = targetVolume; // Store the target for sfxVolume changes

    let appliedVolume = targetVolume * this.sfxVolume;
    appliedVolume = Math.max(0, Math.min(1, appliedVolume)); // Clamp final applied volume

    this.warAmbienceAudio.volume = appliedVolume;

    if (appliedVolume > 0.01 && this.warAmbienceAudio.paused) {
        this.warAmbienceAudio.play().catch(e => console.warn("War ambience play failed:", e));
    } else if (appliedVolume <= 0.01 && !this.warAmbienceAudio.paused) {
        this.warAmbienceAudio.pause();
    }
  }

  loadSound(name, path, isPreload = false) {
    const audio = new Audio(path);
    audio.preload = 'auto';
    this.sfxCache[name] = audio;

    audio.onerror = () => {
      console.error(`Error loading sound: ${name} from ${path}`);
    };

    if (isPreload) {
      audio.load(); // Explicitly load, though 'auto' often suffices
    }
  }

  playSound(name, sourceX, sourceY, initialVolumeScale = 1.0, isUISound = false) {
    if (!this.sfxCache[name]) {
      console.error(`Sound not found: ${name}`);
      return;
    }

    let finalVolume = this.sfxVolume * initialVolumeScale; // Start with master SFX and desired scale

    if (!isUISound && typeof sourceX === 'number' && typeof sourceY === 'number' && this.game && this.game.cameraX !== undefined && this.game.viewWidth !== undefined) {
        // Using cameraX/Y and viewWidth/Height which should be updated in Game.js before rendering/sound logic
        const camCenterX = this.game.cameraX + this.game.viewWidth / 2;
        const camCenterY = this.game.cameraY + this.game.viewHeight / 2;
        const distance = Math.hypot(sourceX - camCenterX, sourceY - camCenterY);
        
        const maxAudibleDistance = 1200; 
        const falloffStartDistance = 300; // Sounds start to fade beyond this distance

        if (distance > maxAudibleDistance) {
            finalVolume = 0; // Too far, effectively silent
        } else if (distance > falloffStartDistance) {
            // Calculate attenuation factor (1 at falloffStartDistance, 0 at maxAudibleDistance)
            const attenuation = 1 - ((distance - falloffStartDistance) / (maxAudibleDistance - falloffStartDistance));
            finalVolume *= Math.max(0, attenuation); // Ensure volume doesn't go negative
        }
        // If distance <= falloffStartDistance, finalVolume remains this.sfxVolume * initialVolumeScale
    }
    
    if (finalVolume <= 0.01) { // Don't play if effectively silent
        // console.log(`Skipping sound ${name} due to low volume: ${finalVolume}`); // Optional: for debugging
        return;
    }

    try {
      const soundInstance = new Audio(this.sfxCache[name].src);
      soundInstance.volume = Math.max(0, Math.min(1, finalVolume)); // Clamp volume

      soundInstance.play().catch(err => console.warn(`Error playing sound ${name}:`, err));

      soundInstance.onerror = () => { // This primarily catches errors during loading if not preloaded, or decoding.
        console.error(`Error with sound instance for ${name}:`, soundInstance.error);
      };
    } catch (error) { // This catches synchronous errors, e.g. if Audio constructor fails.
      console.error(`Exception during playSound ${name}:`, error);
    }
  }

  preloadSounds() {
    this.loadSound('attack_sword', 'assets/audiosfx/Attack/SWORD_Hit_Sword_Hard_Designed_03_SOUNDMORPH.wav', true); // Keep for specific king slash
    this.loadSound('ui_click', 'assets/audiosfx/Medieval Fight Ambient Dynamic Sound/MENU_Choice_SOUNDMORPH.wav', true);
    // Remove generic 'unit_die' and 'attack_melee'
    // this.loadSound('unit_die', 'assets/audiosfx/Dieing/DIE_Char_Gen_MALE_SOUNDMORPH.wav', true);
    // this.loadSound('attack_melee', 'assets/audiosfx/Attack/Melee/Mellee metalic 1.mp3', true);
    
    // Level-based melee attack sounds
    this.loadSound('attack_melee_l1', 'assets/audiosfx/Attack/Melee/Mellee metalic 1.mp3', true);
    this.loadSound('attack_melee_l2', 'assets/audiosfx/Attack/Melee/Mellee metalic 2.mp3', true);
    this.loadSound('attack_melee_l3', 'assets/audiosfx/Attack/Melee/Mellee metalic 3.mp3', true);

    // Faction-specific death sounds
    this.loadSound('death_human', 'assets/audiosfx/Dieing/Humans/DieSound 1.mp3', true);
    this.loadSound('death_elf', 'assets/audiosfx/Dieing/Elfs/ElfsDie 1.mp3', true);
    this.loadSound('death_orc', 'assets/audiosfx/Dieing/Orcs/OrcDie 1.mp3', true);

    this.loadSound('attack_arrow', 'assets/audiosfx/Attack/Arrow Shot/Arrow Shot 1.mp3', true); // Keep for archers
    this.loadSound('footstep', 'assets/audiosfx/StepSound/Stepsound.mp3', true);
  }
}
