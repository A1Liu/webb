"use client";

import { memoize } from "@a1liu/webb-ui-shared/util";
import toast from "react-hot-toast";

export const EnvFlags = {
  registeredGlobals: new Map<string, unknown>(),
} as const;

// Explicitly declaring the flags on the window interface so that they're editable
declare global {
  interface Window {
    EnvironmentFlags: typeof EnvFlags;
  }
}
if (typeof window !== "undefined") {
  window.EnvironmentFlags = EnvFlags;
}

interface RegisterGlobalProps<T> {
  field: string;
  eagerInit?: boolean;
  create: () => T;
}

const globalEagerInits = new Map<string, () => unknown>();
export function registerGlobal<T>({
  field,
  eagerInit,
  create,
}: RegisterGlobalProps<T>): () => T {
  if (typeof window === "undefined") {
    return () => {
      throw new Error("failed to register global");
    };
  }

  if (window.EnvironmentFlags.registeredGlobals.has(field)) {
    throw new Error(`Field '${field}' already exists`);
  }

  window.EnvironmentFlags.registeredGlobals.set(field, null);

  const initializer = memoize(() => {
    const t = create();

    window.EnvironmentFlags.registeredGlobals.set(field, t);
    return t;
  });

  if (eagerInit) {
    globalEagerInits.set(field, initializer);
  }

  return initializer;
}

registerGlobal.init = memoize(() => {
  for (const init of globalEagerInits.values()) {
    init();
  }
});

registerGlobal({
  field: "toast",
  eagerInit: true,
  create: () => {
    // TODO: replace with real logging, e.g. pino
    const { error, log } = console;

    console.log = (...args: unknown[]) => {
      toast(args.map(String).join(" "));
      log(...args);
    };
    console.error = (...args: unknown[]) => {
      toast.error(args.map(String).join(" "));
      error(...args);
    };

    return toast;
  },
});
