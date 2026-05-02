// contracts/TrendResearchWorkflow.contracts.js

/**
 * @typedef {{ keyword: string }} CollectSignalsInput
 * @typedef {{ signals: string[] }} CollectSignalsOutput
 *
 * @typedef {{ signals: string[] }} ScoreTrendsInput
 * @typedef {{ scored: Array<{ item: string, score: number }> }} ScoreTrendsOutput
 *
 * @typedef {{ scored: Array<{ item: string, score: number }> }} SelectCandidatesInput
 * @typedef {{ candidates: string[] }} SelectCandidatesOutput
 *
 * @typedef {{ candidates: string[] }} ProduceFinalOutputInput
 * @typedef {{ ranked: string[] }} ProduceFinalOutputOutput
 */

export const TrendResearchWorkflowContracts = {
  CollectSignals:     { input: 'CollectSignalsInput',     output: 'CollectSignalsOutput' },
  ScoreTrends:        { input: 'ScoreTrendsInput',        output: 'ScoreTrendsOutput' },
  SelectCandidates:   { input: 'SelectCandidatesInput',   output: 'SelectCandidatesOutput' },
  ProduceFinalOutput: { input: 'ProduceFinalOutputInput', output: 'ProduceFinalOutputOutput' },
};
