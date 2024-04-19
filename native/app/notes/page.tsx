"use client";

import React from "react";
import { TopbarLayout } from "@/components/TopbarLayout";
import { v4 as uuid } from "uuid";
import { useNotesState } from "@/components/state/notes";
import { usePlatform } from "@/components/hooks/usePlatform";
import { ActiveNote } from "./active/ActiveNote";
import clsx from "clsx";
import { DefaultTimeFormatter } from "@/components/util";
import { useRouter } from "next/navigation";
import { useUserProfile } from "@/components/state/userProfile";

export const dynamic = "force-static";

function SelectActiveNote() {
  const { notes, activeNote, cb } = useNotesState();
  const { isMobile } = usePlatform();
  const hasAuth = useUserProfile((s) => !!s.userProfile?.secret);
  const router = useRouter();

  return (
    <div
      className={clsx(
        "flex flex-col gap-2 overflow-y-scroll",
        isMobile && "flex-grow",
      )}
    >
      {[...(notes ? notes?.values() : [])]
        .reverse()
        .filter((note) => !note.isTombstone)
        .map((note) => {
          return (
            <button
              key={note.id}
              className={clsx(
                activeNote === note.id && !isMobile
                  ? "bg-yellow-700"
                  : "bg-slate-700",
                "disabled:bg-slate-900",
                "text-white rounded-md p-6 flex flex-col gap-2",
              )}
              disabled={!hasAuth && !!note.base64EncryptionIvParam}
              onClick={() => {
                cb.setActiveNote(note.id);
                if (isMobile) {
                  router.push("/notes/active");
                }
              }}
            >
              <p>
                {note.merges ? "*" : ""}
                {note.preview}
              </p>

              <p>{DefaultTimeFormatter.format(note.lastUpdateDate)}</p>
            </button>
          );
        })}
    </div>
  );
}

export default function Notes() {
  const { isMobile } = usePlatform();
  const cb = useNotesState((s) => s.cb);
  const router = useRouter();

  return (
    <TopbarLayout
      title={"Notes"}
      buttons={[
        {
          type: "button",
          text: "New Note",
          onClick: () => {
            cb.setActiveNote(uuid());
            if (isMobile) {
              router.push("/notes/active");
            }
          },
        },
        {
          type: "link",
          text: "Settings",
          href: "/settings",
        },
        {
          type: "button",
          text: "Refresh",
          onClick: () => window.location.reload(),
        },
      ]}
    >
      <div className="flex h-full w-full gap-2 flex-grow justify-stretch">
        <SelectActiveNote />

        {!isMobile ? (
          <div className="flex flex-col gap-2 flex-grow">
            <ActiveNote />
          </div>
        ) : null}
      </div>
    </TopbarLayout>
  );
}
