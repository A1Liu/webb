export function assertUnreachable(_: never): void {
  console.error("unreachable code executed");
}

export function timeout(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export function memoize<T>(_maker: () => T): {
  (): T;
  clear: () => void;
  memoizedValue?: T;
} {
  let maker: (() => T) | undefined = _maker;

  const func = () => {
    if (maker) {
      const result = maker();
      maker = undefined;
      func.memoizedValue = result;
      return result;
    }

    return func.memoizedValue as T;
  };

  func.memoizedValue = undefined as undefined | T;
  func.clear = () => {
    maker = _maker;
    func.memoizedValue = undefined;
  };

  return func;
}

export interface UnwrappedPromise<T> {
  value?: T;
  promise: Promise<T>;
}

export class Future<T> {
  readonly promise: Promise<T>;
  readonly resolve: (t: T) => unknown;
  readonly reject: (err: unknown) => unknown;
  private _valueSlot: T | undefined;

  constructor() {
    let resolve: (t: T) => unknown = () => {};
    let reject: (err: unknown) => unknown = () => {};
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    promise.then((value) => (this._valueSlot = value));

    this.promise = promise;
    this.resolve = resolve;
    this.reject = reject;
  }

  static unwrapPromise<K>(promise: Promise<K>): UnwrappedPromise<K> {
    let _valueSlot: K | undefined = undefined;
    promise.then((k) => {
      _valueSlot = k;
    });
    return {
      promise,
      get value(): K | undefined {
        return _valueSlot;
      },
    };
  }

  get value(): T | undefined {
    return this._valueSlot;
  }

  get unwrapped(): UnwrappedPromise<T> {
    const fut = this;
    return {
      promise: fut.promise,
      get value(): T | undefined {
        return fut._valueSlot;
      },
    };
  }
}

// Gets from Map. If the value doesn't exist, compute it using the provided lambda
// and store it in the map, and then return it
export function getOrCompute<T>(
  map: Map<string, T>,
  key: string,
  make: () => T,
): T {
  const value = map.get(key);
  if (value !== undefined) return value;

  const newValue = make();
  map.set(key, newValue);

  return newValue;
}

// TODO: RxJS or similar thing
export class Observable {
  private subscribers: (() => void)[] = [];

  private pushUpdate() {
    this.subscribers.forEach((s) => s());
  }

  static create(): [() => void, Observable] {
    const o = new Observable();
    return [() => o.pushUpdate(), o];
  }

  subscribe(cb: () => void) {
    this.subscribers.push(cb);
  }

  unsubscribe(cb: () => void) {
    this.subscribers = this.subscribers.filter((sub) => sub !== cb);
  }
}

export const PromStruct = {
  allSettled: async function promStructAllSettled<
    T extends Record<string, Promise<unknown>>,
  >(
    t: T,
  ): Promise<
    | { ok: true; results: { [K in keyof T]: Awaited<T[K]> } }
    | {
        ok: false;
        results: { [K in keyof T]?: Awaited<T[K]> };
        errors: { [K in keyof T]?: Error };
      }
  > {
    const resultsArray = await Promise.all(
      Object.entries(t).map(
        async ([key, value]): Promise<[keyof T, unknown, Error | null]> => {
          try {
            return [key, await value, null];
          } catch (e) {
            return [key, null, e instanceof Error ? e : new Error(String(e))];
          }
        },
      ),
    );

    let ok = true;
    const results: any = {};
    const errors: { [K in keyof T]?: Error } = {};

    for (const [key, result, error] of resultsArray) {
      if (error) {
        errors[key] = error;
        ok = false;
      } else {
        results[key] = result;
      }
    }

    return { ok, results, errors };
  },

  all: async function promStructAll<T extends Record<string, Promise<unknown>>>(
    t: T,
  ): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
    const resultsArray = await Promise.all(
      Object.entries(t).map(
        async ([key, value]): Promise<[keyof T, unknown]> => {
          return [key, await value];
        },
      ),
    );

    const results: any = {};

    for (const [key, result] of resultsArray) {
      results[key] = result;
    }

    return results;
  },
};
