import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";

export default function Shell() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-6 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
