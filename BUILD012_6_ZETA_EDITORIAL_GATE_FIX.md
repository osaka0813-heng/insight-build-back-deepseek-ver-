# Build012.6 Zeta — Draft Below Threshold

Observed message:
`Candidate does not meet the publication threshold.`

This was not a Writer failure. Analyze deliberately classified the candidate as
`no_new_global_insight`, and the Write endpoint blocked all drafting.

Product correction:
- Analyze decides whether normal publication is recommended.
- Writer may still create a complete editorial draft for human review.
- A below-threshold draft keeps `qualityChecks.publishThresholdMet = false`.
- Normal approval remains disabled in the editor.
- Publication requires the existing explicit human-override path.
- The API returns `editorialGate` metadata explaining the decision.

This separates:
1. ability to draft and inspect content
2. permission to publish content

No frontend update is required.
