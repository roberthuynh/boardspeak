"use client";

interface AgentBannerProps {
  nativeSupported: boolean;
  dismissed: boolean;
  onDismiss: () => void;
  showDemo: boolean;
  demoEnabled: boolean;
  onDemo: () => void;
}

export function AgentBanner({
  nativeSupported,
  dismissed,
  onDismiss,
  showDemo,
  demoEnabled,
  onDemo,
}: AgentBannerProps) {
  if (nativeSupported || dismissed) {
    return null;
  }

  return (
    <aside className="agent-banner" aria-labelledby="agent-banner-title">
      <div className="agent-banner-copy">
        <p className="panel-kicker">Plain browser mode</p>
        <h2 id="agent-banner-title">Bring an agent to the board</h2>
        <p>
          Mouse play works here. For voice play, open this page in ChatGPT&apos;s built-in browser and enable
          Site tools from the address bar.
        </p>
        <p>
          In Chrome 149+, enable <code>chrome://flags/#enable-webmcp-testing</code>, relaunch, then open the
          Model Context Tool Inspector extension. The compatibility layer is already loaded for Inspector.
        </p>
      </div>

      <div className="agent-banner-actions">
        {showDemo ? (
          <button disabled={!demoEnabled} onClick={onDemo} type="button">
            Demo: agent turn
          </button>
        ) : null}
        <button className="quiet-action" onClick={onDismiss} type="button">
          Dismiss
        </button>
      </div>
    </aside>
  );
}
