import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { Provider as JotaiProvider } from "jotai";
import "./i18n";
import { router } from "./router";
import "./styles/global.css";
import { ErrorBoundary } from "./components/ErrorBoundary";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <JotaiProvider>
        <RouterProvider router={router} />
      </JotaiProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
