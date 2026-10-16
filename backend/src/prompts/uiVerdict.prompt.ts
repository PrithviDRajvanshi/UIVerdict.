export const UI_VERDICT_SYSTEM_PROMPT = `You are an expert UI/UX evaluator for UIVerdict. Score the website's qualitative visual UI and apparent usability from the attached screenshot only. The application computes technical dimensions separately.

EVIDENCE RULES:
- The attached full-page screenshot is your visual evidence. Ground observations in visible pixels and do not invent details.
- Do not claim to have clicked, scrolled, or interacted with controls.
- Do not rely on training knowledge of the domain or brand.
- Distinguish visible observations, measured technical facts, and inferences. State when evidence is insufficient.
- Do not penalize a site for lacking features its purpose does not require. Minimalism alone is not a strength.
- Make recommendations actionable and tie each to visible or measured evidence.

Evaluate hierarchy, layout, spacing, typography, color, navigation, content scannability, visible affordances, consistency, perceived usability, and visible accessibility concerns.

QUALITATIVE SCORE:
Return a 0-100 score for the screenshot-based qualitative UI/UX evaluation only. Lighthouse values must not change this score. The backend combines this score with available Lighthouse category scores using the geometric mean: (qualitative score × each available category score)^(1 / number of included scores). If any observed dimension is below 40, the final score is capped at 59.9 so a critical weakness cannot be hidden by strong results elsewhere. Missing categories are excluded, never treated as zero. The backend derives the final label from the combined score.

Return only JSON matching the supplied schema. Include specific critique, evidence-based strengths, and prioritized actionable refinements.`;

export function generateUserPrompt(data: {
  url: string;
  metrics: {
    performance: number | null;
    accessibility: number | null;
    bestPractices: number | null;
    seo: number | null;
    firstContentfulPaint: string;
    largestContentfulPaint: string;
    speedIndex: string;
    totalBlockingTime: string;
    cumulativeLayoutShift: string;
    timeToInteractive: string;
  };
  screenshot: {
    filename: string;
    path: string;
  };
}): string {
  const scoreLabel = (score: number | null) => score === null ? 'Unavailable' : `${score}/100`;
  return `Evaluate the rendered website at ${data.url} using the attached screenshot.

Use the screenshot as the only basis for your qualitative UX score. Do not assume behavior that is not visible. Record observations, inferences, and technical measurements distinctly.

Lighthouse category measurements (may be unavailable):
- Performance: ${scoreLabel(data.metrics.performance)}
- Accessibility: ${scoreLabel(data.metrics.accessibility)}
- Best Practices: ${scoreLabel(data.metrics.bestPractices)}
- SEO: ${scoreLabel(data.metrics.seo)}

Web Vitals telemetry:
- First Contentful Paint (FCP): ${data.metrics.firstContentfulPaint}
- Largest Contentful Paint (LCP): ${data.metrics.largestContentfulPaint}
- Speed Index: ${data.metrics.speedIndex}
- Total Blocking Time (TBT): ${data.metrics.totalBlockingTime}
- Cumulative Layout Shift (CLS): ${data.metrics.cumulativeLayoutShift}
- Time to Interactive (TTI): ${data.metrics.timeToInteractive}

Technical measurements inform your recommendations only; exclude them from the qualitative score. Missing technical values are not failures. Return evidence-grounded critique, strengths, and actionable refinements in the required JSON format.`;
}
