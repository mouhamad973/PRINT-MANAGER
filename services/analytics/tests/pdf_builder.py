"""Fabrique de PDF minimaux pour les tests : chaque page est décrite par son flux de contenu."""

from __future__ import annotations

from dataclasses import dataclass

A4 = (595.28, 841.89)
A3 = (841.89, 1190.55)


@dataclass(frozen=True)
class Page:
    content: str = ""
    size: tuple[float, float] = A4
    #: Dictionnaire de ressources PDF, en syntaxe PDF (ExtGState, ColorSpace…).
    resources: str = ""


def build_pdf(pages: list[Page]) -> bytes:
    """Assemble un PDF valide, avec sa table de références croisées."""
    objects: list[bytes] = []
    page_ids = [3 + 2 * index for index in range(len(pages))]
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode())
    for page, page_id in zip(pages, page_ids, strict=True):
        width, height = page.size
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] "
                f"/Resources << {page.resources} >> /Contents {page_id + 1} 0 R >>"
            ).encode()
        )
        stream = page.content.encode()
        objects.append(
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"
        )

    output = bytearray(b"%PDF-1.7\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(output)
    output += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        output += f"{offset:010d} 00000 n \n".encode()
    output += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    ).encode()
    return bytes(output)


def fill(rgb: str, size: tuple[float, float] = A4, fraction: float = 1.0) -> Page:
    """Page dont la partie basse (`fraction` de la hauteur) est remplie d'une couleur RVB."""
    width, height = size
    return Page(content=f"{rgb} rg 0 0 {width} {height * fraction} re f", size=size)
