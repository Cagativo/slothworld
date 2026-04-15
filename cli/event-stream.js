#!/usr/bin/env node

/**
 * Slothworld EventBus CLI
 * 
 * Quick debugging and observability tool for event streams
 * 
 * Usage:
 *   node cli/event-stream.js watch                  [Watch events in real-time]
 *   node cli/event-stream.js list [limit]           [List recent events]
 *   node cli/event-stream.js task <taskId>          [Show task history]
 *   node cli/event-stream.js stats                  [Show event statistics]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createEventBus } from '../core/engine/eventBus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, '..', 'bridge-store.json');

function loadEvents() {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      return [];
    }

    const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return Array.isArray(data.events) ? data.events : [];
  } catch (error) {
    console.error('Failed to load events:', error.message);
    return [];
  }
}

function formatTimestamp(ts) {
  const date = new Date(ts);
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

function printEvent(event, index) {
  const timestamp = formatTimestamp(event.timestamp);
  const taskId = (event.taskId || '-').substring(0, 20).padEnd(20);
  const type = (event.type || '-').padEnd(25);
  const payload = event.payload ? JSON.stringify(event.payload).substring(0, 40) : '';
  
  console.log(`${String(index + 1).padStart(4)} │ ${timestamp} │ ${taskId} │ ${type} │ ${payload}`);
}

function command_list(limit = 50) {
  const events = loadEvents();
  const shown = events.slice(-limit);
  
  console.log(`\n📋 Recent Events (showing last ${Math.min(limit, events.length)} of ${events.length})\n`);
  console.log(' ID  │ Timestamp            │ Task ID              │ Event Type               │ Payload');
  console.log('─────┼──────────────────────┼──────────────────────┼──────────────────────────┼─────────────────────────────────────────');
  
  shown.forEach((event, idx) => {
    printEvent(event, events.length - shown.length + idx);
  });
  
  console.log('');
}

function command_task(taskId) {
  const events = loadEvents();
  const taskEvents = events.filter((e) => e.taskId === taskId);
  
  if (taskEvents.length === 0) {
    console.log(`\n❌ No events found for task: ${taskId}\n`);
    return;
  }

  console.log(`\n📖 Task History: ${taskId}\n`);
  console.log('Step │ Timestamp            │ Event Type               │ Payload');
  console.log('─────┼──────────────────────┼──────────────────────────┼─────────────────────────────────────────');
  
  taskEvents.forEach((event, idx) => {
    const timestamp = formatTimestamp(event.timestamp);
    const type = (event.type || '-').padEnd(25);
    const payload = event.payload ? JSON.stringify(event.payload) : '{}';
    
    console.log(`${String(idx + 1).padStart(4)} │ ${timestamp} │ ${type} │ ${payload}`);
  });

  // Reconstruct state
  const eventBus = createEventBus();
  taskEvents.forEach((e) => {
    eventBus._getInternalEventBus().emit(e);
  });
  
  const state = eventBus.replayTaskState(taskId);
  console.log(`\n📊 Reconstructed State:`);
  console.log(`   Status: ${state.status}`);
  console.log(`   Events: ${state.eventCount}`);
  console.log(`\n`);
}

function command_stats() {
  const events = loadEvents();
  
  const stats = {
    total: events.length,
    byType: {},
    byTask: {},
    byStatus: {},
    timeRange: null
  };

  events.forEach((e) => {
    stats.byType[e.type] = (stats.byType[e.type] || 0) + 1;
    stats.byTask[e.taskId] = (stats.byTask[e.taskId] || 0) + 1;
    if (e.payload?.status) {
      stats.byStatus[e.payload.status] = (stats.byStatus[e.payload.status] || 0) + 1;
    }
  });

  if (events.length > 0) {
    const first = new Date(events[0].timestamp);
    const last = new Date(events[events.length - 1].timestamp);
    stats.timeRange = {
      first: first.toISOString(),
      last: last.toISOString(),
      durationMs: last - first
    };
  }

  console.log(`\n📊 Event Statistics\n`);
  console.log(`Total Events: ${stats.total}`);
  
  if (stats.timeRange) {
    console.log(`Time Range: ${stats.timeRange.duration || ''}`);
    console.log(`  From: ${stats.timeRange.first}`);
    console.log(`  To:   ${stats.timeRange.last}`);
  }

  console.log(`\nEvent Types:`);
  Object.entries(stats.byType)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`  ${type.padEnd(30)} ${count}`);
    });

  console.log(`\nUnique Tasks: ${Object.keys(stats.byTask).length}`);
  console.log(`\nTask Status Distribution:`);
  Object.entries(stats.byStatus).forEach(([status, count]) => {
    console.log(`  ${status.padEnd(20)} ${count}`);
  });

  console.log('');
}

function command_watch() {
  console.log('\n👀 Watching events (not implemented yet)');
  console.log('   Implement WebSocket endpoint in bridge-server.js for real-time updates\n');
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'list';

  switch (cmd) {
    case 'list':
      command_list(parseInt(args[1]) || 50);
      break;
    case 'task':
      if (!args[1]) {
        console.log('Usage: node event-stream.js task <taskId>');
        process.exit(1);
      }
      command_task(args[1]);
      break;
    case 'stats':
      command_stats();
      break;
    case 'watch':
      command_watch();
      break;
    case 'help':
    case '--help':
    case '-h':
      console.log(`
  🔍 Slothworld EventBus CLI

  Commands:

    list [limit]        Show recent events (default: 50)
    task <taskId>       Show event history for a specific task
    stats               Show event statistics
    watch               Watch events in real-time (WebSocket)
    help                Show this message

  Examples:

    node cli/event-stream.js list 100
    node cli/event-stream.js task task-12345
    node cli/event-stream.js stats
`);
      break;
    default:
      console.log(`Unknown command: ${cmd}`);
      console.log('Try: node event-stream.js help');
      process.exit(1);
  }
}

main();
