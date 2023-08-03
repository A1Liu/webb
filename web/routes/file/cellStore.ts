import { writable } from "svelte/store";
import { v4 as uuid } from "uuid";
import type { Writable } from "svelte/store";

export interface CellInfo {
  readonly id: string;
  contents: string;
}

export class Sheet {
  public readonly cellLayout = writable<string[]>([]);
  public readonly cells = new Map<string, Writable<CellInfo>>();

  createCell(): string {
    const id = uuid();
    const store = writable({
      id,
      contents: "",
    });

    this.cellLayout.update((prev) => [...prev, id]);
    this.cells.set(id, store);

    return id;
  }

  *cellIter(cells: string[]): Generator<CellInfo, void, unknown> {
    for (const cellId of cells) {
      const cellInfo = this.cells.get(cellId);
      if (!cellInfo) continue;

      yield cellInfo;
    }
  }
}
