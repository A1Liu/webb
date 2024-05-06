import { Toaster } from "react-hot-toast";
import clsx from "clsx";
import { useEffect } from "react";
import { GlobalInitGroup } from "./constants";
import { AppStateKind, useGlobals } from "./state/appGlobals";
import { NotesSyncInitGroup } from "./state/notes";
import { PeerInitGroup } from "./state/peers";
import { NetworkInitGroup } from "./network";
import { buttonClass } from "./TopbarLayout";
import { useRequest } from "ahooks";
import { automergePackage } from "./state/noteContents";

export function GlobalWrapper({ children }: { children: React.ReactNode }) {
  const { state } = useGlobals();
  const { loading: automergeLoading } = useRequest(
    () => automergePackage.promise,
  );

  useEffect(() => {
    GlobalInitGroup.init();
    NetworkInitGroup.init();
    PeerInitGroup.init();
    NotesSyncInitGroup.init();
  }, []);

  if (automergeLoading) {
    return null;
  }

  return (
    <div className="h-full w-full">
      {state.kind === AppStateKind.PermissionFlow ? (
        <div
          className="fixed top-0 bottom-0 left-0 right-0 flex items-center
        justify-center bg-opacity-30 bg-slate-500 z-50 p-4"
        >
          <div className="p-4 flex flex-col gap-2 bg-black border border-white rounded-md text-white">
            <h3 className="font-bold text-lg">{state.title}</h3>

            <pre className="text-sm break-words text-wrap">
              {state.description}
            </pre>

            <div className="flex gap-2">
              {state.options.map((value) => (
                <button
                  key={value}
                  className={buttonClass}
                  onClick={() => state.completion(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : undefined}

      <div
        className={clsx(
          "h-full w-full",
          state.kind === AppStateKind.BackgroundFlow && "hidden",
        )}
      >
        {children}
      </div>

      <Toaster position="bottom-left" />
    </div>
  );
}
