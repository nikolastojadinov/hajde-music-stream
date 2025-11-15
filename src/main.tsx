import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { PiProvider } from "@/contexts/PiContext";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PiProvider>
      <App />
    </PiProvider>
  </React.StrictMode>
);
