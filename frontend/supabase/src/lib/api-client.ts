"use client";

import { useState, useCallback } from "react";

/** Lightweight API helper that throws an Arabic-friendly error on failure. */
export async function apiFetch<T = any>(
  url: string,
  opts?: RequestInit & { json?: any }
): Promise<T> {
  const headers: Record<string, string> = { ...(opts?.headers as any) };
  let body = opts?.body;
  if (opts?.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  const res = await fetch(url, {
    ...opts,
    headers,
    body,
    credentials: "same-origin",
  });
  let data: any = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => null);
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && (data.error || data.message)) ||
      (typeof data === "string" && data) ||
      "حدث خطأ غير متوقع. حاول مرة أخرى."
    const err = new Error(typeof msg === "string" ? msg : "حدث خطأ.") as any;
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

/** Hook to run an async function with loading/error state. */
export function useAsync<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fn();
      setData(d);
      return d;
    } catch (e: any) {
      setError(e?.message || "خطأ غير معروف");
      throw e;
    } finally {
      setLoading(false);
    }
  }, deps);
  return { data, loading, error, run, setData, setError };
}
