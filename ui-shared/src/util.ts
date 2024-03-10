import { v4 as uuid } from "uuid";

export function assertUnreachable(_: never): void {
  console.error("unreachable code executed");
}

export function timeout(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export function memoize<T>(_maker: () => T): () => T {
  let maker: (() => T) | undefined = _maker;
  let slot: T;

  return () => {
    if (maker) {
      const result = maker();
      maker = undefined;
      slot = result;
      return result;
    }

    return slot;
  };
}

export function future<T>(): {
  promise: Promise<T>;
  resolve: (t: T) => unknown;
  reject: (err: Error) => unknown;
} {
  let resolve: (t: T) => unknown = () => {};
  let reject: (err: Error) => unknown = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

export interface UnwrappedPromise<T> {
  value?: T;
  promise: Promise<T>;
}

export function unwrapPromise<T>(
  promiseMaker: () => Promise<T>,
): () => UnwrappedPromise<T> {
  return (): UnwrappedPromise<T> => {
    const promise = promiseMaker();
    let slot: T | undefined = undefined;
    promise?.then((value) => {
      slot = value;
    });

    return {
      get value(): T | undefined {
        return slot;
      },
      promise: promise!,
    };
  };
}

export function getId(): string {
  const id = window.localStorage.getItem("peerjs-id");
  if (id === null) {
    const newId = uuid();
    window.localStorage.setItem("peerjs-id", newId);
    return newId;
  }

  return id;
}
