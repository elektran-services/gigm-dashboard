"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { md5Hash, getBrowserInfo } from "@/lib/utils";
import { saveAuthToken, saveCredentialsForAutoRefresh } from "@/lib/auth";
import { buildGPS51LoginUrl } from "@/lib/config";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Check if user was redirected due to session expiration
    const errorParam = searchParams.get('error');
    if (errorParam === 'session_expired') {
      setError('Your session has expired. Please login again.');
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    
    try {
      // Hash password with MD5
      const hashedPassword = md5Hash(password);
      
      // Get browser info
      const browser = getBrowserInfo();
      
      // Make API call
      const response = await fetch(buildGPS51LoginUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "DEVICE",
          from: "web",
          username: username,
          password: hashedPassword,
          browser: browser,
        }),
      });

      const data = await response.json();
      
      // Check if login was successful (status 0 = success)
      if (data.status === 0 && data.token) {
        // Save auth token and user data
        saveAuthToken(data.token, data);
        
        // Save credentials for automatic token refresh
        saveCredentialsForAutoRefresh(username, hashedPassword);
        
        // Redirect to dashboard
        router.push("/dashboard");
      } else {
        // Show error message
        setError(data.cause || "Login failed. Please check your credentials.");
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("An error occurred during login. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left Column - Write-up Section */}
      <div
        className="hidden lg:flex lg:w-1/2 px-10 py-8 flex-col justify-center overflow-hidden"
        style={{ backgroundColor: "#e5e7eb", backgroundImage: "none" }}
      >
        <div className="max-w-xl mx-auto text-gray-900 w-full">
          <div className="mb-5">
            <Image
              src="/gigmotors_logo.jpg"
              alt="GIGMotors Logo"
              width={200}
              height={60}
              priority
              className="h-12 w-auto"
            />
          </div>
          <h1 className="text-3xl xl:text-4xl font-bold mb-3 text-gray-900 leading-tight">
            Welcome to GIGMotors Dashboard
          </h1>
          <p className="text-base mb-6 text-gray-800">
            Fuel monitoring for your fleet — tank levels, real refuels, mileage, and downloadable
            reports in one place.
          </p>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-base mb-0.5">Fuel Monitoring</h3>
                <p className="text-sm text-gray-800">
                  View tank level by Total Mileage, spot real station fills, and open purchase
                  addresses on the map.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-base mb-0.5">Fuel Report</h3>
                <p className="text-sm text-gray-800">
                  Open past fuel history by date and download clear Excel reports for audits,
                  reviews, and team sharing.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-base mb-0.5">Daily Fuel Capture</h3>
                <p className="text-sm text-gray-800">
                  Each day&apos;s fuel activity is recorded automatically, so your records stay
                  complete and ready when you sign in.
                </p>
              </div>
            </div>
          </div>
          <p className="mt-8 text-sm font-bold text-gray-900">
            SafeTrack Technologies | SafePRO Services
          </p>
        </div>
      </div>

      {/* Right Column - Login Form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-8 bg-white overflow-hidden">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <div className="flex justify-center items-center mb-3">
              <div className="inline-flex items-center gap-3">
                <div className="w-11 h-11 rounded-lg bg-linear-to-br from-[#e31d00] to-[#c41900] flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h1 className="text-3xl font-bold text-gray-900">Sign In</h1>
              </div>
            </div>
            <p className="text-gray-600 text-sm">Enter your credentials to access fuel monitoring</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-red-800">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#e31d00] focus:border-transparent outline-none transition-all text-gray-900"
                placeholder="Enter your username"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#e31d00] focus:border-transparent outline-none transition-all text-gray-900"
                placeholder="••••••••"
              />
            </div>

            <div className="flex items-center">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  type="checkbox"
                  className="w-4 h-4 text-[#e31d00] border-gray-300 rounded focus:ring-[#e31d00]"
                />
                <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-700">
                  Remember me
                </label>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#e31d00] hover:bg-[#c41900] text-white font-semibold py-3 px-4 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Signing in...
                </span>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Don't have an account?{" "}
              <a href="#" className="font-medium text-[#c41900] hover:text-[#a81500]">
                Contact your administrator
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      <LoginForm />
    </Suspense>
  );
}
