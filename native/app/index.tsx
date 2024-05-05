import { GlobalWrapper } from "@/components/GlobalWrapper";
import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./globals.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <div>Hello world!</div>,
  },
]);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GlobalWrapper>
      <RouterProvider router={router} />
 </GlobalWrapper>
  </React.StrictMode>
);
