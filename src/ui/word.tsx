import { useMemo, useState } from "react";
import { localStore } from "../core/local-store";
import { InputSanitizer } from "../core/security";
import type { JournalEntry, Passage, Reflection } from "../core/types";
import {
  JournalEditor,
  JournalService,
  NetworkGuard,
  ReflectionFeedback,
  ReflectionService,
} from "../word/journal";
import { PassageMatcher, quickThemes } from "../word/verse-index";
import { AppShell, Icon, PrivacySeal } from "./components";

export function ScripturePanel({ compact = false }: { compact?: boolean }) {
  const matcher = useMemo(() => new PassageMatcher(), []);
  const [theme, setTheme] = useState("");
  const [result, setResult] = useState<ReturnType<
    PassageMatcher["surface"]
  > | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [recent, setRecent] = useState(localStore.recentThemes());
  const [saved, setSaved] = useState(false);

  const surface = (value = theme) => {
    let normalized: string;
    try {
      normalized = new InputSanitizer().validate(value, 80, 1);
    } catch {
      return;
    }
    setTheme(normalized);
    localStore.addRecentTheme(normalized);
    setRecent(localStore.recentThemes());
    setResult(matcher.surface(normalized, excluded));
    setSaved(false);
  };

  const another = () => {
    if (result?.passage) setExcluded((items) => [...items, result.passage!.id]);
    const next = matcher.surface(
      theme,
      result?.passage ? [...excluded, result.passage.id] : excluded,
    );
    setResult(next);
    setSaved(false);
  };

  const save = (passage: Passage) => {
    localStore.savePassage(passage);
    setSaved(true);
  };

  return (
    <div
      className={`stack gap-5 ${compact ? "" : "container container-narrow section"}`}
    >
      {!compact && (
        <div className="stack gap-3">
          <span className="eyebrow">Subsystem B · Word</span>
          <h1 className="h1">What's on your heart?</h1>
          <p className="lede">
            Name a theme in plain words and an existing passage surfaces from
            the index on this device.
          </p>
        </div>
      )}
      <form
        className="field"
        onSubmit={(event) => {
          event.preventDefault();
          surface();
        }}
      >
        <label className="label" htmlFor={compact ? "theme-compact" : "theme"}>
          Name a theme
        </label>
        <div className="cluster gap-3">
          <input
            className="input"
            id={compact ? "theme-compact" : "theme"}
            value={theme}
            maxLength={80}
            onChange={(event) => setTheme(event.target.value)}
            placeholder="fear · gratitude · waiting…"
          />
          <button className="btn btn--primary" type="submit">
            <Icon name="sparkle" />
            Surface a passage
          </button>
        </div>
        <p className="hint">Or start from one of these:</p>
        <div className="cluster gap-2">
          {quickThemes.map((item) => (
            <button
              className="pill"
              type="button"
              key={item}
              onClick={() => surface(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </form>
      {result?.matched && result.passage && (
        <div className="verse-card stack gap-4">
          <span className="tag">Surfaced for “{theme}”</span>
          <blockquote className="verse sacred">
            {result.passage.text}
            <span className="ref">{result.passage.reference}</span>
          </blockquote>
          <p className="small muted">
            Why this surfaced — matched against a local verse index. Passages
            are retrieved, never generated.
          </p>
          <div className="verse-actions">
            <button className="btn btn--ghost" onClick={another}>
              <Icon name="refresh" />
              Surface another
            </button>
            <a
              className="btn btn--quiet"
              href={result.passage.contextUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="word" />
              Read in context
            </a>
            <button
              className="btn btn--quiet"
              onClick={() => save(result.passage!)}
            >
              {saved ? "Saved on this device" : "Save"}
            </button>
          </div>
        </div>
      )}
      {result && !result.matched && (
        <div className="banner banner--warn">
          <Icon name="alert" />
          <div>
            <p className="banner__title">No passage matched that theme</p>
            <p className="small muted">
              Try a plainer word. No reference has been invented.
            </p>
            <div className="cluster gap-2 mt-3">
              {result.suggestions.map((item) => (
                <button
                  type="button"
                  className="pill"
                  onClick={() => surface(item)}
                  key={item}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="banner banner--sage">
        <Icon name="shield" />
        <div>
          <p className="banner__title">Grounded in a local verse index</p>
          <p className="small muted">Nothing you type leaves this device.</p>
        </div>
      </div>
      {recent.length > 0 && (
        <section>
          <h2 className="h3">Recent themes</h2>
          <div className="cluster gap-2 mt-3">
            {recent.map((item) => (
              <button
                type="button"
                className="pill"
                onClick={() => surface(item)}
                key={item}
              >
                {item}
              </button>
            ))}
          </div>
        </section>
      )}
      <PrivacySeal />
    </div>
  );
}

export function ScripturePage() {
  return (
    <AppShell>
      <ScripturePanel />
    </AppShell>
  );
}

export function JournalPanel({
  compact = false,
  reflectionEnabled = true,
}: {
  compact?: boolean;
  reflectionEnabled?: boolean;
}) {
  const editor = useMemo(() => new JournalEditor(), []);
  const service = useMemo(() => new JournalService(localStore), []);
  const reflections = useMemo(() => new ReflectionService(), []);
  const guard = useMemo(() => new NetworkGuard(), []);
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState(service.listEarlier());
  const [current, setCurrent] = useState<JournalEntry | null>(null);
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [reflecting, setReflecting] = useState(false);
  const [message, setMessage] = useState("");
  editor.draftText = draft;

  const save = () => {
    try {
      const entry = service.save(draft);
      setCurrent(entry);
      setEntries(service.listEarlier());
      setDraft("");
      setMessage("Saved on this device.");
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const reflect = async () => {
    if (!reflectionEnabled) return;
    if (!draft.trim() && !current) return;
    setReflecting(true);
    setMessage("");
    try {
      let entry = current;
      const normalizedDraft = draft.trim();
      if (normalizedDraft && (!entry || entry.text !== normalizedDraft)) {
        entry = service.save(normalizedDraft);
        setCurrent(entry);
        setEntries(service.listEarlier());
      }
      const { result } = await guard.assertZeroEgress(() =>
        reflections.requestReflection(entry!.text),
      );
      setReflection(result);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setReflecting(false);
    }
  };

  const feedback = (choice: ReflectionFeedback) => {
    if (current && reflection)
      service.recordFeedback(current.id, reflection, choice);
    setReflection(null);
    setEntries(service.listEarlier());
    setMessage(
      choice === ReflectionFeedback.KeepWithEntry
        ? "Reflection kept with the entry on this device."
        : "Reflection dismissed. Nothing was sent.",
    );
  };

  return (
    <div
      className={`stack gap-5 ${compact ? "" : "container container-narrow section"}`}
    >
      {!compact && (
        <div>
          <span className="eyebrow">Private companion</span>
          <h1 className="h1 mt-3">Lament journal</h1>
          <p className="lede mt-3">
            Write without performing. Your words stay on this device.
          </p>
        </div>
      )}
      <div className="journal-compose stack gap-3">
        <label
          className="label"
          htmlFor={compact ? "journal-compact" : "journal"}
        >
          What are you carrying?
        </label>
        <textarea
          className="textarea journal-editor"
          id={compact ? "journal-compact" : "journal"}
          rows={compact ? 6 : 10}
          maxLength={10_000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="You can say it plainly here…"
        />
        <div className="between">
          <span className="mono small muted">{editor.wordCount} words</span>
          <PrivacySeal />
        </div>
        <div className="cluster gap-2">
          <button className="btn btn--primary" onClick={save}>
            Save entry
          </button>
          <button
            className="btn btn--ghost"
            onClick={() => {
              setDraft("");
              editor.clear();
            }}
          >
            Clear draft
          </button>
          {reflectionEnabled && (
            <button
              className="btn btn--quiet"
              disabled={reflecting || (!draft.trim() && !current)}
              onClick={() => void reflect()}
            >
              <Icon name="sparkle" />
              {reflecting
                ? "Reflecting on this device…"
                : "Ask for a reflection"}
            </button>
          )}
        </div>
      </div>
      {!reflectionEnabled && (
        <div className="banner banner--warn">
          <Icon name="alert" />
          <div>
            <p className="banner__title">On-device reflection unavailable</p>
            <p className="small muted">
              Writing and saving remain private on this device. Cenacle will not
              send your entry to a cloud model.
            </p>
          </div>
        </div>
      )}
      {message && (
        <p className="banner banner--sage" role="status">
          {message}
        </p>
      )}
      {reflection && (
        <div className="reflection stack gap-3">
          <p className="sacred">{reflection.text}</p>
          {reflection.illustrativeReference && (
            <p className="small">
              Illustrative Scripture: {reflection.illustrativeReference}
            </p>
          )}
          <p className="small muted">{reflection.affirmation}</p>
          <div className="cluster gap-2">
            <button
              className="btn btn--primary"
              onClick={() => feedback(ReflectionFeedback.KeepWithEntry)}
            >
              Keep with entry
            </button>
            <button
              className="btn btn--quiet"
              onClick={() => feedback(ReflectionFeedback.NotHelpful)}
            >
              Not helpful
            </button>
          </div>
        </div>
      )}
      <section>
        <h2 className="h3">
          Earlier <span className="small muted">· local to this device</span>
        </h2>
        {entries.length === 0 ? (
          <div className="paper-panel mt-3">
            <p className="h3">Your first page is waiting.</p>
            <p className="muted">
              This private, on-device journal begins only when you write.
            </p>
          </div>
        ) : (
          <ul className="journal-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <button
                  className="btn btn--quiet btn--block"
                  onClick={() => {
                    setCurrent(entry);
                    setDraft(entry.text);
                  }}
                >
                  <span>
                    {entry.text.slice(0, 110)}
                    {entry.text.length > 110 ? "…" : ""}
                  </span>
                  <span className="mono small">
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </span>
                </button>
                {entry.keptReflection && (
                  <p className="reflection small mt-2">
                    {entry.keptReflection.text}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function JournalPage({
  reflectionEnabled = true,
}: {
  reflectionEnabled?: boolean;
}) {
  return (
    <AppShell night>
      <JournalPanel reflectionEnabled={reflectionEnabled} />
    </AppShell>
  );
}
