import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import Shell from "./components/Shell.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Diary from "./pages/Diary.jsx";
import Timeline from "./pages/Timeline.jsx";
import Kanban from "./pages/Kanban.jsx";
import Browse from "./pages/Browse.jsx";
import Search from "./pages/Search.jsx";
import Edit from "./pages/Edit.jsx";
import Graph from "./pages/Graph.jsx";
import Settings from "./pages/Settings.jsx";
import Library from "./pages/Library.jsx";
import Manual from "./pages/Manual.jsx";

function PortalGate({ children }) {
  return children;
}

export default function App() {
  return (
    <HashRouter>
      <PortalGate>
        <Shell>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/diary" element={<Diary />} />
            <Route path="/diary/:date" element={<Diary />} />
            <Route path="/timeline" element={<Timeline />} />
            <Route path="/kanban" element={<Kanban />} />
            <Route path="/browse/*" element={<Browse />} />
            <Route path="/search" element={<Search />} />
            <Route path="/edit/*" element={<Edit />} />
            <Route path="/graph" element={<Graph />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/library/*" element={<Library />} />
            <Route path="/manual" element={<Manual />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      </PortalGate>
    </HashRouter>
  );
}
