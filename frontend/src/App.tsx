import { Routes, Route } from "react-router-dom";
import Shell from "./components/layout/Shell";
import Dashboard from "./pages/Dashboard";
import NewRun from "./pages/NewRun";
import RunDetail from "./pages/RunDetail";
import Opportunities from "./pages/Opportunities";
import Lessons from "./pages/Lessons";

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="new" element={<NewRun />} />
        <Route path="runs/:id" element={<RunDetail />} />
        <Route path="opportunities" element={<Opportunities />} />
        <Route path="lessons" element={<Lessons />} />
      </Route>
    </Routes>
  );
}
