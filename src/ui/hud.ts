import Phaser from "phaser";
import { CONFIG } from "../config/gameConfig";
import { bus, gameRef } from "./bus";
import { setJoystick, setActionButton } from "./controller";
import { el } from "./dom";

// Das In-Game-HUD als reines DOM-Overlay. Liest pro Frame (rAF) den Zustand der
// aktiven GameScene aus gameRef und aktualisiert nur die nötigen Knoten. Die
// Minimap wird auf ein <canvas> mit 2D-Kontext gezeichnet.

const MINIMAP_SIZE = 200;

interface HudRefs {
  root: HTMLDivElement;
  kings: HTMLElement;
  dashFill: HTMLElement;
  dashLabel: HTMLElement;
  shieldFill: HTMLElement;
  shieldLabel: HTMLElement;
  v1: HTMLElement;
  v2: HTMLElement;
  archers: HTMLElement;
  champBadge: HTMLElement;
  champN: HTMLElement;
  eliteBadge: HTMLElement;
  eliteN: HTMLElement;
  timer: HTMLElement;
  hpFill: HTMLElement;
  hpText: HTMLElement;
  fps: HTMLElement;
  killfeed: HTMLElement;
  canvas: HTMLCanvasElement;
}

let refs: HudRefs | null = null;

// Vorherige Elite-Zähler, um echte Zuwächse (für den Belohnungs-Puls) zu erkennen.
let prevChamp = 0;
let prevElite = 0;

// Startet die einmalige Puls-Animation eines Badges neu (remove → Reflow → add),
// damit auch dicht aufeinanderfolgende Zuwächse jeweils sichtbar pulsen.
function bumpBadge(node: HTMLElement): void {
  node.classList.remove("bump");
  void node.offsetWidth; // erzwungener Reflow → Animation startet garantiert neu
  node.classList.add("bump");
}

export function buildHud(parent: HTMLElement): void {
  const kings = el("div", { class: "hud-kings" }, [
    el("span", { class: "crown", html: "♛" }),
    el("span", { id: "hud-kings-n", textContent: "—" }),
  ]);

  const dashFill = el("div", { class: "ability-fill dash" });
  const dashLabel = el("div", { class: "ability-label", textContent: "Sprint" });
  const dash = el("div", { class: "ability" }, [el("div", { class: "ability-bar" }, [dashFill, dashLabel])]);

  const shieldFill = el("div", { class: "ability-fill shield" });
  const shieldLabel = el("div", { class: "ability-label", textContent: "Schild" });
  const shield = el("div", { class: "ability" }, [el("div", { class: "ability-bar" }, [shieldFill, shieldLabel])]);

  // Elite-Belohnungen als leuchtende, farbumrandete Badges: der Gold-Champion und
  // der Lila-Stufe-3-Vasall. Die Badges sind gedämpft, solange man keinen besitzt,
  // und "zünden" (volles Leuchten + sanftes Atmen) beim ersten Erwerb; jeder weitere
  // Zuwachs löst einen kräftigen Puls aus. So zieht sich die Belohnungs-Farbe vom
  // aufgesammelten Orb über die leuchtende Einheit bis ins HUD durch.
  const champN = el("b", { textContent: "0" });
  const champBadge = el("div", { class: "elite-badge gold", title: "Gold-Champions (legendär)" }, [
    el("span", { class: "eb-ico", html: "⚡" }),
    el("span", { class: "eb-label", textContent: "Champions" }),
    champN,
  ]);
  const eliteN = el("b", { textContent: "0" });
  const eliteBadge = el("div", { class: "elite-badge purple", title: "Stufe-3-Elite-Vasallen" }, [
    el("span", { class: "eb-ico", html: "✦" }),
    el("span", { class: "eb-label", textContent: "Stufe 3" }),
    eliteN,
  ]);
  const elite = el("div", { class: "hud-elite" }, [champBadge, eliteBadge]);

  // Beim Ende des Zuwachs-Pulses die bump-Klasse entfernen, damit das "Atmen" der
  // erspielten Badges (eigene, dauerhafte Animation) wieder übernimmt.
  for (const b of [champBadge, eliteBadge]) {
    b.addEventListener("animationend", (e) => {
      if ((e as AnimationEvent).animationName === "badge-pop") b.classList.remove("bump");
    });
  }

  // Reihen-Einheiten (häufig) bewusst schlicht darunter – die Hierarchie hebt die
  // seltenen Belohnungen hervor.
  const v1 = el("b", { textContent: "0" });
  const v2 = el("b", { textContent: "0" });
  const archers = el("b", { textContent: "0" });
  const rankfile = el("div", { class: "hud-rankfile" }, [
    el("span", {}, ["Stufe 1: ", v1]),
    el("span", {}, ["Stufe 2: ", v2]),
    el("span", {}, ["Schützen: ", archers]),
  ]);

  const vassals = el("div", { class: "hud-vassals" }, [
    el("span", { class: "vh", textContent: "Gefolge" }),
    elite,
    rankfile,
  ]);

  const status = el("div", { class: "hud-panel hud-status" }, [kings, dash, shield, vassals]);

  const timer = el("div", { class: "hud-panel hud-timer", textContent: "00:00" });
  const pauseBtn = el("button", { class: "hud-pause hud-panel", title: "Pause (ESC / P)", html: "&#10074;&#10074;" });
  pauseBtn.addEventListener("click", () => bus.emit("requestPauseToggle", undefined));
  const topCenter = el("div", { class: "hud-topcenter" }, [pauseBtn, timer]);

  const canvas = el("canvas", { id: "minimap" });
  canvas.width = MINIMAP_SIZE;
  canvas.height = MINIMAP_SIZE;
  const minimap = el("div", { class: "hud-panel hud-minimap-wrap" }, [canvas]);

  const killfeed = el("div", { class: "hud-killfeed", style: { top: `${MINIMAP_SIZE + 26}px` } });

  const hpFill = el("div", { class: "hp-fill" });
  const hpText = el("div", { class: "hp-text", textContent: "" });
  const hp = el("div", { class: "hud-hp" }, [el("div", { class: "hp-bar" }, [hpFill]), hpText]);

  const fps = el("div", { class: "hud-fps", textContent: "" });

  const root = el("div", { id: "hud" }, [status, topCenter, minimap, killfeed, hp, fps, buildTouchControls()]);
  parent.append(root);

  refs = { root, kings: kings.lastElementChild as HTMLElement, dashFill, dashLabel, shieldFill, shieldLabel, v1, v2, archers, champBadge, champN, eliteBadge, eliteN, timer, hpFill, hpText, fps, killfeed, canvas };

  // Kill-Feed an das Königstod-Event koppeln.
  bus.on("kingKilled", ({ faction, kingsLeft }) => pushKill(faction, kingsLeft));

  // Eine einzige rAF-Schleife treibt das gesamte HUD.
  requestAnimationFrame(tick);
}

export function showHud(visible: boolean): void {
  refs?.root.classList.toggle("is-active", visible);
}

const FACTION_LABEL: Record<string, string> = { human: "Menschen", elf: "Elfen", orc: "Orks" };

function pushKill(faction: string, kingsLeft: number): void {
  if (!refs) return;
  const msg = el("div", {
    class: "kill-msg",
    textContent: `${FACTION_LABEL[faction] ?? "Ein"}-König gefallen — ${kingsLeft} übrig`,
  });
  refs.killfeed.append(msg);
  // Nach Ende der Ausblend-Animation (siehe CSS) entfernen.
  msg.addEventListener("animationend", (e) => {
    if ((e as AnimationEvent).animationName === "kill-out") msg.remove();
  });
}

function tick(): void {
  requestAnimationFrame(tick);
  const game = gameRef.current;
  const r = refs;
  if (!r || !game || !game.scene.isActive() || !game.playerKing) return;

  const king = game.playerKing;

  // Könige übrig
  const kingsAlive = game.units.reduce((n, u) => (u.unitType === "king" ? n + 1 : n), 0);
  r.kings.textContent = `${kingsAlive} Könige übrig`;

  // Sprint-Cooldown
  const dashRatio = Phaser.Math.Clamp(king.dashTimer / CONFIG.dashCooldown, 0, 1);
  r.dashFill.style.width = `${dashRatio * 100}%`;
  const dashReady = dashRatio >= 1;
  r.dashFill.classList.toggle("ready", dashReady && king.dashReadyFlashTimer > 0);
  r.dashLabel.textContent = dashReady ? "Sprint bereit" : `Sprint ${((CONFIG.dashCooldown - king.dashTimer) / 1000).toFixed(1)}s`;

  // Schild-Cooldown
  const shieldRatio = Phaser.Math.Clamp(king.shieldCooldownTimer / CONFIG.shieldAbilityCooldown, 0, 1);
  r.shieldFill.style.width = `${shieldRatio * 100}%`;
  const shieldReady = shieldRatio >= 1;
  r.shieldFill.classList.toggle("ready", shieldReady && king.shieldReadyFlashTimer > 0);
  r.shieldLabel.textContent = shieldReady ? "Schild bereit" : `Schild ${((CONFIG.shieldAbilityCooldown - king.shieldCooldownTimer) / 1000).toFixed(1)}s`;

  // Gefolge zählen
  const team = king.team;
  let c1 = 0, c2 = 0, c3 = 0, arc = 0, champ = 0;
  for (const u of game.units) {
    if (u.team !== team) continue;
    if (u.unitType === "vassal") {
      if (u.level === 1) c1++;
      else if (u.level === 2) c2++;
      else if (u.level === 3) c3++;
    } else if (u.unitType === "archer") arc++;
    else if (u.unitType === "champion") champ++;
  }
  r.v1.textContent = `${c1}`;
  r.v2.textContent = `${c2}`;
  r.archers.textContent = `${arc}`;
  // Elite-Badges: Zahl setzen, beim ersten Erwerb "zünden" (is-earned) und bei jedem
  // echten Zuwachs einen Belohnungs-Puls auslösen (bumpBadge startet die Animation neu).
  r.champN.textContent = `${champ}`;
  r.eliteN.textContent = `${c3}`;
  r.champBadge.classList.toggle("is-earned", champ > 0);
  r.eliteBadge.classList.toggle("is-earned", c3 > 0);
  if (champ > prevChamp) bumpBadge(r.champBadge);
  if (c3 > prevElite) bumpBadge(r.eliteBadge);
  prevChamp = champ;
  prevElite = c3;

  // Timer
  const total = Math.floor(game.gameTime / 1000);
  r.timer.textContent = `${`0${Math.floor(total / 60)}`.slice(-2)}:${`0${total % 60}`.slice(-2)}`;

  // HP – das fraktions-skalierte Maximum des Spielerkönigs nutzen (Orc: 330),
  // damit Balken und Text bei vollem Leben korrekt 100% bzw. "330 / 330" zeigen.
  const hp = Math.max(0, king.hp);
  const maxHp = king.maxHp;
  const hpPct = Phaser.Math.Clamp(hp / maxHp, 0, 1);
  r.hpFill.style.width = `${hpPct * 100}%`;
  r.hpFill.style.background =
    hpPct > 0.5 ? "linear-gradient(90deg,#2faa3a,#6fd06f)" : hpPct > 0.25 ? "linear-gradient(90deg,#c89a1e,#f4d24a)" : "linear-gradient(90deg,#b23f38,#e3645c)";
  r.hpText.textContent = `${hp.toFixed(0)} / ${maxHp}`;

  // FPS
  r.fps.textContent = `${Math.round(game.game.loop.actualFps)} FPS`;

  drawMinimap(r.canvas, game);
}

function drawMinimap(canvas: HTMLCanvasElement, game: NonNullable<typeof gameRef.current>): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = MINIMAP_SIZE;
  const scale = size / CONFIG.worldWidth;
  const toX = (wx: number) => wx * scale;
  const toY = (wy: number) => wy * scale;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#1c3a1c";
  ctx.fillRect(0, 0, size, size);

  for (const o of game.obstacles) {
    ctx.fillStyle = o.type === "water" ? "#3366ff" : "#0a4f0a";
    ctx.fillRect(toX(o.x), toY(o.y), Math.max(1, o.width * scale), Math.max(1, o.height * scale));
  }

  ctx.fillStyle = "#888888";
  for (const b of game.buildings) ctx.fillRect(toX(b.x) - 1, toY(b.y) - 1, 3, 3);

  const player = game.playerKing;
  const playerTeam = player?.team;

  for (const s of game.souls) {
    ctx.fillStyle =
      s.soulType === "green" ? "#00ff66" : s.soulType === "blue" ? "#00ccff" : s.soulType === "gold" ? "#ffd700" : "#cc00cc";
    // Gold-Orbs etwas größer (Rarität auf der Minimap erkennbar).
    const sz = s.soulType === "gold" ? 3 : 2;
    ctx.fillRect(toX(s.x), toY(s.y), sz, sz);
  }

  for (const u of game.units) {
    if (u === player) continue;
    if (u.unitType === "king") {
      const cx = toX(u.centerX);
      const cy = toY(u.centerY);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ff2a2a";
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (u.unitType === "champion") {
      // Champions als goldene Punkte hervorheben (eigene wie fremde).
      ctx.fillStyle = "#ffd700";
      ctx.fillRect(toX(u.centerX) - 1, toY(u.centerY) - 1, 3, 3);
    } else {
      ctx.fillStyle = u.team === playerTeam ? "#2f7d32" : "#8a2020";
      ctx.fillRect(toX(u.centerX) - 1, toY(u.centerY) - 1, 2, 2);
    }
  }

  // Safe-Zone
  const c = game.safeZoneCurrent;
  ctx.strokeStyle = "#ff0000";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(toX(c.centerX), toY(c.centerY), c.radius * scale, 0, Math.PI * 2);
  ctx.stroke();

  // Kamerabereich
  const cam = game.cameras.main;
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1;
  ctx.strokeRect(toX(cam.scrollX), toY(cam.scrollY), cam.width * scale, cam.height * scale);

  // Spielerkönig als heller Pfeil in Blickrichtung
  if (player) {
    const x = toX(player.centerX);
    const y = toY(player.centerY);
    const rad = 5;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.beginPath();
    ctx.arc(x, y, rad + 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    if (player.facingDirection >= 0) {
      ctx.moveTo(x + rad, y);
      ctx.lineTo(x - rad, y - rad);
      ctx.lineTo(x - rad, y + rad);
    } else {
      ctx.moveTo(x - rad, y);
      ctx.lineTo(x + rad, y - rad);
      ctx.lineTo(x + rad, y + rad);
    }
    ctx.closePath();
    ctx.fill();
  }
}

// ---- Touch-Steuerung (virtueller Joystick + Sprint/Schild) ----------------
function buildTouchControls(): HTMLElement {
  const knob = el("div", { class: "knob" });
  const stick = el("div", { class: "joystick" }, [knob]);
  const radius = 75;
  let active = -1;

  const move = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    const rect = stick.getBoundingClientRect();
    let dx = e.clientX - (rect.left + rect.width / 2);
    let dy = e.clientY - (rect.top + rect.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist > radius) {
      dx = (dx / dist) * radius;
      dy = (dy / dist) * radius;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    setJoystick(dx / radius, dy / radius);
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    active = -1;
    knob.style.transform = "translate(0,0)";
    setJoystick(0, 0);
  };
  stick.addEventListener("pointerdown", (e) => {
    active = e.pointerId;
    move(e);
  });
  stick.addEventListener("pointermove", move);
  stick.addEventListener("pointerup", end);
  stick.addEventListener("pointercancel", end);

  const dashBtn = el("div", { class: "touch-btn dash", textContent: "Sprint" });
  const shieldBtn = el("div", { class: "touch-btn shield", textContent: "Schild" });
  bindHold(dashBtn, "btnDash");
  bindHold(shieldBtn, "btnShield");

  return el("div", { class: "hud-touch" }, [stick, dashBtn, shieldBtn]);
}

function bindHold(node: HTMLElement, key: "btnDash" | "btnShield"): void {
  node.addEventListener("pointerdown", () => setActionButton(key, true));
  node.addEventListener("pointerup", () => setActionButton(key, false));
  node.addEventListener("pointerleave", () => setActionButton(key, false));
  node.addEventListener("pointercancel", () => setActionButton(key, false));
}
