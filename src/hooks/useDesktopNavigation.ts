import { useCallback, useMemo, useState } from "react";

const LAST_ROUTE_KEY = "lifetrace:desktop:last-route";
const DEFAULT_ROUTE = "/app/today";
const ALLOWED_PREFIXES = ["/app/"];

type NavigationHistory = {
  entries: string[];
  index: number;
};

function normalizeRoute(value: string | null | undefined): string {
  const route = value?.trim() || DEFAULT_ROUTE;
  if (route.startsWith("/app/finance") || route.startsWith("/finance/")) return DEFAULT_ROUTE;
  return ALLOWED_PREFIXES.some((prefix) => route.startsWith(prefix)) ? route : DEFAULT_ROUTE;
}

function initialHistory(): NavigationHistory {
  const route = typeof window === "undefined"
    ? DEFAULT_ROUTE
    : normalizeRoute(window.localStorage.getItem(LAST_ROUTE_KEY));
  return { entries: [route], index: 0 };
}

export function useDesktopNavigation() {
  const [history, setHistory] = useState<NavigationHistory>(initialHistory);
  const route = history.entries[history.index] ?? DEFAULT_ROUTE;

  const persist = useCallback((next: string) => {
    window.localStorage.setItem(LAST_ROUTE_KEY, next);
  }, []);

  const navigate = useCallback((nextValue: string) => {
    const next = normalizeRoute(nextValue);
    setHistory((current) => {
      const active = current.entries[current.index] ?? DEFAULT_ROUTE;
      if (active === next) return current;
      const entries = [...current.entries.slice(0, current.index + 1), next];
      return { entries, index: entries.length - 1 };
    });
    persist(next);
  }, [persist]);

  const back = useCallback(() => {
    setHistory((current) => {
      const index = Math.max(0, current.index - 1);
      persist(current.entries[index] ?? DEFAULT_ROUTE);
      return index === current.index ? current : { ...current, index };
    });
  }, [persist]);

  const forward = useCallback(() => {
    setHistory((current) => {
      const index = Math.min(current.entries.length - 1, current.index + 1);
      persist(current.entries[index] ?? DEFAULT_ROUTE);
      return index === current.index ? current : { ...current, index };
    });
  }, [persist]);

  return useMemo(() => ({
    route,
    navigate,
    back,
    forward,
    canBack: history.index > 0,
    canForward: history.index < history.entries.length - 1,
  }), [back, forward, history.entries.length, history.index, navigate, route]);
}
