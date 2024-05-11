import React from "react";
import { TopbarLayout } from "@/components/TopbarLayout";
import { v4 as uuid } from "uuid";
import { NoteData, useNotesState } from "@/components/state/notes";
import { usePlatform } from "@/components/hooks/usePlatform";
import clsx from "clsx";
import { DefaultTimeFormatter } from "@/components/util";
import { NoteEditor } from "./active/NoteEditor";
import { useRequest } from "ahooks";
import { usePermissionCache } from "@/components/state/permissions";
import { useUserProfile } from "@/components/state/userProfile";
import { useDeviceProfile } from "@/components/state/deviceProfile";
import { useNavigate } from "react-router-dom";

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
        resourceId: [note.folder, noteId],
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

const desktopBoxStyles = "w-48 flex-shrink-0 border-r-2 border-slate-500";
function SelectActiveNote() {
  const notes = useNotesState((s) => s.notes);
  const { isMobile } = usePlatform();
  const shownNotes = [...(notes ? notes?.values() : [])].filter(
    (note) => !note.isTombstone,
  );

  if (shownNotes.length === 0) {
    return (
      <div
        className={clsx("flex flex-col", "items-center justify-center", {
          [desktopBoxStyles]: !isMobile,
          "flex-grow": isMobile,
        })}
      >
        <h3>No Notes</h3>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "flex flex-col",
        "gap-2 overflow-y-scroll scrollbar-hidden p-1",
        { [desktopBoxStyles]: !isMobile, "flex-grow": isMobile },
      )}
    >
      {shownNotes.reverse().map((note) => (
        <ActiveNoteButton key={note.id} note={note} />
      ))}
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
