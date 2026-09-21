"""DLP service — masks sensitive data using regex patterns before LLM submission.

Masking happens here, in the api-server, on the way out: `chat.py` runs every
user/system message through :func:`apply_masking` while building the LiteLLM
payload.  The user's own message is still stored and displayed verbatim — only
what leaves the perimeter is masked.

**There is deliberately no unmasking.**  A `restore_masking()` used to live here
(and in a LiteLLM callback that never ran).  It was removed on purpose, because
restoring the original values into the model's answer would:

1. Make a degraded answer look correct — the model reasons over `██████`, so its
   reply is necessarily generic; substituting the real value back only makes it
   *appear* personalised.
2. Make the masking invisible — a user who never sees the `███` has no way to
   learn that their PII was intercepted, which is the whole point of a DLP
   signal.

So the `█` characters that show up in an answer are intentional.  Do not add
restoration back.
"""

import re
from dataclasses import dataclass


@dataclass
class MaskingRule:
    """A single masking rule with a pattern and a same-length placeholder generator."""

    name: str
    pattern: re.Pattern
    description: str

    def generate_placeholder(self, match: re.Match) -> str:
        """Generate a placeholder that preserves the original length.

        Same-length placeholders keep the token count comparable between the
        masked and unmasked forms, so usage figures stay meaningful.
        """
        return "█" * len(match.group())


MASKING_RULES: list[MaskingRule] = [
    MaskingRule(
        name="credit_card",
        pattern=re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
        description="Credit card numbers (13-16 digits)",
    ),
    MaskingRule(
        name="ssn",
        pattern=re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
        description="US Social Security Number (SSN)",
    ),
    MaskingRule(
        name="phone_cn",
        pattern=re.compile(r"\b1[3-9]\d{9}\b"),
        description="Chinese mobile phone number",
    ),
    MaskingRule(
        name="id_card_cn",
        pattern=re.compile(
            r"\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])"
            r"(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b"
        ),
        description="Chinese ID card number (18 digits)",
    ),
    MaskingRule(
        name="email",
        pattern=re.compile(
            r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"
        ),
        description="Email addresses",
    ),
    MaskingRule(
        name="ip_v4",
        pattern=re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
        description="IPv4 addresses",
    ),
    MaskingRule(
        name="bank_card_cn",
        pattern=re.compile(r"\b(?:62\d{14,17}|(?:4|5)\d{15})\b"),
        description="Chinese bank card numbers",
    ),
]


@dataclass
class MaskResult:
    """Result of applying DLP masking to a text.

    Note there is no placeholder→original mapping.  It was removed together with
    `restore_masking` so that reinstating unmasking is not merely discouraged but
    impossible without rewriting this module — see the module docstring.
    """

    masked_text: str
    match_count: int = 0


def apply_masking(text: str) -> MaskResult:
    """Replace every sensitive match in ``text`` with a same-length `█` run."""
    total_masked = 0

    for rule in MASKING_RULES:

        def _replace(match: re.Match, r: MaskingRule = rule) -> str:
            nonlocal total_masked
            total_masked += 1
            return r.generate_placeholder(match)

        text = rule.pattern.sub(_replace, text)

    return MaskResult(masked_text=text, match_count=total_masked)
