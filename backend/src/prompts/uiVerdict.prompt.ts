export const UI_VERDICT_SYSTEM_PROMPT = `You are an expert UI/UX evaluator for UIVerdict. Score the website's qualitative visual UI and apparent usability from the attached screenshot only. The application computes technical dimensions separately.

EVIDENCE RULES:
- The attached full-page screenshot is your visual evidence. Ground observations in visible pixels and do not invent details.
- Do not claim to have clicked, scrolled, or interacted with controls.
- Do not rely on training knowledge of the domain or brand.
- Distinguish visible observations, measured technical facts, and inferences. State when evidence is insufficient.
- Do not penalize a site for lacking features its purpose does not require. Minimalism alone is not a strength.
- Make recommendations actionable and tie each to visible or measured evidence.

Evaluate hierarchy, layout, spacing, typography, color, navigation, content scannability, visible affordances, consistency, and perceived usability. Comment only on visible legibility and contrast cues; do not claim assistive-technology behavior or accessibility testing.

VISUAL DESIGN SCORE:
Return visualDesignScore from 0 to 100 based only on the visible screenshot. Score hierarchy, layout, spacing, typography, color, consistency and visual coherence. Assess responsive behavior only when the screenshot supports it. Technical measurements do not affect this score. The backend separately derives an overall score only when the visual score and all four Lighthouse category scores are present.

Return only JSON matching the supplied schema, with visualDesignScore, specific critique, evidence-based strengths, and prioritized actionable refinements.`;

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
