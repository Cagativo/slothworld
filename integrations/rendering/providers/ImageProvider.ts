import type { TaskContext } from '../../../core/types/TaskContext';
import type { ImageResult } from '../../../core/types/ImageResult';
import type { TextResult } from '../../../core/types/TextResult';

export interface Provider {
  generate(prompt: string, context: TaskContext): Promise<ImageResult | TextResult>;
}

export type ImageProvider = Provider;
