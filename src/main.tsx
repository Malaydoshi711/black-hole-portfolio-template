import React from "react";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import "@fontsource/michroma/latin-400.css";
import "@fontsource-variable/schibsted-grotesk/wght.css";
import "./shared.css";
import "./styles.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    {import.meta.env.PROD && !/^(localhost|127\.|\[::1\])/.test(location.hostname) && <Analytics />}
  </React.StrictMode>,
);
