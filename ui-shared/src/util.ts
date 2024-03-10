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

export interface UnwrappedPromise<T> {
  value?: T;
  promise: Promise<T>;
}

export class Future<T> {
  readonly promise: Promise<T>;
  readonly resolve: (t: T) => unknown;
  readonly reject: (err: Error) => unknown;
  private _valueSlot: T | undefined;

  constructor() {
    let resolve: (t: T) => unknown = () => {};
    let reject: (err: Error) => unknown = () => {};
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    promise.then((value) => (this._valueSlot = value));

    this.promise = promise;
    this.resolve = resolve;
    this.reject = reject;
  }

  get value(): T | undefined {
    return this._valueSlot;
  }

  get unwrapped() {
    const fut = this;
    return {
      promise: fut.promise,
      get value(): T | undefined {
        return fut._valueSlot;
      },
    };
  }
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
