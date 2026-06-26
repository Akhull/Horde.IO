import type { Faction } from "../types";
import { DIFFICULTY, DIFFICULTY_ORDER, DEFAULT_DIFFICULTY } from "../config/gameConfig";
import type { Difficulty } from "../config/gameConfig";
import { bus } from "./bus";
import { el } from "./dom";
import {
  startGame,
  stopGame,
  setVolume,
  getVolume,
  playClick,
  ensureMusic,
  pauseGame,
  resumeGame,
  isGameRunning,
} from "./controller";
import { showHud } from "./hud";

// Baut und verwaltet alle Menü-Screens + das Pause-Overlay als DOM-Overlay.
// Genau ein Screen ist aktiv (oder keiner während des Spiels).

type ScreenName = "loading" | "title" | "menu" | "options" | "selection" | "gameover";

const BG: Record<string, string> = {
  loading: "/assets/images/TitleScreen.png",
  title: "/assets/images/TitleScreen.png",
  menu: "/assets/images/MainMenu.png",
  options: "/assets/images/options.png",
  selection: "/assets/images/selectionmenu.png",
  gameover: "/assets/images/MainMenu.png",
};

const FACTION_UI: { id: Faction; label: string; flavor: string }[] = [
  { id: "human", label: "Mensch", flavor: "Ausgewogen und standhaft" },
  { id: "elf", label: "Elf", flavor: "Flink und treffsicher" },
  { id: "orc", label: "Ork", flavor: "Roh und schlagkräftig" },
];

let root: HTMLDivElement;
const screens = new Map<ScreenName, HTMLElement>();

// Laufzeit-Zustand.
let lastFaction: Faction = "human";
let lastDifficulty: Difficulty = DEFAULT_DIFFICULTY;
let selectedDifficulty: Difficulty = DEFAULT_DIFFICULTY;
let paused = false;

// Refs, die sich zur Laufzeit ändern.
let loadingBar: HTMLElement;
let goTitle: HTMLElement;
let pauseOverlay: HTMLElement;
const diffSegs: HTMLButtonElement[] = [];
const sliderEls: Record<"musicVolume" | "sfxVolume", HTMLInputElement> = {} as never;
const sliderVals: Record<"musicVolume" | "sfxVolume", HTMLElement> = {} as never;

export function buildScreens(parent: HTMLElement): void {
  root = el("div", { id: "ui" });
  parent.append(root);

  addScreen("loading", buildLoading());
  addScreen("title", buildTitle());
  addScreen("menu", buildMenu());
  addScreen("options", buildOptions());
  addScreen("selection", buildSelection());
  addScreen("gameover", buildGameOver());
  buildPauseOverlay();

  showScreen("loading");

  bus.on("loadProgress", (p) => {
    loadingBar.style.width = `${Math.round(p * 100)}%`;
  });
  bus.on("bootReady", () => showScreen("title"));
  bus.on("gameOver", ({ result, faction }) => {
    lastFaction = faction;
    setPaused(false);
    showGameOver(result);
  });
  bus.on("requestPauseToggle", () => togglePause());

  // Pause per ESC / P auf Fensterebene (greift nur während einer laufenden Partie).
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "p" || e.key === "P") {
      if (isGameRunning()) {
        e.preventDefault();
        togglePause();
      }
    }
  });
}

function addScreen(name: ScreenName, content: HTMLElement[]): void {
  const s = el("section", { class: "screen", dataset: { screen: name } }, content);
  // CSS-Custom-Property muss über setProperty gesetzt werden (nicht via style-Objekt).
  s.style.setProperty("--bg", `url("${BG[name]}")`);
  screens.set(name, s);
  root.append(s);
}

function showScreen(name: ScreenName | null): void {
  for (const [key, s] of screens) s.classList.toggle("is-active", key === name);
}

// Navigation mit Klick-Sound.
function go(name: ScreenName): void {
  playClick();
  if (name === "options") syncSliders();
  if (name === "selection") {
    selectedDifficulty = DEFAULT_DIFFICULTY;
    refreshDiff();
  }
  showScreen(name);
}

// ---- Screen-Definitionen --------------------------------------------------

function buildLoading(): HTMLElement[] {
  loadingBar = el("div", { class: "bar-fill" });
  return [
    el("div", { class: "brand", textContent: "Horde of Kings" }),
    el("div", { class: "bar" }, [loadingBar]),
    el("div", { class: "loading-text", textContent: "wird geschmiedet …" }),
  ];
}

function buildTitle(): HTMLElement[] {
  const start = el("button", { class: "btn", textContent: "Spiel starten" });
  start.addEventListener("click", () => {
    ensureMusic();
    go("menu");
  });
  return [
    el("div", { class: "brand", textContent: "Horde of Kings" }),
    el("div", { class: "brand-sub", textContent: "Ein König. Eine Horde. Ein Überlebender." }),
    el("div", { class: "btn-col" }, [start]),
    el("div", { class: "footer-note", textContent: "WASD / Pfeiltasten bewegen · Leertaste Sprint · Q Schild · ESC Pause" }),
  ];
}

function buildMenu(): HTMLElement[] {
  const sp = el("button", { class: "btn", textContent: "Einzelspieler" });
  sp.addEventListener("click", () => go("selection"));

  const opt = el("button", { class: "btn btn--ghost", textContent: "Optionen" });
  opt.addEventListener("click", () => go("options"));

  const mp = el("button", { class: "btn btn--ghost btn--disabled", textContent: "Mehrspieler" });
  const notice = el("div", { class: "hint", style: { minHeight: "1.4em" } });
  mp.addEventListener("click", () => {
    playClick();
    notice.textContent = "Mehrspieler folgt – der Einzelspieler ist die vollständige Erfahrung.";
    notice.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
  });

  return [el("div", { class: "brand", textContent: "Horde of Kings" }), el("div", { class: "btn-col" }, [sp, opt, mp]), notice];
}

function buildOptions(): HTMLElement[] {
  const body = el("div", { class: "options-body" }, [buildSlider("Musik", "musicVolume"), buildSlider("Soundeffekte", "sfxVolume")]);
  const back = el("button", { class: "btn", textContent: "Zurück" });
  back.addEventListener("click", () => go("menu"));

  return [el("div", { class: "heading", textContent: "Optionen" }), el("div", { class: "panel" }, [body]), el("div", { class: "btn-col" }, [back])];
}

function buildSlider(label: string, key: "musicVolume" | "sfxVolume"): HTMLElement {
  const val = el("span", { class: "val", textContent: "50%" });
  const input = el("input", { type: "range", min: "0", max: "100", value: "50" });
  input.addEventListener("input", () => {
    const v = Number(input.value) / 100;
    setVolume(key, v);
    val.textContent = `${input.value}%`;
  });
  sliderEls[key] = input;
  sliderVals[key] = val;
  return el("div", { class: "slider-row" }, [el("div", { class: "slider-head" }, [el("span", { textContent: label }), val]), input]);
}

function syncSliders(): void {
  (["musicVolume", "sfxVolume"] as const).forEach((key) => {
    const pct = Math.round(getVolume(key) * 100);
    sliderEls[key].value = `${pct}`;
    sliderVals[key].textContent = `${pct}%`;
  });
}

// König-Vorschau-PNGs für die Auswahlkarten: dieselben statischen Kenney-Sprites,
// die Phaser unter human_king/elf_king/orc_king lädt (kein altes anim-Sheet mehr).
const KING_PREVIEW: Record<Faction, string> = {
  human: "/assets/kenney/medieval-rts/PNG/Retina/Unit/medievalUnit_05.png",
  elf: "/assets/kenney/medieval-rts/PNG/Retina/Unit/medievalUnit_17.png",
  orc: "/assets/kenney/medieval-rts/PNG/Retina/Unit/medievalUnit_23.png",
};

function buildSelection(): HTMLElement[] {
  const cards = FACTION_UI.map((f) => {
    const sprite = el("div", { class: "king-sprite", style: { backgroundImage: `url("${KING_PREVIEW[f.id]}")` } });
    const card = el("div", { class: "card", tabIndex: 0 }, [
      el("div", { class: "card-stage" }, [sprite]),
      el("div", { class: "card-name", textContent: f.label }),
      el("div", { class: "card-flavor", textContent: f.flavor }),
    ]);
    const pick = () => launch(f.id, selectedDifficulty);
    card.addEventListener("click", pick);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") pick();
    });
    return card;
  });

  // Schwierigkeits-Auswahl (Segmented Control). Skaliert nur die KI.
  diffSegs.length = 0;
  const segs = DIFFICULTY_ORDER.map((d) => {
    const seg = el("button", { class: "seg", textContent: DIFFICULTY[d].label, dataset: { diff: d } });
    seg.addEventListener("click", () => {
      playClick();
      selectedDifficulty = d;
      refreshDiff();
    });
    diffSegs.push(seg);
    return seg;
  });
  refreshDiff();

  const back = el("button", { class: "btn btn--ghost", textContent: "Zurück" });
  back.addEventListener("click", () => go("menu"));

  return [
    el("div", { class: "heading", textContent: "Wähle deine Fraktion" }),
    el("div", { class: "card-row" }, cards),
    el("div", { class: "diff-block" }, [el("div", { class: "diff-label", textContent: "Schwierigkeit" }), el("div", { class: "seg-group" }, segs)]),
    el("div", { class: "btn-col" }, [back]),
  ];
}

function refreshDiff(): void {
  for (const seg of diffSegs) seg.classList.toggle("is-active", seg.dataset.diff === selectedDifficulty);
}

function buildGameOver(): HTMLElement[] {
  goTitle = el("div", { class: "gameover-title", textContent: "" });
  const msg = el("div", { class: "hint" });

  const again = el("button", { class: "btn", textContent: "Nochmal" });
  again.addEventListener("click", () => {
    playClick();
    launch(lastFaction, lastDifficulty);
  });
  const home = el("button", { class: "btn btn--ghost", textContent: "Hauptmenü" });
  home.addEventListener("click", () => {
    stopGame();
    go("menu");
  });

  return [goTitle, msg, el("div", { class: "btn-col" }, [again, home])];
}

function showGameOver(result: "win" | "loss"): void {
  goTitle.textContent = result === "win" ? "Sieg!" : "Niederlage";
  goTitle.className = `gameover-title ${result}`;
  const msgEl = screens.get("gameover")!.querySelector(".hint") as HTMLElement;
  msgEl.textContent = result === "win" ? "Du bist der letzte König auf dem Schlachtfeld." : "Dein König ist gefallen.";
  showHud(false);
  showScreen("gameover");
}

// ---- Pause-Overlay --------------------------------------------------------
function buildPauseOverlay(): void {
  const resume = el("button", { class: "btn", textContent: "Weiter" });
  resume.addEventListener("click", () => {
    playClick();
    setPaused(false);
  });
  const home = el("button", { class: "btn btn--danger", textContent: "Hauptmenü" });
  home.addEventListener("click", () => quitToMenu());

  const panel = el("div", { class: "panel pause-panel" }, [
    el("div", { class: "heading", textContent: "Pause" }),
    el("div", { class: "btn-col" }, [resume, home]),
    el("div", { class: "hint", textContent: "ESC oder P zum Fortsetzen" }),
  ]);
  pauseOverlay = el("div", { class: "pause-overlay" }, [panel]);
  root.append(pauseOverlay);
}

function setPaused(p: boolean): void {
  if (p === paused) return;
  paused = p;
  if (p) {
    pauseGame();
    pauseOverlay.classList.add("is-active");
  } else {
    pauseOverlay.classList.remove("is-active");
    resumeGame();
  }
}

function togglePause(): void {
  if (!isGameRunning()) return;
  setPaused(!paused);
}

function quitToMenu(): void {
  playClick();
  setPaused(false);
  stopGame();
  showHud(false);
  showScreen("menu");
}

// Spiel starten: Menüs ausblenden, HUD zeigen, Engine anwerfen.
function launch(faction: Faction, difficulty: Difficulty): void {
  lastFaction = faction;
  lastDifficulty = difficulty;
  setPaused(false);
  startGame(faction, difficulty);
  showScreen(null);
  showHud(true);
}
