import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { useRequest } from "ahooks";
import { ZodSchema, ZodTypeDef } from "zod";

export function useStream<T>({
  streamId,
  messageSchema,
  onMessage,
  refreshDeps,
}: {
  streamId: string;
  messageSchema: ZodSchema<T, ZodTypeDef, unknown>;
  onMessage: (t: T) => void;
  refreshDeps: unknown[];
}) {
  const listenerRef = useRef(onMessage);

  const { data: unlisten } = useRequest(
    async () => {
      const unlisten = await listen(streamId, (event) => {
        const t = messageSchema.safeParse(event.payload);
        if (!t.success) {
          throw new Error("Failed to make request");
        }

        listenerRef.current(t.data);
      });
      return unlisten;
    },
    { refreshDeps: [streamId, ...refreshDeps] },
  );

  // TODO: make this actually synchronize before proceeding, so that there's no
  // dropped messages

  useEffect(() => {
    listenerRef.current = onMessage;
    return unlisten;
  }, [unlisten]);
}
