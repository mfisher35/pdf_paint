export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={title}>
        <div className="title-bar">
          <span className="title">{title}</span>
          <span className="controls">
            <span onClick={onClose} style={{ fontWeight: 'bold' }}>✕</span>
          </span>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
