import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

/* In-flow evidence disclosures (approved design §6).

   Every trigger owns at most one panel, keyed by a stable id. Panels render in
   document flow exactly where their block places them, animate open from 0fr
   to 1fr, and close from the same trigger, their X, or Escape. Closing
   returns focus to the trigger. Several panels may be open at once; this is
   not an accordion and there is no modal, backdrop or focus trap. Changing
   chapter clears every panel. */

const CLOSE_MS = 260;

interface DisclosureState {
  open: ReadonlySet<string>;
  closing: ReadonlySet<string>;
  toggle: (id: string) => void;
  openPanel: (id: string) => void;
  close: (id: string, restoreFocus?: boolean) => void;
  closeAll: () => void;
  registerTrigger: (id: string, element: HTMLElement | null) => void;
  registerPanel: (id: string, element: HTMLElement | null) => void;
}

const DisclosureContext = createContext<DisclosureState | null>(null);

function reducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function panelDomId(id: string): string {
  return `rd-panel-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function DisclosureProvider({ children, resetKey }: { children: ReactNode; resetKey: string }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [closing, setClosing] = useState<ReadonlySet<string>>(() => new Set());
  const triggers = useRef(new Map<string, HTMLElement>());
  const panels = useRef(new Map<string, HTMLElement>());
  const timers = useRef(new Map<string, number>());

  const finishClose = useCallback((ids: string[]) => {
    setClosing((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const close = useCallback((id: string, restoreFocus = true) => {
    const panel = panels.current.get(id);
    // Closing a parent also closes every panel nested inside it.
    const nested = [...panels.current.entries()]
      .filter(([otherId, element]) => otherId !== id && panel?.contains(element))
      .map(([otherId]) => otherId);
    const ids = [id, ...nested];
    setOpen((current) => {
      if (!ids.some((value) => current.has(value))) return current;
      const next = new Set(current);
      for (const value of ids) next.delete(value);
      return next;
    });
    if (restoreFocus) {
      const trigger = triggers.current.get(id);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
    if (reducedMotion()) return;
    setClosing((current) => new Set([...current, ...ids]));
    for (const value of ids) {
      window.clearTimeout(timers.current.get(value));
      timers.current.set(value, window.setTimeout(() => finishClose([value]), CLOSE_MS));
    }
  }, [finishClose]);

  const toggle = useCallback((id: string) => {
    if (open.has(id)) {
      close(id);
      return;
    }
    window.clearTimeout(timers.current.get(id));
    finishClose([id]);
    setOpen((current) => new Set([...current, id]));
  }, [close, finishClose, open]);

  const openPanel = useCallback((id: string) => {
    window.clearTimeout(timers.current.get(id));
    finishClose([id]);
    setOpen((current) => (current.has(id) ? current : new Set([...current, id])));
  }, [finishClose]);

  const closeAll = useCallback(() => {
    setOpen(new Set());
    setClosing(new Set());
  }, []);

  // Changing chapter clears every panel before the new chapter paints.
  const [seenResetKey, setSeenResetKey] = useState(resetKey);
  if (seenResetKey !== resetKey) {
    setSeenResetKey(resetKey);
    setOpen(new Set());
    setClosing(new Set());
  }

  useEffect(() => {
    const current = timers.current;
    return () => {
      for (const timer of current.values()) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      // The innermost open panel that contains focus closes first.
      const containing = [...panels.current.entries()]
        .filter(([id, element]) => open.has(id) && element.contains(active))
        .sort(([, left], [, right]) => (left.contains(right) ? 1 : right.contains(left) ? -1 : 0));
      const target = containing[0]?.[0]
        ?? [...triggers.current.entries()].find(([id, element]) => open.has(id) && element === active)?.[0];
      if (!target) return;
      event.preventDefault();
      close(target);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, open]);

  const registerTrigger = useCallback((id: string, element: HTMLElement | null) => {
    if (element) triggers.current.set(id, element);
    else if (triggers.current.get(id) && !triggers.current.get(id)?.isConnected) triggers.current.delete(id);
  }, []);
  const registerPanel = useCallback((id: string, element: HTMLElement | null) => {
    if (element) panels.current.set(id, element);
    else panels.current.delete(id);
  }, []);

  const value = useMemo<DisclosureState>(() => ({
    open,
    closing,
    toggle,
    openPanel,
    close,
    closeAll,
    registerTrigger,
    registerPanel,
  }), [close, closeAll, closing, open, openPanel, registerPanel, registerTrigger, toggle]);

  return <DisclosureContext.Provider value={value}>{children}</DisclosureContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDisclosures(): DisclosureState {
  const value = useContext(DisclosureContext);
  if (!value) throw new Error("useDisclosures must be used inside DisclosureProvider");
  return value;
}

/** A native button that owns one disclosure. Carries aria-expanded/controls. */
export function DisclosureButton({
  id,
  children,
  className = "textbtn",
  ...rest
}: { id: string; children: ReactNode; className?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "id" | "onClick" | "type">) {
  const state = useDisclosures();
  const isOpen = state.open.has(id);
  const register = useCallback((element: HTMLButtonElement | null) => state.registerTrigger(id, element), [id, state]);
  return (
    <button
      {...rest}
      ref={register}
      type="button"
      className={className}
      aria-expanded={isOpen}
      aria-controls={isOpen ? panelDomId(id) : undefined}
      onClick={() => state.toggle(id)}
    >
      {children}
    </button>
  );
}

function PanelBody({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const state = useDisclosures();
  const isOpen = state.open.has(id);
  // A panel mounts collapsed and grows on the next frame; reduced motion opens at once.
  const [entered, setEntered] = useState(reducedMotion);
  const register = useCallback((element: HTMLElement | null) => state.registerPanel(id, element), [id, state]);

  useEffect(() => {
    if (!isOpen || entered) return;
    const frame = window.requestAnimationFrame(() => setEntered(true));
    // Hidden tabs never fire animation frames; never leave a panel collapsed.
    const fallback = window.setTimeout(() => setEntered(true), 60);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
    };
  }, [entered, isOpen]);

  return (
    <section
      ref={register}
      id={panelDomId(id)}
      className={`inline-detail${isOpen && entered ? " is-open" : ""}`}
      role="region"
      aria-label={`${label} details`}
      inert={!isOpen}
    >
      <div className="inline-detail-clip">
        <div className="inline-detail-body">
          <div className="dialog-top">
            <span className="eyebrow">ARGUS evidence room</span>
            <button type="button" className="close" aria-label="Close details" onClick={() => state.close(id)}>×</button>
          </div>
          <div className="inline-content">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** The panel slot placed directly after its anchor block. */
export function InlinePanel({ id, label, className, children }: { id: string; label: string; className?: string; children: () => ReactNode }) {
  const state = useDisclosures();
  const visible = state.open.has(id) || state.closing.has(id);
  if (!visible) return null;
  return (
    <div className={className ? `inline-detail-slot ${className}` : "inline-detail-slot"}>
      <PanelBody id={id} label={label}>{children()}</PanelBody>
    </div>
  );
}

/** The table variant: a full-width row inserted after the scoring row. */
export function InlineRow({ id, label, colSpan, children }: { id: string; label: string; colSpan: number; children: () => ReactNode }) {
  const state = useDisclosures();
  const visible = state.open.has(id) || state.closing.has(id);
  if (!visible) return null;
  return (
    <tr className="inline-detail-slot">
      <td colSpan={colSpan}>
        <PanelBody id={id} label={label}>{children()}</PanelBody>
      </td>
    </tr>
  );
}
