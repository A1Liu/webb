"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import { toast, Toaster } from "react-hot-toast";
import clsx from "clsx";
import Head from "next/head";
import { get, set, del } from "idb-keyval";
import { useEffect } from "react";
import { doPlatformInit } from "./hooks/usePlatform";

// TODO: replace with real logging, e.g. pino
if (typeof window !== "undefined") {
  const { error, log } = console;

  console.log = (...args: unknown[]) => {
    toast(args.map(String).join(" "));
    log(...args);
  };
  console.error = (...args: unknown[]) => {
    toast.error(args.map(String).join(" "));
    error(...args);
  };
}

// Custom storage object
const storage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return (await get(name)) || null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    console.debug("IDB set", { name, value });
    const id = toast.loading(`IDB set ${name}...`);
    await set(name, value);
    toast(`IDB set ${name} - DONE`, { id });
  },
  removeItem: async (name: string): Promise<void> => {
    console.debug("IDB remove", { name });
    const id = toast.loading(`IDB del ${name}...`);
    await del(name);
    toast(`IDB del ${name} - DONE`, { id });
  },
};

export enum AppStateKind {
  Page = "Page",
  BackgroundFlow = "BackgroundFlow",
}

type AppState =
  | { kind: AppStateKind.Page; backgroundFlowId?: undefined }
  | { kind: AppStateKind.BackgroundFlow; backgroundFlowId: string };

interface PersistedAppState {
  otherDeviceId: string;
}

interface BackgroundFlowOptions {}
interface BackgroundFlowProps {
  id: string;
}

export const NO_HYDRATE = Symbol("no-hydrate");

interface WebbGlobals {
  // Whether or not we're currently running a flow behind the webview.
  // Useful for scanning QR codes.
  state: AppState;
  persistedState: Partial<PersistedAppState> | typeof NO_HYDRATE;

  cb: {
    runBackgroundFlow: (
      flow: (props: BackgroundFlowProps) => Promise<void>,
      opts?: BackgroundFlowOptions
    ) => Promise<void>;
    setOtherDeviceId: (val: string) => void;
  };
}

// NOTE: we need to call this with `create()(stuff)` because otherwise Typescript
// has an aneurysm.
const useGlobals = create<WebbGlobals>()(
  persist(
    (set, get) => {
      function setPersistedData(
        createState: (
          state: Partial<PersistedAppState>
        ) => Partial<PersistedAppState>
      ): void {
        set((prev) => ({
          persistedState: createState(
            typeof prev.persistedState === "symbol" ? {} : prev.persistedState
          ),
        }));
      }

      return {
        state: { kind: AppStateKind.Page },
        persistedState: NO_HYDRATE,

        cb: {
          setOtherDeviceId: (otherDeviceId) => {
            setPersistedData((prev) => ({ ...prev, otherDeviceId }));
          },
          runBackgroundFlow: async (runFlow) => {
            const id = uuid();
            try {
              set({
                state: {
                  kind: AppStateKind.BackgroundFlow,
                  backgroundFlowId: id,
                },
              });
              await runFlow({ id });
            } catch (error) {
              toast(`failed: ${String(error)}`);
            } finally {
              const { state } = get();
              if (state.backgroundFlowId === id) {
                set({ state: { kind: AppStateKind.Page } });
              }
            }
          },
        },
      };
    },

    {
      name: "global-storage",
      storage: createJSONStorage(() => storage),
      skipHydration: true,
      partialize: ({ persistedState }) => ({ persistedState }),
    }
  )
);

export function usePersistedState<S>(
  pick: (s: Partial<PersistedAppState>) => S
): S;
export function usePersistedState(): Partial<PersistedAppState>;
export function usePersistedState<S>(
  pick: (s: Partial<PersistedAppState>) => S = (s) => s as S
): S {
  return useGlobals((s) =>
    pick(typeof s.persistedState === "symbol" ? {} : s.persistedState)
  );
}

export function useAppState<S>(pick: (s: AppState) => S): S;
export function useAppState(): Partial<AppState>;
export function useAppState<S>(pick: (s: AppState) => S = (s) => s as S): S {
  return useGlobals((s) => pick(s.state));
}

export function useModifyGlobals(): WebbGlobals["cb"] {
  return useGlobals((s) => s.cb);
}

export function GlobalWrapper({ children }: { children: React.ReactNode }) {
  const {
    state: { kind },
  } = useGlobals();

  useEffect(() => {
    // Manually call rehydrate on startup to work around SSR nonsense
    // in Next.js
    useGlobals.persist.rehydrate();

    doPlatformInit();
  }, []);

  return (
    <div className="h-full w-full">
      <Head>
        <meta name="theme-color" content="#39ff14" />
      </Head>

      <div
        className={clsx(
          "h-full w-full",
          kind === AppStateKind.BackgroundFlow && "hidden"
        )}
      >
        {children}
      </div>

      <Toaster position="bottom-left" />
    </div>
  );
}
