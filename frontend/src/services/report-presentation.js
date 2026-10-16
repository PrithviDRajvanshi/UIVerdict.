export function getReportPresentation(status, aiStatus) {
  const validated = status === 'COMPLETED';
  const targetMessage = status === 'BLOCKED'
    ? 'The website prevented the analyzer from reaching its intended interface.'
    : status === 'INCONCLUSIVE'
    ? 'The analyzer could not reliably confirm the intended page.'
    : status === 'FAILED'
    ? 'This analysis failed before a reliable report could be completed.'
    : null;
  return {
    validated,
    retryAvailable: status === 'BLOCKED' || status === 'INCONCLUSIVE',
    targetMessage,
    aiUnavailable: validated && aiStatus === 'UNAVAILABLE',
    scoresAvailable: validated,
  };
}
