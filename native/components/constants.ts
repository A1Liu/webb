"use client";

import { memoize } from "@a1liu/webb-ui-shared/util";

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

export function registerGlobal<T>(field: string, createT: () => T): () => T {
  if (typeof window === "undefined") {
    return () => {
      throw new Error("failed to register global");
    };
  }

  if (window.EnvironmentFlags.registeredGlobals.has(field)) {
    throw new Error(`Field '${field}' already exists`);
  }

  window.EnvironmentFlags.registeredGlobals.set(field, null);

  return memoize(() => {
    const t = createT();

    window.EnvironmentFlags.registeredGlobals.set(field, t);
    return t;
  });
}
