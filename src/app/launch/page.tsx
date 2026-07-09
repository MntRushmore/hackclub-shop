"use client";

import { useState } from "react";
import Image from "next/image";
import LaunchShaderBg from "../components/LaunchShaderBg";

/**
 * The launch-lock "coming soon" page. Rendered by the middleware (via rewrite)
 * for every gated request, so it sits fixed over everything — including the
 * global <Navigation/> from the root layout — with a high z-index. The flowing
 * red/white shader fills the screen; a calm white card holds the password
 * unlock form.
 *
 * The form POSTs to /api/launch/unlock. On success the server sets the unlock
 * cookie and we reload — the middleware then sees the cookie and lets the
 * original request through.
 */
export default function LaunchPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/launch/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // Cookie is set; reload so the middleware re-evaluates and lets us in.
        window.location.reload();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Something went wrong. Please try again.");
      setBusy(false);
    } catch {
      setError("Network error. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10001] flex min-h-screen items-center justify-center overflow-hidden bg-white px-4">
      <LaunchShaderBg />

      <div className="relative w-full max-w-md rounded-3xl border-2 border-gray-200/80 bg-white/85 p-8 text-center shadow-2xl backdrop-blur-md">
        <Image
          src="https://assets.hackclub.com/flag-standalone.svg"
          alt="Hack Club"
          width={64}
          height={64}
          className="mx-auto mb-5"
        />
        <h1 className="mb-3 font-display text-4xl font-black text-hackclub-dark">
          Something is coming
        </h1>
        <p className="mb-7 font-bold text-hackclub-slate">
          The Hack Club Shop is almost ready. Enter the password to take an
          early look.
        </p>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            autoComplete="off"
            className="w-full rounded-full border-2 border-gray-200 bg-white px-5 py-3 text-center font-bold text-hackclub-dark outline-none transition-colors focus:border-hackclub-red"
          />
          <button
            type="submit"
            disabled={busy || password.length === 0}
            className="w-full transform rounded-full bg-hackclub-red px-6 py-3.5 text-lg font-black text-white shadow-md transition-all hover:scale-105 hover:bg-hackclub-orange hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 disabled:hover:bg-hackclub-red"
          >
            {busy ? "Unlocking..." : "Unlock"}
          </button>
        </form>

        {error && (
          <p className="mt-4 text-sm font-bold text-hackclub-red">{error}</p>
        )}

        <p className="mt-7 text-sm text-hackclub-muted">
          Not part of Hack Club yet?{" "}
          <a
            href="https://hackclub.com/slack"
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-hackclub-blue hover:underline"
          >
            Come join us
          </a>
        </p>
      </div>
    </div>
  );
}
