import { create } from "zustand";
import { NetworkLayer, PeerData } from "@a1liu/webb-ui-shared/network";
import { getId } from "@a1liu/webb-ui-shared/util";
import { persist } from "zustand/middleware";
import { ZustandIdbStorage } from "../util";
import { GlobalInitGroup, InitGroup } from "../constants";
import { toast } from "react-hot-toast";

export const PeerInitGroup = new InitGroup("peers");

export const getNetworkLayerGlobal = PeerInitGroup.registerValue({
  field: "networkLayer",
  eagerInit: true,
  create: () => {
    const network = new NetworkLayer(getId());
    network.ensureInit();
    async function initListener() {
      let connected = false;
      while (true) {
        const update = await network.statusChannel.pop();
        switch (update.type) {
          case "peerStatus": {
            switch (update.status) {
              case "connected":
                if (!connected) {
                  toast.success("Connected!", { id: update.type });
                  toast.dismiss("peerError");
                  connected = true;
                }
                break;
              case "connecting":
                if (!connected) {
                  toast.loading("Connecting...", { id: update.type });
                }
                break;
              case "disconnected":
                if (connected) {
                  toast.error("Disconnected!", { id: update.type });
                  connected = false;
                }
                break;
            }

            break;
          }

          case "peerError":
            toast.error(`Peer Error: ${update.errorType}`, { id: update.type });
            connected = false;
            break;

          case "peerConnected":
            usePeers.getState().cb.addPeer(update.peer);
            break;

          case "peerDisconnected":
            // TODO: Set this up with more info about peers
            break;

          case "connInfo":
            // TODO: Set this up with more info about peers
            toast.error(`connInfo ${JSON.stringify(update)}`);
            break;

          default:
            toast(`Unrecognized update=${JSON.stringify(update)}`);
        }
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
      storage: ZustandIdbStorage,
      skipHydration: true,
      partialize: ({ cb, ...rest }) => ({ ...rest }),
    },
  ),
);

GlobalInitGroup.registerValue({
  field: "usePeers",
  eagerInit: true,
  create: () => {
    // Manually call rehydrate on startup to work around SSR nonsense
    // in Next.js
    usePeers.persist.rehydrate();

    return usePeers;
  },
});
