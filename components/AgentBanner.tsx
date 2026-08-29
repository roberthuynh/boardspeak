"use client";

interface AgentBannerProps {
  nativeSupported: boolean;
  dismissed: boolean;
  onDismissedChange: (dismissed: boolean) => void;
  showDemo: boolean;
  demoEnabled: boolean;
  onDemo: () => void;
}

export function AgentBanner({
  nativeSupported,
  dismissed,
  onDismissedChange,
  showDemo,
  demoEnabled,
  onDemo,
}: AgentBannerProps) {
  if (nativeSupported) {
    return null;
  }

  return (
    <aside
      aria-label="Agent setup"
      className="agent-banner"
      data-collapsed={dismissed}
    >
      <div
        className="agent-banner-copy"
        hidden={dismissed}
        id="agent-banner-instructions"
      >
        <span aria-hidden="true" className="agent-banner-icon">
          !
        </span>
        <div className="agent-banner-message">
          <p className="panel-kicker">Plain browser mode</p>
          <h2>Voice play needs WebMCP</h2>
          <p className="agent-banner-lede">
            Mouse play works now. To let an agent play Black, choose either setup:
          </p>
          <ol>
            <li>
              <strong>ChatGPT desktop:</strong> open this page in the built-in
              browser, then turn on <strong>Site tools</strong> from the address bar.
            </li>
            <li>
              <strong>Chrome 149+:</strong> enable{" "}
              <code>chrome://flags/#enable-webmcp-testing</code>, relaunch, then open
              the Model Context Tool Inspector extension.
            </li>
          </ol>
          <p className="agent-banner-note">
            The Inspector compatibility layer is already loaded on this page.
          </p>
        </div>
      </div>

      <div className="agent-banner-actions">
        {showDemo ? (
          <button disabled={!demoEnabled} onClick={onDemo} type="button">
            Demo: agent turn
          </button>
        ) : null}
        <button
          aria-controls="agent-banner-instructions"
          aria-expanded={!dismissed}
          className="quiet-action"
          onClick={() => onDismissedChange(!dismissed)}
          type="button"
        >
          {dismissed ? "Show agent setup" : "Hide setup"}
        </button>
      </div>
    </aside>
  );
}
