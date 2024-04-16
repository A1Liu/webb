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
import { registerGlobal } from "./constants";
import { NetworkLayer, PeerData } from "@a1liu/webb-ui-shared/network";
import { getId, memoize } from "@a1liu/webb-ui-shared/util";
import { z } from "zod";

export const getNetworkLayerGlobal = registerGlobal("networkLayer", () => {
  return new NetworkLayer(getId());
});

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
    return (await get(name)) ?? null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    console.debug("IDB set", { name, value });
    await set(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    console.debug("IDB remove", { name });
    await del(name);
  },
};

export enum AppStateKind {
  Page = "Page",
  BackgroundFlow = "BackgroundFlow",
}

type AppState =
  | { kind: AppStateKind.Page; backgroundFlowId?: undefined }
  | { kind: AppStateKind.BackgroundFlow; backgroundFlowId: string };

interface NoteData {
  id: string;
  hash: string;
  text: string;
  date: Date;
}

interface PersistedAppState {
  otherDeviceId: string;
  peers: Record<string, PeerData>;
  activeNote: string;
  notes: Map<string, NoteData>;
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

  privateCb: {
    setPersistedData(
      createState: (
        state: Partial<PersistedAppState>,
      ) => Partial<PersistedAppState>,
    ): void;
  };

  cb: {
    runBackgroundFlow: (
      flow: (props: BackgroundFlowProps) => Promise<void>,
      opts?: BackgroundFlowOptions,
    ) => Promise<void>;
    addPeer: (peer: PeerData) => void;
    updateNote: (note: NoteData) => void;
    setActiveNote: (id: string) => void;
  };
}

// NOTE: we need to call this with `create()(stuff)` because otherwise Typescript
// has an aneurysm.
const useGlobals = create<WebbGlobals>()(
  persist(
    (set, get) => {
      function setPersistedData(
        createState: (
          state: Partial<PersistedAppState>,
        ) => Partial<PersistedAppState>,
      ): void {
        set((prev) => ({
          persistedState:
            typeof prev.persistedState === "symbol"
              ? createState({})
              : {
                  ...prev.persistedState,
                  ...createState(prev.persistedState),
                },
        }));
      }

      return {
        state: { kind: AppStateKind.Page },
        persistedState: NO_HYDRATE,

        privateCb: {
          setPersistedData,
        },

        cb: {
          setActiveNote: (id) =>
            setPersistedData((prev) => ({ ...prev, activeNote: id })),
          updateNote: (note) => {
            setPersistedData((prev) => ({
              ...prev,
              notes: new Map(prev.notes ?? []).set(note.id, note),
            }));
          },
          addPeer: (peer) => {
            setPersistedData((prev) => ({
              peers: {
                ...prev.peers,
                [peer.id]: peer,
              },
            }));
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
      storage: createJSONStorage(() => storage, {
        reviver: (_key, value) => {
          try {
            if (
              !value ||
              typeof value !== "object" ||
              !("__typename" in value)
            ) {
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
              `Unrecognized typename: ${String(
                JSON.stringify(value),
              )} with ${e}`,
            );
          }
        },
        replacer: (_key, value) => {
          if (value instanceof Map) {
            return {
              __typename: "Map",
              state: Array.from(value.entries()),
            };
          }
          if (value instanceof Date) {
            return {
              __typename: "Date",
              state: value.toISOString(),
            };
          }

          return value;
        },
      }),
      skipHydration: true,
      partialize: ({ persistedState }) => ({ persistedState }),
    },
  ),
);

const initNetworkLayer = memoize(async () => {
  while (true) {
    const peer = await getNetworkLayerGlobal().listen();
    useGlobals.getState().cb.addPeer(peer);
  }
});

export function usePersistedState<S>(
  pick: (s: Partial<PersistedAppState>) => S,
): S;
export function usePersistedState(): Partial<PersistedAppState>;
export function usePersistedState<S>(
  pick: (s: Partial<PersistedAppState>) => S = (s) => s as S,
): S {
  return useGlobals((s) =>
    pick(typeof s.persistedState === "symbol" ? {} : s.persistedState),
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

// For debugging state
const initUseGlobalRegistration = registerGlobal(
  "globalZustand",
  () => useGlobals,
);

export function GlobalWrapper({ children }: { children: React.ReactNode }) {
  const {
    state: { kind },
  } = useGlobals();

  useEffect(() => {
    // Manually call rehydrate on startup to work around SSR nonsense
    // in Next.js
    useGlobals.persist.rehydrate();

    doPlatformInit();

    initNetworkLayer();

    initUseGlobalRegistration();
  }, []);

  return (
    <div className="h-full w-full">
      <Head>
        <meta name="theme-color" content="#39ff14" />
      </Head>

      <div
        className={clsx(
          "h-full w-full",
          kind === AppStateKind.BackgroundFlow && "hidden",
        )}
      >
        {children}
      </div>

      <Toaster position="bottom-left" />
    </div>
  );
}
