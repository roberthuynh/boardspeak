"use client";

export interface TraceEntry {
  id: string;
  timestamp: string;
  name: string;
  args: unknown;
  result: unknown;
  isError: boolean;
}

interface CallTraceProps {
  entries: readonly TraceEntry[];
}

function serialize(value: unknown, limit = 600) {
  let output: string;

  if (typeof value === "string") {
    output = value;
  } else {
    try {
      output = JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      output = "[Result could not be displayed]";
    }
  }

  return output.length > limit ? `${output.slice(0, limit - 1)}…` : output;
}

function formatTimestamp(timestamp: string) {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime())
    ? timestamp
    : new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(parsed);
}

export function CallTrace({ entries }: CallTraceProps) {
  return (
    <details className="call-trace">
      <summary>
        <span>Agent call trace</span>
        <span className="panel-count">{entries.length}</span>
      </summary>

      {entries.length > 0 ? (
        <ol className="trace-list">
          {entries.map((entry) => (
            <li className="trace-entry" data-error={entry.isError ? "true" : undefined} key={entry.id}>
              <div className="trace-heading">
                <time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time>
                <code>{entry.name}</code>
                <span className="trace-verdict">{entry.isError ? "ERROR" : "OK"}</span>
              </div>
              <dl>
                <div>
                  <dt>Arguments</dt>
                  <dd>
                    <pre tabIndex={0}>{serialize(entry.args)}</pre>
                  </dd>
                </div>
                <div>
                  <dt>{entry.isError ? "Error" : "Result"}</dt>
                  <dd>
                    <pre tabIndex={0}>{serialize(entry.result)}</pre>
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-state">Agent calls will appear here, without opening DevTools.</p>
      )}
    </details>
  );
}
