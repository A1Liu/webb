"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import { toast, Toaster } from "react-hot-toast";
import clsx from "clsx";
import Head from "next/head";
import { useEffect } from "react";
import { doPlatformInit } from "./hooks/usePlatform";
import { registerGlobal } from "./constants";
import { NetworkLayer, PeerData } from "@a1liu/webb-ui-shared/network";
import { getId, memoize } from "@a1liu/webb-ui-shared/util";
import { ZustandJsonStorage } from "./util";

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

export enum AppStateKind {
  Page = "Page",
  BackgroundFlow = "BackgroundFlow",
}

type AppState =
  | { kind: AppStateKind.Page; backgroundFlowId?: undefined }
  | { kind: AppStateKind.BackgroundFlow; backgroundFlowId: string };

interface PersistedAppState {
  otherDeviceId: string;
  peers: Map<string, PeerData>;
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
  };
}

// NOTE: we need to call this with `create()(stuff)` because otherwise Typescript
// has an aneurysm.
export const useGlobals = create<WebbGlobals>()(
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
          addPeer: (peer) => {
            setPersistedData((prev) => {
              const peers = new Map(prev.peers ?? []);
              peers.set(peer.id, peer);
              return { peers };
            });
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
      storage: ZustandJsonStorage,
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
