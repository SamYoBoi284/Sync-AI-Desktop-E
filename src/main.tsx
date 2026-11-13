import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { consumeStartupSplash } from "./services/nativeBridge";
import "./styles.css"; import "./shell.css"; import "./history.css"; import "./workspace.css"; import "./tasks-notes.css"; import "./library.css";
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("The Sync AI Desktop root element is missing.");
async function bootstrap() { let showStartupSplash = false; try { showStartupSplash = await consumeStartupSplash(); } catch { /* Mount if IPC is unavailable. */ } ReactDOM.createRoot(rootElement).render(<React.StrictMode><App showStartupSplash={showStartupSplash} /></React.StrictMode>); }
void bootstrap();
