# UIVerdict scoring decision

## Dimensions

`visualDesignScore` is the model's 0–100 assessment of the rendered screenshot only. Performance, Accessibility, Best Practices, and SEO remain Lighthouse measurements with their existing 0–100 provenance. Missing inputs remain unavailable.

For new records, the overall score is emitted only when all five dimensions are present and valid. It is the equal-weight geometric mean:

`(visualDesignScore × performance × accessibility × bestPractices × seo)^(1/5)`

A measured zero produces zero. The value is rounded to one decimal place, and the centralized verdict thresholds classify that rounded score. Existing records retain their saved overall score and label; their new visual score stays unavailable because it cannot be reconstructed from the old combined value.

## Severity cap

The existing below-40 cap is retained: if any of the five dimensions is below 40, the overall score cannot exceed 59.9. This makes a critical weakness visible in the summary label while preserving each raw dimension for diagnosis. It applies only to the combined overall score, not to visual or Lighthouse measurements. The cap is a product severity policy, not an empirically calibrated psychometric rule; its effect is covered by synthetic tests and should be reviewed against human-rated real-world examples before claiming calibration.

## Calibration evidence

The ecommerce, SaaS, portfolio, news, and poor-interface fixtures in `tests/scoring-calibration.test.ts` are synthetic examples that exercise formula behavior and expected rankings. They do not demonstrate calibration against real websites. No saved real-world report was changed or used as calibration evidence, so real-world calibration remains outstanding.
