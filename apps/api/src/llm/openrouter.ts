export interface CallOpenRouterArgs {
  prompt: string;
  purpose: string;
  maxTokens?: number;
  model?: string;
}

export interface CallOpenRouterResult {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model: string;
}

export async function callOpenRouter(_args: CallOpenRouterArgs): Promise<CallOpenRouterResult> {
  throw new Error('callOpenRouter not implemented (skeleton)');
}
