import toast from "react-hot-toast";
import { z, ZodTypeDef } from "zod";
import { NetworkLayer, RpcDefinition } from "@a1liu/webb-tools/network";
import { PeerjsDriver } from "@a1liu/webb-peerjs-driver";
import { InitGroup } from "./constants";
import { v4 as uuid } from "uuid";
import {
  DeviceProfileHydration,
  useDeviceProfile,
} from "./state/deviceProfile";

export const NetworkInitGroup = new InitGroup("network");

export const getPeerjsDriverGlobal = NetworkInitGroup.registerValue({
  field: "peerjsDriver",
  eagerInit: true,
  create: async () => {
    const networkLayer = await getNetworkLayerGlobal();
    const driver = networkLayer.addConnectionDefinition(PeerjsDriver);
    driver.ensureInit();

    return driver;
  },
});

export const getNetworkLayerGlobal = NetworkInitGroup.registerValue({
  field: "networkLayer",
  eagerInit: true,
  create: async () => {
    await DeviceProfileHydration.promise;

    const id = useDeviceProfile.getState().deviceProfile?.id;
    if (!id) {
      // TODO: simplify this
      throw new Error("WTF Device Profile should be available at this point");
    }

    const network = new NetworkLayer({ deviceId: id });

    return network;
  },
});

interface RpcHandler<In, Out> {
  name: string;
  call: (peerId: string, i: In) => AsyncGenerator<Out>;
}

export function registerRpcHandler<In, Out>({
  group,
  rpc,
  handler,
}: {
  group: InitGroup;
  rpc: RpcDefinition<In, Out>;
  handler: (peerId: string, i: In) => AsyncGenerator<Out>;
}): RpcHandler<In, Out> {
  const name = rpc.name;
  const getValue = group.registerValue({
    field: name,
    eagerInit: true,
    create: () => {
      async function task() {
        const network = await getNetworkLayerGlobal();
        while (true) {
          try {
            await rpc.singleExec(network, async function* (peerId, result) {
              if (!result.success) {
                toast.error(
                  `${name} had invalid input: ${JSON.stringify(result.error)}`,
                );
                return;
              }
              yield* handler(peerId, result.data);
            });
          } catch (error) {
            console.error(`Failed running RPC: ${name}`, error);
            toast.error(`Failed running RPC: ${name} ${error}`);
          }
        }
      }

      // Kickoff task
      task();

      // Call
      return async function* (peerId: string, data: In): AsyncGenerator<Out> {
        try {
          const network = await getNetworkLayerGlobal();

          for await (const result of rpc.call(network, peerId, data)) {
            if (!result.success) {
              toast.error(
                `${name} had invalid output: ${JSON.stringify(result.error)}`,
              );
              return;
            }

            yield result.data;
          }
        } catch (error) {
          console.error(`Error calling RPC function: ${String(error)}`);
        }
      };
    },
  });

  return {
    name,
    call: (peerId: string, i: In): AsyncGenerator<Out> => {
      const rpcValue = getValue();
      return rpcValue(peerId, i);
    },
  };
}

interface Listener<T> {
  send: (peerId: string, data: T) => Promise<void>;
}

function createListener<T>({
  channel: userChannel,
  schema,
  listener,
}: {
  channel: string;
  schema: z.ZodSchema<T, ZodTypeDef, unknown>;
  listener: (peerId: string, t: T) => Promise<void>;
}): Listener<T> {
  const channel = `chan-${userChannel}`;

  async function task() {
    const network = await getNetworkLayerGlobal();

    while (true) {
      try {
        const chunk = await network.receive(channel);

        // TODO remove throw
        const result = schema.safeParse(chunk.data);
        if (!result.success) {
          toast.error(
            `channel ${userChannel} had invalid output: ${JSON.stringify(
              chunk,
            )}`,
          );
          throw new Error(
            `channel ${userChannel} had invalid output: ${JSON.stringify(
              chunk,
            )}`,
          );
        }

        await listener(chunk.sender, result.data);
      } catch (error) {
        console.error(`Failed in Listener: ${channel}`, error);
        toast.error(`Failed in Listener: ${channel}`);
      }
    }
  }

  task();

  return {
    send: async (peerId, data) => {
      const network = await getNetworkLayerGlobal();
      await network.send({
        receiver: peerId,
        port: channel,
        requestId: uuid(),
        data,
      });
    },
  };
}

export function registerListener<T>({
  group,
  channel: userChannel,
  schema,
  listener,
}: {
  group: InitGroup;
  channel: string;
  schema: z.ZodSchema<T, ZodTypeDef, unknown>;
  listener: (peerId: string, t: T) => Promise<void>;
}): Listener<T> {
  const getValue = group.registerValue({
    field: `chan-${userChannel}`,
    eagerInit: true,
    create: () => {
      return createListener({
        channel: userChannel,
        schema,
        listener,
      });
    },
  });

  return {
    send: async (peerId, data) => {
      const listener = getValue();
      listener.send(peerId, data);
    },
  };
}
