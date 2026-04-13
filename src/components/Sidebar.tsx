interface SidebarProps {
  topic: string | null;
}

export default function Sidebar({ topic }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">BP</div>
        <h1>HR-BPM</h1>
      </div>

      <div className="sidebar-section-label">Current context</div>
      <div className="sidebar-context">
        <div className="sidebar-context-label">Talking about</div>
        <div className="sidebar-context-value">
          {topic ?? 'No active topic — describe a situation to get started'}
        </div>
      </div>

      <div className="sidebar-section-label">I can help with</div>
      <div className="sidebar-capabilities">
        <div className="sidebar-capability">Policy guidance grounded in SoSafe Confluence</div>
        <div className="sidebar-capability">Coaching for difficult conversations</div>
        <div className="sidebar-capability">Performance management process</div>
        <div className="sidebar-capability">Absence &amp; leave questions</div>
        <div className="sidebar-capability">Escalation to a human HRBP</div>
      </div>

      <div className="sidebar-spacer" />

      <div className="sidebar-footer">
        Time-sensitive information is always flagged with its source and recency.
        When in doubt, confirm with your HRBP.
      </div>
    </aside>
  );
}
