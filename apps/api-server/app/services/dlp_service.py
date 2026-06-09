"""DLP service — masks sensitive data using regex patterns before LLM submission.

Mirrors the logic in apps/dlp-plugin/masking_rules.py so that parsed
document text goes through the same DLP pipeline as regular chat messages.
"""

import re
from dataclasses import dataclass, field
from typing import ClassVar


@dataclass
class MaskingRule:
    """A single masking rule with a pattern and a same-length placeholder generator."""

    name: str
    pattern: re.Pattern
    description: str

    def generate_placeholder(self, match: re.Match) -> str:
        """Generate a placeholder that preserves the original length."""
        return "█" * len(match.group())


# All masking rules (mirrors dlp-plugin/masking_rules.py)
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
    """Result of applying DLP masking to a text."""

    masked_text: str
    mapping: dict[str, str]  # placeholder -> original value
    match_count: int = 0


def apply_masking(text: str) -> MaskResult:
    """Apply all masking rules to the text.

    Returns:
        MaskResult with masked_text and placeholder->original mapping.
    """
    mapping: dict[str, str] = {}
    total_masked = 0

    for rule in MASKING_RULES:
        def _replace(match: re.Match, r=rule) -> str:
            nonlocal total_masked
            placeholder = r.generate_placeholder(match)
            mapping[placeholder] = match.group()
            total_masked += 1
            return placeholder

        text = rule.pattern.sub(_replace, text)

    return MaskResult(
        masked_text=text,
        mapping=mapping,
        match_count=total_masked,
    )


def restore_masking(text: str, mapping: dict[str, str]) -> str:
    """Restore original values from the placeholder mapping.

    Processes in order of longest placeholder first to avoid partial matches.
    """
    sorted_items = sorted(mapping.items(), key=lambda x: len(x[0]), reverse=True)

    for placeholder, original in sorted_items:
        text = text.replace(placeholder, original)

    return text
