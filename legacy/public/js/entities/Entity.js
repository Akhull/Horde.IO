export class Entity {
  constructor(x, y, width, height) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this._gridCells = new Set(); // For SpatialGrid
  }
  
  update(deltaTime) {}
  
  draw(ctx, cameraX, cameraY) {
    ctx.fillStyle = "white";
    ctx.fillRect(this.x - cameraX, this.y - cameraY, this.width, this.height);
  }
  
  intersects(other) {
    return !(this.x + this.width < other.x ||
             this.x > other.x + other.width ||
             this.y + this.height < other.y ||
             this.y > other.y + other.height);
  }
}
