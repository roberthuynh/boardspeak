"use client";

import { useEffect, useRef, useState } from "react";

export interface ToolRailEntry {
  name: string;
  mode: "READ" | "ACT";
  detail?: string;
}

interface ToolRailProps {
  entries: readonly ToolRailEntry[];
}

export function ToolRail({ entries }: ToolRailProps) {
  const previousEntriesRef = useRef(entries);
  const exitTimersRef = useRef<number[]>([]);
  const [departing, setDeparting] = useState<readonly ToolRailEntry[]>([]);
  const activeNames = new Set(entries.map((entry) => entry.name));
  const newlyDeparting = previousEntriesRef.current.filter(
    (entry) => !activeNames.has(entry.name),
  );
  const departingByName = new Map(
    [...departing, ...newlyDeparting]
      .filter((entry) => !activeNames.has(entry.name))
      .map((entry) => [entry.name, entry]),
  );
  const renderedEntries = [
    ...entries.map((entry) => ({ ...entry, exiting: false })),
    ...[...departingByName.values()].map((entry) => ({
      ...entry,
      exiting: true,
    })),
  ];
  useEffect(() => {
    const nextNames = new Set(entries.map((entry) => entry.name));
    const removed = previousEntriesRef.current.filter(
      (entry) => !nextNames.has(entry.name),
    );
    previousEntriesRef.current = entries;

    if (removed.length === 0) {
      return;
    }

    const removedNames = new Set(removed.map((entry) => entry.name));
    setDeparting((current) => [
      ...current.filter((entry) => !removedNames.has(entry.name)),
      ...removed,
    ]);
    const timer = window.setTimeout(() => {
      setDeparting((current) =>
        current.filter((entry) => !removedNames.has(entry.name)),
      );
    }, 210);
    exitTimersRef.current.push(timer);
  }, [entries]);

  useEffect(
    () => () => {
      for (const timer of exitTimersRef.current) {
        window.clearTimeout(timer);
      }
    },
    [],
  );

  return (
    <section className="tool-rail" aria-labelledby="tool-rail-heading">
      <div className="tool-rail-heading">
        <p className="panel-kicker">Live WebMCP surface</p>
        <h2 id="tool-rail-heading">Tools your agent can see right now</h2>
      </div>

      {renderedEntries.length > 0 ? (
        <ul className="tool-list">
          {renderedEntries.map((entry) => (
            <li
              aria-hidden={entry.exiting || undefined}
              className="tool-entry"
              data-exiting={entry.exiting ? "true" : undefined}
              data-mode={entry.mode.toLowerCase()}
              data-tool-name={entry.name}
              key={entry.name}
            >
              <span className="tool-badge">{entry.mode}</span>
              <code>{entry.name}</code>
              {entry.detail ? <span className="tool-detail">{entry.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-state">The page is preparing its tools.</p>
      )}
    </section>
  );
}
