import {
  defaultSettings,
  type JournalEntry,
  type Passage,
  type SettingsModel
} from "./types";

const KEYS = {
  settings: "cenacle.settings.v1",
  journal: "cenacle.journal.v1",
  recentThemes: "cenacle.recent-themes.v1",
  passages: "cenacle.saved-passages.v1",
  session: "cenacle.room-session.v1"
} as const;

function parse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Origin-scoped persistence. No method in this class can issue a network call. */
export class LocalStore {
  constructor(private readonly storage: Storage = window.localStorage) {}

  loadSettings(): SettingsModel {
    return { ...defaultSettings, ...parse(this.storage.getItem(KEYS.settings), {}) };
  }

  saveSettings(settings: SettingsModel): void {
    this.storage.setItem(KEYS.settings, JSON.stringify(structuredClone(settings)));
  }

  listEntries(): JournalEntry[] {
    return parse<JournalEntry[]>(this.storage.getItem(KEYS.journal), []).sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
  }

  saveEntry(entry: JournalEntry): void {
    const entries = this.listEntries().filter((item) => item.id !== entry.id);
    this.storage.setItem(KEYS.journal, JSON.stringify([entry, ...entries]));
  }

  keepReflection(entryId: string, reflection: JournalEntry["keptReflection"]): void {
    const entries = this.listEntries().map((entry) =>
      entry.id === entryId ? { ...entry, keptReflection: reflection } : entry
    );
    this.storage.setItem(KEYS.journal, JSON.stringify(entries));
  }

  addRecentTheme(theme: string): void {
    const normalized = theme.trim();
    if (!normalized) return;
    const recent = this.recentThemes().filter(
      (item) => item.toLocaleLowerCase() !== normalized.toLocaleLowerCase()
    );
    this.storage.setItem(KEYS.recentThemes, JSON.stringify([normalized, ...recent].slice(0, 8)));
  }

  recentThemes(): string[] {
    return parse<string[]>(this.storage.getItem(KEYS.recentThemes), []);
  }

  savePassage(passage: Passage): void {
    const passages = this.savedPassages().filter((item) => item.id !== passage.id);
    this.storage.setItem(KEYS.passages, JSON.stringify([passage, ...passages]));
  }

  savedPassages(): Passage[] {
    return parse<Passage[]>(this.storage.getItem(KEYS.passages), []);
  }

  setSession(value: unknown): void {
    window.sessionStorage.setItem(KEYS.session, JSON.stringify(value));
  }

  getSession<T>(): T | null {
    return parse<T | null>(window.sessionStorage.getItem(KEYS.session), null);
  }

  clearSession(): void {
    window.sessionStorage.removeItem(KEYS.session);
  }

  clearAll(): void {
    Object.values(KEYS).forEach((key) => this.storage.removeItem(key));
    window.sessionStorage.removeItem(KEYS.session);
  }
}

export const localStore = new LocalStore();
