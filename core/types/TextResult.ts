export interface TextResult {
  text: string;
  provider: string;
  createdAt: number;
  metadata?: Record<string, any>;
}
