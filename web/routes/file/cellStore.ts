import { writable, readable } from "svelte/store";
import { v4 as uuid } from "uuid";
import type { Writable, Readable } from "svelte/store";

export interface CellInfo {
  readonly id: string;
  readonly index: number;
  readonly directory: string;
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
    directory = "/",
    contents = "",
    focus = false,
  }: Partial<Omit<CellInfo, "index">> = {}): string {
    const index = this.cellLayoutRef.length;
    const store = writable({ id, index, directory, contents, focus });

    this.cells.set(id, store);

    this.cellLayoutRef = [...this.cellLayoutRef, id];
    this.cellLayoutSetters.forEach((s) => s(this.cellLayoutRef));

    return id;
  }

  moveDownFrom(id: string, options?: { directory?: string | null }) {
    const index = this.cellLayoutRef.indexOf(id);
    if (index === -1) {
      return;
    }

    const directory = options?.directory ?? undefined;

    const targetId = this.cellLayoutRef[index + 1];
    if (!targetId) {
      this.createCell({ focus: true, directory });
      return;
    }

    this.cells.get(targetId)!.update((prev) => ({
      ...prev,
      focus: true,
    }));
  }
}
