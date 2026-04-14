export interface TaskContext {
  taskId: string;
  workflowId?: string;
  source?: 'ui' | 'discord' | 'api';
  retryCount?: number;
  metadata?: Record<string, any>;
}
