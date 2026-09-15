import { useCallback, useRef } from "react";

type Orientation = "vertical" | "horizontal";

interface Props {
  orientation: Orientation;   // vertical = drag left/right, horizontal = drag up/down
  onDrag: (deltaPx: number) => void;
  className?: string;
}

/**
 * A 4px hit area with a 1px visible line. Cursor changes on hover.
 * We use pointer capture so drag works even when the pointer leaves the handle.
 */
export default function ResizeHandle({ orientation, onDrag, className = "" }: Props) {
  const dragging = useRef(false);
  const lastPos = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    lastPos.current = orientation === "vertical" ? e.clientX : e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [orientation]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const pos = orientation === "vertical" ? e.clientX : e.clientY;
    const delta = pos - lastPos.current;
    lastPos.current = pos;
    onDrag(delta);
  }, [orientation, onDrag]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }, []);

  const isVertical = orientation === "vertical";

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={
        "group relative shrink-0 " +
        (isVertical
          ? "w-1 cursor-col-resize hover:bg-blue-500/40"
          : "h-1 cursor-row-resize hover:bg-blue-500/40") +
        " " + className
      }
      style={{ touchAction: "none" }}
    >
      <div
        className={
          "absolute bg-zinc-800 group-hover:bg-blue-500 transition-colors " +
          (isVertical
            ? "left-1/2 top-0 bottom-0 w-px -translate-x-1/2"
            : "top-1/2 left-0 right-0 h-px -translate-y-1/2")
        }
      />
    </div>
  );
}
