import {
  Component,
  useEffect,
  useId,
  useRef,
  type ErrorInfo,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { FocusManager, LiveRegionPoliteness } from "../core/accessibility";
import { navigate } from "./router";

const paths: Record<string, ReactNode> = {
  mic: (
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4" />
    </>
  ),
  camera: (
    <path d="M15 10l4.5-2.6v9.2L15 14M4 7h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
  ),
  captions: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 11h3M7 14h6M14 11h3" />
    </>
  ),
  word: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" />
      <path d="M19 17H6a2 2 0 0 0-2 2" />
    </>
  ),
  pen: (
    <>
      <path d="M20 4C12 5 8 8 5 18l1 1C16 16 19 12 20 4Z" />
      <path d="M6 19l5-5" />
    </>
  ),
  sparkle: (
    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V6l7-3Z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </>
  ),
  refresh: <path d="M20 8a8 8 0 1 0 .8 6M20 4v4h-4" />,
  leave: (
    <path d="M3 6c6-3 12-3 18 0 .6.3 1 1 1 1.6V10c0 .8-.7 1.5-1.5 1.4l-3-.3a1.5 1.5 0 0 1-1.3-1.2l-.3-1.7c-3-1-5.8-1-8.8 0l-.3 1.7a1.5 1.5 0 0 1-1.3 1.2l-3 .3C2.7 11.5 2 10.8 2 10V7.6C2 7 2.4 6.3 3 6Z" />
  ),
  pip: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <rect x="12" y="11" width="7" height="5" rx="1" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
};

export function Icon({
  name,
  size = 24,
}: {
  name: keyof typeof paths;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function FlameSprite() {
  return (
    <svg
      width="0"
      height="0"
      style={{ position: "absolute" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="fl" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#D2532A" />
          <stop offset=".55" stopColor="#E4923A" />
          <stop offset="1" stopColor="#F6CE8B" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Brand() {
  return (
    <a
      className="brand"
      href="/"
      onClick={(event) => {
        event.preventDefault();
        navigate("/");
      }}
    >
      <svg className="flame" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M16 2c.6 4.2 4.8 6 6.6 9.8 1.9 4 .2 9.6-4.4 11.4-.2-2.2-.9-3.6-2.4-4.8.3 2 .1 3.6-1.1 5.2-3.3-.9-5.7-3.9-5.7-7.6 0-2.2 1-3.9 2.3-5.6.2 1.6.9 2.6 2 3.3C15 15 13.6 9 16 2Z"
          fill="url(#fl)"
        />
      </svg>
      Cenacle <small>upper room</small>
    </a>
  );
}

export function LinkButton({
  to,
  className = "btn btn--quiet",
  children,
}: PropsWithChildren<{ to: string; className?: string }>) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function PrivacySeal({ count = 0 }: { count?: number }) {
  return (
    <span className="seal">
      <span className="seal__icon">
        <Icon name="shield" size={20} />
      </span>
      <b>On-device</b> · <span className="mono">{count} requests out</span>
    </span>
  );
}

export function AppHeader({ night = false }: { night?: boolean }) {
  return (
    <header className="topbar">
      <div className="container">
        <Brand />
        <nav className="hide-sm">
          <LinkButton to="/" className="nav-link">
            Presence
          </LinkButton>
          <span data-word-nav>
            <LinkButton to="/word/scripture" className="nav-link">
              Word
            </LinkButton>
          </span>
          <span data-word-nav>
            <LinkButton to="/word/journal" className="nav-link">
              Journal
            </LinkButton>
          </span>
          <LinkButton to="/settings" className="nav-link">
            Settings
          </LinkButton>
        </nav>
        <div className="cluster gap-3">
          {night ? (
            <PrivacySeal />
          ) : (
            <>
              <LinkButton to="/join" className="btn btn--quiet btn--sm">
                Join
              </LinkButton>
              <LinkButton to="/host" className="btn btn--primary btn--sm">
                Host a room
              </LinkButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function AppShell({
  night = false,
  children,
}: PropsWithChildren<{ night?: boolean }>) {
  useEffect(() => {
    document.body.classList.toggle("night", night);
    return () => document.body.classList.remove("night");
  }, [night]);
  return (
    <>
      <FlameSprite />
      <AppHeader night={night} />
      {children}
      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-live-region={LiveRegionPoliteness.Polite}
      />
      <div
        className="sr-only"
        aria-live="assertive"
        aria-atomic="true"
        data-live-region={LiveRegionPoliteness.Assertive}
      />
    </>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="switch">
      <span className="sr-only">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="track" />
    </label>
  );
}

export function AccessibleDialog({
  open,
  title,
  destructive = false,
  onClose,
  children,
  footer,
}: PropsWithChildren<{
  open: boolean;
  title: string;
  destructive?: boolean;
  onClose: () => void;
  footer?: ReactNode;
}>) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open || !ref.current) return;
    opener.current = document.activeElement as HTMLElement | null;
    const focus = new FocusManager();
    focus.trap(ref.current, opener.current);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      focus.release();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="dialog"
        role={destructive ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={id}
      >
        {destructive && <div className="dialog__accent" />}
        <button
          className="dialog__close"
          onClick={onClose}
          aria-label="Close dialog"
        >
          ×
        </button>
        <div className="dialog__head">
          <h2 className="dialog__title" id={id}>
            {title}
          </h2>
        </div>
        <div className="dialog__body">{children}</div>
        {footer && <div className="dialog__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function StateView({
  mark = "alert",
  title,
  message,
  children,
}: PropsWithChildren<{
  mark?: "alert" | "sage";
  title: string;
  message: string;
}>) {
  return (
    <main className="state">
      <div className="state__inner">
        <div
          className={`state__mark ${mark === "sage" ? "state__mark--sage" : "state__mark--danger"}`}
        >
          <Icon name={mark === "sage" ? "shield" : "alert"} />
        </div>
        <h1>{title}</h1>
        <p>{message}</p>
        <div className="cluster center gap-3 mt-5">{children}</div>
      </div>
    </main>
  );
}

export class ErrorBoundary extends Component<
  PropsWithChildren,
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Contained UI error", error, info.componentStack);
  }
  render() {
    if (this.state.error)
      return (
        <AppShell>
          <StateView
            title="This view stopped safely"
            message="Reload the view to return to a known state."
          >
            <button
              className="btn btn--primary"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </StateView>
        </AppShell>
      );
    return this.props.children;
  }
}
