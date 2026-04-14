import type { TaskContext } from '../../../core/types/TaskContext';
import type { ImageResult } from '../../../core/types/ImageResult';

export interface ImageProvider {
  generate(prompt: string, context: TaskContext): Promise<ImageResult>;
}
