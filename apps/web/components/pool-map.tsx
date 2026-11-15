"use client";
import { useEffect, useRef, useState } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import catalog from "../data/seats.json";
type Props = {
  selectable?: boolean;
  reserved?: string[];
  selected?: string;
  selectedIds?: string[];
  onSelect?: (id: string) => void;
  numbers?: Record<string, number | null>;
  showNumbers?: boolean;
  closed?: string[];
  editMode?: boolean;
  immersive?: boolean;
};
export function PoolMap({
  selectable = false,
  reserved = [],
  selected,
  selectedIds = [],
  onSelect,
  numbers = {},
  showNumbers = false,
  closed = [],
  editMode = false,
  immersive = false,
}: Props = {}) {
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const [centers, setCenters] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const pointers = useRef(new Set<number>());
  useEffect(() => {
    if (!selectable || !showNumbers || !overlay.current) return;
    const result: Record<string, { x: number; y: number }> = {};
    overlay.current
      .querySelectorAll<SVGPathElement>("path[data-seat]")
      .forEach((path) => {
        const box = path.getBBox();
        result[path.dataset.seat!] = {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        };
      });
    setCenters(result);
  }, [selectable, showNumbers]);
  useEffect(() => {
    if (image.current?.complete) {
      if (image.current.naturalWidth > 0) setLoaded(true);
      else setError(true);
    }
  }, []);
  return (
    <section
      className={`map-panel${immersive ? " immersive-map" : ""}`}
      aria-label="Карта території басейну"
      onTouchStartCapture={(event) => {
        // Leave a single finger to the browser's native page scroll. Let two
        // fingers reach the map library for pinch zoom and two-finger pan.
        if (!immersive && event.touches.length === 1) event.stopPropagation();
      }}
      onTouchMoveCapture={(event) => {
        if (!immersive && event.touches.length === 1) event.stopPropagation();
      }}
    >
      <TransformWrapper
        minScale={1}
        maxScale={8}
        centerOnInit
        wheel={{ step: 0.15, wheelDisabled: !immersive }}
        onPinchStart={() => {
          moved.current = true;
        }}
        doubleClick={{ disabled: true }}
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <TransformComponent
              wrapperClass="map-viewport"
              contentClass="map-content"
            >
              <div
                className="map-canvas"
                onPointerDown={(event) => {
                  pointers.current.add(event.pointerId);
                  if (pointers.current.size === 1) moved.current = false;
                  else moved.current = true;
                  pointerStart.current = { x: event.clientX, y: event.clientY };
                }}
                onPointerMove={(event) => {
                  const start = pointerStart.current;
                  if (
                    start &&
                    Math.hypot(
                      event.clientX - start.x,
                      event.clientY - start.y,
                    ) > 6
                  )
                    moved.current = true;
                }}
                onPointerUp={(event) => {
                  pointers.current.delete(event.pointerId);
                }}
                onPointerCancel={(event) => {
                  moved.current = true;
                  pointers.current.delete(event.pointerId);
                }}
              >
                <div className="map-art">
                  <img
                    ref={image}
                    className="pool-map"
                    src="/maps/pool-map.svg"
                    alt="План басейну з розташуванням шезлонгів, доріжок і зелених зон"
                    draggable={false}
                    onLoad={() => setLoaded(true)}
                    onError={() => setError(true)}
                  />
                  {(selectable || closed.length > 0) && (
                    <svg
                      ref={overlay}
                      className="seat-overlay"
                      viewBox={catalog.viewBox}
                      aria-label="Вибір шезлонга"
                    >
                      {catalog.seats.map((seat) => {
                        const taken = reserved.includes(seat.id);
                        const isSelected =
                          selected === seat.id || selectedIds.includes(seat.id);
                        const inactive = closed.includes(seat.id);
                        const blocked =
                          taken || (inactive && !editMode) || !selectable;
                        const label = `Шезлонг ${numbers[seat.id] ?? seat.id}${inactive ? " — недоступний" : taken ? " — зайнято" : ""}`;
                        return (
                          <path
                            key={seat.id}
                            d={seat.path}
                            data-seat={seat.id}
                            className={
                              inactive
                                ? `seat closed${editMode ? " editable" : ""}${isSelected ? " selected" : ""}`
                                : taken
                                  ? "seat taken"
                                  : isSelected
                                    ? "seat selected"
                                    : "seat"
                            }
                            role={selectable ? "button" : undefined}
                            aria-label={label}
                            aria-disabled={blocked}
                            aria-pressed={isSelected}
                            tabIndex={blocked ? -1 : 0}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (moved.current && event.detail !== 0) return;
                              if (
                                !blocked &&
                                (!moved.current || event.detail === 0)
                              )
                                onSelect?.(seat.id);
                            }}
                            onKeyDown={(event) => {
                              if (
                                !blocked &&
                                (event.key === "Enter" || event.key === " ")
                              ) {
                                event.preventDefault();
                                onSelect?.(seat.id);
                              }
                            }}
                          >
                            <title>{label}</title>
                          </path>
                        );
                      })}
                      {showNumbers &&
                        catalog.seats.map(
                          (seat) =>
                            numbers[seat.id] !== null &&
                            centers[seat.id] && (
                              <text
                                key={`number-${seat.id}`}
                                x={centers[seat.id].x}
                                y={centers[seat.id].y}
                                className="seat-number"
                                aria-hidden="true"
                              >
                                {numbers[seat.id] ?? seat.id}
                              </text>
                            ),
                        )}
                    </svg>
                  )}
                </div>
              </div>
            </TransformComponent>
            {immersive ? (
              <div className="map-legend" aria-label="Позначки місць на карті">
                <span className="free-key">○ Вільне</span>
                <span className="taken-key">● Зайняте</span>
                <span className="selected-key">● Обране</span>
                <span className="closed-key">● Недоступне</span>
              </div>
            ) : (
              <div className="map-label">ПЛАН ТЕРИТОРІЇ</div>
            )}
            <div className="map-controls">
              <button onClick={() => zoomIn()} aria-label="Збільшити карту">
                +
              </button>
              <button onClick={() => zoomOut()} aria-label="Зменшити карту">
                −
              </button>
              <button
                onClick={() => resetTransform()}
                aria-label="Показати всю карту"
              >
                {immersive ? "⤢" : "↺"}
              </button>
            </div>
            <p className="map-hint">
              <span className="touch-map-hint">
                {immersive
                  ? "Рухайте одним пальцем · Масштабуйте двома"
                  : "1 палець — сторінка · 2 — карта"}
              </span>
              <span className="mouse-map-hint">
                {immersive
                  ? "Колесо — масштаб · Перетягніть карту"
                  : "Ctrl + колесо — масштаб · Перетягніть карту"}
              </span>
            </p>
          </>
        )}
      </TransformWrapper>
      {!loaded && !error && (
        <p className="map-status" role="status">
          Завантаження карти…
        </p>
      )}
      {error && (
        <p className="map-status" role="alert">
          Не вдалося завантажити карту. <a href="/">Спробувати ще раз</a>
        </p>
      )}
    </section>
  );
}
