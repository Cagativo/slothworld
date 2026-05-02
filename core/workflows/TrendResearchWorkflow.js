// core/workflows/TrendResearchWorkflow.js
import { createWorkflow } from '../workflow.js';

export function createTrendResearchWorkflow(keyword) {
  return createWorkflow({
    context: { keyword },
    shouldPlan: false,
    steps: [
      {
        action: 'CollectSignals',
        contextKey: 'collect_signals',
        title: 'Collect Signals',
        description: `Collect raw signals for keyword: ${keyword}`,
        complexity: 'low',
        rolePreference: 'researcher',
      },
      {
        action: 'ScoreTrends',
        contextKey: 'score_trends',
        title: 'Score Trends',
        description: 'Score collected signals by relevance',
        complexity: 'med',
        rolePreference: 'researcher',
      },
      {
        action: 'SelectCandidates',
        contextKey: 'select_candidates',
        title: 'Select Candidates',
        description: 'Select top candidates from scored trends',
        complexity: 'low',
        rolePreference: 'any',
      },
      {
        action: 'ProduceFinalOutput',
        contextKey: 'produce_final_output',
        title: 'Produce Final Output',
        description: 'Produce final ranked output',
        complexity: 'low',
        rolePreference: 'any',
      },
    ],
  });
}
