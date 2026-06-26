import type { GridEntity } from "../types";

// Uniform-Grid für schnelle Nachbarschaftssuchen (Broad-Phase der Kollisionen).
// Faithful-Port von public/js/core/SpatialGrid.js, typisiert.
export class SpatialGrid {
  readonly cellSize: number;
  private readonly numCols: number;
  private readonly numRows: number;
  private readonly grid: Set<GridEntity>[][];

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
  getPotentialColliders(entity: GridEntity): GridEntity[] {
    const found = new Set<GridEntity>();
    const startCol = Math.max(0, Math.floor(entity.x / this.cellSize) - 1);
    const endCol = Math.min(this.numCols - 1, Math.floor((entity.x + entity.width) / this.cellSize) + 1);
    const startRow = Math.max(0, Math.floor(entity.y / this.cellSize) - 1);
    const endRow = Math.min(this.numRows - 1, Math.floor((entity.y + entity.height) / this.cellSize) + 1);
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        this.grid[r][c].forEach((e) => found.add(e));
      }
    }
    found.delete(entity);
    return Array.from(found);
  }

  getEntitiesInBoundingBox(x: number, y: number, width: number, height: number): GridEntity[] {
    const found = new Set<GridEntity>();
    for (const cell of this.cellsForBox({ x, y, width, height })) {
      cell.forEach((e) => found.add(e));
    }
    return Array.from(found);
  }
}
