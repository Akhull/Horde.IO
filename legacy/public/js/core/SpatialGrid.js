export class SpatialGrid {
    constructor(worldWidth, worldHeight, cellSize) {
        this.worldWidth = worldWidth;
        this.worldHeight = worldHeight;
        this.cellSize = cellSize;
        this.grid = []; // 2D array: grid[row][col] = Set of entities

        this.numCols = Math.ceil(worldWidth / cellSize);
        this.numRows = Math.ceil(worldHeight / cellSize);

        for (let r = 0; r < this.numRows; r++) {
            this.grid[r] = [];
            for (let c = 0; c < this.numCols; c++) {
                this.grid[r][c] = new Set(); // Use a Set for unique entity storage per cell
            }
        }
    }

    // Helper to get cell indices for a given entity's bounding box
    _getCellIndices(entity) {
        const indices = new Set(); // Use a Set to store unique cell string identifiers "r,c"
        if (!entity || typeof entity.x !== 'number' || typeof entity.width !== 'number') { // Basic check
            console.warn("Invalid entity for grid:", entity);
            return []; // Return empty array of actual cell objects for now
        }

        const startCol = Math.floor(entity.x / this.cellSize);
        const endCol = Math.floor((entity.x + entity.width) / this.cellSize);
        const startRow = Math.floor(entity.y / this.cellSize);
        const endRow = Math.floor((entity.y + entity.height) / this.cellSize);

        for (let r = Math.max(0, startRow); r <= Math.min(this.numRows - 1, endRow); r++) {
            for (let c = Math.max(0, startCol); c <= Math.min(this.numCols - 1, endCol); c++) {
                indices.add(`${r},${c}`); // Store as string to ensure uniqueness before getting cell object
            }
        }
        return Array.from(indices).map(s => {
            const [r, c] = s.split(',').map(Number);
            return this.grid[r][c];
        });
    }
    
    // Helper to get cell indices from a single point (x,y)
    _getCellIndicesForPoint(x, y) {
        const col = Math.floor(x / this.cellSize);
        const row = Math.floor(y / this.cellSize);
        if (row >= 0 && row < this.numRows && col >= 0 && col < this.numCols) {
            return [{ r: row, c: col }];
        }
        return [];
    }


    addEntity(entity) {
        if (!entity._gridCells) {
            entity._gridCells = new Set(); // Store Set of cell objects entity is in
        }
        const cells = this._getCellIndices(entity);
        cells.forEach(cellSet => {
            if (cellSet) { // Ensure cellSet is valid
                cellSet.add(entity);
                entity._gridCells.add(cellSet);
            }
        });
    }

    removeEntity(entity) {
        if (entity._gridCells) {
            entity._gridCells.forEach(cellSet => {
                if (cellSet) cellSet.delete(entity);
            });
            entity._gridCells.clear();
        }
    }

    updateEntity(entity) {
        // Simple remove and re-add. More optimal would be to check if cells actually changed.
        this.removeEntity(entity);
        this.addEntity(entity);
    }

    // Get entities in the same cell(s) as the given entity's bounding box, and immediate neighbors
    getPotentialColliders(entity) {
        const potentialColliders = new Set();
        if (!entity || typeof entity.x !== 'number') return Array.from(potentialColliders);

        const startCol = Math.max(0, Math.floor(entity.x / this.cellSize) - 1);
        const endCol = Math.min(this.numCols - 1, Math.floor((entity.x + entity.width) / this.cellSize) + 1);
        const startRow = Math.max(0, Math.floor(entity.y / this.cellSize) - 1);
        const endRow = Math.min(this.numRows - 1, Math.floor((entity.y + entity.height) / this.cellSize) + 1);

        for (let r = startRow; r <= endRow; r++) {
            for (let c = startCol; c <= endCol; c++) {
                if (this.grid[r] && this.grid[r][c]) {
                    this.grid[r][c].forEach(e => potentialColliders.add(e));
                }
            }
        }
        potentialColliders.delete(entity); // Remove the entity itself
        return Array.from(potentialColliders);
    }

    // Get entities within a rectangular query area (more generic than by entity)
    getEntitiesInBoundingBox(x, y, width, height) {
        const entitiesInBox = new Set();
        const queryRect = { x, y, width, height }; // Use a temporary object for _getCellIndices
        
        const cells = this._getCellIndices(queryRect); // This will get cells covered by the box
        cells.forEach(cellSet => {
            if (cellSet) {
                cellSet.forEach(entity => {
                    // Optional: Add a more precise check here if entity's own bbox intersects queryRect
                    // For now, if it's in any of the cells touched by the query box, include it.
                    // A more precise check: if (entity.x < x + width && entity.x + entity.width > x && ...)
                    entitiesInBox.add(entity);
                });
            }
        });
        return Array.from(entitiesInBox);
    }
}
