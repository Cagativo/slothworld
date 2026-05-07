/**
 * Selector-safe friendly agent inspection view models.
 */

const MAX_LINES = 2;

const DESK_TITLES = Object.freeze({
  'desk-0': 'Research Sloth',
  'desk-1': 'Listings Sloth',
  'desk-4': 'Render Sloth',
  'desk-5': 'Support Sloth',
});

const ZONE_TITLES = Object.freeze({
  engineCrystal: 'Engine Sloth',
  researchDesk: 'Research Sloth',
  renderDesk: 'Render Sloth',
  shopifyDesk: 'Listings Sloth',
  approvalDesk: 'Approval Sloth',
  archiveLibrary: 'Archive Sloth',
  anomalyShelf: 'Anomaly Watcher',
  supportDesk: 'Support Sloth',
});

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function friendlyTitle(agent) {
  return DESK_TITLES[agent?.deskId]
    || ZONE_TITLES[agent?.worldZoneId]
    || ZONE_TITLES[agent?.zoneId]
    || 'Sloth Worker';
}

function statusLabel(agent) {
  if (agent?.anomaly || agent?.visualState === 'error') return 'Needs attention';
  if (agent?.visualState === 'processing') return 'Processing';
  if (agent?.visualState === 'working' || agent?.currentTaskId) return 'Working';
  return 'Idle';
}

function taskCategory(agent) {
  const text = [
    clean(agent?.taskType),
    clean(agent?.title),
    clean(agent?.trendPanelState?.keyword),
  ].filter(Boolean).join(' ').toLowerCase();
  if (text.includes('trend') || agent?.trendPanelState) return 'Checking trend results';
  if (text.includes('shopify') || text.includes('listing') || text.includes('product') || text.includes('publish')) return 'Handling listing work';
  if (text.includes('image') || text.includes('render') || text.includes('mockup') || text.includes('design')) return 'Working on visuals';
  if (text.includes('discord') || text.includes('support') || text.includes('message') || text.includes('reply')) return 'Handling messages';
  if (text.includes('approval') || text.includes('review')) return 'Reviewing work';
  return agent?.currentTaskId ? 'Assigned to a task' : null;
}

export function buildAgentInspectionViewModel(agent) {
  const status = statusLabel(agent);
  const category = taskCategory(agent);
  const lines = [];

  if (status === 'Idle') {
    lines.push('Waiting for work');
  } else if (category) {
    lines.push(category);
  } else {
    lines.push(status === 'Needs attention' ? 'Needs a look' : 'Work in progress');
  }

  return Object.freeze({
    targetType: 'agent',
    title: friendlyTitle(agent),
    statusLabel: status,
    lines: Object.freeze(lines.slice(0, MAX_LINES)),
    tone: status === 'Needs attention' ? 'warning' : 'agent',
    maxLines: MAX_LINES,
  });
}
