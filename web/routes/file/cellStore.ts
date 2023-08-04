import { writable, readable } from "svelte/store";
import { v4 as uuid } from "uuid";
import type { Writable, Readable } from "svelte/store";

export interface CellInfo {
  readonly id: string;
  readonly index: number;
  contents: string;
  focus: boolean;
}

export class Sheet {
  public readonly cellLayout: Readable<string[]>;
  public readonly cells = new Map<string, Writable<CellInfo>>();
  private cellLayoutRef: string[] = [];
  private readonly cellLayoutSetters: ((s: string[]) => unknown)[] = [];

  constructor() {
    this.cellLayout = readable<string[]>([], (set) => {
      this.cellLayoutSetters.push(set);

      return function stop() {};
    });
  }

  createCell({
    id = uuid(),
    contents = "",
    focus = false,
  }: Partial<CellInfo> = {}): string {
    const store = writable({ id, contents, focus });

    this.cells.set(id, store);

    this.cellLayoutRef = [...this.cellLayoutRef, id];
    this.cellLayoutSetters.forEach((s) => s(this.cellLayoutRef));

    return id;
  }

  moveDownFrom(id: string) {
    const index = this.cellLayoutRef.indexOf(id);
    if (index === -1) {
      return;
    }

    const targetIndex = index + 1;
    if (!this.cellLayoutRef[targetIndex]) {
      this.createCell({ focus: true });
      return;
    }

    const nextId = this.cellLayoutRef[targetIndex];
    this.cells.get(nextId)!.update((prev) => ({
      ...prev,
      focus: true,
    }));
  }
}
