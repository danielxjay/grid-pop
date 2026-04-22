import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

function syncViewportVars() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const top = Math.max(0, vv?.offsetTop ?? 0);
  const height = Math.max(0, vv?.height ?? window.innerHeight);
  const width = Math.max(0, vv?.width ?? window.innerWidth);
  const bottom = Math.max(0, window.innerHeight - height - top);

  root.style.setProperty("--vv-top", `${top}px`);
  root.style.setProperty("--vv-bottom", `${bottom}px`);
  root.style.setProperty("--vvh", `${height}px`);
  root.style.setProperty("--vvw", `${width}px`);
}

syncViewportVars();
window.addEventListener("resize", syncViewportVars, { passive: true });
window.visualViewport?.addEventListener("resize", syncViewportVars, { passive: true });
window.visualViewport?.addEventListener("scroll", syncViewportVars, { passive: true });

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
