"""Document parsing service — uses unstructured library to extract text.

Handles PDF, DOCX, XLSX, TXT, CSV, MD, and common image formats.
"""

import tempfile
from pathlib import Path

from app.core.config import settings

# File extensions we can parse
SUPPORTED_EXTENSIONS: set[str] = {
    ".pdf", ".docx", ".doc", ".xlsx", ".xls",
    ".txt", ".csv", ".md",
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp",
}

# Extensions that produce meaningful text
TEXT_PRODUCING_EXTENSIONS: set[str] = {
    ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".txt", ".csv", ".md",
}


def estimate_tokens(text: str) -> int:
    """Rough token count estimate. ~4 chars per token for English/Chinese mixed."""
    return max(1, len(text) // 4)


def parse_document(file_content: bytes, file_name: str) -> str:
    """Parse a document using unstructured library and return extracted text.

    Uses file-type-specific partition functions for best results.
    Falls back to plain text for unsupported types.

    Raises:
        ValueError: if file extension is not in SUPPORTED_EXTENSIONS.
        RuntimeError: if parsing fails.
    """
    ext = Path(file_name).suffix.lower()

    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {ext}")

    # Images — not yet parseable in V1
    if ext in (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"):
        return f"[Image file: {file_name} — OCR not yet supported]"

    # Write to temp file for unstructured (most partition functions want a filename)
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(file_content)
        tmp_path = tmp.name

    try:
        if ext == ".pdf":
            from unstructured.partition.pdf import partition_pdf
            elements = partition_pdf(filename=tmp_path, strategy="auto")
        elif ext in (".docx", ".doc"):
            from unstructured.partition.docx import partition_docx
            elements = partition_docx(filename=tmp_path)
        elif ext in (".xlsx", ".xls"):
            from unstructured.partition.xlsx import partition_xlsx
            elements = partition_xlsx(filename=tmp_path)
        elif ext == ".csv":
            from unstructured.partition.csv import partition_csv
            elements = partition_csv(filename=tmp_path)
        elif ext == ".md":
            from unstructured.partition.md import partition_md
            elements = partition_md(filename=tmp_path)
        elif ext == ".txt":
            from unstructured.partition.text import partition_text
            elements = partition_text(filename=tmp_path)
        else:
            return f"[Unsupported file type: {ext}]"

        return "\n\n".join(str(el) for el in elements)

    except Exception as e:
        raise RuntimeError(f"Failed to parse {file_name}: {e}") from e

    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except Exception:
            pass


def build_injection_text(parsed_text: str, file_name: str) -> str:
    """Build the text block to inject into the LLM message.

    For small documents: inject full text.
    For large documents: inject truncated text with a note.
    """
    token_estimate = estimate_tokens(parsed_text)

    if token_estimate <= settings.MAX_FILE_SIZE_MB * 1024 * 256:
        # Full injection
        return (
            f"\n\n--- Content of {file_name} ---\n"
            f"{parsed_text}\n"
            f"--- End of {file_name} ---"
        )
    else:
        # Truncated injection
        max_chars = settings.MAX_FILE_SIZE_MB * 1024 * 256
        truncated = parsed_text[:max_chars]
        return (
            f"\n\n--- Content of {file_name} (truncated) ---\n"
            f"{truncated}\n"
            f"... [Document truncated. Full document is approximately "
            f"{token_estimate:,} tokens.]\n"
            f"--- End of {file_name} ---"
        )
