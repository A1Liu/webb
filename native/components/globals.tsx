"use client";

import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { toast, Toaster } from "react-hot-toast";
import clsx from "clsx";
import Head from "next/head";
import { useEffect } from "react";
import { doPlatformInit } from "./hooks/usePlatform";
import { registerGlobal } from "./constants";
import { initNetworkLayer, usePeers } from "./state/peers";

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

interface BackgroundFlowOptions {}
interface BackgroundFlowProps {
  id: string;
}

export const NO_HYDRATE = Symbol("no-hydrate");

interface WebbGlobals {
  // Whether or not we're currently running a flow behind the webview.
  // Useful for scanning QR codes.
  state: AppState;

  cb: {
    runBackgroundFlow: (
      flow: (props: BackgroundFlowProps) => Promise<void>,
      opts?: BackgroundFlowOptions,
    ) => Promise<void>;
  };
}

// NOTE: we need to call this with `create()(stuff)` because otherwise Typescript
// has an aneurysm.
export const useGlobals = create<WebbGlobals>()((set, get) => {
  return {
    state: { kind: AppStateKind.Page },

    cb: {
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
});

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
    usePeers.persist.rehydrate();

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
