import { GlobalWrapper } from "@/components/GlobalWrapper";
import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./globals.css";
import Index from "./page";
import { lazy } from "react";

const Notes = lazy(() => import("./notes/page"));
const ActiveNote = lazy(() => import("./notes/active/page"));
const Settings = lazy(() => import("./settings/page"));

const router = createBrowserRouter([
  {
    path: "/",
    element: <Index />,
  },
  {
    path: "/notes",
    element: <Notes />,
  },
  {
    path: "/notes/active",
    element: <ActiveNote />,
  },
  {
    path: "/settings",
    element: <Settings />,
  },
]);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GlobalWrapper>
      <Suspense fallback={<div className="h-full w-full bg-black" />}>
        <RouterProvider router={router} />
      </Suspense>
    </GlobalWrapper>
  </React.StrictMode>,
);
