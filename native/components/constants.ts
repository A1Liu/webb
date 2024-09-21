import { memoize } from "@a1liu/webb-tools/util";
import toast from "react-hot-toast";

export const EnvFlags = {
  registry: {} as Record<
    string,
    (() => unknown) | Record<string, () => unknown>
  >,
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

export class InitGroup {
  private initCalled = false;
  private readonly valueCreatorRegistry: Record<string, () => unknown> = {};
  private readonly eagerInitRegistry: Record<string, () => unknown> = {};

  constructor(readonly name: string) {
    if (typeof window === "undefined") {
      return;
    }

    if (window.EnvironmentFlags.registry[name]) {
      throw new Error(`Found previous global registration for ${name}`);
    }

    window.EnvironmentFlags.registry[name] = this.valueCreatorRegistry;
  }

  init() {
    this.initCalled = true;
    for (const init of Object.values(this.eagerInitRegistry)) {
      init();
    }
  }

  registerValue<T>({
    field,
    eagerInit,
    create,
  }: RegisterGlobalProps<T>): () => T {
    if (typeof window === "undefined") {
      return () => {
        throw new Error("failed to register global");
      };
    }

    if (this.valueCreatorRegistry[field]) {
      throw new Error(`Field '${field}' already exists`);
    }

    const initializer = memoize(() => {
      const t = create();

      return t;
    });

    this.valueCreatorRegistry[field] = initializer;

    if (eagerInit) {
      this.registerInit(field, initializer);
    }

    return initializer;
  }

  registerInit(name: string, init: () => void) {
    if (this.eagerInitRegistry[name]) {
      throw new Error(`Initializer '${name}' already exists`);
    }

    const func = memoize(init);
    this.eagerInitRegistry[name] = func;

    if (this.initCalled) {
      // We've already run initialization,
      // so this should just execute once global code has finished execution
      setTimeout(func);
    }
  }
}

export const GlobalInitGroup = new InitGroup("global");

GlobalInitGroup.registerValue({
  field: "toast",
  eagerInit: true,
  create: () => {
    // TODO: add real logging, e.g. pino
    return toast;
  },
});
