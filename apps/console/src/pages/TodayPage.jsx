import { useState, useCallback } from 'react';
import { TodayHeader } from '../features/today/TodayHeader.jsx';
import { AttentionQueue } from '../features/today/AttentionQueue.jsx';
import { ActiveCases } from '../features/today/ActiveCases.jsx';
import { ActionDock } from '../features/today/ActionDock.jsx';
import { ReviewQueue } from '../features/today/ReviewQueue.jsx';
import { TodayCalendar } from '../features/today/TodayCalendar.jsx';
import { SourcingRuns } from '../features/today/SourcingRuns.jsx';
import { AutomationHealth } from '../features/today/AutomationHealth.jsx';
import { RecentWork } from '../features/today/RecentWork.jsx';
import { GraphViewPlaceholder } from '../features/today/GraphViewPlaceholder.jsx';
import { useDragDrop } from '../hooks/useDragDrop.js';
import {
  cases as initialCases,
  calendarItems,
  sourcingRuns,
  reviewItems as initialReviews,
  integrations,
  recentActivity as initialActivity,
  attentionItems as initialAttention,
  ACTIONS,
} from '../data/synthetic-today.js';

export default function TodayPage() {
  const [cases, setCases] = useState(initialCases);
  const [reviews, setReviews] = useState(initialReviews);
  const [activity, setActivity] = useState(initialActivity);
  const [attention, setAttention] = useState(initialAttention);
  const [selectedCase, setSelectedCase] = useState(null);

  const { draggedItem, dragOverTarget, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop } = useDragDrop();

  // Stage change — status only, no workflow execution
  const handleStageChange = useCallback((caseId, newStage) => {
    setCases((prev) => prev.map((c) => c.id === caseId ? { ...c, stage: newStage } : c));
  }, []);

  // Action menu — select case for action dock
  const handleActionMenu = useCallback((caseItem) => {
    setSelectedCase(caseItem);
  }, []);

  // Request workflow — synthetic progression: Ready → Running → Review
  const handleRequestAction = useCallback((caseItem, action) => {
    const missing = action.requires.filter((r) => !caseItem.sources[r]);
    if (missing.length > 0) {
      // Move to Needs Info
      setCases((prev) => prev.map((c) =>
        c.id === caseItem.id ? { ...c, stage: 'Needs Info', blocker: `Missing: ${missing.join(', ')}` } : c
      ));
      return;
    }

    // Progress: Ready → Running → Review (synthetic)
    setCases((prev) => prev.map((c) =>
      c.id === caseItem.id ? { ...c, stage: 'Review', workflow: action.label, draftCount: c.draftCount + 1 } : c
    ));

    // Add review item
    const newReview = {
      id: `rev-syn-${Date.now()}`,
      caseId: caseItem.id,
      candidate: caseItem.candidate.name,
      type: action.label,
      status: 'Needs Review',
      createdAt: new Date().toISOString(),
    };
    setReviews((prev) => [newReview, ...prev]);

    // Add activity
    const newActivity = {
      id: `act-syn-${Date.now()}`,
      type: 'workflow-started',
      description: `${action.label} started for ${caseItem.candidate.name}`,
      timestamp: new Date().toISOString(),
      caseId: caseItem.id,
    };
    setActivity((prev) => [newActivity, ...prev]);

    setSelectedCase(null);
  }, []);

  // Review actions
  const handleReview = useCallback((item) => {
    // Synthetic: just log
  }, []);

  const handleRequestChanges = useCallback((item) => {
    setReviews((prev) => prev.map((r) => r.id === item.id ? { ...r, status: 'Changes Requested' } : r));
    setActivity((prev) => [{
      id: `act-syn-${Date.now()}`,
      type: 'changes-requested',
      description: `Changes requested on ${item.type} — ${item.candidate}`,
      timestamp: new Date().toISOString(),
      caseId: item.caseId,
    }, ...prev]);
  }, []);

  const handleApprove = useCallback((item) => {
    setReviews((prev) => prev.map((r) => r.id === item.id ? { ...r, status: 'Approved' } : r));
    setActivity((prev) => [{
      id: `act-syn-${Date.now()}`,
      type: 'draft-reviewed',
      description: `${item.type} approved for ${item.candidate}`,
      timestamp: new Date().toISOString(),
      caseId: item.caseId,
    }, ...prev]);
  }, []);

  return (
    <div className="today-page">
      <TodayHeader attentionCount={attention.length} caseCount={cases.length} />

      <div className="today-grid">
        {/* Left column — main content */}
        <div className="today-col-main">
          <AttentionQueue items={attention} />
          <ActiveCases
            cases={cases}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onActionMenu={handleActionMenu}
            onStageChange={handleStageChange}
          />
          <ActionDock
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            dragOverTarget={dragOverTarget}
            selectedCase={selectedCase}
            onRequestAction={handleRequestAction}
          />
          <ReviewQueue
            items={reviews}
            onReview={handleReview}
            onRequestChanges={handleRequestChanges}
            onApprove={handleApprove}
          />
        </div>

        {/* Right column — schedule + status */}
        <div className="today-col-side">
          <GraphViewPlaceholder />
          <TodayCalendar items={calendarItems} />
          <SourcingRuns runs={sourcingRuns} />
          <AutomationHealth integrations={integrations} />
          <RecentWork activity={activity} />
        </div>
      </div>
    </div>
  );
}
