import { useCallback, useMemo, useState } from "react";

const LAST_ROUTE_KEY = "lifetrace:desktop:last-route";
const DEFAULT_ROUTE = "/app/today";
const ALLOWED_PREFIXES = ["/app/", "/finance/"];

function normalizeRoute(value: string | null | undefined): string {
  const route = value?.trim() || DEFAULT_ROUTE;
  return ALLOWED_PREFIXES.some((prefix) => route.startsWith(prefix)) ? route : DEFAULT_ROUTE;
}

function initialRoute(): string {
  if (typeof window === "undefined") return DEFAULT_ROUTE;
  return normalizeRoute(window.localStorage.getItem(LAST_ROUTE_KEY));
}

export function useDesktopNavigation() {
  const [entries, setEntries] = useState<string[]>(() => [initialRoute()]);
  const [index, setIndex] = useState(0);
  const route = entries[index] ?? DEFAULT_ROUTE;

  const persist = useCallback((next: string) => {
    window.localStorage.setItem(LAST_ROUTE_KEY, next);
  }, []);

  const navigate = useCallback((nextValue: string) => {
    const next = normalizeRoute(nextValue);
    setEntries((current) => {
      const base = current.slice(0, index + 1);
      if (base[base.length - 1] === next) return base;
      return [...base, next];
    });
    setIndex((current) => {
      const nextIndex = current + 1;
      return entries[index] === next ? current : nextIndex;
    });
    persist(next);
  }, [entries, index, persist]);

  const back = useCallback(() => {
    setIndex((current) => {
      const next = Math.max(0, current - 1);
      persist(entries[next] ?? DEFAULT_ROUTE);
      return next;
    });
  }, [entries, persist]);

  const forward = useCallback(() => {
    setIndex((current) => {
      const next = Math.min(entries.length - 1, current + 1);
      persist(entries[next] ?? DEFAULT_ROUTE);
      return next;
    });
  }, [entries, persist]);

  return useMemo(() => ({
    route,
    navigate,
    back,
    forward,
    canBack: index > 0,
    canForward: index < entries.length - 1,
  }), [back, entries.length, forward, index, navigate, route]);
}
