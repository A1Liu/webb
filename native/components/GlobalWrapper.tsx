"use client";

import { Toaster } from "react-hot-toast";
import clsx from "clsx";
import Head from "next/head";
import { useEffect } from "react";
import { GlobalInitGroup } from "./constants";
import { AppStateKind, useGlobals } from "./state/appGlobals";
import { NotesSyncInitGroup } from "./state/notes";

export function GlobalWrapper({ children }: { children: React.ReactNode }) {
  const {
    state: { kind },
  } = useGlobals();

  useEffect(() => {
    GlobalInitGroup.init();
    NotesSyncInitGroup.init();
  }, []);

  return (
    <div className="h-full w-full">
      <Head>
        <meta name="theme-color" content="#39ff14" />
      </Head>

      <div
        className={clsx(
          "h-full w-full",
          kind === AppStateKind.BackgroundFlow && "hidden",
        )}
      >
        {children}
      </div>

      <Toaster position="bottom-left" />
    </div>
  );
}