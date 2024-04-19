import { create } from "zustand";
import { PeerData } from "@a1liu/webb-ui-shared/network";
import { persist } from "zustand/middleware";
import { ZustandIdbStorage } from "../util";
import { InitGroup } from "../constants";
import { toast } from "react-hot-toast";
import { getNetworkLayerGlobal } from "../network";

export interface Peer extends PeerData {
  name?: string;
  connected?: boolean;
  lastConnected?: Date;
}

export const PeerInitGroup = new InitGroup("peers");

PeerInitGroup.registerInit("networkLayer", async () => {
  const network = await getNetworkLayerGlobal();
  const cb = usePeers.getState().cb;
  network.ensureInit();
  async function initListener() {
    let connected = false;
    while (true) {
      const update = await network.statusChannel.pop();
      switch (update.type) {
        case "networkStatus": {
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

        case "networkError":
          toast.error(`Peer Error: ${update.errorType}`, { id: update.type });
          connected = false;
          break;

        case "peerConnected":
          cb.updatePeer({
            ...update.peer,
            connected: true,
            lastConnected: new Date(),
          });
          break;

        case "peerDisconnected":
          // TODO: Set this up with more info about peers
          cb.updatePeer({ id: update.peerId, connected: false });
          break;

        case "connInfo":
          // TODO: Set this up with more info about peers
          // toast.error(`connInfo ${JSON.stringify(update)}`);
          break;

        default:
          toast(`Unrecognized update=${JSON.stringify(update)}`);
      }
    }
  }

  initListener();

  return network;
});

interface PeersState {
  peers: Map<string, Peer>;
  cb: {
    updatePeer: (peer: PeerData & Partial<Peer>) => void;
    deletePeer: (peerId: string) => void;
  };
}

export const usePeers = create<PeersState>()(
  persist(
    (set) => {
      return {
        deviceProfile: undefined,
        peers: new Map(),
        cb: {
          deletePeer: (peerId) => {
            set((prev) => {
              const peers = new Map(prev.peers);
              peers.delete(peerId);
              return { peers };
            });
          },
          updatePeer: (peer) => {
            set((prev) => {
              const peers = new Map(prev.peers);
              const prevPeer: Partial<Peer> = peers.get(peer.id) ?? {};
              peers.set(peer.id, { ...prevPeer, ...peer });

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
      partialize: ({ cb, ...rest }) => ({
        ...rest,
      }),
    },
  ),
);

PeerInitGroup.registerValue({
  field: "usePeers",
  eagerInit: true,
  create: () => {
    // Manually call rehydrate on startup to work around SSR nonsense
    // in Next.js
    usePeers.persist.rehydrate();

    return usePeers;
  },
});
