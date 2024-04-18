import toast from "react-hot-toast";
import { z } from "zod";
import { NetworkLayer } from "@a1liu/webb-ui-shared/network";
import { getId } from "@a1liu/webb-ui-shared/util";
import { InitGroup } from "./constants";

export const NetworkInitGroup = new InitGroup("network");

export const getNetworkLayerGlobal = NetworkInitGroup.registerValue({
  field: "networkLayer",
  eagerInit: true,
  create: () => {
    const network = new NetworkLayer(getId());
    network.ensureInit();

    return network;
  },
});

export function registerRpc<In extends z.ZodSchema, Out extends z.ZodSchema>({
  funcName,
  rpc,
  group,
  input,
  output,
}: {
  funcName: string;
  group: InitGroup;
  input: In;
  output: Out;
  rpc: (peerId: string, i: z.infer<In>) => AsyncGenerator<z.infer<Out>>;
}): { call: (peerId: string, i: z.infer<In>) => AsyncGenerator<z.infer<Out>> } {
  const field = `rpc-${funcName}`;

  const getValue = group.registerValue({
    field,
    eagerInit: true,
    create: () => {
      async function task() {
        const network = getNetworkLayerGlobal();
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
            console.error(`Failed during RPC: ${field}`, error);
            toast.error(`Failed during RPC: ${field}`);
          }
        }
      }

      // Kickoff task
      task();

      // Call
      return async function* (peerId: string, data: In): AsyncGenerator<Out> {
        const network = getNetworkLayerGlobal();

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
      };
    },
  });

  return {
    call: (peerId: string, i: In): AsyncGenerator<Out> => {
      const rpcValue = getValue();
      return rpcValue(peerId, i);
    },
  };
}
