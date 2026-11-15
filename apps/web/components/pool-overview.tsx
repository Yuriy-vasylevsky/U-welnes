"use client";
import { useEffect, useState } from "react";
import { PoolMap } from "./pool-map";
import catalog from "../data/seats.json";
export function PoolOverview() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/pool/seats", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok) {
          const data = await response.json();
          if (data.map_version === catalog.source_sha256)
            setEnabled(data.enabled ?? {});
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return (
    <PoolMap
      closed={catalog.seats
        .filter((seat) => enabled[seat.id] !== true)
        .map((seat) => seat.id)}
    />
  );
}
