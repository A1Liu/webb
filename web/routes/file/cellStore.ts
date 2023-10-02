import { writable, readable } from "svelte/store";
import { v4 as uuid } from "uuid";
import type { Writable, Readable } from "svelte/store";
import { userHomeDir } from "$lib/handlers";

let HOME_DIR = "";
userHomeDir().then((dir) => (HOME_DIR = dir));

export interface CellInfo {
  readonly id: string;
  readonly index: number;
  readonly directory: string;
  contents: string;
  focus: boolean;
}

interface MoveDownCommand {
  id: string;
  directory?: string;
}

export type SheetCommand =
  | {
      kind: "createCell";
      options: Partial<Omit<CellInfo, "index">>;
    }
  | {
      kind: "moveDownFrom";
      options: MoveDownCommand;
    };

export class Sheet {
  public readonly cellLayout: Readable<string[]>;
  public readonly cells = new Map<string, Writable<CellInfo>>();
  private cellLayoutRef: string[] = [];
  private readonly cellLayoutSetters = new Set<(s: string[]) => unknown>();

  constructor() {
    this.cellLayout = readable<string[]>([], (set) => {
      this.cellLayoutSetters.add(set);

      return () => {
        this.cellLayoutSetters.delete(set);
      };
    });
  }

  createCell({
    id = uuid(),
    directory,
    contents = "",
    focus = false,
  }: Partial<Omit<CellInfo, "index">> = {}): string {
    const index = this.cellLayoutRef.length;
    const store = writable({
      id,
      index,
      directory: directory ?? HOME_DIR,
      contents,
      focus,
    });

    this.cells.set(id, store);

    this.cellLayoutRef = [...this.cellLayoutRef, id];
    this.cellLayoutSetters.forEach((s) => s(this.cellLayoutRef));

    return id;
  }

  moveDownFrom({ id, directory }: MoveDownCommand) {
    const index = this.cellLayoutRef.indexOf(id);
    if (index === -1) {
      return;
    }

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
