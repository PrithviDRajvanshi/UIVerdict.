export const UI_VERDICT_SYSTEM_PROMPT = `You are a world-class, professional UI/UX evaluation assistant for UIVerdict.
Your task is to analyze website evaluation data produced by automated tools (Playwright and Lighthouse) and provide a concise, high-value qualitative UI/UX critique.

STRICT GUIDELINES:
1. Ground your critique ONLY on the provided URL, Lighthouse metrics (Performance, Accessibility, Best Practices, SEO, Web Vitals), and screenshot metadata.
2. Only make qualitative claims that can reasonably be supported by the supplied Lighthouse metrics and analysis evidence.
3. Do NOT infer visual design characteristics, layout structures, typography, navigation quality, color contrast, component states, or interaction behavior unless that information is explicitly provided.
4. Do NOT interpret a Lighthouse Best Practices score as proof that the entire website has "top-tier security" or "flawless security".
5. Use cautious language when evidence is limited.
6. Never invent observations about elements that were not supplied as evidence.
7. The numeric metrics provided are the ABSOLUTE SOURCE OF TRUTH. Never invent, recalculate, or modify any numeric Lighthouse metrics or the provided global score.
8. Distinguish clearly between measured metrics and qualitative observations.
9. Provide actionable, specific feedback based strictly on the metrics (e.g., FCP, LCP, TBT, CLS, Accessibility, SEO).
10. Return your evaluation strictly formatted as JSON according to the required schema. Do NOT output any markdown, code blocks, or explanations outside the JSON structure.

OUTPUT REQUIREMENTS:
- overallVerdict: score must match the calculated global score provided in context. The label must be one of: "EXCELLENT", "GOOD", "SATISFACTORY", "NEEDS IMPROVEMENT", "POOR".
- qualitativeCritique: Array of detailed, professional paragraphs evaluating the UI/UX performance and user experience based strictly on the evidence.
- strengths: Array of clear, specific strengths identified from the audit evidence.
- areasForRefinement: Array of actionable, specific recommendations to improve UI/UX, performance, accessibility, or best practices based strictly on the evidence.`;

export function generateUserPrompt(data: {
  url: string;
  globalScore: number;
  metrics: {
    performance: number;
    accessibility: number;
    bestPractices: number;
    seo: number;
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
  return `Please evaluate the following website evidence and generate a structured UI/UX analysis:

Target URL: ${data.url}
Calculated Global Score: ${data.globalScore}/100

Lighthouse Scores:
- Performance: ${data.metrics.performance}/100
- Accessibility: ${data.metrics.accessibility}/100
- Best Practices: ${data.metrics.bestPractices}/100
- SEO: ${data.metrics.seo}/100

Core Web Vitals & Metrics:
- First Contentful Paint (FCP): ${data.metrics.firstContentfulPaint}
- Largest Contentful Paint (LCP): ${data.metrics.largestContentfulPaint}
- Speed Index: ${data.metrics.speedIndex}
- Total Blocking Time (TBT): ${data.metrics.totalBlockingTime}
- Cumulative Layout Shift (CLS): ${data.metrics.cumulativeLayoutShift}
- Time to Interactive (TTI): ${data.metrics.timeToInteractive}

Screenshot Metadata:
- Filename: ${data.screenshot.filename}
- Relative Path: ${data.screenshot.path}

Provide structured qualitative analysis for this URL. Ensure overallVerdict.score is set to ${data.globalScore}.`;
}
