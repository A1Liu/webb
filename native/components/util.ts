import { PersistStorage, StorageValue } from "zustand/middleware";
import { isNotNil } from "ramda";
import { z } from "zod";
import { toast } from "react-hot-toast";
import { get, set, del } from "idb-keyval";
import { Future, getOrCompute, timeout } from "@a1liu/webb-ui-shared/util";
import { debounce } from "lodash";

export const DefaultTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "short",
  timeStyle: "medium",
});

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

export function zustandJsonReviver(_key: string, value: unknown): unknown {
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
}

export function zustandJsonReplacer(
  this: unknown,
  _key: string,
  value: unknown,
): unknown {
  if (value instanceof Map) {
    return {
      __typename: "Map",
      state: [...value.entries()],
    };
  }

  if (typeof this !== "object" || !this) {
    return value;
  }

  const holder = this as Record<string, unknown>;
  const rawValue = holder[_key];
  if (rawValue instanceof Date) {
    return {
      __typename: "Date",
      state: rawValue.toISOString(),
    };
  }

  return value;
}

// operations should be linearized
// set operations and remove operations should be debounced
class IdbStorage implements PersistStorage<unknown> {
  private readonly mutexes = new Map<string, Mutex>();
  private readonly debouncers = new Map<
    string,
    (r: () => Promise<void>) => Promise<void> | undefined
  >();

  mutex(name: string) {
    return getOrCompute(this.mutexes, name, () => new Mutex());
  }

  debouncer(name: string) {
    const debouncer = getOrCompute(this.debouncers, name, () => {
      return debounce(
        (r: () => Promise<void>) => {
          return r();
        },
        333,
        {
          trailing: true,
          maxWait: 10_000,
        },
      );
    });
    return {
      async debounce(r: () => Promise<void>) {
        await debouncer(r);
      },
    };
  }

  async getItem(name: string): Promise<StorageValue<unknown> | null> {
    return this.mutex(name).run(async () => {
      const value = (await get(name)) ?? null;
      console.log(`Read ${name}`);
      return value;
    });
  }

  async setItem(name: string, value: StorageValue<unknown>): Promise<void> {
    await this.debouncer(name).debounce(() => {
      return this.mutex(name).run(async () => {
        await set(name, value);
        console.log(`Wrote ${name}`);
      });
    });
  }

  async removeItem(name: string): Promise<void> {
    return this.mutex(name).run(async () => {
      await del(name);
      console.log(`Deleted ${name}`);
    });
  }
}

export const ZustandIdbStorage: PersistStorage<unknown> = new IdbStorage();

export async function getFirstSuccess<T>(promises: Promise<T>[]): Promise<
  | {
      success: true;
      value: T;
    }
  | { success: false }
> {
  const neverResolve = new Promise<T>(() => {});

  const firstSuccess = Promise.race(
    promises.map((p) => p.catch(() => neverResolve)),
  ).then((value) => ({ success: true as const, value }));
  const allFailed = Promise.allSettled(promises)
    .then(() => timeout(10))
    .then(() => ({
      success: false as const,
    }));

  return Promise.race([firstSuccess, allFailed]);
}

class Mutex {
  private isRunning = false;
  private readonly listeners: (() => unknown)[] = [];

  async run<T>(run: () => Promise<T>): Promise<T> {
    const this_ = this;

    const fut = new Future<T>();

    async function mutexRunner() {
      try {
        const returnValue = await run();
        fut.resolve(returnValue);
      } catch (error) {
        fut.reject(error);
        toast.error(`Error in storage ${String(error)}`);
        console.error(`Error in storage`, error);
      } finally {
        const nextListener = this_.listeners.shift();
        if (!nextListener) {
          this_.isRunning = false;
          return;
        }

        nextListener();
      }
    }
    if (!this_.isRunning) {
      this_.isRunning = true;
      mutexRunner();
    } else {
      this_.listeners.push(mutexRunner);
    }

    return fut.promise;
  }
}
