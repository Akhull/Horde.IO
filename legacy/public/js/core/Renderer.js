// public/js/core/Renderer.js

import { CONFIG } from "./config.js";

export class Renderer {
  constructor(game) {
    this.game = game;
    this.ctx = game.ctx;
  }

  draw() {
    const ctx = this.ctx;
    const game = this.game;
    // Leere den Canvas anhand der logischen (CSS‑)Größe
    ctx.clearRect(0, 0, game.logicalWidth, game.logicalHeight);

    // Update viewWidth and viewHeight based on mode
    if (game.isMobile) {
        game.viewWidth = game.logicalWidth / game.gameZoom;
        game.viewHeight = game.logicalHeight / game.gameZoom;
    } else {
        game.viewWidth = game.logicalWidth;
        game.viewHeight = game.logicalHeight;
    }
    
    // Update camera position
    if (game.playerKing) {
        game.cameraX = game.playerKing.x - game.viewWidth / 2;
        game.cameraY = game.playerKing.y - game.viewHeight / 2;
        game.cameraX = Math.max(0, Math.min(CONFIG.worldWidth - game.viewWidth, game.cameraX));
        game.cameraY = Math.max(0, Math.min(CONFIG.worldHeight - game.viewHeight, game.cameraY));
    } else {
        game.cameraX = 0;
        game.cameraY = 0;
    }

    const camX = game.cameraX;
    const camY = game.cameraY;
    const viewW = game.viewWidth;
    const viewH = game.viewHeight;

    // Helper for culling check
    const isInView = (entity, width, height) => {
        return entity.x + width > camX && entity.x < camX + viewW &&
               entity.y + height > camY && entity.y < camY + viewH;
    };
    
    const isInViewCentered = (item, itemWidth, itemHeight) => { // For items where x,y is center
        return item.x - itemWidth / 2 < camX + viewW &&
               item.x + itemWidth / 2 > camX &&
               item.y - itemHeight / 2 < camY + viewH &&
               item.y + itemHeight / 2 > camY;
    };


    if (game.isMobile) {
      ctx.save();
      ctx.scale(game.gameZoom, game.gameZoom);
      
      this.drawGround(); // Ground is full screen, no specific culling needed other than camera
      
      game.obstacles.filter(o => isInView(o, o.width, o.height)).forEach(o => o.draw(ctx, camX, camY));
      game.buildings.filter(b => isInView(b, b.width, b.height)).forEach(b => b.draw(ctx, camX, camY, game.assets));
      game.souls.filter(s => isInView(s, s.width, s.height)).forEach(s => s.draw(ctx, camX, camY, game.assets));
      game.powerUps.filter(p => isInView(p, p.width, p.height)).forEach(p => p.draw(ctx, camX, camY));
      game.projectiles.filter(proj => isInView(proj, proj.width, proj.height)).forEach(proj =>
        proj.draw(ctx, camX, camY, game.assets.arrow)
      );
      game.units.filter(u => isInView(u, u.width, u.height)).forEach(u =>
        u.draw(ctx, camX, camY, game.slashImage, game.assets, game.playerKing ? game.playerKing.team : null)
      );
      
      this.drawNonKingHealthBars(game, ctx, camX, camY); // Health bars are tied to units, unit culling handles this
      this.drawSafeZone(); // Safe zone can be large, specific culling might be complex, draw for now
      this.drawKingHealthBars(game, ctx, camX, camY); // Tied to units

      game.activeVisualEffects.filter(p => {
          const pSize = p.size * 2; return isInViewCentered(p, pSize, pSize);
      }).forEach(particle => {
        ctx.fillStyle = `rgba(${particle.color.r}, ${particle.color.g}, ${particle.color.b}, ${particle.alpha})`;
        ctx.beginPath();
        ctx.arc(particle.x - camX, particle.y - camY, particle.size, 0, Math.PI * 2);
        ctx.fill();
      });

      game.floatingTexts.filter(t => {
          const tWidth = t.size * 4; const tHeight = t.size;
          return isInViewCentered({x: t.x, y: t.currentY}, tWidth, tHeight); // Use currentY for text
      }).forEach(textEffect => {
        ctx.font = `${textEffect.size}px 'Cinzel', serif`;
        ctx.fillStyle = `rgba(${textEffect.color.r}, ${textEffect.color.g}, ${textEffect.color.b}, ${textEffect.alpha})`;
        ctx.textAlign = "center";
        ctx.fillText(textEffect.text, textEffect.x - camX, textEffect.currentY - camY);
      });

      ctx.restore();
      this.drawMinimap();
    } else {
      // Desktop: No gameZoom scaling, direct drawing
      this.drawGround();
      game.obstacles.filter(o => isInView(o, o.width, o.height)).forEach(o => o.draw(ctx, camX, camY));
      game.buildings.filter(b => isInView(b, b.width, b.height)).forEach(b => b.draw(ctx, camX, camY, game.assets));
      game.souls.filter(s => isInView(s, s.width, s.height)).forEach(s => s.draw(ctx, camX, camY, game.assets));
      game.powerUps.filter(p => isInView(p, p.width, p.height)).forEach(p => p.draw(ctx, camX, camY));
      game.projectiles.filter(proj => isInView(proj, proj.width, proj.height)).forEach(proj =>
        proj.draw(ctx, camX, camY, game.assets.arrow)
      );
      game.units.filter(u => isInView(u, u.width, u.height)).forEach(u =>
        u.draw(ctx, camX, camY, game.slashImage, game.assets, game.playerKing ? game.playerKing.team : null)
      );

      this.drawNonKingHealthBars(game, ctx, camX, camY);
      this.drawSafeZone();
      this.drawKingHealthBars(game, ctx, camX, camY);
      
      game.activeVisualEffects.filter(p => {
          const pSize = p.size * 2; return isInViewCentered(p, pSize, pSize);
      }).forEach(particle => {
        ctx.fillStyle = `rgba(${particle.color.r}, ${particle.color.g}, ${particle.color.b}, ${particle.alpha})`;
        ctx.beginPath();
        ctx.arc(particle.x - camX, particle.y - camY, particle.size, 0, Math.PI * 2);
        ctx.fill();
      });

      game.floatingTexts.filter(t => {
          const tWidth = t.size * 4; const tHeight = t.size;
           return isInViewCentered({x: t.x, y: t.currentY}, tWidth, tHeight);
      }).forEach(textEffect => {
        ctx.font = `${textEffect.size}px 'Cinzel', serif`;
        ctx.fillStyle = `rgba(${textEffect.color.r}, ${textEffect.color.g}, ${textEffect.color.b}, ${textEffect.alpha})`;
        ctx.textAlign = "center";
        ctx.fillText(textEffect.text, textEffect.x - camX, textEffect.currentY - camY);
      });
      
      this.drawMinimap();
    }
    this.drawHUD();
    if (game.isMultiplayerMode && game.socket) {
      for (let id in game.remotePlayers) {
        let rp = game.remotePlayers[id];
        ctx.drawImage(
          game.assets.factions[rp.faction].king, 
          rp.x - game.cameraX, 
          rp.y - game.cameraY, 
          40 * 1.3, 
          40 * 1.3
        );
      }
    }
  }

  drawGround() {
    const ctx = this.ctx;
    const game = this.game;
    let brightness = 0.5 + 0.5 * Math.abs(Math.sin(game.timeOfDay * Math.PI));
    let vw = game.isMobile ? game.viewWidth : game.logicalWidth;
    let vh = game.isMobile ? game.viewHeight : game.logicalHeight;
    if (game.assets.ground && game.assets.ground.complete) {
      let pattern = ctx.createPattern(game.assets.ground, "repeat");
      if (pattern && pattern.setTransform) {
        pattern.setTransform(new DOMMatrix().translate(-game.cameraX, -game.cameraY));
      }
      ctx.globalAlpha = brightness;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, vw, vh);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "#225522";
      ctx.fillRect(0, 0, vw, vh);
    }
  }

  drawSafeZone() {
    const ctx = this.ctx;
    const game = this.game;
    if (game.safeZoneState !== "delay") {
      ctx.strokeStyle = "red";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(
        game.safeZoneCurrent.centerX - game.cameraX, 
        game.safeZoneCurrent.centerY - game.cameraY, 
        game.safeZoneCurrent.radius, 
        0, Math.PI * 2
      );
      ctx.stroke();
      if (
        game.safeZoneCurrent.radius !== game.safeZoneTarget.radius ||
        game.safeZoneCurrent.centerX !== game.safeZoneTarget.centerX ||
        game.safeZoneCurrent.centerY !== game.safeZoneTarget.centerY
      ) {
        ctx.strokeStyle = "red";
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 5]);
        ctx.beginPath();
        ctx.arc(
          game.safeZoneTarget.centerX - game.cameraX, 
          game.safeZoneTarget.centerY - game.cameraY, 
          game.safeZoneTarget.radius, 
          0, Math.PI * 2
        );
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  drawMinimap() {
    const ctx = this.ctx;
    const game = this.game;
    const r = window.devicePixelRatio || 1;
    const cw = game.logicalWidth;
    const margin = 10;
    const minimapWidth = 200;
    const minimapHeight = 200;
    let minimapX = cw - minimapWidth - margin;
    let minimapY = margin;
    let scale = minimapWidth / CONFIG.worldWidth;
    ctx.save();
    ctx.resetTransform();
    ctx.scale(r, r);
    ctx.fillStyle = "#225522";
    ctx.fillRect(minimapX, minimapY, minimapWidth, minimapHeight);
    ctx.save();
    ctx.translate(minimapX, minimapY);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.rect(0, 0, CONFIG.worldWidth, CONFIG.worldHeight);
    ctx.clip();
    game.obstacles.forEach(o => o.drawMinimap(ctx));
    game.buildings.forEach(b => {
      ctx.fillStyle = "grey";
      let markerW = b.width * 1.75, markerH = b.height * 1.75;
      ctx.fillRect(b.x - markerW / 2, b.y - markerH / 2, markerW, markerH);
    });
    game.units.forEach(u => {
      ctx.fillStyle = (u.team === game.playerKing?.team) ? "green" : "red";
      let markerW = u.width * 1.75, markerH = u.height * 1.75;
      ctx.fillRect(u.x - markerW / 2, u.y - markerH / 2, markerW, markerH);
    });
    game.souls.forEach(s => {
      ctx.fillStyle = s.soulType === "green" ? "lime" : (s.soulType === "blue" ? "cyan" : "magenta");
      ctx.fillRect(s.x, s.y, s.width, s.height);
    });
    game.powerUps.forEach(p => {
      ctx.fillStyle = p.effectType === "speed" ? "yellow" : "orange";
      ctx.fillRect(p.x, p.y, p.width, p.height);
    });
    ctx.strokeStyle = "red";
    ctx.lineWidth = 2 / scale;
    ctx.beginPath();
    ctx.arc(
      game.safeZoneCurrent.centerX, 
      game.safeZoneCurrent.centerY, 
      game.safeZoneCurrent.radius, 
      0, Math.PI * 2
    );
    ctx.stroke();
    if (
      game.safeZoneCurrent.radius !== game.safeZoneTarget.radius ||
      game.safeZoneCurrent.centerX !== game.safeZoneTarget.centerX ||
      game.safeZoneCurrent.centerY !== game.safeZoneTarget.centerY
    ) {
      ctx.setLineDash([5 / scale, 5 / scale]);
      ctx.beginPath();
      ctx.arc(
        game.safeZoneTarget.centerX, 
        game.safeZoneTarget.centerY, 
        game.safeZoneTarget.radius, 
        0, Math.PI * 2
      );
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(game.cameraX, game.cameraY, game.viewWidth, game.viewHeight);
    ctx.restore();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.strokeRect(minimapX, minimapY, minimapWidth, minimapHeight);
    ctx.restore();
  }

  // Neue Methode: Zeichnet Gesundheitsbalken für alle Nicht‑König-Einheiten.
  drawNonKingHealthBars(game, ctx, cameraX, cameraY) {
    game.units.forEach(u => {
      if (u.unitType !== "king" && u.health !== undefined && u.maxHealth) {
        // Falls in der Unit.draw() bereits der Balken gezeichnet wird, entfällt diese Methode eventuell.
        // Hier könnte man ergänzend eigene Logik einfügen.
      }
    });
  }

  // Neue Methode: Zeichnet Gesundheitsbalken für alle König-Einheiten (später gezeichnet, damit im Vordergrund).
  drawKingHealthBars(game, ctx, cameraX, cameraY) {
    game.units.forEach(u => {
      if (u.unitType === "king" && u.health !== undefined && u.maxHealth) {
        // Auch hier, falls bereits in Unit.draw() gezeichnet wird, evtl. redundant.
      }
    });
  }

  drawHUD() {
    const ctx = this.ctx;
    const game = this.game;
    if (!game.playerKing) return;
    const r = window.devicePixelRatio || 1;
    const cw = game.logicalWidth;
    const ch = game.logicalHeight;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(r, r);
    
    // Könige-Anzeige (links oben)
    let kingsAlive = game.units.filter(u => u.unitType === "king").length;
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(10, 10, 160, 40);
    ctx.font = "24px 'Cinzel', serif";
    ctx.fillStyle = "white";
    ctx.textAlign = "left"; // Ensure left alignment
    ctx.fillText("Könige: " + kingsAlive, 20, 40);
    
    // Dash-Cooldown-Balken
    let dashRatio = Math.min(game.playerKing.dashTimer / CONFIG.dashCooldown, 1);
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(10, 60, 160, 20);
    // Cooldown Ready Flash for Dash
    if (game.playerKing.dashReadyFlashTimer > 0 && dashRatio >= 1) {
        ctx.fillStyle = "#FFFF99"; // Brighter yellow
    } else {
        ctx.fillStyle = "yellow";
    }
    ctx.fillRect(10, 60, 160 * dashRatio, 20);
    ctx.strokeStyle = "white";
    ctx.strokeRect(10, 60, 160, 20);
    ctx.font = "14px 'Cinzel', serif"; // Slightly smaller for timer text
    ctx.fillStyle = "white";
    ctx.textAlign = "center"; // Center the text
    if (dashRatio < 1) {
        let remainingDash = ((CONFIG.dashCooldown - game.playerKing.dashTimer) / 1000).toFixed(1);
        ctx.fillText(remainingDash + "s", 10 + 160 / 2, 75);
    } else {
        ctx.fillText("Dash Ready!", 10 + 160 / 2, 75);
    }
    
    // Shield-Cooldown-Balken
    let shieldRatio = Math.min(game.playerKing.shieldCooldownTimer / CONFIG.shieldAbilityCooldown, 1);
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(10, 90, 160, 20);
    // Cooldown Ready Flash for Shield
    if (game.playerKing.shieldReadyFlashTimer > 0 && shieldRatio >= 1) {
        ctx.fillStyle = "#66CCFF"; // Brighter blue
    } else {
        ctx.fillStyle = "blue";
    }
    ctx.fillRect(10, 90, 160 * shieldRatio, 20);
    ctx.strokeStyle = "white";
    ctx.strokeRect(10, 90, 160, 20);
    ctx.font = "14px 'Cinzel', serif"; // Slightly smaller for timer text
    ctx.fillStyle = "white";
    ctx.textAlign = "center"; // Center the text
    if (shieldRatio < 1) {
        let remainingShield = ((CONFIG.shieldAbilityCooldown - game.playerKing.shieldCooldownTimer) / 1000).toFixed(1);
        ctx.fillText(remainingShield + "s", 10 + 160 / 2, 105);
    } else {
        ctx.fillText("Shield Ready!", 10 + 160 / 2, 105);
    }
    
    // Vasallen-Counter und Bogenschützen-Anzeige (links mittig)
    let vassals = game.units.filter(u => u.unitType === "vassal" && u.team === game.playerKing.team);
    let v1 = vassals.filter(u => u.level === 1).length;
    let v2 = vassals.filter(u => u.level === 2).length;
    let v3 = vassals.filter(u => u.level === 3).length;
    let archers = game.units.filter(u => u.unitType === "archer" && u.team === game.playerKing.team);
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(10, 120, 220, 160);
    ctx.font = "16px 'Cinzel', serif";
    ctx.fillStyle = "white";
    ctx.textAlign = "left"; // Ensure left alignment
    ctx.fillText("Vassalen:", 20, 140);
    ctx.drawImage(game.assets.factions[game.playerFaction].level1, 20, 150, 24, 24);
    ctx.textAlign = "left"; // Ensure left alignment
    ctx.fillText("Level 1: " + v1, 50, 168);
    ctx.drawImage(game.assets.factions[game.playerFaction].level2, 20, 180, 24, 24);
    ctx.textAlign = "left"; // Ensure left alignment
    ctx.fillText("Level 2: " + v2, 50, 198);
    ctx.drawImage(game.assets.factions[game.playerFaction].level3, 20, 210, 24, 24);
    ctx.textAlign = "left"; // Ensure left alignment
    ctx.fillText("Level 3: " + v3, 50, 228);
    ctx.textAlign = "left"; // Ensure left alignment
    ctx.fillText("Bogenschützen: " + archers.length, 20, 258);
    
    // FPS-Anzeige (unten links)
    ctx.font = "16px Arial";
    ctx.fillStyle = "white";
    ctx.textAlign = "left";
    ctx.fillText("FPS: " + game.fps, 10, ch - 10);
    
    // Timer (mittig oben)
    let totalSeconds = Math.floor(game.gameTime / 1000);
    let minutes = Math.floor(totalSeconds / 60);
    let seconds = totalSeconds % 60;
    let timerText = ("0" + minutes).slice(-2) + ":" + ("0" + seconds).slice(-2);
    ctx.font = "20px Arial";
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.fillText(timerText, cw / 2, 30);
    
    // Player King Health on HUD (Bottom-Center)
    const playerHP = game.playerKing.hp;
    const playerMaxHP = 300; // Assuming King's max HP
    const healthText = `HP: ${Math.max(0, playerHP).toFixed(0)} / ${playerMaxHP}`;
    ctx.font = "20px 'Cinzel', serif";
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.fillText(healthText, cw / 2, ch - 25); // Adjusted Y position

    let hudHealthBarWidth = 200;
    let hudHealthBarHeight = 15;
    let hudHealthBarX = cw / 2 - hudHealthBarWidth / 2;
    let hudHealthBarY = ch - 50; // Above the text
    
    ctx.fillStyle = "rgba(0,0,0,0.7)"; // Slightly darker background for HUD health bar
    ctx.fillRect(hudHealthBarX, hudHealthBarY, hudHealthBarWidth, hudHealthBarHeight);
    
    ctx.fillStyle = "lime";
    ctx.fillRect(hudHealthBarX, hudHealthBarY, hudHealthBarWidth * (Math.max(0, playerHP) / playerMaxHP), hudHealthBarHeight);
    
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1; // Thinner line for HUD bar
    ctx.strokeRect(hudHealthBarX, hudHealthBarY, hudHealthBarWidth, hudHealthBarHeight);

    ctx.textAlign = "left"; // Reset textAlign
    ctx.restore();
  }
}
