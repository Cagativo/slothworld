import { AsyncLocalStorage } from 'node:async_hooks';

const runtimeContext = new AsyncLocalStorage();
let taskEngineCallerKey = null;

function violation() {
  throw new Error('ENGINE_ENFORCEMENT_VIOLATION');
}

export function registerTaskEngineCallerKey(key) {
  if (taskEngineCallerKey !== null) {
    violation();
  }

  taskEngineCallerKey = key;
}

export function runInTaskEngineExecutionContext(taskId, key, fn) {
  if (!key || taskEngineCallerKey === null || key !== taskEngineCallerKey) {
    violation();
  }

  return runtimeContext.run({
    taskId,
    engineExecution: true,
    workerExecution: true,
    providerExecution: true,
    sideEffectExecution: true
  }, fn);
}

export function getTaskEngineRuntimeContext() {
  return runtimeContext.getStore() || null;
}

export function assertTaskEngineExecutionContext() {
  const ctx = runtimeContext.getStore();
  if (!ctx || ctx.engineExecution !== true) {
    violation();
  }
}

export function assertWorkerExecutionContext() {
  const ctx = runtimeContext.getStore();
  if (!ctx || ctx.workerExecution !== true) {
    violation();
  }
}

export function assertProviderExecutionContext() {
  const ctx = runtimeContext.getStore();
  if (!ctx || ctx.providerExecution !== true) {
    violation();
  }
}

export function assertSideEffectExecutionContext() {
  const ctx = runtimeContext.getStore();
  if (!ctx || ctx.sideEffectExecution !== true) {
    violation();
  }
}
