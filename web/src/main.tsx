import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./styles/theme.css";
import Landing from "./pages/Landing";
import TeamFlow from "./pages/TeamFlow";
import Host from "./pages/Host";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/join" element={<TeamFlow />} />
        <Route path="/host" element={<Host />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
