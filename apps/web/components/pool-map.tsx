"use client";
import { useEffect, useRef, useState } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import catalog from "../data/seats.json";
type Props = {
  selectable?: boolean;
  reserved?: string[];
  selected?: string;
  onSelect?: (id: string) => void;
};
export function PoolMap({
  selectable = false,
  reserved = [],
  selected,
  onSelect,
}: Props = {}) {
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const pointers = useRef(new Set<number>());
  useEffect(() => {
    if (image.current?.complete) {
      if (image.current.naturalWidth > 0) setLoaded(true);
      else setError(true);
    }
  }, []);
  return (
    <section className="map-panel" aria-label="Карта території басейну">
      <TransformWrapper
        minScale={1}
        maxScale={6}
        centerOnInit
        wheel={{ step: 0.15 }}
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
                  moved.current = pointers.current.size > 1;
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
                  {selectable && (
                    <svg
                      className="seat-overlay"
                      viewBox={catalog.viewBox}
                      aria-label="Вибір шезлонга"
                    >
                      {catalog.seats.map((seat) => {
                        const taken = reserved.includes(seat.id);
                        const label = `Шезлонг ${seat.id}${taken ? " — зайнято" : ""}`;
                        return (
                          <path
                            key={seat.id}
                            d={seat.path}
                            data-seat={seat.id}
                            className={
                              taken
                                ? "seat taken"
                                : selected === seat.id
                                  ? "seat selected"
                                  : "seat"
                            }
                            role="button"
                            aria-label={label}
                            aria-disabled={taken}
                            aria-pressed={selected === seat.id}
                            tabIndex={taken ? -1 : 0}
                            onClick={(event) => {
                              if (
                                !taken &&
                                (!moved.current || event.detail === 0)
                              )
                                onSelect?.(seat.id);
                            }}
                            onKeyDown={(event) => {
                              if (
                                !taken &&
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
                    </svg>
                  )}
                </div>
              </div>
            </TransformComponent>
            <div className="map-label">ПЛАН ТЕРИТОРІЇ</div>
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
                ↺
              </button>
            </div>
            <p className="map-hint">
              Два пальці для масштабу · Перетягніть карту
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
