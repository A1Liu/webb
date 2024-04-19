"use client";

import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { toast } from "react-hot-toast";
import { GlobalInitGroup } from "../constants";

export enum AppStateKind {
  Page = "Page",
  PermissionFlow = "PermissionFlow",
  BackgroundFlow = "BackgroundFlow",
}

type AppState =
  | { kind: AppStateKind.Page; flowId?: undefined }
  | { kind: AppStateKind.BackgroundFlow; flowId: string }
  | {
      kind: AppStateKind.PermissionFlow;
      flowId: string;
      title: string;
      description: string;
      completion: (value: boolean) => void;
    };

interface BackgroundFlowOptions {}
interface BackgroundFlowProps {
  id: string;
}

interface PermissionFlowProps {
  title: string;
  description: string;
}

interface WebbGlobals {
  // Whether or not we're currently running a flow behind the webview.
  // Useful for scanning QR codes.
  state: AppState;

  cb: {
    runPermissionFlow: (props: PermissionFlowProps) => Promise<boolean>;
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
      runPermissionFlow: async (props) => {
        const id = uuid();
        try {
          const approve = await new Promise<boolean>((resolve) => {
            set({
              state: {
                kind: AppStateKind.PermissionFlow,
                flowId: id,
                title: props.title,
                description: props.description,
                completion: resolve,
              },
            });
          });

          return approve;
        } catch (error) {
          toast(`perm flow failed: ${String(error)}`);
          return false;
        } finally {
          const { state } = get();
          if (state.flowId === id) {
            set({ state: { kind: AppStateKind.Page } });
          }
        }
      },
      runBackgroundFlow: async (runFlow) => {
        const id = uuid();
        try {
          set({
            state: {
              kind: AppStateKind.BackgroundFlow,
              flowId: id,
            },
          });
          await runFlow({ id });
        } catch (error) {
          toast(`bg flow failed: ${String(error)}`);
        } finally {
          const { state } = get();
          if (state.flowId === id) {
            set({ state: { kind: AppStateKind.Page } });
          }
        }
      },
    },
  };
});

// For debugging state
GlobalInitGroup.registerValue({
  field: "useGlobals",
  eagerInit: true,
  create: () => useGlobals,
});
