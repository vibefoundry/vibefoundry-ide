function TemplateRow({ template, isDownloading, downloadingId, onSelect }) {
  const busy = isDownloading && downloadingId === template.id
  const disabled = isDownloading

  return (
    <div className="template-card">
      {template.icon && (
        <img
          className="template-card-icon"
          src={`/api/templates/icon/${template.icon}`}
          alt=""
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      )}
      <div className="template-card-titles">
        <div className="template-card-title-row">
          <h3>{template.name}</h3>
          {typeof template.track === 'number' && (
            <span className="template-card-track">Track {template.track}</span>
          )}
        </div>
        <p className="template-card-desc">{template.description}</p>
      </div>
      <div className="template-card-footer">
        <button
          className="btn-primary"
          onClick={() => onSelect(template.id)}
          disabled={disabled}
        >
          {busy ? 'Downloading…' : 'Download'}
        </button>
      </div>
    </div>
  )
}

export default function TemplatePickerModal({
  open,
  catalog,
  catalogError,
  loadingCatalog,
  isDownloading,
  downloadingId,
  onSelect,
  onClose,
}) {
  if (!open) return null

  const templates = catalog?.templates || []

  return (
    <div
      className="modal-overlay"
      onClick={() => !isDownloading && onClose()}
    >
      <div
        className="modal template-picker-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Download Templates</h3>
          <button
            className="modal-close"
            onClick={() => !isDownloading && onClose()}
          >×</button>
        </div>
        <div className="modal-body">
          {loadingCatalog && <p>Loading catalog…</p>}
          {catalogError && (
            <p className="modal-note" style={{ color: '#b91c1c' }}>
              {catalogError}
            </p>
          )}
          {!loadingCatalog && !catalogError && templates.length === 0 && (
            <p className="modal-note">No templates available.</p>
          )}
          {templates.length > 0 && (
            <div className="template-row-list">
              {templates.map((tpl) => (
                <TemplateRow
                  key={tpl.id}
                  template={tpl}
                  isDownloading={isDownloading}
                  downloadingId={downloadingId}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button
            className="btn-secondary"
            onClick={onClose}
            disabled={isDownloading}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
