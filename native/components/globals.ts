import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { toast } from "react-hot-toast";

interface WebbGlobals {
  // Whether or not we're currently running a flow behind the webview.
  // Useful for scanning QR codes.
  inBackgroundFlow: boolean;
  backgroundFlowId?: string;

  cb: {
    runBackgroundFlow: (flow: (id: string) => Promise<void>) => Promise<void>;
  };
}

export const useGlobals = create<WebbGlobals>((set, get) => {
  return {
    inBackgroundFlow: false,

    cb: {
      runBackgroundFlow: async (flow) => {
        const id = uuid();
        try {
          set({ inBackgroundFlow: true, backgroundFlowId: id });
          await flow(id);
        } catch (error) {
          toast(`failed: ${String(error)}`);
        } finally {
          const { backgroundFlowId } = get();
          if (backgroundFlowId === id) {
            set({ backgroundFlowId: undefined, inBackgroundFlow: false });
          }
        }
      },
    },
  };
});
