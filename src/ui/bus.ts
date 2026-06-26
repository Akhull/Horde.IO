import type { Faction } from "../types";
import type { GameScene } from "../scenes/GameScene";

// Ergebnis einer Partie.
export type GameResult = "win" | "loss";

// Einziger Kommunikationsweg Engine -> DOM-UI. Phaser (Boot/Game) feuert diese
// Events; die UI-Schicht hört darauf. Die Gegenrichtung (UI -> Engine) läuft
// nicht über Events, sondern über die expliziten Controller-Funktionen.
export interface BusEvents {
  loadProgress: number; // 0..1 während des Asset-Ladens
  bootReady: void; // Assets + Animationen fertig -> Titelbildschirm zeigen
  kingKilled: { faction: Faction; kingsLeft: number };
  gameOver: { result: GameResult; faction: Faction };
  requestPauseToggle: void; // HUD-Pause-Button -> Screens schaltet die Pause um
}

type Listener<T> = (payload: T) => void;

class EventBus {
  private map = new Map<keyof BusEvents, Set<Listener<unknown>>>();

  on<K extends keyof BusEvents>(type: K, fn: Listener<BusEvents[K]>): () => void {
    let set = this.map.get(type);
    if (!set) {
      set = new Set();
      this.map.set(type, set);
    }
    set.add(fn as Listener<unknown>);
    return () => set!.delete(fn as Listener<unknown>);
  }

  emit<K extends keyof BusEvents>(type: K, payload: BusEvents[K]): void {
    this.map.get(type)?.forEach((fn) => (fn as Listener<BusEvents[K]>)(payload));
  }
}

export const bus = new EventBus();

// Referenz auf die gerade laufende GameScene. Das DOM-HUD liest sie pro Frame
// (rAF). Wird in GameScene.create gesetzt und beim Szenen-Ende geleert.
export const gameRef: { current: GameScene | null } = { current: null };
