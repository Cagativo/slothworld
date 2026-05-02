// contracts/TrendResearchWorkflow.contracts.js

/**
 * @typedef {{ keyword: string }} CollectSignalsInput
 * @typedef {{ signals: string[] }} CollectSignalsOutput
 *
 * @typedef {{ signals: string[] }} ScoreTrendsInput
 * @typedef {{ scored: Array<{ item: string, score: number }> }} ScoreTrendsOutput
 *
 * @typedef {{ scored: Array<{ item: string, score: number }> }} SelectCandidatesInput
 * @typedef {{ candidates: Array<{ item: string, score: number }> }} SelectCandidatesOutput
 *
 * @typedef {{ candidates: Array<{ item: string, score: number }> }} ProduceFinalOutputInput
 * @typedef {{ ranked: string[] }} ProduceFinalOutputOutput
 */

export const TrendResearchWorkflowContracts = {
  CollectSignals:     { input: 'CollectSignalsInput',     output: 'CollectSignalsOutput' },
  ScoreTrends:        { input: 'ScoreTrendsInput',        output: 'ScoreTrendsOutput' },
  SelectCandidates:   { input: 'SelectCandidatesInput',   output: 'SelectCandidatesOutput' },
  ProduceFinalOutput: { input: 'ProduceFinalOutputInput', output: 'ProduceFinalOutputOutput' },
};
