import { useState } from 'react'

function TemplateCard({ template, isDownloading, downloadingId, onSelect }) {
  const [showAllUses, setShowAllUses] = useState(false)
  const uses = template.use_cases || []
  const visibleUses = showAllUses ? uses : uses.slice(0, 3)
  const remaining = uses.length - visibleUses.length
  const busy = isDownloading && downloadingId === template.id
  const disabled = isDownloading

  return (
    <div className="template-card">
      <div className="template-card-header">
        {template.icon && (
          <img
            className="template-card-icon"
            src={`/api/templates/icon/${template.icon}`}
            alt=""
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        )}
        <div className="template-card-titles">
          <h3>{template.name}</h3>
          {typeof template.track === 'number' && (
            <span className="template-card-track">Track {template.track}</span>
          )}
        </div>
      </div>
      <p className="template-card-desc">{template.description}</p>
      {uses.length > 0 && (
        <ul className="template-card-uses">
          {visibleUses.map((u, i) => <li key={i}>{u}</li>)}
        </ul>
      )}
      {remaining > 0 && !showAllUses && (
        <button
          type="button"
          className="template-card-more"
          onClick={() => setShowAllUses(true)}
        >
          +{remaining} more
        </button>
      )}
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
            <div className="template-card-grid">
              {templates.map((tpl) => (
                <TemplateCard
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
