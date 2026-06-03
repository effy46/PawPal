import { useEffect, useRef, useState } from "react";
import type { CSSProperties, JSX, MouseEvent as ReactMouseEvent, PointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { i18n, resolveLanguage } from "../../../shared/i18n";
import type { CodexActivity, CodexActivityState, PetState, SpeechBubble } from "../../../shared/types";
import { getPetAsset, getPetAssetVariantCount } from "../assets";
import { useNow, useSnapshot } from "../hooks";
import { pointInElementHitbox } from "../petHitbox";

type SettingsCopy = ReturnType<typeof i18n>["settings"];

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
const BUBBLE_INTERACTIVE_SELECTOR = `.speech-bubble, .pet-context-menu, ${CODEX_INTERACTIVE_SELECTOR}`;
const MAX_EXPANDED_CODEX_SESSIONS = 2;
const CODEX_COMPLETE_CELEBRATION_MS = 3200;
const CONTEXT_MENU_WIDTH_PX = 164;
const CONTEXT_MENU_HEIGHT_PX = 170;
const CONTEXT_MENU_OFFSET_PX = 8;
const CONTEXT_MENU_MARGIN_PX = 10;

const CODEX_STATE_TO_PET_STATE: Record<CodexActivityState, PetState> = {
  idle: "idle",
  working: "focusGuard",
  reviewing: "focusAlert",
  complete: "focusDone",
  waiting: "sitting",
  error: "sad"
};

function codexStateLabel(state: CodexActivityState, labels: SettingsCopy): string {
  const stateLabels: Record<CodexActivityState, string> = {
    idle: labels.codexIdle,
    working: labels.codexWorking,
    reviewing: labels.codexReviewing,
    complete: labels.codexComplete,
    waiting: labels.codexWaiting,
    error: labels.codexError
  };
  return stateLabels[state];
}

function codexActivityLabel(activity: CodexActivity, labels: SettingsCopy): string {
  const waitingCount = activity.sessions.filter((session) => session.state === "waiting").length;
  if (waitingCount > 1) return labels.codexNeedInputCount(waitingCount);
  if (waitingCount === 1) return labels.codexWaiting;
  const errorCount = activity.sessions.filter((session) => session.state === "error").length;
  if (errorCount > 1) return labels.codexBlockedCount(errorCount);
  if (errorCount === 1 || activity.state === "error") return labels.codexBlocked;
  const activeCount = activity.sessions.filter(
    (session) => session.state === "working" || session.state === "reviewing"
  ).length;
  if (activeCount > 1) return labels.codexActiveCount(activeCount);
  return codexStateLabel(activity.state, labels);
}

function agentActivityProviderName(activity: CodexActivity, labels: SettingsCopy): string {
  if (activity.provider === "claude") return labels.claudeCode;
  if (activity.provider === "cursor") return labels.cursor;
  return labels.codex;
}

function agentActivityChatsLabel(activity: CodexActivity, labels: SettingsCopy): string {
  if (activity.provider === "claude") return labels.claudeCodeChats(activity.sessions.length);
  if (activity.provider === "cursor") return labels.cursorChats(activity.sessions.length);
  return labels.codexChats(activity.sessions.length);
}

function stripCodexStatusPrefix(message: string): string {
  return message.replace(/^(Ready|Needs input|Reply needed|Blocked|就绪|需要输入|需要回复|受阻)：?\s*/i, "");
}

function codexActivityTitle(activity: CodexActivity, labels: SettingsCopy): string {
  if (activity.sessions.length > 1) return agentActivityChatsLabel(activity, labels);
  const session = activity.sessions[0];
  if (session?.title) return session.title;
  if (activity.message) return stripCodexStatusPrefix(activity.message);
  return agentActivityProviderName(activity, labels);
}

function codexActivityTooltip(activity: CodexActivity, labels: SettingsCopy): string | undefined {
  if (!activity.sessions.length) return activity.message ?? undefined;
  return activity.sessions
    .map((session) => `${codexStateLabel(session.state, labels)}: ${session.title}`)
    .join("\n");
}

function codexSessionCount(activity: CodexActivity): number {
  const activeCount = activity.sessions.filter((session) => session.state !== "complete").length;
  return activeCount || activity.sessions.length;
}

function codexSessionMessage(message: string | null): string | null {
  if (!message) return null;
  return stripCodexStatusPrefix(message);
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
  const [codexAnchorLeft, setCodexAnchorLeft] = useState<number | null>(null);
  const [contextMenuPoint, setContextMenuPoint] = useState<{ x: number; y: number } | null>(null);
  const agentSessionClickRef = useRef<{ sessionId: string; clickedAt: number } | null>(null);
  const codexDetailSessionIdRef = useRef<string | null>(null);
  const openedAgentSessionRef = useRef<{ sessionId: string; openedAt: number } | null>(null);
  const dragRef = useRef<DragRef | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const petButtonRef = useRef<HTMLButtonElement | null>(null);
  const mouseInteractiveRef = useRef<boolean | null>(null);
  const lastMousePointRef = useRef<{ x: number; y: number } | null>(null);
  const language = resolveLanguage(snapshot.settings.language);
  const labels = i18n(language).settings;
  const menuLabels = i18n(language).menu;

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

  useEffect(() => {
    if (!contextMenuPoint) return;
    const close = (): void => setContextMenuPoint(null);
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenuPoint]);

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
  const invertQuitFacing =
    state === "quitRunning" && (appearanceId === "lovartPuppy" || appearanceId === "xiaoJiMao" || appearanceId === "hachi");
  const facingClass =
    snapshot.petFacing === (invertQuitFacing ? "right" : "left") ? "facing-left" : "facing-right";
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
  const hiddenTotalCodexSessionCount = hiddenCodexSessionCount + hiddenNewerCodexSessionCount;
  const petScaleStyle = { "--pet-scale": snapshot.petScale } as CSSProperties;
  const primaryCodexSession = codexPrimarySession(snapshot.codexActivity);
  const canOpenAgentSession =
    snapshot.codexActivity.provider === "codex" ||
    snapshot.codexActivity.provider === "claude" ||
    snapshot.codexActivity.provider === "cursor";
  const activeCodexDetailSession =
    snapshot.codexActivity.sessions.find((session) => session.id === codexDetailSessionId) ??
    primaryCodexSession;
  const activeCodexDetailSessionId =
    activeCodexDetailSession?.id ?? codexDetailSessionIdRef.current ?? primaryCodexSession?.id;
  const codexDetail = activeCodexDetailSession
    ? codexSessionMessage(activeCodexDetailSession.message)
    : codexActivityDetail(snapshot.codexActivity);
  const codexDetailTitle = activeCodexDetailSession?.title ?? codexActivityTitle(snapshot.codexActivity, labels);
  const codexDetailLabel = activeCodexDetailSession
    ? codexStateLabel(activeCodexDetailSession.state, labels)
    : codexActivityLabel(snapshot.codexActivity, labels);
  const codexDetailState = activeCodexDetailSession?.state ?? snapshot.codexActivity.state;
  const shellStyle = {
    ...petScaleStyle,
    "--pet-asset-scale": asset.displayScale ?? 1,
    "--pet-asset-y": `${asset.displayYOffset ?? 0}px`,
    ...(resizeHandlePoint
      ? {
          "--resize-handle-left": `${resizeHandlePoint.left}px`,
          "--resize-handle-top": `${resizeHandlePoint.top}px`
        }
      : {}),
    ...(codexAnchorLeft ? { "--codex-anchor-left": `${codexAnchorLeft}px` } : {})
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
    const updateOverlayAnchors = (): void => {
      const shell = shellRef.current;
      const button = petButtonRef.current;
      if (!shell || !button) return;

      const shellRect = shell.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      setResizeHandlePoint({
        left: Math.round(buttonRect.right - shellRect.left - 28),
        top: Math.round(buttonRect.bottom - shellRect.top - 28)
      });
      setCodexAnchorLeft(Math.round(button.offsetLeft + button.offsetWidth / 2));
    };

    updateOverlayAnchors();
    window.addEventListener("resize", updateOverlayAnchors);
    return () => window.removeEventListener("resize", updateOverlayAnchors);
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

  function requestOpenAgentSession(sessionId?: string): void {
    if (!sessionId || !canOpenAgentSession) return;
    const now = Date.now();
    const opened = openedAgentSessionRef.current;
    if (opened?.sessionId === sessionId && now - opened.openedAt < 800) return;
    openedAgentSessionRef.current = { sessionId, openedAt: now };
    window.pawpal.openAgentSession(sessionId, snapshot.codexActivity.provider);
  }

  function openAgentSession(event: ReactMouseEvent<HTMLElement>, sessionId?: string): void {
    if (!sessionId || !canOpenAgentSession) return;
    event.preventDefault();
    event.stopPropagation();
    requestOpenAgentSession(sessionId);
  }

  function trackAgentSessionPointerDown(event: PointerEvent<HTMLElement>, sessionId?: string): void {
    if (!sessionId || !canOpenAgentSession) return;
    const now = Date.now();
    const clicked = agentSessionClickRef.current;
    if (clicked?.sessionId === sessionId && now - clicked.clickedAt <= 500) {
      event.preventDefault();
      event.stopPropagation();
      agentSessionClickRef.current = null;
      requestOpenAgentSession(sessionId);
      return;
    }
    agentSessionClickRef.current = { sessionId, clickedAt: now };
  }

  function showNewerCodexSessions(event: ReactMouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setCodexStackStartIndex((current) => Math.max(0, current - 1));
  }

  function showOlderCodexSessions(event: ReactMouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setCodexStackStartIndex((current) => Math.min(maxCodexStackStartIndex, current + 1));
  }

  function cycleCodexSessions(event: ReactMouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setCodexStackStartIndex((current) => (current >= maxCodexStackStartIndex ? 0 : current + 1));
  }

  function scrollCodexSessions(event: ReactWheelEvent<HTMLElement>): void {
    if (!maxCodexStackStartIndex) return;
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (Math.abs(delta) < 4) return;

    event.preventDefault();
    event.stopPropagation();
    setCodexStackStartIndex((current) =>
      Math.max(0, Math.min(maxCodexStackStartIndex, current + (delta > 0 ? 1 : -1)))
    );
  }

  function openContextMenu(event: ReactMouseEvent<HTMLElement>): void {
    event.preventDefault();
    event.stopPropagation();
    const minPoint = CONTEXT_MENU_MARGIN_PX + CONTEXT_MENU_OFFSET_PX;
    const maxX = window.innerWidth - CONTEXT_MENU_WIDTH_PX + CONTEXT_MENU_OFFSET_PX - CONTEXT_MENU_MARGIN_PX;
    const maxY = window.innerHeight - CONTEXT_MENU_HEIGHT_PX + CONTEXT_MENU_OFFSET_PX - CONTEXT_MENU_MARGIN_PX;
    setContextMenuPoint({
      x: Math.max(minPoint, Math.min(event.clientX, maxX)),
      y: Math.max(minPoint, Math.min(event.clientY, maxY))
    });
  }

  function runContextAction(action: () => void): void {
    setContextMenuPoint(null);
    action();
  }

  return (
    <main
      ref={shellRef}
      className={`pet-shell ${resizeHotspot ? "is-resize-hotspot" : ""}`}
      lang={language}
      style={shellStyle}
      aria-label="PawPal desktop pet"
      onContextMenu={openContextMenu}
    >
      <div className="pet-stage">
      {contextMenuPoint ? (
        <section
          className="pet-context-menu"
          style={
            {
              "--menu-left": `${contextMenuPoint.x}px`,
              "--menu-top": `${contextMenuPoint.y}px`
            } as CSSProperties
          }
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => runContextAction(window.pawpal.openSettings)}>
            {menuLabels.settings}
          </button>
          <button
            type="button"
            onClick={() => runContextAction(snapshot.focusActive ? window.pawpal.stopFocus : window.pawpal.startFocus)}
          >
            {snapshot.focusActive ? menuLabels.stopFocusMode : menuLabels.startFocusMode}
          </button>
          <span aria-hidden="true" />
          <button type="button" onClick={() => runContextAction(window.pawpal.hideDog)}>
            {menuLabels.hideDog}
          </button>
          <button className="is-danger" type="button" onClick={() => runContextAction(window.pawpal.quit)}>
            {menuLabels.quit}
          </button>
        </section>
      ) : null}
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
                hiddenTotalCodexSessionCount ? " has-more" : ""
              }`}
              aria-label={codexActivityTooltip(snapshot.codexActivity, labels)}
              onWheel={scrollCodexSessions}
            >
              {visibleCodexSessions.map((session) => (
                <article
                  className={`codex-chat-card codex-chat-card--${session.state}`}
                  key={session.id}
                  onDoubleClick={(event) => openAgentSession(event, session.id)}
                  onPointerDown={(event) => trackAgentSessionPointerDown(event, session.id)}
                  onPointerEnter={() => {
                    codexDetailSessionIdRef.current = session.id;
                    setCodexDetailSessionId(session.id);
                    setCodexDetailsOpen(true);
                  }}
                  onPointerLeave={() => setCodexDetailsOpen(false)}
                >
                  <span>{session.title}</span>
                  <strong>{codexStateLabel(session.state, labels)}</strong>
                  {codexSessionMessage(session.message) ? (
                    <p>{codexSessionMessage(session.message)}</p>
                  ) : null}
                </article>
              ))}
              {hiddenTotalCodexSessionCount ? (
                <div className="codex-chat-pager" aria-label={labels.codexMoreChats(hiddenTotalCodexSessionCount)}>
                  <button
                    className="codex-chat-pager-button"
                    onClick={showNewerCodexSessions}
                    type="button"
                    aria-label={labels.codexShowLatestChats}
                    disabled={!hiddenNewerCodexSessionCount}
                  >
                    ↑
                  </button>
                  <button
                    className="codex-chat-more"
                    onClick={cycleCodexSessions}
                    type="button"
                    aria-label={labels.codexShowOlderChats(hiddenTotalCodexSessionCount)}
                  >
                    {labels.codexOlderChats(hiddenTotalCodexSessionCount)}
                  </button>
                  <button
                    className="codex-chat-pager-button"
                    onClick={showOlderCodexSessions}
                    type="button"
                    aria-label={labels.codexShowOlderChats(hiddenCodexSessionCount)}
                    disabled={!hiddenCodexSessionCount}
                  >
                    ↓
                  </button>
                </div>
              ) : null}
            </section>
            <button
              className={`codex-count-badge codex-count-badge--${codexState} codex-count-badge--expanded`}
              onClick={() => setCodexExpanded(false)}
              type="button"
              aria-label={labels.codexCollapseChats}
            >
              v
            </button>
          </>
        ) : (
          <button
            className={`codex-count-badge codex-count-badge--${codexState}`}
            onClick={() => setCodexExpanded(true)}
            type="button"
            aria-label={labels.codexExpandChats}
          >
            {codexSessionCount(snapshot.codexActivity)}
          </button>
        )
      ) : showCodexActivity ? (
        <div
          className={`codex-badge codex-badge--${codexState}`}
          onDoubleClick={(event) => openAgentSession(event, primaryCodexSession?.id)}
          onPointerDown={(event) => trackAgentSessionPointerDown(event, primaryCodexSession?.id)}
          onPointerEnter={() => setCodexDetailsOpen(true)}
          onPointerLeave={() => setCodexDetailsOpen(false)}
          aria-label={codexActivityTooltip(snapshot.codexActivity, labels)}
        >
          <span>{codexActivityTitle(snapshot.codexActivity, labels)}</span>
          <strong>{codexActivityLabel(snapshot.codexActivity, labels)}</strong>
        </div>
      ) : null}

      {showCodexActivity && codexDetailsOpen ? (
        <section
          className={`codex-detail-popover codex-detail-popover--${codexDetailState}`}
          onDoubleClick={(event) => openAgentSession(event, activeCodexDetailSessionId)}
          onPointerDown={(event) => trackAgentSessionPointerDown(event, activeCodexDetailSessionId)}
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
              {labels.codexMoreChats(snapshot.codexActivity.sessions.length - 1)}
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
        aria-label={labels.resizePetAria}
        className="pet-resize-handle"
        onPointerCancel={stopResizePointer}
        onPointerDown={startResizePointer}
        onPointerUp={stopResizePointer}
        type="button"
      >
        <span className="pet-resize-tooltip">{labels.resizePet}</span>
      </button>
    </main>
  );
}
