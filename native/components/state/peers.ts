import { create } from "zustand";
import { NetworkLayer, PeerData } from "@a1liu/webb-ui-shared/network";
import { getId } from "@a1liu/webb-ui-shared/util";
import { persist } from "zustand/middleware";
import { ZustandJsonStorage } from "../util";
import { registerGlobal } from "../constants";

export const getNetworkLayerGlobal = registerGlobal({
  field: "networkLayer",
  eagerInit: true,
  create: () => {
    const network = new NetworkLayer(getId());
    async function initListener() {
      while (true) {
        const peer = await network.listen();
        usePeers.getState().cb.addPeer(peer);
      }
    }

    initListener();

    return network;
  },
});

interface PeersState {
  peers: Map<string, PeerData>;
  cb: {
    addPeer: (peer: PeerData) => void;
    deletePeer: (peerId: string) => void;
  };
}

export const usePeers = create<PeersState>()(
  persist(
    (set) => {
      return {
        peers: new Map(),
        cb: {
          deletePeer: (peerId) => {
            set((prev) => {
              const peers = new Map(prev.peers ?? []);
              peers.delete(peerId);
              return { peers };
            });
          },
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

registerGlobal({
  field: "usePeers",
  eagerInit: true,
  create: () => {
    // Manually call rehydrate on startup to work around SSR nonsense
    // in Next.js
    usePeers.persist.rehydrate();

    return usePeers;
  },
});
