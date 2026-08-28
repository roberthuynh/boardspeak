"use client";

export interface MoveLogEntry {
  notation: string;
  plainText: string;
}

interface MoveLogProps {
  entries: readonly MoveLogEntry[];
  winnerText?: string | null;
}

export function MoveLog({ entries, winnerText = null }: MoveLogProps) {
  const newestFirst = [...entries].reverse();
  const latestMove = newestFirst[0]?.plainText;
  const announcement = [latestMove, winnerText].filter(Boolean).join(". ");

  return (
    <section className="move-log" aria-labelledby="move-log-heading">
      <div className="panel-heading-row">
        <h2 id="move-log-heading">Moves</h2>
        <span aria-hidden="true" className="panel-count">
          {entries.length}
        </span>
      </div>

      <p aria-atomic="true" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {entries.length > 0 ? (
        <ol className="move-list">
          {newestFirst.map((entry, index) => (
            <li className="move-entry" key={`${entries.length - index}-${entry.notation}`}>
              <code>{entry.notation}</code>
              <span>{entry.plainText}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-state">White opens. Select a pawn to begin.</p>
      )}

      {winnerText ? <p className="winner-message">{winnerText}</p> : null}
    </section>
  );
}
