# Voice Specification

## Register
Sentence length: 3 to 24 words
Contractions: yes
Person: second person for rider actions; first plural only for documented product decisions
Formality: direct transit guidance using literal status language and explicit limitations
Humor: allowed only in non-critical project notes; banned in route, outage, error, and accessibility guidance

## Hard bans
- “Live” or “real time” when the build uses snapshot data
- Generic calls to action such as “Learn more” and “Get started”
- Euphemisms that obscure an inaccessible route or missing service

## Required
- Claims include the data mode and source or build-time qualifier.
- Buttons name the resulting action or object.
- Errors explain the failed service, preserved state, and next useful action.
- Empty states distinguish no matching demo option from no transit service.

## Paired examples
Button BAD: Get started
Button GOOD: Plan an accessible trip
Empty state BAD: No results
Empty state GOOD: This snapshot has no direct trip for those stations. Try another pair.
Error BAD: Something went wrong
Error GOOD: The live trip service could not be reached. Your station choices are still here; try again.
Headline BAD: Accessibility made easy
Headline GOOD: Know whether you can get there—and get back.
