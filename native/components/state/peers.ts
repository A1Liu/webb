import { create } from "zustand";
import { NetworkLayer, PeerData } from "@a1liu/webb-ui-shared/network";
import { getId, memoize } from "@a1liu/webb-ui-shared/util";
import { persist } from "zustand/middleware";
import { ZustandJsonStorage } from "../util";
import { registerGlobal } from "../constants";

export const getNetworkLayerGlobal = registerGlobal("networkLayer", () => {
  return new NetworkLayer(getId());
});

interface PeersState {
  peers: Map<string, PeerData>;
  cb: {
    addPeer: (peer: PeerData) => void;
  };
}

export const usePeers = create<PeersState>()(
  persist(
    (set) => {
      return {
        peers: new Map(),
        cb: {
          addPeer: (peer) => {
            set((prev) => {
              const peers = new Map(prev.peers ?? []);
              peers.set(peer.id, peer);
              return { peers };
            });
          },
        },
      };
    },

    {
      name: "peers-storage",
      storage: ZustandJsonStorage,
      skipHydration: true,
      partialize: ({ cb, ...rest }) => ({ ...rest }),
    },
  ),
);

export const initNetworkLayer = memoize(async () => {
  while (true) {
    const peer = await getNetworkLayerGlobal().listen();
    usePeers.getState().cb.addPeer(peer);
  }
});
