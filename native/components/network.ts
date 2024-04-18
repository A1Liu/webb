import toast from "react-hot-toast";
import { z } from "zod";
import { NetworkLayer } from "@a1liu/webb-ui-shared/network";
import { InitGroup } from "./constants";
import { useDeviceProfile } from "./state/deviceProfile";

export const NetworkInitGroup = new InitGroup("network");

export const getNetworkLayerGlobal = NetworkInitGroup.registerValue({
  field: "networkLayer",
  eagerInit: true,
  create: async () => {
    await useDeviceProfile.getState().hydrationPromise.promise;

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
                  `${field} had invalid input: ${JSON.stringify(chunk)}`
                );
                return;
              }
              yield* rpc(chunk.peerId, result.data);
            });
          } catch (error) {
            console.error(`Failed during RPC: ${field}`, error);
            toast.error(`Failed during RPC: ${field}`);
          }
        }
      }

      // Kickoff task
      task();

      // Call
      return async function* (peerId: string, data: In): AsyncGenerator<Out> {
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
              `${field} had invalid output: ${JSON.stringify(chunk)}`
            );
            return;
          }

          yield result.data;
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
