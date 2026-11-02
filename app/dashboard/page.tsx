"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getUserData, clearAuth } from "@/lib/auth";
import DailyFuelPanel from "./components/fuel/DailyFuelPanel";
import FuelReportsPanel from "./components/fuel/FuelReportsPanel";

type MenuId = "fuel" | "reports";

export default function DashboardPage() {
  const router = useRouter();
  const [userData, setUserData] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<MenuId>("fuel");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    const data = getUserData();
    if (!data) {
      router.push("/");
    } else {
      setUserData(data);
    }
  }, [router]);

  const handleLogout = () => {
    clearAuth();
    router.push("/");
  };

  if (!userData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#e31d00]" />
      </div>
    );
  }

  const menuItems: Array<{
    id: MenuId;
    label: string;
    icon: ReactNode;
  }> = [
    {
      id: "fuel",
      label: "Fuel Monitoring",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
          />
        </svg>
      ),
    },
    {
      id: "reports",
      label: "Reports",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      ),
    },
  ];

  const headerLabel = menuItems.find((item) => item.id === activeMenu)?.label ?? "Fuel Monitoring";

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <aside
        className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0 fixed lg:static inset-y-0 left-0 z-50 w-64 bg-gray-900 transform transition-transform duration-300 ease-in-out flex flex-col`}
      >
        <div className="flex items-center justify-start px-4 h-16 bg-gray-800 border-b border-gray-700">
          <Image
            src="/gigmotors_logo.jpg"
            alt="GIGMotors Logo"
            width={140}
            height={45}
            priority
            className="h-10 w-auto"
          />
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {menuItems.map((item) => {
            const active = activeMenu === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveMenu(item.id);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-[#e31d00] text-white font-medium"
                    : "text-gray-300 hover:bg-gray-800 hover:text-white font-normal"
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-3 pb-3">
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white hover:bg-red-600 transition-colors font-medium"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2h4a2 2 0 012 2v1"
              />
            </svg>
            <span>Logout</span>
          </button>
        </div>

        <div className="mt-auto px-3 pb-4 text-left border-t border-gray-700 pt-4">
          <p className="text-xs text-gray-400 mb-1">© {new Date().getFullYear()}</p>
          <p className="text-xs text-gray-500">Powered by</p>
          <p className="text-xs text-gray-300 font-medium">SafeTrack Technologies</p>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        {showLogoutConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
            <div className="bg-white rounded-lg shadow-2xl p-6 w-full max-w-xs mx-auto flex flex-col items-center">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Confirm Logout</h2>
              <p className="text-sm text-gray-600 mb-4 text-center">Are you sure you want to logout?</p>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => {
                    setShowLogoutConfirm(false);
                    handleLogout();
                  }}
                  className="flex-1 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700"
                >
                  Yes, Logout
                </button>
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 py-2 rounded-lg bg-gray-200 text-gray-700 font-medium hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <header className="bg-white shadow-sm h-16 flex items-center justify-between px-4 lg:px-8">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="text-xl font-semibold text-gray-900">{headerLabel}</h1>
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-gray-900 truncate">{userData.nickname}</p>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-3 lg:p-6">
          {activeMenu === "fuel" ? <DailyFuelPanel /> : <FuelReportsPanel />}
        </main>
      </div>
    </div>
  );
}
