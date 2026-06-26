import type { GridEntity } from "../types";

// Uniform-Grid für schnelle Nachbarschaftssuchen (Broad-Phase der Kollisionen).
// Faithful-Port von public/js/core/SpatialGrid.js, typisiert.
export class SpatialGrid {
  readonly cellSize: number;
  private readonly numCols: number;
  private readonly numRows: number;
  private readonly grid: Set<GridEntity>[][];

  // Monoton steigender Besuchsstempel für allokationsfreie Deduplizierung in den
  // *Into-Query-Varianten. Pro Query +1; eine Entität gilt als „in diesem Ergebnis
  // schon gesehen", wenn entity._visit === aktueller Stempel.
  private visitStamp = 0;

  // Interner Puffer, den die alten (Array-zurückgebenden) Methoden befüllen und dann
  // in ein frisches Array kopieren – so bleibt deren öffentliches Verhalten erhalten.
  private readonly scratch: GridEntity[] = [];

  constructor(worldWidth: number, worldHeight: number, cellSize: number) {
    this.cellSize = cellSize;
    this.numCols = Math.ceil(worldWidth / cellSize);
    this.numRows = Math.ceil(worldHeight / cellSize);
    this.grid = [];
    for (let r = 0; r < this.numRows; r++) {
      this.grid[r] = [];
      for (let c = 0; c < this.numCols; c++) {
        this.grid[r][c] = new Set<GridEntity>();
      }
    }
  }

  private cellsForBox(box: { x: number; y: number; width: number; height: number }): Set<GridEntity>[] {
    const result: Set<GridEntity>[] = [];
    const startCol = Math.floor(box.x / this.cellSize);
    const endCol = Math.floor((box.x + box.width) / this.cellSize);
    const startRow = Math.floor(box.y / this.cellSize);
    const endRow = Math.floor((box.y + box.height) / this.cellSize);
    for (let r = Math.max(0, startRow); r <= Math.min(this.numRows - 1, endRow); r++) {
      for (let c = Math.max(0, startCol); c <= Math.min(this.numCols - 1, endCol); c++) {
        result.push(this.grid[r][c]);
      }
    }
    return result;
  }

  addEntity(entity: GridEntity): void {
    if (!entity._gridCells) entity._gridCells = new Set();
    for (const cell of this.cellsForBox(entity)) {
      cell.add(entity);
      entity._gridCells.add(cell);
    }
  }

  removeEntity(entity: GridEntity): void {
    if (entity._gridCells) {
      entity._gridCells.forEach((cell) => cell.delete(entity));
      entity._gridCells.clear();
    }
  }

  updateEntity(entity: GridEntity): void {
    this.removeEntity(entity);
    this.addEntity(entity);
  }

  // Entitäten in derselben Zelle + direkten Nachbarzellen (mit 1 Zelle Puffer).
  // Allokationsfreie Variante: schreibt eindeutige (deduplizierte) Treffer in `out`,
  // leert `out` vorher und gibt es zurück. `entity` selbst ist ausgeschlossen.
  // Deduplizierung per Besuchsstempel statt per Set – kein GC-Müll im Hot-Path.
  getPotentialCollidersInto(entity: GridEntity, out: GridEntity[]): GridEntity[] {
    out.length = 0;
    const stamp = ++this.visitStamp;
    entity._visit = stamp; // sich selbst als „schon gesehen" markieren -> ausgeschlossen
    const cs = this.cellSize;
    const startCol = Math.max(0, Math.floor(entity.x / cs) - 1);
    const endCol = Math.min(this.numCols - 1, Math.floor((entity.x + entity.width) / cs) + 1);
    const startRow = Math.max(0, Math.floor(entity.y / cs) - 1);
    const endRow = Math.min(this.numRows - 1, Math.floor((entity.y + entity.height) / cs) + 1);
    for (let r = startRow; r <= endRow; r++) {
      const row = this.grid[r];
      for (let c = startCol; c <= endCol; c++) {
        row[c].forEach((e) => {
          if (e._visit !== stamp) {
            e._visit = stamp;
            out.push(e);
          }
        });
      }
    }
    return out;
  }

  // Entitäten in derselben Zelle + direkten Nachbarzellen (mit 1 Zelle Puffer).
  getPotentialColliders(entity: GridEntity): GridEntity[] {
    return this.getPotentialCollidersInto(entity, this.scratch).slice();
  }

  // Allokationsfreie Variante von getEntitiesInBoundingBox: dedupliziert in `out`.
  getEntitiesInBoundingBoxInto(x: number, y: number, width: number, height: number, out: GridEntity[]): GridEntity[] {
    out.length = 0;
    const stamp = ++this.visitStamp;
    const cs = this.cellSize;
    const startCol = Math.floor(x / cs);
    const endCol = Math.floor((x + width) / cs);
    const startRow = Math.floor(y / cs);
    const endRow = Math.floor((y + height) / cs);
    for (let r = Math.max(0, startRow); r <= Math.min(this.numRows - 1, endRow); r++) {
      const row = this.grid[r];
      for (let c = Math.max(0, startCol); c <= Math.min(this.numCols - 1, endCol); c++) {
        row[c].forEach((e) => {
          if (e._visit !== stamp) {
            e._visit = stamp;
            out.push(e);
          }
        });
      }
    }
    return out;
  }

  getEntitiesInBoundingBox(x: number, y: number, width: number, height: number): GridEntity[] {
    return this.getEntitiesInBoundingBoxInto(x, y, width, height, this.scratch).slice();
  }
}
