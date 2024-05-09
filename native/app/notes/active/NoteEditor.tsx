import React, { useRef } from "react";
import { useNotesState } from "@/components/state/notes";
import { useLockFn, useRequest } from "ahooks";
import {
  NoteContentStoreProvider,
  NoteDocData,
  updateNoteDocAsync,
  useNoteContents,
} from "@/components/state/noteContents";
import { NoteDataFetch, SyncNotesButton } from "./SyncNotesButton";
import { buttonClass } from "@/components/TopbarLayout";
import { usePeers } from "@/components/state/peers";
import toast from "react-hot-toast";
import { base64ToBytes, getFirstSuccess } from "@/components/util";
import {
  AskPermission,
  usePermissionCache,
} from "@/components/state/permissions";
import { useUserProfile } from "@/components/state/userProfile";
import { useDeviceProfile } from "@/components/state/deviceProfile";
import { PermissionsManager } from "@/components/permissions";
import { getNetworkLayerGlobal } from "@/components/network";
import { useNavigate } from "react-router-dom";
import * as automerge from "@automerge/automerge";
import CodeMirror, {
  BasicSetupOptions,
  EditorView,
  ReactCodeMirrorRef,
  ViewUpdate,
} from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import clsx from "clsx";

export const dynamic = "force-static";

function ReconnectButton() {
  const { connected } = usePeers();

  if (connected) return null;

  return (
    <button
      className={buttonClass}
      onClick={async () => {
        const network = await getNetworkLayerGlobal();
        network.ensureInit();
      }}
    >
      Reconnect
    </button>
  );
}

const FontSizeTheme = EditorView.theme({
  "&": { fontSize: "16px" },
  "& *": { fontFamily: "sans-serif" },
  ".cm-content .ͼv": { wordBreak: "break-all" },
});

const EditorBasicSetup: BasicSetupOptions = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
};
const EditorExtensions = [
  EditorView.lineWrapping,
  markdown({ base: markdownLanguage, codeLanguages: [] }),
  FontSizeTheme,
];

function createOnChangeHandler(
  noteId: string,
  changeDoc: (updater: (d: NoteDocData) => void) => void,
) {
  const { cb } = useNotesState.getState();
  return (text: string, update: ViewUpdate) => {
    const transactions = update.transactions.filter((t) => !t.changes.empty);
    if (transactions.length === 0) return;

    changeDoc((d) => {
      transactions.forEach((t) => {
        t.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
          d.contents.deleteAt(fromA, toA - fromA);
          d.contents.insertAt(fromA, ...inserted);
        });
      });
    });
    cb.updateNote(
      noteId,
      (prev) => ({
        ...prev,
        lastUpdateDate: new Date(),
        preview: text.split("\n", 1)[0].slice(0, 20),
      }),
      true,
    );
  };
}

function NoteContentEditor() {
  const { noteId, doc, hydrationPromise } = useNoteContents((s) => s);
  const { changeDoc } = useNoteContents((s) => s.actions);
  const editorRef = useRef<ReactCodeMirrorRef>({});
  const { loading } = useRequest(() => hydrationPromise.promise, {
    refreshDeps: [hydrationPromise],
  });

  if (loading) {
    return (
      <div className="flex justify-stretch relative flex-grow">
        <div className="flex grow items-center justify-center">
          <p className="text-lg font-bold">LOADING</p>
        </div>
      </div>
    );
  }

  return (
    <CodeMirror
      key={noteId}
      ref={editorRef}
      theme={"dark"}
      value={doc.contents.toString()}
      height={"100%"}
      width={"100%"}
      className="flex-grow"
      basicSetup={EditorBasicSetup}
      onChange={createOnChangeHandler(noteId, changeDoc)}
      extensions={EditorExtensions}
    />
  );
}

async function requestKeyForNote(noteId: string) {
  const toastId = toast.loading(`Requesting perms...`);

  const { peers } = usePeers.getState();
  const firstResult = await getFirstSuccess(
    [...peers.values()].map(async (peer) => {
      // cheating here to always get the first successful result
      // if one exists
      if (!noteId) throw new Error(``);
      const result = AskPermission.call(peer.id, {
        action: {
          actionId: [{ __typename: "Exact", value: "updateNote" }],
          resourceId: [{ __typename: "Exact", value: noteId }],
        },
      });
      for await (const { permission } of result) {
        return { peerId: peer.id, permission };
      }

      throw new Error(``);
    }),
  );

  if (!firstResult.success) {
    toast.error(`Couldn't fetch key to unlock file`, {
      id: toastId,
    });
    return false;
  }

  const { permission, peerId } = firstResult.value;

  const { permissionCache, cb } = usePermissionCache.getState();
  permissionCache.set(permission.cert.signature, permission);
  cb.updateCache(permissionCache);

  toast.success(`Successfully added permission!`);
  toast.loading(`Fetching latest data...`, {
    id: toastId,
  });

  const { notes } = useNotesState.getState();

  let count = 0;
  for (const note of notes.values()) {
    const dataFetchResult = NoteDataFetch.call(peerId, {
      noteId: note.id,
      permission,
    });

    for await (const { noteId, textData } of dataFetchResult) {
      const doc = automerge.load<NoteDocData>(
        new Uint8Array(base64ToBytes(textData)),
      );

      await updateNoteDocAsync(noteId, doc);

      toast.loading(`Fetching latest data... (${++count})`, {
        id: toastId,
      });
    }
  }

  toast.success(`Fetched and unlocked note!`, {
    id: toastId,
  });
}

function useNoteKeyRequest(noteId: string): {
  loading: boolean;
  requestKey: () => Promise<boolean | undefined>;
} {
  const { loading, runAsync: requestKey } = useRequest(
    async () => {
      const { userProfile } = useUserProfile.getState();
      const { deviceProfile } = useDeviceProfile.getState();
      if (!userProfile || !deviceProfile) return false;

      const { permissionCache } = usePermissionCache.getState();
      const permissions = new PermissionsManager(
        deviceProfile.id,
        userProfile?.publicAuthUserId,
        permissionCache,
      );
      const perm = permissions.findMyPermission({
        actionId: ["updateNote"],
        resourceId: [noteId],
      });

      if (perm) return true;

      await requestKeyForNote(noteId);
      return true;
    },
    {
      manual: true,
    },
  );

  const requestKeyHandler = useLockFn(requestKey);

  return {
    loading,
    requestKey: requestKeyHandler,
  };
}

export function NoteEditor({ noteId }: { noteId: string }) {
  const { userProfile } = useUserProfile();
  const { deviceProfile } = useDeviceProfile();
  const { permissionCache } = usePermissionCache();
  const {
    data: hasAuth,
    loading,
    refresh,
  } = useRequest(
    async () => {
      if (!userProfile || !deviceProfile) return false;

      const permissions = new PermissionsManager(
        deviceProfile.id,
        userProfile?.publicAuthUserId,
        permissionCache,
      );
      const perm = permissions.findMyPermission({
        actionId: ["updateNote"],
        resourceId: [noteId],
      });

      if (perm) return true;

      return false;
    },
    {
      refreshDeps: [noteId, userProfile, deviceProfile, permissionCache],
    },
  );
  const { loading: requestKeyLoading, requestKey } = useNoteKeyRequest(noteId);
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex justify-stretch relative flex-grow">
        <div className="flex grow items-center justify-center">
          <p className="text-lg font-bold">LOADING</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "flex justify-stretch items-stretch relative flex-grow",
        hasAuth && "overflow-hidden",
      )}
    >
      <div className="absolute top-2 right-5 flex flex-col gap-2 items-end z-10">
        <SyncNotesButton />
        <ReconnectButton />
      </div>

      {!hasAuth ? (
        <div className="flex flex-col gap-2 grow items-center justify-center">
          <p className="text-lg">~~ LOCKED ~~</p>

          <div className="flex gap-2">
            <button
              className={buttonClass}
              disabled={requestKeyLoading}
              onClick={() => navigate(-1)}
            >
              Go back
            </button>

            <button
              className={buttonClass}
              disabled={requestKeyLoading}
              onClick={() => requestKey().then(() => refresh())}
            >
              Request Key
            </button>
          </div>
        </div>
      ) : (
        <NoteContentStoreProvider noteId={noteId}>
          <NoteContentEditor />
        </NoteContentStoreProvider>
      )}
    </div>
  );
}
