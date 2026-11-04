"""Point d'entrée HTTP de l'analyse PDF. Le fichier est analysé en mémoire, puis oublié."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from arksen_analytics.pdf_analysis import (
    DEFAULT_DPI,
    AnalysisError,
    IccSeparator,
    analyze_pdf,
)

router = APIRouter(prefix="/v1/pdf", tags=["Analyse PDF"])

#: Taille maximale d'un fichier, en octets.
MAX_FILE_BYTES = 50 * 1024 * 1024


class PageOutput(BaseModel):
    number: int
    width_mm: float
    height_mm: float
    format: str
    orientation: str
    area_factor: float
    cyan: float
    magenta: float
    yellow: float
    black: float
    total: float
    #: Couverture de noir si la page est imprimée en niveaux de gris.
    gray: float
    is_color: bool


class CoverageOutput(BaseModel):
    cyan: float
    magenta: float
    yellow: float
    black: float
    total: float


class AnalysisOutput(BaseModel):
    #: Méthode de rendu et de séparation, pour savoir comment chaque mesure a été obtenue.
    method: str
    dpi: int
    page_count: int
    color_pages: int
    #: Couverture moyenne du document, pondérée par la surface des pages.
    average: CoverageOutput
    pages: list[PageOutput]


@lru_cache(maxsize=1)
def configured_icc() -> IccSeparator | None:
    """Profil ICC CMJN de sortie, si `ANALYTICS_CMYK_ICC_PROFILE` désigne un fichier."""
    path = os.environ.get("ANALYTICS_CMYK_ICC_PROFILE", "").strip()
    return IccSeparator(Path(path)) if path else None


@router.post("/analyze")
async def analyze_route(
    file: Annotated[UploadFile, File()],
    dpi: Annotated[int, Query(ge=36, le=150)] = DEFAULT_DPI,
) -> AnalysisOutput:
    """Formats et couverture CMJN de chaque page d'un PDF."""
    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Le fichier dépasse 50 Mo.")
    try:
        analysis = analyze_pdf(data, dpi=dpi, icc=configured_icc())
    except AnalysisError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    average = analysis.average()
    return AnalysisOutput(
        method=analysis.method,
        dpi=analysis.dpi,
        page_count=len(analysis.pages),
        color_pages=sum(1 for page in analysis.pages if page.is_color),
        average=CoverageOutput(
            **{key: round(value, 3) for key, value in average.items()},
            total=round(sum(average.values()), 3),
        ),
        pages=[
            PageOutput(
                number=page.number,
                width_mm=page.width_mm,
                height_mm=page.height_mm,
                format=page.format,
                orientation=page.orientation,
                area_factor=page.area_factor,
                cyan=page.cyan,
                magenta=page.magenta,
                yellow=page.yellow,
                black=page.black,
                total=round(page.total, 3),
                gray=page.gray,
                is_color=page.is_color,
            )
            for page in analysis.pages
        ],
    )
