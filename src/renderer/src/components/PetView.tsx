import { useEffect, useRef, useState } from "react";
import type { JSX, PointerEvent } from "react";
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
const BUBBLE_INTERACTIVE_SELECTOR = ".speech-bubble, .codex-count-badge, .codex-chat-stack";
const MAX_EXPANDED_CODEX_SESSIONS = 2;

const CODEX_STATE_TO_PET_STATE: Record<CodexActivityState, PetState> = {
  idle: "idle",
  working: "focusGuard",
  reviewing: "focusAlert",
  complete: "happy",
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
  const dragRef = useRef<DragRef | null>(null);
  const mouseInteractiveRef = useRef<boolean | null>(null);
  const lastMousePointRef = useRef<{ x: number; y: number } | null>(null);
  const bubbleVisibleRef = useRef(false);
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
  const showCodexActivity = !snapshot.blockingMode && codexState !== "idle";
  const showCodexMulti = showCodexActivity && snapshot.codexActivity.sessions.length > 1;
  const state = showCodexActivity ? CODEX_STATE_TO_PET_STATE[codexState] : snapshot.petState;
  const altText = `PawPal ${state}`;
  const facingClass = snapshot.petFacing === "left" ? "facing-left" : "facing-right";
  const appearanceId = snapshot.settings.petAppearanceId;
  const customAppearance = snapshot.settings.customPetAppearance;
  const asset = getPetAsset(appearanceId, state, assetVariant, assetReplayKey, customAppearance);
  const visibleCodexSessions = snapshot.codexActivity.sessions.slice(0, MAX_EXPANDED_CODEX_SESSIONS);
  const hiddenCodexSessionCount = Math.max(
    0,
    snapshot.codexActivity.sessions.length - visibleCodexSessions.length
  );

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

    if (!point) {
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
    const isOnBubble =
      bubbleVisibleRef.current && Boolean(target.closest(BUBBLE_INTERACTIVE_SELECTOR));

    setMouseInteractive(isOnPet || isOnBubble);
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
    bubbleVisibleRef.current = Boolean(bubble);
    updateMouseInteractivity(lastMousePointRef.current);
  }, [bubble]);

  useEffect(() => {
    if (!showCodexMulti) setCodexExpanded(false);
  }, [showCodexMulti]);

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

  return (
    <main
      className="pet-shell"
      aria-label="PawPal desktop pet"
      onContextMenu={(event) => {
        event.preventDefault();
        window.pawpal.petContextMenu();
      }}
    >
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
          <section
            className="codex-chat-stack"
            title={codexActivityTooltip(snapshot.codexActivity)}
          >
            <button
              className="codex-chat-stack__collapse"
              onClick={() => setCodexExpanded(false)}
              type="button"
              aria-label="Collapse Codex chats"
            >
              v
            </button>
            {visibleCodexSessions.map((session) => (
              <article
                className={`codex-chat-card codex-chat-card--${session.state}`}
                key={session.id}
              >
                <span>{session.title}</span>
                <strong>{codexStateLabel(session.state)}</strong>
                {codexSessionMessage(session.message) ? (
                  <p>{codexSessionMessage(session.message)}</p>
                ) : null}
              </article>
            ))}
            {hiddenCodexSessionCount ? (
              <div className="codex-chat-more">+{hiddenCodexSessionCount} more</div>
            ) : null}
          </section>
        ) : (
          <button
            className={`codex-count-badge codex-count-badge--${codexState}`}
            onClick={() => setCodexExpanded(true)}
            title={codexActivityTooltip(snapshot.codexActivity)}
            type="button"
            aria-label="Expand Codex chats"
          >
            {codexSessionCount(snapshot.codexActivity)}
          </button>
        )
      ) : showCodexActivity ? (
        <div
          className={`codex-badge codex-badge--${codexState}`}
          title={codexActivityTooltip(snapshot.codexActivity)}
        >
          <span>{codexActivityTitle(snapshot.codexActivity)}</span>
          <strong>{codexActivityLabel(snapshot.codexActivity)}</strong>
        </div>
      ) : null}

      <button
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
    </main>
  );
}
