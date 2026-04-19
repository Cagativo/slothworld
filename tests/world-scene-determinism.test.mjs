/**
 * world-scene-determinism.test.mjs
 *
 * Asserts that the WorldScene pipeline is fully deterministic:
 * identical graph input must always produce identical output at every stage.
 *
 * Covered modules:
 *   rendering/world-scene.js         — buildWorldScene()
 *   rendering/world-scene-adapter.js — toRenderableComponents()
 *   rendering/zone-renderer.js       — buildEntityPositionMap()
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildWorldScene } from '../rendering/world-scene.js';
import { toRenderableComponents } from '../rendering/world-scene-adapter.js';
import { buildEntityPositionMap } from '../rendering/zone-renderer.js';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 't1', type: 'task',   status: 'created',          metadata: { duration: null,  queueTime: null,  latency: null,  incidents: [] } },
    { id: 't2', type: 'task',   status: 'enqueued',         metadata: { duration: null,  queueTime: 10,    latency: null,  incidents: [] } },
    { id: 't3', type: 'task',   status: 'claimed',          metadata: { duration: null,  queueTime: 5,     latency: null,  incidents: [] } },
    { id: 't4', type: 'task',   status: 'executing',        metadata: { duration: null,  queueTime: 8,     latency: null,  incidents: [] } },
    { id: 't5', type: 'task',   status: 'execute_finished', metadata: { duration: 300,   queueTime: 12,    latency: null,  incidents: [] } },
    { id: 't6', type: 'task',   status: 'acked',            metadata: { duration: 400,   queueTime: 6,     latency: 3,     incidents: [] } },
    { id: 't7', type: 'task',   status: 'completed',        metadata: { duration: 250,   queueTime: 4,     latency: 2,     incidents: [] } },
    { id: 't8', type: 'task',   status: 'failed',           metadata: { duration: 100,   queueTime: 7,     latency: null,  incidents: [{ clusterType: 'timeout', severity: 'high' }] } },
    { id: 'w1', type: 'worker', status: 'idle',             metadata: {} },
  ],
  edges: [
    { id: 'e1', from: 't1', to: 't2' },
    { id: 'e2', from: 't2', to: 't3' },
    { id: 'e3', from: 't3', to: 't5' },
    { id: 'e4', from: 't5', to: 't6' },
  ],
  metadata: { snapshotAt: 1000 },
};

/** Deep-clone a value so mutations in one run cannot affect another. */
function clone(v) { return JSON.parse(JSON.stringify(v)); }

/** Stable JSON serialisation used for equality comparison. */
function stable(v) { return JSON.stringify(v); }

// ---------------------------------------------------------------------------
// Helpers that run the full pipeline once
// ---------------------------------------------------------------------------

function runScene(graph)      { return buildWorldScene(graph); }
function runComponents(graph) { return toRenderableComponents(runScene(graph)); }
function runPositions(graph)  { return buildEntityPositionMap(runComponents(graph)); }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorldScene determinism', () => {

  describe('buildWorldScene', () => {
    it('produces identical output on two independent runs with the same input', () => {
      const a = runScene(clone(GRAPH));
      const b = runScene(clone(GRAPH));
      assert.equal(stable(a), stable(b));
    });

    it('entity count matches non-zone node count', () => {
      const { entities } = runScene(clone(GRAPH));
      const nonZoneNodes = GRAPH.nodes.filter(n => n.type !== 'zone');
      assert.equal(entities.length, nonZoneNodes.length);
    });

    it('connection count matches edge count', () => {
      const { connections } = runScene(clone(GRAPH));
      assert.equal(connections.length, GRAPH.edges.length);
    });

    it('entity order matches node order in input', () => {
      const { entities } = runScene(clone(GRAPH));
      const ids = entities.map(e => e.id);
      const expected = GRAPH.nodes.filter(n => n.type !== 'zone').map(n => n.id);
      assert.deepEqual(ids, expected);
    });

    it('does not mutate the input graph', () => {
      const original = clone(GRAPH);
      runScene(GRAPH);
      assert.equal(stable(GRAPH), stable(original));
    });

    it('three runs all produce identical scenes', () => {
      const results = [runScene(clone(GRAPH)), runScene(clone(GRAPH)), runScene(clone(GRAPH))];
      assert.equal(stable(results[0]), stable(results[1]));
      assert.equal(stable(results[1]), stable(results[2]));
    });
  });

  describe('toRenderableComponents', () => {
    it('produces identical output on two independent runs', () => {
      const a = runComponents(clone(GRAPH));
      const b = runComponents(clone(GRAPH));
      assert.equal(stable(a), stable(b));
    });

    it('component order is stable: zones → connections → entities', () => {
      const comps = runComponents(clone(GRAPH));
      const types = comps.map(c => c.componentType);
      const lastZone   = types.lastIndexOf('zone-background');
      const firstFlow  = types.indexOf('flow-line');
      const firstAgent = types.indexOf('agent-sprite');

      if (lastZone !== -1 && firstFlow !== -1)  assert.ok(lastZone  < firstFlow,  'zones before flow-lines');
      if (firstFlow !== -1 && firstAgent !== -1) assert.ok(firstFlow < firstAgent, 'flow-lines before agents');
    });

    it('agent-sprite count equals entity count from buildWorldScene', () => {
      const scene = runScene(clone(GRAPH));
      const comps  = toRenderableComponents(scene);
      const agents = comps.filter(c => c.componentType === 'agent-sprite');
      assert.equal(agents.length, scene.entities.length);
    });

    it('flow-line count equals connection count from buildWorldScene', () => {
      const scene = runScene(clone(GRAPH));
      const comps  = toRenderableComponents(scene);
      const flows  = comps.filter(c => c.componentType === 'flow-line');
      assert.equal(flows.length, scene.connections.length);
    });

    it('does not mutate the input scene', () => {
      const scene    = runScene(clone(GRAPH));
      const original = clone(scene);
      toRenderableComponents(scene);
      assert.equal(stable(scene), stable(original));
    });

    it('three runs all produce identical component lists', () => {
      const results = [runComponents(clone(GRAPH)), runComponents(clone(GRAPH)), runComponents(clone(GRAPH))];
      assert.equal(stable(results[0]), stable(results[1]));
      assert.equal(stable(results[1]), stable(results[2]));
    });
  });

  describe('buildEntityPositionMap', () => {
    it('produces identical positions on two independent runs', () => {
      const a = runPositions(clone(GRAPH));
      const b = runPositions(clone(GRAPH));
      // Map → sorted entries for stable comparison
      const toObj = m => Object.fromEntries([...m.entries()].sort((x, y) => x[0].localeCompare(y[0])));
      assert.equal(stable(toObj(a)), stable(toObj(b)));
    });

    it('returns an entry for every agent-sprite component', () => {
      const comps    = runComponents(clone(GRAPH));
      const posMap   = buildEntityPositionMap(comps);
      const agentIds = comps.filter(c => c.componentType === 'agent-sprite').map(c => c.id);
      for (const id of agentIds) {
        assert.ok(posMap.has(id), `position missing for entity ${id}`);
      }
    });

    it('every position has numeric x and y', () => {
      const posMap = runPositions(clone(GRAPH));
      for (const [id, pos] of posMap) {
        assert.equal(typeof pos.x, 'number', `${id}.x`);
        assert.equal(typeof pos.y, 'number', `${id}.y`);
      }
    });

    it('entities in the same zone get distinct x positions (different slots) when zone-background exists', () => {
      // Add a CLAIMED zone node so a zone-background component is generated,
      // enabling slot assignment in buildEntityPositionMap.
      const graphWithZone = clone(GRAPH);
      graphWithZone.nodes.push({ id: 'CLAIMED', type: 'zone', status: 'zone',
        position: { x: 440, y: 160 }, size: { width: 160, height: 200 } });

      const comps  = runComponents(graphWithZone);
      const posMap = buildEntityPositionMap(comps);
      const p3 = posMap.get('t3');
      const p4 = posMap.get('t4');
      assert.ok(p3 && p4, 'both positions exist');
      assert.notEqual(p3.x, p4.x, 't3 and t4 must have different slot x');
    });

    it('entities in the same zone receive different slot positions', () => {
      // buildWorldScene always produces zone-background components from LIFECYCLE_ZONES,
      // so entities sharing a zone are slotted at different x positions within it.
      const posMap = runPositions(clone(GRAPH));
      const p3 = posMap.get('t3');
      const p4 = posMap.get('t4');
      assert.ok(p3 && p4, 'both positions exist');
      // t3 (claimed) and t4 (executing → CLAIMED) share the CLAIMED zone; slots differ
      assert.notEqual(p3.x, p4.x, 't3 and t4 must have different slot x within CLAIMED zone');
    });

    it('three runs all produce identical position maps', () => {
      const toObj = m => Object.fromEntries([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
      const results = [runPositions(clone(GRAPH)), runPositions(clone(GRAPH)), runPositions(clone(GRAPH))];
      assert.equal(stable(toObj(results[0])), stable(toObj(results[1])));
      assert.equal(stable(toObj(results[1])), stable(toObj(results[2])));
    });
  });

  describe('full pipeline determinism', () => {
    it('same graph → same scene → same components → same positions on two full runs', () => {
      const toObj = m => Object.fromEntries([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));

      const sceneA = runScene(clone(GRAPH));
      const compsA = toRenderableComponents(sceneA);
      const posA   = toObj(buildEntityPositionMap(compsA));

      const sceneB = runScene(clone(GRAPH));
      const compsB = toRenderableComponents(sceneB);
      const posB   = toObj(buildEntityPositionMap(compsB));

      assert.equal(stable(sceneA), stable(sceneB),   'scenes identical');
      assert.equal(stable(compsA), stable(compsB),   'components identical');
      assert.equal(stable(posA),   stable(posB),     'positions identical');
    });
  });

});
