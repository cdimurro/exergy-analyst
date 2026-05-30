from __future__ import annotations

from pathlib import Path

from exergy_analyst import pdf_extract
from exergy_analyst.pdf_extract import PdfExtraction, extract_pdf_document


def test_pdf_extraction_uses_fast_local_text_before_slow_mineru(monkeypatch, tmp_path: Path) -> None:
    pdf = tmp_path / "readable.pdf"
    pdf.write_bytes(b"%PDF-1.7 placeholder")

    def fake_local(path: Path) -> PdfExtraction:
        assert path == pdf
        return PdfExtraction(
            text="Readable technical PDF text. " * 80,
            parser="local PyMuPDF text extraction",
            status="extracted",
            metadata={"source": str(path)},
        )

    def fail_mineru(_: Path) -> PdfExtraction:
        raise AssertionError("MinerU should not run when local text is already usable")

    monkeypatch.setattr(pdf_extract, "_extract_with_local_pdf_stack", fake_local)
    monkeypatch.setattr(pdf_extract, "mineru_configured", lambda: True)
    monkeypatch.setattr(pdf_extract, "_extract_with_mineru", fail_mineru)

    result = extract_pdf_document(pdf)

    assert result.parser == "local PyMuPDF text extraction"
    assert result.metadata["fast_text_first"] is True
