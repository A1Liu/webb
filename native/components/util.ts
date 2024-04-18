import { PersistStorage, StorageValue } from "zustand/middleware";
import { isNotNil } from "ramda";
import { z } from "zod";
import { toast } from "react-hot-toast";
import { get, set, del } from "idb-keyval";

z.discriminatedUnion;

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

export class EncryptedText {
  private _text: string = "";
  private encrypted: boolean = false;
  private rawEncryptionKey: CryptoKey | undefined = undefined;
  private wrappedEncryptionKey: string;
  private readonly iv: ArrayBuffer;

  constructor(options: { wrappedEncryptionKey: string; iv?: ArrayBuffer }) {
    this.wrappedEncryptionKey = options.wrappedEncryptionKey;
    this.iv = options.iv ?? window.crypto.getRandomValues(new Uint8Array(12));
  }

  decryptKey(runner: (wrapped: string) => CryptoKey) {
    this.rawEncryptionKey = runner(this.wrappedEncryptionKey);
  }

  async decryptText() {
    if (!this.encrypted) {
      return;
    }

    if (!this.rawEncryptionKey) {
      throw new Error("Don't have the encryption key unwrapped yet");
    }

    const output = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: this.iv },
      this.rawEncryptionKey,
      new TextEncoder().encode(this._text),
    );

    this._text = new TextDecoder().decode(output);
  }

  set text(value: string) {
    if (this.encrypted) {
      throw new Error("Can't modify the data until it's decrypted");
    }

    this._text = value;
  }

  get text(): string {
    if (this.encrypted) {
      throw new Error("Can't modify the data until it's decrypted");
    }

    return this._text;
  }
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

export const ZustandJsonStorage: PersistStorage<unknown> = {
  getItem: async (name: string): Promise<StorageValue<unknown> | null> => {
    return (await get(name)) ?? null;
  },
  setItem: async (
    name: string,
    value: StorageValue<unknown>,
  ): Promise<void> => {
    await set(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await del(name);
  },
};
