import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildWorkstationStatusSnapshots, selectLatestGeneratedImageAsset } from '../ui/selectors/workstationStatusSelectors.js';
import {
  buildResearchDeskResultCardViewModel,
  buildWorkstationPopoverViewModel,
} from '../ui/hotspots/workstationSemantics.js';
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

test('workstation status selectors: research_desk snapshot exposes trend analysis', () => {
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
          analysis: {
            summary: 'Cozy home products are the strongest cluster.',
            recommendation: 'Lead with compact room comfort.',
            opportunities: ['Small apartment bundle'],
            risks: ['Seasonality'],
            confidence: 0.77,
            provider: 'ollama',
            model: 'llama3.1:8b',
          },
          results: [
            { item: 'Tree lamp', score: 0.95 },
          ],
        },
      },
    ],
  });

  assert.equal(snapshots.research_desk.trendResult.analysis.summary, 'Cozy home products are the strongest cluster.');
  assert.equal(snapshots.research_desk.trendResult.analysis.recommendation, 'Lead with compact room comfort.');
  assert.deepEqual(snapshots.research_desk.trendResult.analysis.opportunities, ['Small apartment bundle']);
  assert.equal(snapshots.research_desk.trendResult.analysis.provider, 'ollama');
  assert.ok(Object.isFrozen(snapshots.research_desk.trendResult.analysis));
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

  assert.deepEqual(component.popoverViewModel.lines, ['Top signal: Tree lamp 0.95']);
  assert.equal(component.inspectionViewModel.statusLabel, 'Trend results');
  assert.ok(component.inspectionViewModel.lines.includes('Top signal: Tree lamp 0.95'));
  assert.ok(component.inspectionViewModel.taskSummaries.includes('Tree lamp 0.95'));
  assert.ok(component.inspectionViewModel.taskSummaries.includes('Moss shelf 0.82'));
  assert.ok(!('actions' in component.popoverViewModel));
  assert.ok(!('buttons' in component.popoverViewModel));
  assert.ok(!('actions' in component.inspectionViewModel));
  assert.ok(!('buttons' in component.inspectionViewModel));
});

test('workstation popover: Research Desk prioritizes trend analysis before ranked rows', () => {
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
          analysis: {
            summary: 'Cozy home products are the strongest cluster.',
            recommendation: 'Lead with compact room comfort.',
            opportunities: ['Small apartment bundle'],
          },
          rows: [
            { item: 'Tree lamp', score: 0.95 },
            { item: 'Moss shelf', score: 0.82 },
          ],
        },
      },
    },
  });

  assert.deepEqual(component.popoverViewModel.lines, [
    'Trend results: Cozy home products are the strongest cluster.',
    'Recommendation: Lead with compact room comfort.'
  ]);
  assert.equal(component.inspectionViewModel.statusLabel, 'Trend results');
  assert.deepEqual(component.inspectionViewModel.lines, [
    'Trend results: Cozy home products are the strongest cluster.',
    'Recommendation: Lead with compact room comfort.',
    'Top signal: Tree lamp 0.95'
  ]);
  assert.deepEqual(component.inspectionViewModel.taskSummaries, [
    'Trend results: Cozy home products are the strongest cluster.',
    'Recommendation: Lead with compact room comfort.',
    'Top signal: Tree lamp 0.95'
  ]);
  assert.deepEqual(component.resultCardViewModel.rows.map((row) => `${row.label}: ${row.text}`), [
    'Trend results: Cozy home products are the strongest cluster.',
    'Recommendation: Lead with compact room comfort.',
    'Top signal: Tree lamp 0.95'
  ]);
});

test('workstation semantics: Research Desk result card deduplicates repeated analysis lines', () => {
  const card = buildResearchDeskResultCardViewModel({
    trendResult: {
      taskId: 'task-research-done',
      keyword: 'cozy',
      analysis: {
        summary: 'Mixed trends in fitness.',
        recommendation: 'Mixed trends in fitness.',
      },
      rows: [
        { item: 'Mixed trends in fitness.', score: null },
        { item: 'Monitor growth and habits', score: 0.82 },
      ],
    },
  });

  assert.ok(card);
  assert.deepEqual(card.rows.map((row) => `${row.label}: ${row.text}`), [
    'Trend results: Mixed trends in fitness.',
    'Top signal: Monitor growth and habits 0.82'
  ]);
});

test('workstation semantics: Research Desk unavailable analysis falls back to ranked evidence', () => {
  const card = buildResearchDeskResultCardViewModel({
    trendResult: {
      taskId: 'task-research-done',
      keyword: 'cozy',
      analysis: {
        summary: 'Trend analysis was skipped because the local model did not respond in time.',
        recommendation: 'Use ranked trend evidence for now, or retry with a smaller/faster local model.',
        unavailable: true,
      },
      rows: [
        { item: 'Tree lamp', score: 0.95 },
      ],
    },
  });

  assert.ok(card);
  assert.deepEqual(card.rows.map((row) => `${row.label}: ${row.text}`), [
    'Trend results: Ranked evidence ready. Local AI summary unavailable.',
    'Top signal: Tree lamp 0.95'
  ]);
});

test('workstation status selectors: derives latest generated IMAGE_RENDER asset from safe task projection', () => {
  const tasks = [
    {
      id: 'render-old',
      title: 'Old image',
      type: 'image_render',
      status: 'done',
      createdAt: 100,
      updatedAt: 200,
      executionResult: {
        success: true,
        result: {
          contentBase64: 'must-not-project',
          imageBase64: 'must-not-project',
          path: '/home/continue/slothworld/assets/generated/render-old/old.png',
          asset: {
            id: 'asset-old',
            url: '/assets/generated/render-old/old.png',
            mimeType: 'image/png',
            provider: 'comfyui',
          },
        },
      },
    },
    {
      id: 'render-new',
      title: 'New image',
      type: 'image_render',
      status: 'acknowledged',
      createdAt: 300,
      updatedAt: 500,
      executionResult: {
        success: true,
        result: {
          imageUrl: '/assets/generated/render-new/new.png',
          assetId: 'asset-new',
          asset: {
            id: 'asset-new',
            url: '/assets/generated/render-new/new.png',
            mimeType: 'image/png',
            provider: 'comfyui',
          },
        },
      },
    },
  ];

  const model = selectLatestGeneratedImageAsset(tasks);
  assert.equal(model.kind, 'generatedImageAsset');
  assert.equal(model.taskId, 'render-new');
  assert.equal(model.title, 'New image');
  assert.equal(model.provider, 'comfyui');
  assert.deepEqual(model.asset, {
    id: 'asset-new',
    url: '/assets/generated/render-new/new.png',
    mimeType: 'image/png',
  });
  assert.equal(JSON.stringify(model).includes('contentBase64'), false);
  assert.equal(JSON.stringify(model).includes('imageBase64'), false);
  assert.equal(JSON.stringify(model).includes('/home/continue/slothworld'), false);
});

test('workstation status selectors: ignores IMAGE_RENDER tasks without a safe asset URL', () => {
  const model = selectLatestGeneratedImageAsset([
    {
      id: 'render-no-url',
      title: 'No URL',
      type: 'image_render',
      status: 'done',
      updatedAt: 900,
      executionResult: {
        success: true,
        result: {
          asset: {
            id: 'asset-no-url',
            path: '/home/continue/slothworld/assets/generated/render-no-url/out.png',
            mimeType: 'image/png',
            provider: 'comfyui',
          },
        },
      },
    },
  ]);

  assert.equal(model, null);
});

test('workstation status selectors: attaches generated image asset to render_desk snapshot', () => {
  const snapshots = buildWorkstationStatusSnapshots({
    tasks: [
      {
        id: 'render-preview',
        title: 'Preview image',
        type: 'image_render',
        status: 'done',
        updatedAt: 700,
        executionResult: {
          success: true,
          result: {
            asset: {
              id: 'asset-preview',
              url: '/assets/generated/render-preview/preview.png',
              mimeType: 'image/png',
              provider: 'comfyui',
            },
          },
        },
      },
    ],
    agents: [],
  });

  assert.equal(snapshots.render_desk.generatedImageAsset.taskId, 'render-preview');
  assert.equal(snapshots.render_desk.generatedImageAsset.asset.url, '/assets/generated/render-preview/preview.png');
});

test('workstation status selectors: graph metadata carries render_desk generated asset preview', () => {
  const snapshots = buildWorkstationStatusSnapshots({
    tasks: [
      {
        id: 'render-graph-preview',
        title: 'Graph preview image',
        type: 'image_render',
        status: 'done',
        updatedAt: 800,
        executionResult: {
          success: true,
          result: {
            asset: {
              id: 'asset-graph-preview',
              url: '/assets/generated/render-graph-preview/preview.png',
              mimeType: 'image/png',
              provider: 'comfyui',
            },
          },
        },
      },
    ],
    agents: [],
  });

  const graph = buildVisualWorldGraph(
    { tasks: [], agents: [], transitions: {} },
    { workstationSnapshots: snapshots }
  );

  assert.equal(
    graph.metadata.workstationSnapshots.render_desk.generatedImageAsset.asset.url,
    '/assets/generated/render-graph-preview/preview.png'
  );
});

test('renderer source uses generated image asset URL without raw bytes or provider imports', () => {
  const source = readFileSync(new URL('../rendering/world-scene-asset-renderer.js', import.meta.url), 'utf8');
  assert.match(source, /model\?\.asset\?\.url|model\.asset\.url/);
  assert.equal(/contentBase64|imageBase64/.test(source), false);
  assert.equal(/imageProviderRegistry|comfyUiProvider|openAIImageProvider|huggingFaceImageProvider|\/prompt\b|\/comfyui\b/.test(source), false);
});
