"use client";

import { useRef, useState, type ReactNode } from "react";
import { PANEL } from "./ui";

// How far (px) the handle has to be dragged to snap open, shut or away.
const SNAP_PX = 40;
// Tailwind's `sm`: a card from here up, so no dragging.
const DESKTOP = "(min-width: 40rem)";

/**
 * An info panel. On a phone it's a bottom sheet, like Google Maps': it peeks with the title and
 * the start of the body, a drag up (or a tap on the handle) opens it, a drag down shuts it and then
 * closes it. From `sm` up it's a card in the left column.
 */
export default function Sheet({
  title,
  subtitle,
  onClose,
  closeLabel,
  children,
}: {
  title: ReactNode;
  subtitle: ReactNode;
  onClose(): void;
  closeLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0);
  const from = useRef<number | null>(null);
  // Another building or room in the same sheet starts peeking again.
  const [shown, setShown] = useState(title);
  if (shown !== title) {
    setShown(title);
    setOpen(false);
  }

  const end = () => {
    if (from.current === null) return;
    from.current = null;
    if (drag < -SNAP_PX) setOpen(true);
    else if (drag > SNAP_PX) {
      if (open) setOpen(false);
      else onClose();
    } else if (Math.abs(drag) < 5) setOpen(!open);
    setDrag(0);
  };

  return (
    <aside
      style={drag ? { transform: `translateY(${Math.max(drag, -24)}px)` } : undefined}
      className={`${PANEL} fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl text-sm ${drag ? "" : "transition-transform"} ${
        open ? "max-h-[75dvh]" : "max-h-[13rem]"
      } sm:static sm:max-h-none sm:rounded-lg sm:transform-none`}
    >
      <div
        className="shrink-0 cursor-grab touch-none select-none px-4 pt-2 sm:cursor-auto sm:select-auto sm:touch-auto sm:p-4 sm:pb-0"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button") || matchMedia(DESKTOP).matches) return;
          from.current = e.clientY;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => from.current !== null && setDrag(e.clientY - from.current)}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-zinc-400/60 sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold leading-snug text-zinc-950 dark:text-white">{title}</h2>
          <button onClick={onClose} className="-m-2 p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white" aria-label={closeLabel}>
            ✕
          </button>
        </div>
        <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-sky-700 dark:text-sky-300">{subtitle}</p>
      </div>
      <div
        className={`min-h-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:overflow-visible sm:[mask-image:none] ${
          open ? "overflow-y-auto overscroll-contain" : "overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]"
        }`}
      >
        {children}
      </div>
    </aside>
  );
}
