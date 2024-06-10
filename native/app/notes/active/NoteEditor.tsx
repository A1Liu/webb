import React, { useEffect, useRef, useState } from "react";
import {
  NoteData,
  useActiveNote,
  useNoteMetadata,
  useNotesState,
} from "@/components/state/notes";
import { useLockFn, useRequest } from "ahooks";
import {
  NoteContentStoreProvider,
  NoteDocData,
  updateNoteDocAsync,
  useNoteContents,
} from "@/components/state/noteContents";
import { NoteDataFetch, SyncNotesButton } from "./SyncNotesButton";
import { usePeers } from "@/components/state/peers";
import toast from "react-hot-toast";
import { base64ToBytes, getFirstSuccess } from "@/components/util";
import {
  AskPermission,
  usePermissionCache,
} from "@/components/state/permissions";
import { useUserProfile } from "@/components/state/userProfile";
import { useDeviceProfile } from "@/components/state/deviceProfile";
import { getNetworkLayerGlobal } from "@/components/network";
import { useNavigate } from "react-router-dom";
import * as automerge from "@automerge/automerge";
import CodeMirror, {
  BasicSetupOptions,
  EditorView,
  oneDark,
  ReactCodeMirrorRef,
  ViewUpdate,
} from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import clsx from "clsx";
import { MatchPerms, PermissionResult } from "@/components/permissions";
import { Button } from "@/components/design-system/Button";
import { hyperLink } from "@uiw/codemirror-extensions-hyper-link";
import { Floating } from "@/components/design-system/Hover";
import { isEqual } from "lodash";

export const dynamic = "force-static";

function FolderPicker({
  id,
  initialPath,
  close,
}: {
  id: string;
  initialPath: string[];
  close: () => void;
}) {
  const [path, setPath] = useState<string[]>(initialPath);
  const notes = useNotesState((s) => s.notes);
  const cb = useNotesState((s) => s.cb);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [folderName, setFolderName] = useState("");

  const [, shownFolders] = [...(notes ? notes?.values() : [])]
    .filter((note) => !note.isTombstone)
    .reduce(
      ([notes, folders], note) => {
        if (!isEqual(note.folder.slice(0, path.length), path))
          return [notes, folders];

        if (note.folder.length === path.length) {
          return [[...notes, note], folders];
        }

        const candidateFolder = note.folder[path.length];
        if (!candidateFolder) {
          return [notes, folders];
        }

        folders.add(candidateFolder);

        return [notes, folders];
      },
      [[], new Set<string>()] as [NoteData[], Set<string>],
    );

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  return (
    <>
      <div className="flex flex-wrap min-w-[24rem] gap-0.5 items-center">
        <Button
          size="caption"
          color="text"
          onClick={() => {
            setPath([]);
          }}
        >
          🏠
        </Button>

        {path.flatMap((s, index) => [
          <div key={`div-${index}-${s}`} className="text-xs p-0.5">
            &gt;
          </div>,

          <Button
            key={`${index}-${s}`}
            size="caption"
            color="text"
            onClick={() => {
              setPath(path.slice(0, index + 1));
            }}
          >
            {s}
          </Button>,
        ])}

        <input
          ref={inputRef}
          type="text"
          className={clsx(
            "bg-black border border-slate-200 p-2 text-xs",
            !isEditing && "hidden",
          )}
          value={folderName}
          onChange={(evt) => {
            setFolderName(evt.target.value);
          }}
          onKeyDown={(evt) => {
            if (evt.code === "Escape") {
              evt.preventDefault();
              evt.stopPropagation();
              setIsEditing(false);
              return;
            }
            if (evt.code !== "Enter") return;

            setIsEditing(false);
            setPath([...path, folderName]);
            setFolderName("");
          }}
        />

        {!isEditing ? (
          <Button
            size="caption"
            onClick={() => {
              setIsEditing(true);
            }}
          >
            +
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col overflow-y-scroll scrollbar-hidden max-h-[32rem]">
        {[...shownFolders].map((s, index) => {
          return (
            <Button
              key={`${index}-${s}`}
              color="text"
              size="xs"
              onClick={() => {
                setPath([...path, s]);
              }}
            >
              {s}
            </Button>
          );
        })}{" "}
      </div>

      <Button
        onClick={() => {
          close();
          cb.updateNote(id, (prev) => ({
            ...prev,
            folder: path,
          }));
        }}
      >
        Move
      </Button>
    </>
  );
}

function MoveNoteButton() {
  const { id, folder } = useActiveNote();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Floating
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      floatWrapperProps={{
        className: "flex flex-col p-2 gap-2 border border-slate-300 bg-black",
      }}
      floatingContent={
        <FolderPicker
          id={id}
          initialPath={folder}
          close={() => setIsOpen(false)}
        />
      }
    >
      <Button size="xs">Move</Button>
    </Floating>
  );
}

function ReconnectButton() {
  const { connected } = usePeers();

  if (connected) return null;

  return (
    <Button
      size="xs"
      onClick={async () => {
        const network = await getNetworkLayerGlobal();
        network.ensureInit();
      }}
    >
      Reconnect
    </Button>
  );
}

const FontSizeTheme = EditorView.theme({
  "&": {
    fontSize: "16px",
    color: "white",
    backgroundColor: "#000000",
  },
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
  hyperLink,
  FontSizeTheme,
  oneDark,
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
      theme={"none"}
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

async function requestKeyForNote(note: NoteData) {
  const toastId = toast.loading(`Requesting perms...`);

  const { peers } = usePeers.getState();
  const firstResult = await getFirstSuccess(
    [...peers.values()].map(async (peer) => {
      const result = AskPermission.call(peer.id, {
        action: {
          actionId: [MatchPerms.exact("updateNote")],
          resourceId: [
            ...note.folder.map((folder) => MatchPerms.exact(folder)),
            MatchPerms.exact(note.id),
          ],
        },
      });
      for await (const { permission } of result) {
        return { peerId: peer.id, permission };
      }

      throw new Error(``);
    }),
  );

  if (!firstResult.success) {
    toast.error(`Couldn't fetch key to unlock file`, { id: toastId });
    return false;
  }

  const { permission, peerId } = firstResult.value;
  const { userProfile } = useUserProfile.getState();
  const { deviceProfile } = useDeviceProfile.getState();
  if (!userProfile) {
    toast.error("Missing user profile", { id: toastId });
    return;
  }

  const { cb } = usePermissionCache.getState();
  const permResult = await cb.verifyPermissions(
    permission,
    {
      userId: userProfile?.id ?? "",
      deviceId: deviceProfile?.id ?? "",
      actionId: ["updateNote"],
      resourceId: [...note.folder, note.id],
    },
    userProfile,
  );
  if (permResult !== PermissionResult.Allow) {
    toast.error(`Received insufficient permissions ${permResult}`, {
      id: toastId,
    });
    return;
  }

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

function useNoteKeyRequest(note: NoteData): {
  loading: boolean;
  requestKey: () => Promise<boolean | undefined>;
} {
  const { loading, runAsync: requestKey } = useRequest(
    async () => {
      const { userProfile } = useUserProfile.getState();
      const { deviceProfile } = useDeviceProfile.getState();
      if (!userProfile || !deviceProfile) return false;

      const { cb: permsCb } = usePermissionCache.getState();
      const perm = permsCb.findPermission({
        deviceId: deviceProfile.id,
        userId: userProfile.id,
        actionId: ["updateNote"],
        resourceId: [...note.folder, note.id],
      });
      if (perm) return true;

      await requestKeyForNote(note);
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
  const { permissionCache, cb: permsCb } = usePermissionCache();
  const note = useNoteMetadata(noteId);
  const {
    data: hasAuth,
    loading,
    refresh,
  } = useRequest(
    async () => {
      if (!userProfile || !deviceProfile) return false;
      const perm = permsCb.findPermission({
        deviceId: deviceProfile.id,
        userId: userProfile.id,
        actionId: ["updateNote"],
        resourceId: [...note.folder, noteId],
      });
      if (perm) return true;

      return false;
    },
    {
      refreshDeps: [note, userProfile, deviceProfile, permissionCache],
    },
  );
  const { loading: requestKeyLoading, requestKey } = useNoteKeyRequest(note);
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
        <MoveNoteButton />
      </div>

      {!hasAuth ? (
        <div className="flex flex-col gap-2 grow items-center justify-center">
          <p className="text-lg">~~ LOCKED ~~</p>

          <div className="flex gap-2">
            <Button disabled={requestKeyLoading} onClick={() => navigate(-1)}>
              Go back
            </Button>

            <Button
              disabled={requestKeyLoading}
              onClick={() => requestKey().then(() => refresh())}
            >
              Request Key
            </Button>
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
