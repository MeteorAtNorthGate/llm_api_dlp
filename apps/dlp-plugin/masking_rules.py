"""DLP masking rules — regex patterns for sensitive data detection."""

import re
from dataclasses import dataclass


@dataclass
class MaskingRule:
    """A single masking rule with a pattern and a same-length placeholder generator."""

    name: str
    pattern: re.Pattern
    description: str

    def generate_placeholder(self, match: re.Match) -> str:
        """Generate a placeholder that preserves the original length."""
        return "█" * len(match.group())


# All masking rules
MASKING_RULES: list[MaskingRule] = [
    MaskingRule(
        name="credit_card",
        pattern=re.compile(
            r"\b(?:\d[ -]*?){13,16}\b"
        ),
        description="Credit card numbers (13-16 digits)",
    ),
    MaskingRule(
        name="ssn",
        pattern=re.compile(
            r"\b\d{3}-\d{2}-\d{4}\b"
        ),
        description="US Social Security Number (SSN)",
    ),
    MaskingRule(
        name="phone_cn",
        pattern=re.compile(
            r"\b1[3-9]\d{9}\b"
        ),
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
        pattern=re.compile(
            r"\b(?:\d{1,3}\.){3}\d{1,3}\b"
        ),
        description="IPv4 addresses",
    ),
    MaskingRule(
        name="bank_card_cn",
        pattern=re.compile(
            r"\b(?:62\d{14,17}|(?:4|5)\d{15})\b"
        ),
        description="Chinese bank card numbers",
    ),
]


def apply_masking(text: str) -> tuple[str, dict[str, str]]:
    """Apply all masking rules to the text.

    Returns:
        Tuple of (masked_text, mapping of placeholder -> original_value)
    """
    mapping: dict[str, str] = {}

    for rule in MASKING_RULES:
        def _replace(match: re.Match, r=rule) -> str:
            placeholder = r.generate_placeholder(match)
            mapping[placeholder] = match.group()
            return placeholder

        text = rule.pattern.sub(_replace, text)

    return text, mapping


def restore_masking(text: str, mapping: dict[str, str]) -> str:
    """Restore original values from the placeholder mapping.

    Reverses the mapping so that original values replace their placeholders.
    Processes in order of longest placeholder first to avoid partial matches.
    """
    # Sort by placeholder length descending to avoid partial replacements
    sorted_items = sorted(mapping.items(), key=lambda x: len(x[0]), reverse=True)

    for placeholder, original in sorted_items:
        text = text.replace(placeholder, original)

    return text


def count_masked(text: str) -> int:
    """Count the number of masked fields detected in the text."""
    count = 0
    for rule in MASKING_RULES:
        count += len(rule.pattern.findall(text))
    return count
