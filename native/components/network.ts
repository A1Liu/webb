import toast from "react-hot-toast";
import { z, ZodTypeDef } from "zod";
import { NetworkLayer } from "@a1liu/webb-ui-shared/network";
import { InitGroup } from "./constants";
import {
  DeviceProfileHydration,
  useDeviceProfile,
} from "./state/deviceProfile";

export const NetworkInitGroup = new InitGroup("network");

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
    const network = new NetworkLayer(id);
    network.ensureInit();

    return network;
  },
});

interface RpcHandler<In, Out> {
  name: string;
  call: (peerId: string, i: In) => AsyncGenerator<Out>;
}

export function registerRpc<In extends z.ZodSchema, Out extends z.ZodSchema>({
  name,
  rpc,
  group,
  input,
  output,
}: {
  name: string;
  group: InitGroup;
  input: In;
  output: Out;
  rpc: (peerId: string, i: z.infer<In>) => AsyncGenerator<z.infer<Out>>;
}): RpcHandler<z.infer<In>, z.infer<Out>> {
  const field = `rpc-${name}`;

  const getValue = group.registerValue({
    field,
    eagerInit: true,
    create: () => {
      async function task() {
        const network = await getNetworkLayerGlobal();
        while (true) {
          try {
            await network.rpcSingleExec(field, async function* (chunk) {
              const result = input.safeParse(chunk.data);
              if (!result.success) {
                toast.error(
                  `${field} had invalid input: ${JSON.stringify(chunk)}`,
                );
                return;
              }
              yield* rpc(chunk.peerId, result.data);
            });
          } catch (error) {
            console.error(`Failed running RPC: ${field}`, error);
            toast.error(`Failed running RPC: ${field} ${error}`);
          }
        }
      }

      // Kickoff task
      task();

      // Call
      return async function* (peerId: string, data: In): AsyncGenerator<Out> {
        try {
          const network = await getNetworkLayerGlobal();

          const dataFetchResult = network.rpcCall({
            peerId,
            channel: field,
            data: data,
          });

          for await (const chunk of dataFetchResult) {
            const result = output.safeParse(chunk.data);
            if (!result.success) {
              toast.error(
                `${field} had invalid output: ${JSON.stringify(chunk)}`,
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
        const chunk = await network.recv({ channel });

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

        await listener(chunk.peerId, result.data);
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
      await network.sendData({
        peerId,
        channel,
        ignorePeerIdForChannel: true,
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
