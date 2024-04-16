"use client";

import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { toast } from "react-hot-toast";
import { registerGlobal } from "../constants";

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
registerGlobal({
  field: "useGlobals",
  eagerInit: true,
  create: () => useGlobals,
});
