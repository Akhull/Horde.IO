import { describe, it, expect } from "vitest";
import { SpatialGrid } from "./SpatialGrid";
import type { GridEntity } from "../types";

function ent(x: number, y: number, size = 10): GridEntity {
  return { x, y, width: size, height: size };
}

describe("SpatialGrid", () => {
  it("findet benachbarte Entitäten in derselben Zelle", () => {
    const grid = new SpatialGrid(1000, 1000, 100);
    const a = ent(50, 50);
    const b = ent(60, 60);
    grid.addEntity(a);
    grid.addEntity(b);
    expect(grid.getPotentialColliders(a)).toContain(b);
  });

  it("liefert weit entfernte Entitäten NICHT als potenzielle Kollision", () => {
    const grid = new SpatialGrid(1000, 1000, 100);
    const a = ent(50, 50);
    const far = ent(900, 900);
    grid.addEntity(a);
    grid.addEntity(far);
    expect(grid.getPotentialColliders(a)).not.toContain(far);
  });

  it("entfernt Entitäten wieder aus dem Grid", () => {
    const grid = new SpatialGrid(1000, 1000, 100);
    const a = ent(50, 50);
    const b = ent(60, 60);
    grid.addEntity(a);
    grid.addEntity(b);
    grid.removeEntity(b);
    expect(grid.getPotentialColliders(a)).not.toContain(b);
  });

  it("getEntitiesInBoundingBox liefert nur Entitäten im Bereich", () => {
    const grid = new SpatialGrid(1000, 1000, 100);
    const inside = ent(120, 120);
    const outside = ent(800, 800);
    grid.addEntity(inside);
    grid.addEntity(outside);
    const hits = grid.getEntitiesInBoundingBox(100, 100, 100, 100);
    expect(hits).toContain(inside);
    expect(hits).not.toContain(outside);
  });

  it("updateEntity verschiebt eine Entität in die neue Zelle", () => {
    const grid = new SpatialGrid(1000, 1000, 100);
    const a = ent(50, 50);
    const probe = ent(60, 60);
    grid.addEntity(a);
    grid.addEntity(probe);
    a.x = 800;
    a.y = 800;
    grid.updateEntity(a);
    expect(grid.getPotentialColliders(probe)).not.toContain(a);
  });
});
