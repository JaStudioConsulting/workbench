import { useState } from 'react';
import { Zap, UserCheck, FileSignature, Package, Target, ClipboardCheck, Search, X, Check, AlertCircle } from 'lucide-react';
import { ACTIONS } from '../../data/synthetic-today.js';

const actionIcons = {
  'vet': UserCheck,
  'brand-resume': FileSignature,
  'full-package': Package,
  'match-job': Target,
  'ref-check': ClipboardCheck,
  'source-similar': Search,
};

const sourceLabels = {
  resume: 'Resume',
  jobDescription: 'Job Description',
  transcript: 'Transcript / Call Notes',
  callNotes: 'Call Notes',
  candidateFacts: 'Verified Candidate Facts',
  candidateProfile: 'Candidate Profile',
  referenceMaterial: 'Reference Material',
  referenceTemplate: 'Reference Check Template',
};

function ReadinessPanel({ caseItem, action, onConfirm, onCancel }) {
  const missing = action.requires.filter((r) => !caseItem.sources[r]);
  const isReady = missing.length === 0;

  return (
    <div className="readiness-panel" role="dialog" aria-label={`${action.label} readiness check`}>
      <div className="readiness-header">
        <h3>{action.label}</h3>
        <button className="readiness-close" onClick={onCancel} aria-label="Close"><X size={16} /></button>
      </div>
      <p className="readiness-candidate">{caseItem.candidate.name} → {caseItem.job.title}, {caseItem.job.client}</p>
      <div className="readiness-checks">
        {action.requires.map((req) => {
          const has = caseItem.sources[req];
          return (
            <div key={req} className={`readiness-row ${has ? 'met' : 'unmet'}`}>
              {has ? <Check size={14} /> : <X size={14} />}
              <span>{sourceLabels[req] || req}</span>
            </div>
          );
        })}
      </div>
      {isReady ? (
        <button className="readiness-confirm" onClick={() => onConfirm(caseItem, action)}>
          <Check size={14} /> Start {action.label}
        </button>
      ) : (
        <div className="readiness-blocked">
          <AlertCircle size={14} />
          <span>Missing: {missing.map((m) => sourceLabels[m] || m).join(', ')}</span>
        </div>
      )}
    </div>
  );
}

export function ActionDock({ onDragOver, onDragLeave, onDrop, dragOverTarget, selectedCase, onRequestAction }) {
  const [readinessCheck, setReadinessCheck] = useState(null);

  const handleDrop = (e, actionId) => {
    onDrop?.(e, actionId, (item, targetId) => {
      const action = ACTIONS.find((a) => a.id === targetId);
      if (action) setReadinessCheck({ caseItem: item, action });
    });
  };

  const handleActionClick = (action) => {
    if (selectedCase) {
      setReadinessCheck({ caseItem: selectedCase, action });
    }
  };

  const handleConfirm = (caseItem, action) => {
    onRequestAction?.(caseItem, action);
    setReadinessCheck(null);
  };

  return (
    <section className="today-card action-dock">
      <h2 className="card-title"><Zap size={18} /> Action Dock</h2>
      <p className="dock-hint">Drag a case here or select a case and click an action</p>
      <div className="dock-actions">
        {ACTIONS.map((action) => {
          const Icon = actionIcons[action.id] || Zap;
          const isOver = dragOverTarget === action.id;
          return (
            <button
              key={action.id}
              className={`dock-target ${isOver ? 'drag-over' : ''}`}
              onDragOver={(e) => onDragOver?.(e, action.id)}
              onDragLeave={onDragLeave}
              onDrop={(e) => handleDrop(e, action.id)}
              onClick={() => handleActionClick(action)}
              aria-label={action.label}
            >
              <Icon size={20} />
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>
      {readinessCheck && (
        <ReadinessPanel
          caseItem={readinessCheck.caseItem}
          action={readinessCheck.action}
          onConfirm={handleConfirm}
          onCancel={() => setReadinessCheck(null)}
        />
      )}
    </section>
  );
}
