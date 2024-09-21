export const CHANNEL_BUFFER_FULL = Symbol("channel buffer full");

// Trying to emulate golang channels
// Eventually, need to decide what the behavior should actually be.
// Probably need to add timeouts as well.
export class Channel<T> {
  private readonly listeners: ((t: T) => unknown)[] = [];
  private readonly queue: T[] = [];

  constructor(readonly capacity: number = 1) {}

  get size(): number {
    return this.queue.length;
  }

  async send(t: T): Promise<boolean> {
    if (this.listeners.length) {
      for (const listener of this.listeners) {
        listener(t);
      }
      this.listeners.length = 0;

      return true;
    }

    if (this.size >= this.capacity) {
      return false;
    }

    this.queue.push(t);
    return true;
  }

  async pop(): Promise<T> {
    if (this.queue.length > 0) {
      // Need to do it this way because the `T` type could allow `undefined`
      // as a value type. shifting first and checking the output would potentially
      // cause those values to disappear.
      return this.queue.shift()!;
    }

    return new Promise((res) => {
      this.listeners.push(res);
    });
  }
}
