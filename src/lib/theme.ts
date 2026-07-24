export type ArgusTheme = "dark" | "light";

// Version the preference so everyone receives the new light-first experience
// once. Choices made after this release remain sticky.
export const ARGUS_THEME_STORAGE_KEY = "argus-theme-v2";
export const ARGUS_THEME_COLORS: Readonly<Record<ArgusTheme, string>> = {
  dark: "#06080c",
  light: "#f5f7fa",
};

interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface ThemeDocument {
  documentElement: {
    dataset: { theme?: string };
    style: { colorScheme: string };
  };
  querySelector(selector: string): { setAttribute(name: string, value: string): void } | null;
}

function browserDocument(): ThemeDocument | undefined {
  return (globalThis as typeof globalThis & { document?: ThemeDocument }).document;
}

function browserStorage(): ThemeStorage | undefined {
  try {
    return (globalThis as typeof globalThis & { localStorage?: ThemeStorage }).localStorage;
  } catch {
    return undefined;
  }
}

/** Unknown, corrupted, or unavailable preferences resolve to the light default. */
export function normalizeArgusTheme(value: unknown): ArgusTheme {
  return value === "dark" ? "dark" : "light";
}

export function currentArgusTheme(doc: ThemeDocument | undefined = browserDocument()): ArgusTheme {
  return normalizeArgusTheme(doc?.documentElement.dataset.theme);
}

export function readStoredArgusTheme(storage: ThemeStorage | undefined = browserStorage()): ArgusTheme {
  try {
    return normalizeArgusTheme(storage?.getItem(ARGUS_THEME_STORAGE_KEY));
  } catch {
    return "light";
  }
}

/** Apply visual and browser-chrome theme state without touching persistence. */
export function applyArgusTheme(
  value: unknown,
  doc: ThemeDocument | undefined = browserDocument(),
): ArgusTheme {
  const theme = normalizeArgusTheme(value);
  if (!doc) return theme;

  doc.documentElement.dataset.theme = theme;
  doc.documentElement.style.colorScheme = theme;
  doc.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", ARGUS_THEME_COLORS[theme]);
  return theme;
}

export function persistArgusTheme(
  value: unknown,
  storage: ThemeStorage | undefined = browserStorage(),
): ArgusTheme {
  const theme = normalizeArgusTheme(value);
  try {
    storage?.setItem(ARGUS_THEME_STORAGE_KEY, theme);
  } catch {
    // A blocked storage provider must never prevent the visual theme changing.
  }
  return theme;
}

export function setArgusTheme(
  value: unknown,
  options: {
    document?: ThemeDocument | null;
    storage?: ThemeStorage | null;
    persist?: boolean;
  } = {},
): ArgusTheme {
  const doc = options.document === undefined ? browserDocument() : options.document ?? undefined;
  const storage = options.storage === undefined ? browserStorage() : options.storage ?? undefined;
  const theme = applyArgusTheme(value, doc);
  if (options.persist !== false) persistArgusTheme(theme, storage);
  return theme;
}

export function nextArgusTheme(value: unknown): ArgusTheme {
  return normalizeArgusTheme(value) === "dark" ? "light" : "dark";
}

/** Reconcile the pre-paint HTML bootstrap with the typed runtime helper. */
export function initializeArgusTheme(options: {
  document?: ThemeDocument | null;
  storage?: ThemeStorage | null;
} = {}): ArgusTheme {
  const doc = options.document === undefined ? browserDocument() : options.document ?? undefined;
  const storage = options.storage === undefined ? browserStorage() : options.storage ?? undefined;
  return applyArgusTheme(readStoredArgusTheme(storage), doc);
}
