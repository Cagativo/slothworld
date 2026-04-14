export interface ImageResult {
  path?: string;
  prompt: string;
  provider: string;
  createdAt: number;
  contentBase64?: string;
  mimeType?: string;
  metadata?: Record<string, any>;
}
