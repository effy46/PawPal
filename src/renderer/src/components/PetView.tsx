import { useEffect, useRef, useState } from "react";
import type { CSSProperties, JSX, MouseEvent as ReactMouseEvent, PointerEvent } from "react";
import { i18n, resolveLanguage } from "../../../shared/i18n";
import type { CodexActivity, CodexActivityState, PetState, SpeechBubble } from "../../../shared/types";
import { getPetAsset, getPetAssetVariantCount } from "../assets";
import { useNow, useSnapshot } from "../hooks";
import { pointInElementHitbox } from "../petHitbox";

type DragRef = {
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
};

const CONTINUOUS_ASSET_STATES = new Set<PetState>(["idle", "focusGuard"]);
const CONTINUOUS_ASSET_ROTATION_MS = 15 * 60 * 1000;
const DRAG_START_DISTANCE_PX = 10;
const PET_BUTTON_SELECTOR = ".pet-button";
const CODEX_INTERACTIVE_SELECTOR =
  ".codex-badge, .codex-count-badge, .codex-chat-stack, .codex-detail-popover";
const BUBBLE_INTERACTIVE_SELECTOR = `.speech-bubble, ${CODEX_INTERACTIVE_SELECTOR}`;
const MAX_EXPANDED_CODEX_SESSIONS = 3;
const CODEX_STACK_SCROLL_STEP = 2;
const CODEX_COMPLETE_CELEBRATION_MS = 3200;

const CODEX_STATE_TO_PET_STATE: Record<CodexActivityState, PetState> = {
  idle: "idle",
  working: "focusGuard",
  reviewing: "focusAlert",
  complete: "focusDone",
  waiting: "sitting",
  error: "sad"
};

function codexStateLabel(state: CodexActivityState): string {
  return state[0].toUpperCase() + state.slice(1);
}

function codexActivityLabel(activity: CodexActivity): string {
  const waitingCount = activity.sessions.filter((session) => session.state === "waiting").length;
  if (waitingCount > 1) return `${waitingCount} Need Input`;
  if (waitingCount === 1) return "Needs Input";
  const errorCount = activity.sessions.filter((session) => session.state === "error").length;
  if (errorCount > 1) return `${errorCount} Blocked`;
  if (errorCount === 1 || activity.state === "error") return "Blocked";
  const activeCount = activity.sessions.filter(
    (session) => session.state === "working" || session.state === "reviewing"
  ).length;
  if (activeCount > 1) return `${activeCount} Active`;
  if (activity.state === "working") return "Thinking";
  if (activity.state === "complete") return "Ready";
  return codexStateLabel(activity.state);
}

function codexActivityTitle(activity: CodexActivity): string {
  if (activity.sessions.length > 1) return `${activity.sessions.length} Codex chats`;
  const session = activity.sessions[0];
  if (session?.title) return session.title;
  if (activity.message) return activity.message.replace(/^(Ready|Needs input|Blocked):\s*/i, "");
  return "Codex";
}

function codexActivityTooltip(activity: CodexActivity): string | undefined {
  if (!activity.sessions.length) return activity.message ?? undefined;
  return activity.sessions
    .map((session) => `${codexStateLabel(session.state)}: ${session.title}`)
    .join("\n");
}

function codexSessionCount(activity: CodexActivity): number {
  const activeCount = activity.sessions.filter((session) => session.state !== "complete").length;
  return activeCount || activity.sessions.length;
}

function codexSessionMessage(message: string | null): string | null {
  if (!message) return null;
  return message.replace(/^(Ready|Reply needed|Blocked):\s*/i, "");
}

function codexActivityDetail(activity: CodexActivity): string | null {
  if (activity.message) return codexSessionMessage(activity.message);
  const session = activity.sessions[0];
  return codexSessionMessage(session?.message ?? null);
}

function codexPrimarySession(activity: CodexActivity): CodexActivity["sessions"][number] | null {
  return (
    activity.sessions.find((session) => session.state === "waiting" || session.state === "error") ??
    activity.sessions.find((session) => session.state === "working" || session.state === "reviewing") ??
    activity.sessions[0] ??
    null
  );
}

function randomVariant(count: number, previous?: number): number {
  if (count <= 1) return 0;
  let next = Math.floor(Math.random() * count);
  if (previous !== undefined && next === previous) {
    next = (next + 1) % count;
  }
  return next;
}

function formatFocusCountdown(endsAt: number | null, now: number): string {
  const remainingSeconds = Math.max(0, Math.ceil(((endsAt ?? now) - now) / 1000));
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function PetView(): JSX.Element {
  const snapshot = useSnapshot();
  const now = useNow(1000);
  const [bubble, setBubble] = useState<SpeechBubble | null>(null);
  const [assetVariant, setAssetVariant] = useState(0);
  const [assetReplayKey, setAssetReplayKey] = useState(0);
  const [stateSignal, setStateSignal] = useState(0);
  const [codexExpanded, setCodexExpanded] = useState(false);
  const [codexDetailsOpen, setCodexDetailsOpen] = useState(false);
  const [codexDetailSessionId, setCodexDetailSessionId] = useState<string | null>(null);
  const [codexStackStartIndex, setCodexStackStartIndex] = useState(0);
  const [resizeHotspot, setResizeHotspot] = useState(false);
  const [resizeHandlePoint, setResizeHandlePoint] = useState<{ left: number; top: number } | null>(null);
  const dragRef = useRef<DragRef | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const petButtonRef = useRef<HTMLButtonElement | null>(null);
  const mouseInteractiveRef = useRef<boolean | null>(null);
  const lastMousePointRef = useRef<{ x: number; y: number } | null>(null);
  const labels = i18n(resolveLanguage(snapshot.settings.language)).settings;

  useEffect(() => {
    const offBubble = window.pawpal.onShowBubble(setBubble);
    const offHide = window.pawpal.onHideBubble(() => setBubble(null));
    const offPetState = window.pawpal.onPetState(() => setStateSignal((current) => current + 1));
    return () => {
      offBubble();
      offHide();
      offPetState();
    };
  }, []);

  const codexState = snapshot.codexActivity.state;
  const showCodexActivity =
    snapshot.petState !== "quitRunning" && !bubble && !snapshot.blockingMode && codexState !== "idle";
  const showCodexMulti = showCodexActivity && snapshot.codexActivity.sessions.length > 1;
  const codexPetState = CODEX_STATE_TO_PET_STATE[codexState];
  const codexCompleteAgeMs =
    typeof snapshot.codexActivity.updatedAt === "number" ? now - snapshot.codexActivity.updatedAt : 0;
  const settledCodexPetState =
    codexState === "complete" && codexCompleteAgeMs > CODEX_COMPLETE_CELEBRATION_MS
      ? "idle"
      : codexPetState;
  const state = showCodexActivity ? settledCodexPetState : snapshot.petState;
  const altText = `PawPal ${state}`;
  const appearanceId = snapshot.settings.petAppearanceId;
  const customAppearance = snapshot.settings.customPetAppearance;
  const useDirectionalQuitAsset = state === "quitRunning" && appearanceId !== "custom";
  const facingClass =
    snapshot.petFacing === "left" && !useDirectionalQuitAsset ? "facing-left" : "facing-right";
  const asset = getPetAsset(
    appearanceId,
    state,
    assetVariant,
    assetReplayKey,
    customAppearance,
    snapshot.petFacing
  );
  const maxCodexStackStartIndex = Math.max(
    0,
    snapshot.codexActivity.sessions.length - MAX_EXPANDED_CODEX_SESSIONS
  );
  const visibleCodexSessions = snapshot.codexActivity.sessions.slice(
    codexStackStartIndex,
    codexStackStartIndex + MAX_EXPANDED_CODEX_SESSIONS
  );
  const hiddenCodexSessionCount = Math.max(
    0,
    snapshot.codexActivity.sessions.length - (codexStackStartIndex + visibleCodexSessions.length)
  );
  const hiddenNewerCodexSessionCount = codexStackStartIndex;
  const petScaleStyle = { "--pet-scale": snapshot.petScale } as CSSProperties;
  const primaryCodexSession = codexPrimarySession(snapshot.codexActivity);
  const activeCodexDetailSession =
    snapshot.codexActivity.sessions.find((session) => session.id === codexDetailSessionId) ??
    primaryCodexSession;
  const codexDetail = activeCodexDetailSession
    ? codexSessionMessage(activeCodexDetailSession.message)
    : codexActivityDetail(snapshot.codexActivity);
  const codexDetailTitle = activeCodexDetailSession?.title ?? codexActivityTitle(snapshot.codexActivity);
  const codexDetailLabel = activeCodexDetailSession
    ? codexStateLabel(activeCodexDetailSession.state)
    : codexActivityLabel(snapshot.codexActivity);
  const shellStyle = {
    ...petScaleStyle,
    ...(resizeHandlePoint
      ? {
          "--resize-handle-left": `${resizeHandlePoint.left}px`,
          "--resize-handle-top": `${resizeHandlePoint.top}px`
        }
      : {})
  } as CSSProperties;

  function finishPointerDrag(clicked: boolean): void {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.dragging) {
      window.pawpal.petDragStop();
      return;
    }
    if (clicked) window.pawpal.petClicked();
  }

  function setMouseInteractive(interactive: boolean): void {
    if (mouseInteractiveRef.current === interactive) return;
    mouseInteractiveRef.current = interactive;
    window.pawpal.setMouseInteractive(interactive);
  }

  function updateMouseInteractivity(point: { x: number; y: number } | null): void {
    if (dragRef.current) {
      setMouseInteractive(true);
      return;
    }

    if (codexExpanded && showCodexMulti) {
      setMouseInteractive(true);
      return;
    }

    if (!point) {
      setResizeHotspot(false);
      setMouseInteractive(false);
      return;
    }

    const target = document.elementFromPoint(point.x, point.y);
    if (!(target instanceof Element)) {
      setMouseInteractive(false);
      return;
    }

    const petButton = target.closest(PET_BUTTON_SELECTOR);
    const isOnPet = petButton ? pointInElementHitbox(point, petButton) : false;
    const isOnInteractiveOverlay = Boolean(target.closest(BUBBLE_INTERACTIVE_SELECTOR));
    const isOnResizeHotspot = Boolean(target.closest(".pet-resize-handle"));

    setResizeHotspot(isOnResizeHotspot);
    setMouseInteractive(isOnPet || isOnInteractiveOverlay || isOnResizeHotspot);
  }

  useEffect(() => {
    const variantCount = getPetAssetVariantCount(appearanceId, state, customAppearance);
    setAssetVariant(randomVariant(variantCount));
    setAssetReplayKey(0);
    if (!CONTINUOUS_ASSET_STATES.has(state) || variantCount <= 1) return;
    const timer = window.setInterval(() => {
      setAssetVariant((current) => randomVariant(variantCount, current));
    }, CONTINUOUS_ASSET_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [appearanceId, customAppearance, state, stateSignal]);

  useEffect(() => {
    if (!asset.replayIntervalMs) return;
    const timer = window.setInterval(() => {
      setAssetReplayKey((current) => current + 1);
    }, asset.replayIntervalMs);
    return () => window.clearInterval(timer);
  }, [asset.replayIntervalMs]);

  useEffect(() => {
    const cancelActiveDrag = (): void => finishPointerDrag(false);
    const trackMouse = (event: MouseEvent): void => {
      const point = { x: event.clientX, y: event.clientY };
      lastMousePointRef.current = point;
      updateMouseInteractivity(point);
    };
    const clearMouse = (): void => {
      lastMousePointRef.current = null;
      setResizeHotspot(false);
      updateMouseInteractivity(null);
    };

    setMouseInteractive(false);
    window.addEventListener("mousemove", trackMouse);
    window.addEventListener("mouseleave", clearMouse);
    window.addEventListener("pointerup", cancelActiveDrag);
    window.addEventListener("pointercancel", cancelActiveDrag);
    window.addEventListener("blur", cancelActiveDrag);
    return () => {
      window.removeEventListener("mousemove", trackMouse);
      window.removeEventListener("mouseleave", clearMouse);
      window.removeEventListener("pointerup", cancelActiveDrag);
      window.removeEventListener("pointercancel", cancelActiveDrag);
      window.removeEventListener("blur", cancelActiveDrag);
      window.pawpal.setMouseInteractive(true);
    };
  }, []);

  useEffect(() => {
    updateMouseInteractivity(lastMousePointRef.current);
  }, [bubble, codexExpanded, showCodexMulti]);

  useEffect(() => {
    if (!showCodexMulti) setCodexExpanded(false);
  }, [bubble, showCodexMulti, snapshot.blockingMode]);

  useEffect(() => {
    setCodexStackStartIndex((current) =>
      showCodexMulti ? Math.min(current, maxCodexStackStartIndex) : 0
    );
  }, [maxCodexStackStartIndex, showCodexMulti]);

  useEffect(() => {
    if (!showCodexActivity) {
      setCodexDetailsOpen(false);
      setCodexDetailSessionId(null);
    }
  }, [showCodexActivity]);

  useEffect(() => {
    const updateResizeHandlePoint = (): void => {
      const shell = shellRef.current;
      const button = petButtonRef.current;
      if (!shell || !button) return;

      const shellRect = shell.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      setResizeHandlePoint({
        left: Math.round(buttonRect.right - shellRect.left - 28),
        top: Math.round(buttonRect.bottom - shellRect.top - 28)
      });
    };

    updateResizeHandlePoint();
    window.addEventListener("resize", updateResizeHandlePoint);
    return () => window.removeEventListener("resize", updateResizeHandlePoint);
  }, [asset.src, snapshot.petFacing, snapshot.petScale, state]);

  function startPointer(event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false
    };
  }

  function movePointer(event: PointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.dragging && distance > DRAG_START_DISTANCE_PX) {
      drag.dragging = true;
      window.pawpal.petDragStart({ offsetX: drag.startX, offsetY: drag.startY });
    }
  }

  function stopPointer(event: PointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const shouldReleaseCapture = event.currentTarget.hasPointerCapture(event.pointerId);
    finishPointerDrag(true);
    if (shouldReleaseCapture) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function cancelPointer(event: PointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    finishPointerDrag(false);
  }

  function startResizePointer(event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setMouseInteractive(true);
    setResizeHotspot(true);
    window.pawpal.petResizeStart();
  }

  function stopResizePointer(event: PointerEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    window.pawpal.petResizeStop();
  }

  function openCodexSession(event: ReactMouseEvent<HTMLElement>, sessionId?: string): void {
    if (!sessionId) return;
    event.preventDefault();
    event.stopPropagation();
    window.pawpal.openCodexSession(sessionId);
  }

  function showNewerCodexSessions(event: ReactMouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setCodexStackStartIndex(0);
  }

  function showOlderCodexSessions(event: ReactMouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setCodexStackStartIndex((current) => {
      const remaining = Math.max(
        0,
        snapshot.codexActivity.sessions.length - (current + MAX_EXPANDED_CODEX_SESSIONS)
      );
      const step = remaining <= CODEX_STACK_SCROLL_STEP ? remaining : CODEX_STACK_SCROLL_STEP;
      return Math.min(maxCodexStackStartIndex, current + step);
    });
  }

  return (
    <main
      ref={shellRef}
      className={`pet-shell ${resizeHotspot ? "is-resize-hotspot" : ""}`}
      style={shellStyle}
      aria-label="PawPal desktop pet"
      onContextMenu={(event) => {
        event.preventDefault();
        window.pawpal.petContextMenu();
      }}
    >
      <div className="pet-stage">
      {bubble ? (
        <section className="speech-bubble">
          <p>{bubble.message}</p>
          {bubble.actions?.length ? (
            <div className="bubble-actions">
              {bubble.actions.map((action) => (
                <button
                  className={`bubble-button ${action.kind ?? "secondary"}`}
                  key={action.id}
                  onClick={() => window.pawpal.bubbleAction(action.id)}
                  type="button"
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {snapshot.focusActive ? (
        <div className="focus-badge">
          <span>{labels.focus}</span>
          <strong>{formatFocusCountdown(snapshot.timers.focusEndsAt, now)}</strong>
        </div>
      ) : null}

      {showCodexMulti ? (
        codexExpanded ? (
          <>
            <section
              className={`codex-chat-stack${
                hiddenCodexSessionCount ? " has-more" : ""
              }`}
              aria-label={codexActivityTooltip(snapshot.codexActivity)}
            >
              {hiddenNewerCodexSessionCount ? (
                <button
                  className="codex-chat-latest"
                  onClick={showNewerCodexSessions}
                  type="button"
                  aria-label="Show latest Codex chats"
                >
                  Latest
                </button>
              ) : null}
              {visibleCodexSessions.map((session) => (
                <article
                  className={`codex-chat-card codex-chat-card--${session.state}`}
                  key={session.id}
                  onDoubleClick={(event) => openCodexSession(event, session.id)}
                  onPointerEnter={() => {
                    setCodexDetailSessionId(session.id);
                    setCodexDetailsOpen(true);
                  }}
                  onPointerLeave={() => setCodexDetailsOpen(false)}
                >
                  <span>{session.title}</span>
                  <strong>{codexStateLabel(session.state)}</strong>
                  {codexSessionMessage(session.message) ? (
                    <p>{codexSessionMessage(session.message)}</p>
                  ) : null}
                </article>
              ))}
              {hiddenCodexSessionCount ? (
                <button
                  className="codex-chat-more"
                  onClick={showOlderCodexSessions}
                  type="button"
                  aria-label={`Show ${hiddenCodexSessionCount} older Codex chats`}
                >
                  +{hiddenCodexSessionCount} more
                </button>
              ) : null}
            </section>
            <button
              className={`codex-count-badge codex-count-badge--${codexState} codex-count-badge--expanded`}
              onClick={() => setCodexExpanded(false)}
              type="button"
              aria-label="Collapse Codex chats"
            >
              v
            </button>
          </>
        ) : (
          <button
            className={`codex-count-badge codex-count-badge--${codexState}`}
            onClick={() => setCodexExpanded(true)}
            type="button"
            aria-label="Expand Codex chats"
          >
            {codexSessionCount(snapshot.codexActivity)}
          </button>
        )
      ) : showCodexActivity ? (
        <div
          className={`codex-badge codex-badge--${codexState}`}
          onDoubleClick={(event) => openCodexSession(event, primaryCodexSession?.id)}
          onPointerEnter={() => setCodexDetailsOpen(true)}
          onPointerLeave={() => setCodexDetailsOpen(false)}
          aria-label={codexActivityTooltip(snapshot.codexActivity)}
        >
          <span>{codexActivityTitle(snapshot.codexActivity)}</span>
          <strong>{codexActivityLabel(snapshot.codexActivity)}</strong>
        </div>
      ) : null}

      {showCodexActivity && codexDetailsOpen ? (
        <section
          className="codex-detail-popover"
          onDoubleClick={(event) => openCodexSession(event, activeCodexDetailSession?.id)}
          onPointerEnter={() => setCodexDetailsOpen(true)}
          onPointerLeave={() => setCodexDetailsOpen(false)}
        >
          <span className="codex-detail-popover__tail tail-large" aria-hidden="true" />
          <span className="codex-detail-popover__tail tail-small" aria-hidden="true" />
          <header>
            <span>{codexDetailTitle}</span>
            <strong>{codexDetailLabel}</strong>
          </header>
          {codexDetail ? <p>{codexDetail}</p> : null}
          {showCodexMulti && !codexExpanded ? (
            <div className="codex-detail-more">
              {snapshot.codexActivity.sessions.length - 1} more
            </div>
          ) : null}
        </section>
      ) : null}

      <button
        ref={petButtonRef}
        className={`pet-button state-${state} codex-${codexState} ${facingClass} ${
          asset.isPlaceholder ? "placeholder-asset" : ""
        }`}
        aria-label={altText}
        onPointerCancel={cancelPointer}
        onPointerDown={startPointer}
        onLostPointerCapture={() => finishPointerDrag(false)}
        onPointerMove={movePointer}
        onPointerUp={stopPointer}
        type="button"
      >
        <img draggable={false} src={asset.src} alt={altText} />
      </button>
      </div>
      <button
        aria-label="Drag to make PawPal bigger or smaller"
        className="pet-resize-handle"
        onPointerCancel={stopResizePointer}
        onPointerDown={startResizePointer}
        onPointerUp={stopResizePointer}
        title="Drag to make PawPal bigger or smaller"
        type="button"
      >
        <span className="pet-resize-tooltip">Drag to resize</span>
      </button>
    </main>
  );
}
