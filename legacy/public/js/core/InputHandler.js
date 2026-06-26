export class InputHandler {
    constructor(game) {
      this.game = game;
      this.keys = {};
      window.addEventListener("keydown", e => { this.keys[e.key] = true; });
      window.addEventListener("keyup", e => { this.keys[e.key] = false; });
      if (this.game.isMobile) {
        const joystickContainer = document.getElementById("joystickContainer");
        const joystickKnob = document.getElementById("joystickKnob");
        const joystickMaxRadius = 240;
        const containerRect = () => joystickContainer.getBoundingClientRect();
        const resetJoystick = () => {
          this.game.joystickVector = { x: 0, y: 0 };
          joystickKnob.style.transform = "translate(-50%, -50%)";
        };
        joystickContainer.addEventListener("touchstart", function(e) { e.preventDefault(); });
        joystickContainer.addEventListener("touchmove", (e) => {
          e.preventDefault();
          const touch = e.touches[0];
          const rect = containerRect();
          const posX = touch.clientX - rect.left;
          const posY = touch.clientY - rect.top;
          const centerX = rect.width / 2;
          const centerY = rect.height / 2;
          let deltaX = posX - centerX;
          let deltaY = posY - centerY;
          let distance = Math.hypot(deltaX, deltaY);
          if (distance > joystickMaxRadius) {
            deltaX = (deltaX / distance) * joystickMaxRadius;
            deltaY = (deltaY / distance) * joystickMaxRadius;
            distance = joystickMaxRadius;
          }
          joystickKnob.style.transform = `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px))`;
          this.game.joystickVector = { x: deltaX / joystickMaxRadius, y: deltaY / joystickMaxRadius };
        });
        joystickContainer.addEventListener("touchend", function(e) { e.preventDefault(); resetJoystick(); });
        joystickContainer.addEventListener("touchcancel", function(e) { e.preventDefault(); resetJoystick(); });
        const addTouchControl = (buttonId, keyVal) => {
          const btn = document.getElementById(buttonId);
          btn.addEventListener("touchstart", e => { e.preventDefault(); this.keys[keyVal] = true; });
          btn.addEventListener("touchend", e => { e.preventDefault(); this.keys[keyVal] = false; });
          btn.addEventListener("touchcancel", e => { e.preventDefault(); this.keys[keyVal] = false; });
        };
        addTouchControl("btn-dash", " ");
        addTouchControl("btn-shield", "q");
      }
    }
  }
  