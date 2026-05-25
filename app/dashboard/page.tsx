"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getUserData, clearAuth, getAuthToken } from "@/lib/auth";
import MileageJsonReport from "./components/MileageJsonReport";
import IdleStopJsonReport from "./components/IdleStopJsonReport";

type Bucket = { count: number; latestReportDate: string | null };

export default function DashboardPage() {
  const router = useRouter();
  const [userData, setUserData] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState("dashboard");
  const [reportStats, setReportStats] = useState<{
    mileageJson: Bucket;
    idleStopJson: Bucket;
    generatedAt: string | null;
    loading: boolean;
    error: string | null;
  }>({
    mileageJson: { count: 0, latestReportDate: null },
    idleStopJson: { count: 0, latestReportDate: null },
    generatedAt: null,
    loading: true,
    error: null,
  });
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    const data = getUserData();
    if (!data) {
      router.push("/");
    } else {
      setUserData(data);
      fetchReportStats();
    }
  }, [router]);

  const fetchReportStats = async () => {
    try {
      const token = getAuthToken();
      if (!token) {
        setReportStats((prev) => ({ ...prev, loading: false, error: "Not logged in" }));
        return;
      }

      const res = await fetch("/api/dashboard-stats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();
      if (!res.ok || data.status !== 0) {
        setReportStats((prev) => ({
          ...prev,
          loading: false,
          error: data.cause || "Failed to load report stats",
        }));
        return;
      }

      setReportStats({
        mileageJson: data.mileageJson,
        idleStopJson: data.idleStopJson,
        generatedAt: data.generatedAt ?? null,
        loading: false,
        error: null,
      });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      setReportStats((prev) => ({
        ...prev,
        loading: false,
        error: "Could not load saved report counts",
      }));
    }
  };

  const handleRefresh = () => {
    setReportStats((prev) => ({ ...prev, loading: true, error: null }));
    fetchReportStats();
  };

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

  const menuItems = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
          />
        </svg>
      ),
    },
    {
      id: "mileage",
      label: "Mileage Report",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      ),
    },
    {
      id: "idle-stop",
      label: "Idle / Stop Report",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
  ];

  const menuHeaderLabel =
    menuItems.find((item) => item.id === activeMenu)?.label ??
    activeMenu.replace(/-/g, " ");

  const reportCards = [
    {
      menu: "mileage" as const,
      title: "Mileage Report",
      desc: "Daily maintenance snapshots (5k / 10k km)",
      folder: "mileage_json/",
      bucket: reportStats.mileageJson,
      accent: "from-emerald-500/15 to-teal-500/10 border-emerald-200/80",
      iconBg: "bg-emerald-100 text-emerald-700",
    },
    {
      menu: "idle-stop" as const,
      title: "Idle / Stop Report",
      desc: "Daily idle, stop, and ACC-off events",
      folder: "idle_stop_json/",
      bucket: reportStats.idleStopJson,
      accent: "from-violet-500/15 to-purple-500/10 border-violet-200/80",
      iconBg: "bg-violet-100 text-violet-700",
    },
  ];

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
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveMenu(item.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                activeMenu === item.id
                  ? "bg-[#e31d00] text-gray-900 font-medium"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white font-normal"
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
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
          <h1 className="text-xl font-semibold text-gray-900">{menuHeaderLabel}</h1>
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-gray-900 truncate">{userData.nickname}</p>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-3 lg:p-6">
          {activeMenu === "dashboard" && (
            <>
              <div className="mb-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2.5">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight">
                    Welcome back, {userData.nickname}
                  </h2>
                  <p className="text-xs sm:text-sm text-gray-600 mt-0.5 max-w-xl">
                    JSON fleet reports generated by the monitoring service. Open a card to browse
                    snapshots and download data.
                  </p>
                  {reportStats.generatedAt && !reportStats.loading && (
                    <p className="text-xs text-gray-400 mt-2">
                      Last refreshed {new Date(reportStats.generatedAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#e31d00] text-gray-900 font-medium hover:bg-[#c41900] border border-[#e31d00]/30 shadow-sm disabled:opacity-50"
                  onClick={handleRefresh}
                  disabled={reportStats.loading}
                >
                  Refresh
                </button>
              </div>

              {reportStats.error && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm px-4 py-3">
                  {reportStats.error}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-4xl">
                {reportCards.map((card) => (
                  <button
                    key={card.menu}
                    type="button"
                    onClick={() => setActiveMenu(card.menu)}
                    className={`text-left w-full flex flex-col min-h-[11rem] rounded-md border bg-gradient-to-br ${card.accent} p-4 shadow-sm hover:-translate-y-px transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e31d00]`}
                  >
                    <h3 className="text-lg font-bold text-gray-900">{card.title}</h3>
                    <p className="text-sm text-gray-600 mt-1">{card.desc}</p>
                    <p className="text-xs font-mono text-gray-500 mt-1">{card.folder}</p>
                    <div className="mt-auto pt-3">
                      {reportStats.loading ? (
                        <div className="animate-pulse h-4 bg-white/70 rounded w-12" />
                      ) : (
                        <>
                          <p className="text-2xl font-bold text-gray-900 tabular-nums">
                            {card.bucket.count}{" "}
                            <span className="text-xs font-medium text-gray-500 uppercase">
                              saved files
                            </span>
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Latest {card.bucket.latestReportDate ?? "—"}
                          </p>
                        </>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {activeMenu === "mileage" && <MileageJsonReport />}
          {activeMenu === "idle-stop" && <IdleStopJsonReport />}
        </main>
      </div>
    </div>
  );
}
