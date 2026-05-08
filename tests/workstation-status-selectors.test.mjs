import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWorkstationStatusSnapshots } from '../ui/selectors/workstationStatusSelectors.js';
import { buildWorkstationPopoverViewModel } from '../ui/hotspots/workstationSemantics.js';
import {
  WORKSTATION_HOTSPOTS,
  buildWorkstationHotspotComponents,
  componentForHotspot,
} from '../rendering/workstation-hotspots.js';
import { buildVisualWorldGraph } from '../core/world/buildVisualWorldGraph.js';

test('workstation status selectors: builds frozen snapshots for all semantic stations', () => {
  const snapshots = buildWorkstationStatusSnapshots({
    tasks: [
      { id: 'task-research-active', title: 'Trend sweep', type: 'TREND_RESEARCH', status: 'executing', updatedAt: 300 },
      { id: 'task-research-done', title: 'Trend report', type: 'TREND_RESEARCH', status: 'completed', updatedAt: 200 },
      { id: 'task-render-failed', title: 'Render draft', type: 'image_render', status: 'failed', error: 'timeout', updatedAt: 250 },
      { id: 'task-intake', title: 'New request', type: 'standard', status: 'created', updatedAt: 100 },
    ],
    agents: [],
  });

  const expectedStations = [
    'engine_core',
    'intake_desk',
    'research_desk',
    'render_desk',
    'shopify_desk',
    'support_desk',
    'approval_desk',
    'archive_shelf',
    'anomaly_shelf',
  ];

  assert.ok(Object.isFrozen(snapshots));
  assert.deepStrictEqual(Object.keys(snapshots), expectedStations);

  for (const stationId of expectedStations) {
    const snapshot = snapshots[stationId];
    assert.equal(snapshot.stationId, stationId);
    assert.equal(typeof snapshot.label, 'string');
    assert.ok(Object.isFrozen(snapshot));
    assert.ok(Object.isFrozen(snapshot.currentWork));
    assert.ok(Object.isFrozen(snapshot.currentWork.items));
    assert.ok(!('actions' in snapshot));
    assert.ok(!('buttons' in snapshot));
  }

  assert.equal(snapshots.research_desk.currentWork.count, 1);
  assert.equal(snapshots.research_desk.currentWork.items[0].taskId, 'task-research-active');
  assert.equal(snapshots.research_desk.lastResult?.taskId, 'task-research-done');
  assert.equal(snapshots.render_desk.latestFailure?.taskId, 'task-render-failed');
  assert.equal(snapshots.archive_shelf.lastResult?.taskId, 'task-research-done');
  assert.equal(snapshots.anomaly_shelf.latestFailure?.taskId, 'task-render-failed');
});

test('workstation popover: prefers current work over last result when snapshot has both', () => {
  const model = buildWorkstationPopoverViewModel({
    id: 'researchMonitorHotspot',
    summary: {},
    stationSnapshot: {
      stationId: 'research_desk',
      label: 'Research Desk',
      currentWork: {
        count: 1,
        items: [{ title: 'Trend sweep', summary: 'Executing in progress', taskId: 'task-active' }],
      },
      lastResult: {
        title: 'Trend report',
        status: 'completed',
        summary: 'Completed at Trend report',
        taskId: 'task-done',
        completedAt: 100,
      },
      latestFailure: null,
    },
  });

  assert.equal(model.lines[0], '1 scan active');
  assert.ok(model.lines.includes('Executing in progress'));
  assert.ok(!model.lines.some((row) => row.startsWith('Last result:')));
  assert.ok(!('actions' in model));
  assert.ok(!('buttons' in model));
});

test('workstation popover: falls back to semantic idle lines when snapshot is missing', () => {
  const hotspot = WORKSTATION_HOTSPOTS.find((candidate) => candidate.id === 'researchMonitorHotspot');
  const component = componentForHotspot(hotspot, []);
  const model = buildWorkstationPopoverViewModel(component);

  assert.deepStrictEqual(model.lines, ['Ready to scan trends']);
});

test('workstation hotspots: attach matching station snapshot metadata to components', () => {
  const snapshots = buildWorkstationStatusSnapshots({
    tasks: [
      { id: 'task-active', title: 'Trend sweep', type: 'TREND_RESEARCH', status: 'executing', updatedAt: 300 },
    ],
    agents: [],
  });

  const components = buildWorkstationHotspotComponents(WORKSTATION_HOTSPOTS, [], {
    stationSnapshots: snapshots,
  });
  const researchComponent = components.find((component) => component.id === 'researchMonitorHotspot');
  const anomalyComponent = components.find((component) => component.id === 'anomalyShelfHotspot');

  assert.equal(researchComponent.stationSnapshot.stationId, 'research_desk');
  assert.equal(researchComponent.stationSnapshot.currentWork.count, 1);
  assert.equal(anomalyComponent.stationSnapshot.stationId, 'anomaly_shelf');
});

test('workstation status selectors: snapshots are passively threaded into graph metadata', () => {
  const snapshots = buildWorkstationStatusSnapshots({
    tasks: [
      { id: 'task-active', title: 'Trend sweep', type: 'TREND_RESEARCH', status: 'executing', updatedAt: 300 },
    ],
    agents: [],
  });

  const graph = buildVisualWorldGraph(
    {
      tasks: [
        { id: 'task-active', title: 'Trend sweep', type: 'TREND_RESEARCH', status: 'executing', assignedAgentId: null, deskId: 'desk-0', createdAt: 100, updatedAt: 300, error: null },
      ],
      agents: [],
      transitions: {},
    },
    { workstationSnapshots: snapshots }
  );

  assert.equal(graph.metadata.workstationSnapshots.research_desk.currentWork.count, 1);
});

test('workstation status selectors: TREND_RESEARCH claimed work stays at research_desk', () => {
  const snapshots = buildWorkstationStatusSnapshots({
    tasks: [
      { id: 'task-research-claimed', title: 'Trend claim', type: 'TREND_RESEARCH', status: 'claimed', updatedAt: 400 },
    ],
    agents: [],
  });

  assert.equal(snapshots.research_desk.currentWork.count, 1);
  assert.equal(snapshots.research_desk.currentWork.items[0].taskId, 'task-research-claimed');
  assert.equal(snapshots.engine_core.currentWork.items.some((item) => item.taskId === 'task-research-claimed'), false);
});

test('workstation status selectors: research_desk snapshot includes trend result rows', () => {
  const snapshots = buildWorkstationStatusSnapshots({
    tasks: [
      { id: 'task-research-done', title: 'Trend report', type: 'TREND_RESEARCH', status: 'completed', updatedAt: 500 },
    ],
    agents: [
      {
        id: 'trend-research-worker',
        trendPanelState: {
          taskId: 'task-research-done',
          keyword: 'cozy',
          results: [
            { item: 'Tree lamp', score: 0.95 },
            { item: 'Moss shelf', score: 0.82 },
          ],
        },
      },
    ],
  });

  assert.equal(snapshots.research_desk.trendResult.taskId, 'task-research-done');
  assert.equal(snapshots.research_desk.trendResult.keyword, 'cozy');
  assert.deepEqual(
    snapshots.research_desk.trendResult.rows.map((row) => row.item),
    ['Tree lamp', 'Moss shelf']
  );
  assert.ok(Object.isFrozen(snapshots.research_desk.trendResult.rows));
  assert.ok(!('actions' in snapshots.research_desk));
  assert.ok(!('buttons' in snapshots.research_desk));
});

test('workstation popover: selected Research Desk renders trend result rows', () => {
  const hotspot = WORKSTATION_HOTSPOTS.find((candidate) => candidate.id === 'researchMonitorHotspot');
  const component = componentForHotspot(hotspot, [], {
    stationSnapshots: {
      research_desk: {
        stationId: 'research_desk',
        label: 'Research Desk',
        currentWork: { count: 0, items: [] },
        lastResult: null,
        latestFailure: null,
        trendResult: {
          taskId: 'task-research-done',
          keyword: 'cozy',
          rows: [
            { item: 'Tree lamp', score: 0.95 },
            { item: 'Moss shelf', score: 0.82 },
          ],
        },
      },
    },
  });

  assert.deepEqual(component.popoverViewModel.lines, ['Top trends: cozy', 'Tree lamp 0.95']);
  assert.equal(component.inspectionViewModel.statusLabel, 'Trend results');
  assert.ok(component.inspectionViewModel.lines.includes('Trend: cozy'));
  assert.ok(component.inspectionViewModel.taskSummaries.includes('Tree lamp 0.95'));
  assert.ok(component.inspectionViewModel.taskSummaries.includes('Moss shelf 0.82'));
  assert.ok(!('actions' in component.popoverViewModel));
  assert.ok(!('buttons' in component.popoverViewModel));
  assert.ok(!('actions' in component.inspectionViewModel));
  assert.ok(!('buttons' in component.inspectionViewModel));
});
