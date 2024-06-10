import React, { useState } from "react";
import { TopbarLayout } from "@/components/TopbarLayout";
import { v4 as uuid } from "uuid";
import { NoteData, useNotesState } from "@/components/state/notes";
import { usePlatform } from "@/components/hooks/usePlatform";
import clsx from "clsx";
import { DefaultTimeFormatter } from "@/components/util";
import { NoteEditor } from "./active/NoteEditor";
import { useBoolean, useRequest } from "ahooks";
import { usePermissionCache } from "@/components/state/permissions";
import { useUserProfile } from "@/components/state/userProfile";
import { useDeviceProfile } from "@/components/state/deviceProfile";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/design-system/Button";
import { Floating } from "@/components/design-system/Hover";
import { isEqual } from "lodash";

export const dynamic = "force-static";

function ActiveNoteButton({ note }: { note: NoteData }) {
  const hideDisallowedFolders = useNotesState((s) => s.hideDisallowedFolders);
  const cb = useNotesState((s) => s.cb);
  const activeNote = useNotesState((s) => s.activeNote);
  const { isMobile } = usePlatform();
  const { id: noteId } = note;
  const navigate = useNavigate();

  const { userProfile } = useUserProfile();
  const { deviceProfile } = useDeviceProfile();
  const { permissionCache, cb: permsCb } = usePermissionCache();

  const { data: hasAuth, loading } = useRequest(
    async () => {
      if (!userProfile || !deviceProfile) return false;
      const perm = permsCb.findPermission({
        deviceId: deviceProfile.id,
        userId: userProfile.id,
        actionId: ["updateNote"],
        resourceId: [...note.folder, noteId],
      });

      if (!perm) return false;

      return true;
    },
    {
      refreshDeps: [noteId, userProfile, deviceProfile, permissionCache],
    },
  );

  return (
    <button
      className={clsx(
        {
          hidden: !hasAuth && hideDisallowedFolders,
          "bg-slate-900": !hasAuth,
          "bg-yellow-700": hasAuth && activeNote === note.id,
          "bg-slate-700": hasAuth && activeNote !== note.id,
        },
        !hasAuth
          ? "bg-slate-900"
          : activeNote === note.id && !isMobile
          ? "bg-yellow-700"
          : "bg-slate-700",
        "text-white disabled:bg-slate-900",
        "rounded-md px-3 py-2",
        "flex flex-col items-start gap-1",
      )}
      disabled={loading}
      onClick={() => {
        cb.setActiveNote(note.id);
        if (isMobile) {
          navigate("/notes/active");
        }
      }}
    >
      <p className="text-ellipsis overflow-hidden text-left whitespace-nowrap w-full">
        {note.preview}
      </p>

      <p>{DefaultTimeFormatter.format(note.lastUpdateDate)}</p>
    </button>
  );
}

function Breadcrumbs() {
  const path = useNotesState((s) => s.currentFolder);
  const cb = useNotesState((s) => s.cb);
  const { isMobile } = usePlatform();
  const navigate = useNavigate();

  const [isEditing, { set: setIsEditing, setFalse: close }] = useBoolean(false);
  const [folderName, setFolderName] = useState("");

  return (
    <div className={clsx("flex flex-wrap p-1 gap-0.5 items-center")}>
      <Button
        key="/"
        size="xs"
        color="text"
        onClick={() => {
          cb.setCurrentFolder([]);
        }}
      >
        🏠
      </Button>

      {path.flatMap((s, index) => [
        <div key={`div-${index}-${s}`} className="text-xs p-0.5">
          &gt;
        </div>,

        <Button
          key={`merp-${index}-${s}`}
          size="caption"
          color="text"
          onClick={() => {
            cb.setCurrentFolder(path.slice(0, index + 1));
          }}
        >
          {s}
        </Button>,
      ])}

      <div key="div-/" />

      <Floating
        isOpen={isEditing}
        setIsOpen={setIsEditing}
        allowHover={false}
        floatWrapperProps={{
          className: "border border-slate-200 bg-black p-2 z-10 flex gap-2",
        }}
        floatingContent={
          <>
            <input
              type="text"
              className="bg-black border border-slate-200 p-2"
              value={folderName}
              onChange={(evt) => {
                setFolderName(evt.target.value);
              }}
            />

            <Button
              disabled={!folderName}
              onClick={() => {
                cb.setCurrentFolder([...path, folderName]);
                close();

                cb.setActiveNote(uuid());
                if (isMobile) {
                  navigate("/notes/active");
                }
              }}
            >
              Create
            </Button>
          </>
        }
      >
        <Button
          size="caption"
          onClick={() => {
            setFolderName("");
          }}
        >
          +
        </Button>
      </Floating>
    </div>
  );
}

const desktopBoxStyles = "w-48 flex-shrink-0 border-r-2 border-slate-500";
function SelectActiveNote() {
  const notes = useNotesState((s) => s.notes);
  const path = useNotesState((s) => s.currentFolder);
  const { isMobile } = usePlatform();
  const cb = useNotesState((s) => s.cb);
  const navigate = useNavigate();

  const [shownNotes, shownFolders] = [...(notes ? notes?.values() : [])]
    .filter((note) => !note.isTombstone)
    .reduce(
      ([notes, folders], note) => {
        if (!isEqual(note.folder.slice(0, path.length), path))
          return [notes, folders];

        if (note.folder.length === path.length) {
          if (!isEqual(note.folder, path)) return [notes, folders];
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

  // TODO: Need to make this handle files which are hidden when un-authed
  const visibleItems = shownNotes.length + shownFolders.size;

  return (
    <div
      className={clsx("flex flex-col", {
        [desktopBoxStyles]: !isMobile,
        "flex-grow": isMobile,
      })}
    >
      <Breadcrumbs />

      <div className="flex flex-row justify-between p-1 gap-1">
        <Button
          size="xs"
          className="flex-grow"
          onClick={() => {
            cb.setActiveNote(uuid());
            if (isMobile) {
              navigate("/notes/active");
            }
          }}
        >
          + New Note
        </Button>
      </div>

      <div
        className={clsx("flex flex-col", "gap-2 p-1 flex-grow", {
          ["overflow-y-scroll scrollbar-hidden"]: visibleItems > 0,
          ["items-center justify-center"]: visibleItems === 0,
        })}
      >
        {visibleItems === 0 ? <h3>No Notes</h3> : null}

        {[...shownFolders].map((s, index) => {
          return (
            <Button
              key={`${index}-${s}`}
              color="text"
              onClick={() => {
                cb.setCurrentFolder([...path, s]);
              }}
            >
              {s}
            </Button>
          );
        })}

        {shownNotes.reverse().map((note) => (
          <ActiveNoteButton key={note.id} note={note} />
        ))}
      </div>
    </div>
  );
}

export default function Notes() {
  const { isMobile } = usePlatform();
  const activeNote = useNotesState((s) => s.activeNote);
  const cb = useNotesState((s) => s.cb);
  const navigate = useNavigate();

  return (
    <TopbarLayout
      title={"Notes"}
      buttons={[
        {
          type: "button",
          text: "+ Create",
          onClick: () => {
            cb.setActiveNote(uuid());
            if (isMobile) {
              navigate("/notes/active");
            }
          },
        },
        {
          type: "link",
          text: "⚙️ ",
          href: "/settings",
        },
        {
          type: "button",
          text: "😵",
          onClick: () => window.location.reload(),
        },
      ]}
    >
      <div className="flex h-full w-full flex-grow justify-stretch">
        <SelectActiveNote />

        {!isMobile ? (
          <div className="flex flex-col gap-2 justify-stretch flex-grow">
            <NoteEditor noteId={activeNote} />
          </div>
        ) : null}
      </div>
    </TopbarLayout>
  );
}
