"""Reading the MTA's equipment prose to answer a question the feed cannot.

Every other accessibility verdict in this project is deterministic: identifier
joins, directional flags, graph traversal. This one is not, because the input
is not structured data -- it is free text written by the MTA for humans:

    "mezzanine to lower mezzanine A/C/E to downtown 1/2/3 platform and 7
     platform for service in both directions"

That sentence contains exactly what a transfer depends on -- whether a step-free
path exists between two specific platforms inside one station -- and no amount
of parsing gets it out reliably. Elsewhere the code shows this text raw and asks
the rider to interpret it. Here a language model does the reading.

Three rules keep this consistent with the rest of the project:

  * It never overrides the deterministic layer. Platform accessibility is still
    decided by `gtfs_accessibility`; this only answers the connection question
    that data cannot express.
  * `unknown` is a first-class answer. The prompt is explicit that saying so is
    correct when the descriptions do not cover the path, because a confident
    guess about a step-free route is exactly the failure this project exists to
    prevent.
  * Every verdict cites the equipment it relied on, so a rider can check the
    reasoning against the same text the model read.
"""

import json
import os

MODEL = "claude-opus-5"

SYSTEM = """You read New York City subway elevator and escalator descriptions \
and determine whether a wheelchair user can get between two specific platforms \
inside one station.

The descriptions are written by the MTA for human readers. They name the levels \
a unit connects -- street, mezzanine, and platform -- and often which lines or \
direction a platform serves.

How to reason:
- A step-free path needs elevators covering every level change between the two \
platforms. A typical path is platform -> mezzanine -> platform.
- ESCALATORS ARE NOT A STEP-FREE PATH. A wheelchair user cannot use one. Never \
count an escalator toward a usable path, even when it is working.
- An out-of-service elevator cannot be part of a path.
- Two elevators connect only if they share a level. "Mezzanine to A/C/E \
platform" plus "mezzanine to 1/2/3 platform" connect at the mezzanine. \
"Street to mezzanine" does not help between two platforms.
- Some stations have separate mezzanines that do not link. If the descriptions \
do not show a shared level, do not assume one exists.

Answer "unknown" when the descriptions do not clearly establish a path. That is \
the correct answer far more often than people expect, and it is much better than \
a confident guess: a wheelchair user who trusts a wrong "yes" is stranded on a \
platform they cannot leave. Only answer "yes" when you can name the specific \
working elevators that form the path."""

SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {
            "type": "string",
            "enum": ["step_free", "not_step_free", "unknown"],
            "description": "Whether a step-free path between the two platforms is established.",
        },
        "confidence": {
            "type": "string",
            "enum": ["high", "medium", "low"],
            "description": "How well the descriptions support the verdict.",
        },
        "explanation": {
            "type": "string",
            "description": (
                "Two or three sentences for a rider, naming the levels involved. "
                "Plain language, no equipment jargon beyond the unit numbers."
            ),
        },
        "equipment_used": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Equipment numbers forming the path, or blocking it.",
        },
        "caveats": {
            "type": "array",
            "items": {"type": "string"},
            "description": "What the descriptions do not establish. Empty if none.",
        },
    },
    "required": ["verdict", "confidence", "explanation", "equipment_used", "caveats"],
    "additionalProperties": False,
}


def configured():
    """True when an API key is available for the reasoning call."""
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _describe(equipment):
    lines = []
    for item in equipment:
        state = "WORKING" if item["working"] else "OUT OF SERVICE"
        kind = "Elevator" if item["type"] == "elevator" else "Escalator"
        serving = item.get("serving") or "(no description published)"
        lines.append(f"- {kind} {item['equipment']} [{state}]: {serving}")
    return "\n".join(lines) if lines else "(no equipment published for this station)"


def assess_transfer(station_name, from_route, to_route, equipment):
    """Judge whether the change from `from_route` to `to_route` is step-free.

    Returns the parsed verdict, or a dict with `error` when unavailable. The
    caller treats any failure as "no answer" and falls back to showing the raw
    descriptions -- the feature degrades to the deterministic behavior rather
    than blocking the page.
    """
    if not configured():
        return {"error": "not_configured"}

    try:
        import anthropic
    except ImportError:
        return {"error": "sdk_missing"}

    prompt = (
        f"Station: {station_name}\n"
        f"The rider arrives on a {from_route} train and needs to board a {to_route} train.\n\n"
        f"Elevators and escalators at this station:\n{_describe(equipment)}\n\n"
        f"Can a wheelchair user get from the {from_route} platform to the "
        f"{to_route} platform without stairs?"
    )

    try:
        client = anthropic.Anthropic()
        response = client.messages.create(
            model=MODEL,
            max_tokens=2000,
            system=SYSTEM,
            thinking={"type": "adaptive"},
            # This is focused reading over a short passage, not open-ended
            # research. Medium keeps the page responsive without costing
            # accuracy on a task this scoped.
            output_config={
                "effort": "medium",
                "format": {"type": "json_schema", "schema": SCHEMA},
            },
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as exc:
        return {"error": "request_failed", "detail": str(exc)[:200]}

    # A refusal returns HTTP 200 with no usable content; check before reading.
    if getattr(response, "stop_reason", None) == "refusal":
        return {"error": "refused"}

    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        return {"error": "unparseable"}

    result["model"] = MODEL
    return result
