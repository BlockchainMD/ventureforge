import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  PlusCircle,
  Lightbulb,
  BookOpen,
} from "lucide-react";

const links = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/new", label: "New Run", icon: PlusCircle },
  { to: "/opportunities", label: "Opportunities", icon: Lightbulb },
  { to: "/lessons", label: "Lessons", icon: BookOpen },
];

export default function Sidebar() {
  return (
    <aside className="w-56 bg-gray-900 text-gray-300 flex flex-col min-h-screen">
      <div className="px-5 py-5 text-lg font-bold text-white tracking-tight">
        VentureForge
      </div>
      <nav className="flex-1 px-3 space-y-1">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-gray-800 text-white"
                  : "hover:bg-gray-800 hover:text-white"
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
