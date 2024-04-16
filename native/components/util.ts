import { createJSONStorage, StateStorage } from "zustand/middleware";
import { isNotNil } from "ramda";
import { z } from "zod";
import { toast } from "react-hot-toast";
import { get, set, del } from "idb-keyval";

// Not sure how I feel about this yet, but the idea is at least interesting.
// There is some argument to be made that this kind of thing should not be
// necessary, but at the same time the optional array spread syntax can be
// quite confusing

export function includeIf<T>(b: boolean, ...t: T[]): T[] {
  if (!b) return [];
  return t;
}

export function includeIfExist<T>(...t: (T | null | undefined)[]): T[] {
  return t.filter(isNotNil);
}

// Custom storage object
const storage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return (await get(name)) ?? null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    console.debug("IDB set", { name, value });
    await set(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    console.debug("IDB remove", { name });
    await del(name);
  },
};

export const ZustandJsonStorage = createJSONStorage(() => storage, {
  reviver: (_key, value) => {
    try {
      if (!value || typeof value !== "object" || !("__typename" in value)) {
        return value;
      }

      switch (value.__typename) {
        case "Map": {
          const schema = z.object({
            state: z.array(z.tuple([z.string(), z.unknown()])),
          });
          const parsed = schema.parse(value);

          return new Map(parsed.state);
        }
        case "Date": {
          const schema = z.object({ state: z.string() });
          const parsed = schema.parse(value);

          return new Date(parsed.state);
        }

        default:
          toast.error(`Unrecognized typename: ${value.__typename}`);
          throw new Error(`Unrecognized typename: ${value.__typename}`);
      }
    } catch (e) {
      toast.error(
        `Unrecognized typename: ${String(JSON.stringify(value))} with ${e}`,
      );
    }
  },
  replacer: (_key, value) => {
    if (value instanceof Map) {
      return {
        __typename: "Map",
        state: Array.from(value.entries()),
      };
    }
    if (value instanceof Date) {
      return {
        __typename: "Date",
        state: value.toISOString(),
      };
    }

    return value;
  },
});
