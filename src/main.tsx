import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/Mixer.css";
import "./styles/Transport.css";
import "./styles/ChannelStrip.css";
import "./styles/MasterVolume.css";
import "./styles/ChordMonitor.css";
import "./styles/Transpose.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
