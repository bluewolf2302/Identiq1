# Intelligent governance engine

IdentIQ combines deterministic text checks with semantic AI analysis. Deterministic
rules cover explicit terminology, product facts, prices, and approved claim
restrictions. The AI provider explains issues that require interpretation, but it
must use only the supplied brand context.

## Evidence and locations

Every semantic evidence reference must use a source ID from the retrieved brand
context. When source metadata is available, the source title and version must
match that source; versions are not treated as interchangeable across sources.
Evidence excerpts are accepted only when they occur in the approved context.
Unknown, fabricated, or unverifiable evidence is rejected rather than promoted
to a supported finding.

Visual evidence is validated against the rule that supplied it: rule ID, source
ID, source version, and excerpt must agree. If the visual context lacks source
metadata, no source title or version is invented.

Text locations are retained only when offsets are within the submitted content.
When an excerpt is supplied, the offsets must select that exact excerpt. An
excerpt without offsets may be located when it occurs unambiguously in the
submitted content; unverifiable locations are omitted.

## Duplicate findings

Deterministic findings are merged with semantic findings by category and verified
location, detected text, or matching evidence plus similar issue wording. Sharing
one guideline alone is not enough to merge findings. When a genuine duplicate is
found, the longer explanation and distinct valid evidence references are retained.

## Uncertainty

Unsupported claims remain unverified or require human review. The engine does not
invent legal requirements, certifications, source documents, or facts. Visual
claims that cannot be assessed from submitted text remain pending human review.
An AI status does not override this policy. Findings without sufficient evidence
or with confidence below `0.65` are marked `NEEDS_HUMAN_REVIEW`; the threshold
matches the existing OCR ambiguity baseline. Severity remains independent from
confidence, so a high-severity finding is not automatically high-confidence.

## Teralune limitations

The current Teralune fixture is fictional and contains extracted, structured
brand knowledge rather than original PDF contents or visual inspection. Source
validation therefore proves consistency with that supplied context only; it does
not prove the contents of an external document. Live provider availability and
provider model behaviour may also vary.

Run the ordinary automated suite with `npm.cmd test`. The live API smoke test,
`npm.cmd run ai:smoke:api`, requires a configured provider and is not part of the
automated test suite.
