// The destructible layer as a grid of cells. Built from RGBA pixels (whatever
// was drawn: wordmark, tips, panels); a cell is solid if enough of its pixels
// are opaque. Shots remove cells in a radius. Pure: no DOM, so it is unit-tested.

export interface Cell {
  cx: number;
  cy: number;
  /** 0xRRGGBB of the cell's representative pixel. */
  color: number;
}

export class DestructibleGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly solid: Uint8Array;
  private readonly colors: Uint32Array;
  private total = 0;
  private alive = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly cellSize: number,
  ) {
    if (!(cellSize >= 1) || !Number.isInteger(cellSize)) throw new Error("cellSize must be a positive integer");
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.solid = new Uint8Array(this.cols * this.rows);
    this.colors = new Uint32Array(this.cols * this.rows);
  }

  /**
   * Rebuild from RGBA bytes (length width*height*4). A cell is solid when at
   * least `minCoverage` of its pixels have alpha >= 128.
   */
  load(rgba: Uint8ClampedArray | Uint8Array, minCoverage = 0.3): void {
    if (rgba.length !== this.width * this.height * 4) throw new Error("rgba size mismatch");
    const s = this.cellSize;
    this.total = 0;
    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        let opaque = 0;
        let count = 0;
        let best = -1;
        let bestAlpha = -1;
        const y0 = cy * s;
        const x0 = cx * s;
        for (let y = y0; y < Math.min(y0 + s, this.height); y++) {
          for (let x = x0; x < Math.min(x0 + s, this.width); x++) {
            const i = (y * this.width + x) * 4;
            const a = rgba[i + 3] ?? 0;
            count++;
            if (a >= 128) opaque++;
            if (a > bestAlpha) {
              bestAlpha = a;
              best = i;
            }
          }
        }
        const idx = cy * this.cols + cx;
        const isSolid = count > 0 && opaque / count >= minCoverage;
        this.solid[idx] = isSolid ? 1 : 0;
        this.colors[idx] = isSolid && best >= 0 ? (((rgba[best] ?? 0) << 16) | ((rgba[best + 1] ?? 0) << 8) | (rgba[best + 2] ?? 0)) >>> 0 : 0;
        if (isSolid) this.total++;
      }
    }
    this.alive = this.total;
  }

  isSolidAt(x: number, y: number): boolean {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;
    return this.solid[cy * this.cols + cx] === 1;
  }

  /** Removes solid cells whose centers lie within `radius` of (x, y). Returns them. */
  blast(x: number, y: number, radius: number): Cell[] {
    const s = this.cellSize;
    const out: Cell[] = [];
    const minX = Math.max(0, Math.floor((x - radius) / s));
    const maxX = Math.min(this.cols - 1, Math.floor((x + radius) / s));
    const minY = Math.max(0, Math.floor((y - radius) / s));
    const maxY = Math.min(this.rows - 1, Math.floor((y + radius) / s));
    const r2 = radius * radius;
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const idx = cy * this.cols + cx;
        if (this.solid[idx] !== 1) continue;
        const dx = (cx + 0.5) * s - x;
        const dy = (cy + 0.5) * s - y;
        if (dx * dx + dy * dy > r2) continue;
        this.solid[idx] = 0;
        this.alive--;
        out.push({ cx, cy, color: this.colors[idx] ?? 0 });
      }
    }
    return out;
  }

  get aliveCells(): number {
    return this.alive;
  }

  get totalCells(): number {
    return this.total;
  }

  /** 0 when untouched, 1 when everything is gone. */
  destroyedRatio(): number {
    return this.total === 0 ? 0 : 1 - this.alive / this.total;
  }
}
