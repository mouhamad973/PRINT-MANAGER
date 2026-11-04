"""Analyse des fichiers PDF : formats et couverture CMJN, page par page.

Méthode de mesure (la même à chaque appel, donc reproductible) :

1. **Rendu.** PDFium rend chaque page en sRGB, sur fond blanc, à une résolution donnée
   (72 ppp par défaut). Il applique lui-même les profils ICC intégrés au document, les couleurs
   spéciales (Separation, DeviceN, par leur espace de substitution), les transparences et les
   modes de fusion : le résultat est l'apparence finale de la page.
2. **Séparation CMJN.** Chaque pixel sRGB est converti en valeurs de teinte C, M, J, N entre
   0 et 1 :
   - avec un profil ICC CMJN de sortie s'il est configuré (LittleCMS, intention perceptive) :
     c'est la séparation d'une presse ou d'une imprimante réelle ;
   - sinon par la séparation de référence, sans profil, avec génération du noir à 100 % :
     N = 1 − max(R, V, B), puis C = (1 − R − N) / (1 − N), et de même pour M et J.
3. **Couverture.** La couverture d'un canal est la **moyenne de sa valeur de teinte sur toute la
   surface de la page**, en pourcentage. Un aplat cyan plein sur la moitié de la page vaut 50 % ;
   un fond à 20 % de cyan sur toute la page vaut 20 %. Ce n'est donc pas une proportion de
   pixels colorés. La couverture cumulée est la somme des quatre canaux.

Pour une machine noir et blanc, la page s'imprime en niveaux de gris : sa **couverture en
niveaux de gris** est la moyenne de 1 − luminance (Rec. 709 : 0,2126 R + 0,7152 V + 0,0722 B).

La séparation de référence surestime le noir et sous-estime les couleurs dans les tons sombres
(génération du noir maximale), et un contenu déjà en CMJN repasse par le sRGB : ces écarts
systématiques sont corrigés par la calibration des machines (Phase 5), ou réduits par un profil ICC.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt
import pypdfium2 as pdfium
from PIL import Image, ImageCms

MM_PER_POINT = 25.4 / 72
A4_AREA_MM2 = 210 * 297
DEFAULT_DPI = 72
MAX_PAGES = 500

#: Formats reconnus, en millimètres (petit côté, grand côté). Tolérance de 3 mm.
FORMATS: dict[str, tuple[float, float]] = {
    "A5": (148, 210),
    "A4": (210, 297),
    "A3": (297, 420),
    "SRA3": (320, 450),
    "Letter": (215.9, 279.4),
    "Legal": (215.9, 355.6),
    "Tabloid": (279.4, 431.8),
}
FORMAT_TOLERANCE_MM = 3.0

#: Une page est en couleur si la couverture cumulée de C, M et J dépasse ce seuil, en pourcentage.
COLOR_THRESHOLD = 0.05

REFERENCE_METHOD = "pdfium-srgb/separation-reference-gcr100"


class AnalysisError(ValueError):
    """Fichier impossible à analyser : le message est rédigé pour l'utilisateur."""


@dataclass(frozen=True)
class PageAnalysis:
    number: int
    width_mm: float
    height_mm: float
    format: str
    orientation: str
    #: Surface rapportée à celle d'une page A4.
    area_factor: float
    cyan: float
    magenta: float
    yellow: float
    black: float
    #: Couverture de noir si la page est imprimée en niveaux de gris (machine noir et blanc).
    gray: float
    is_color: bool

    @property
    def total(self) -> float:
        return self.cyan + self.magenta + self.yellow + self.black


@dataclass(frozen=True)
class DocumentAnalysis:
    pages: list[PageAnalysis]
    method: str
    dpi: int

    def average(self) -> dict[str, float]:
        """Couverture moyenne du document, pondérée par la surface de chaque page."""
        area = sum(page.area_factor for page in self.pages)
        if area == 0:
            return {"cyan": 0.0, "magenta": 0.0, "yellow": 0.0, "black": 0.0}
        return {
            channel: sum(getattr(page, channel) * page.area_factor for page in self.pages) / area
            for channel in ("cyan", "magenta", "yellow", "black")
        }


def detect_format(width_mm: float, height_mm: float) -> tuple[str, str]:
    """Nom du format (ou « Personnalisé ») et orientation de la page."""
    short, long = sorted((width_mm, height_mm))
    name = next(
        (
            label
            for label, (a, b) in FORMATS.items()
            if abs(short - a) <= FORMAT_TOLERANCE_MM and abs(long - b) <= FORMAT_TOLERANCE_MM
        ),
        "Personnalisé",
    )
    if abs(width_mm - height_mm) <= FORMAT_TOLERANCE_MM:
        orientation = "square"
    else:
        orientation = "landscape" if width_mm > height_mm else "portrait"
    return name, orientation


Floats = npt.NDArray[np.float64]


def separate_reference(rgb: npt.NDArray[np.uint8]) -> tuple[Floats, Floats, Floats, Floats]:
    """Séparation de référence, sans profil : génération du noir à 100 %."""
    values = rgb.astype(np.float64) / 255.0
    red, green, blue = values[..., 0], values[..., 1], values[..., 2]
    black = 1.0 - np.maximum(np.maximum(red, green), blue)
    remaining = 1.0 - black
    # Là où le noir est plein, il n'y a pas de couleur : on évite la division par zéro.
    safe = np.where(remaining > 0, remaining, 1.0)
    cyan = np.where(remaining > 0, (1.0 - red - black) / safe, 0.0)
    magenta = np.where(remaining > 0, (1.0 - green - black) / safe, 0.0)
    yellow = np.where(remaining > 0, (1.0 - blue - black) / safe, 0.0)
    return cyan, magenta, yellow, black


class IccSeparator:
    """Séparation par un profil ICC CMJN de sortie (LittleCMS), depuis sRGB."""

    def __init__(self, profile_path: Path) -> None:
        try:
            output = ImageCms.getOpenProfile(str(profile_path))
        except (OSError, ImageCms.PyCMSError) as error:
            raise ValueError(f"Profil ICC illisible : {profile_path}") from error
        self.name = f"pdfium-srgb/icc:{profile_path.name}"
        self._transform = ImageCms.buildTransform(
            ImageCms.createProfile("sRGB"),
            output,
            "RGB",
            "CMYK",
            renderingIntent=ImageCms.Intent.PERCEPTUAL,
        )

    def __call__(self, rgb: npt.NDArray[np.uint8]) -> tuple[Floats, Floats, Floats, Floats]:
        image = ImageCms.applyTransform(Image.fromarray(rgb, "RGB"), self._transform)
        assert image is not None
        values = np.asarray(image, dtype=np.float64) / 255.0
        return values[..., 0], values[..., 1], values[..., 2], values[..., 3]


def analyze_pdf(
    data: bytes,
    dpi: int = DEFAULT_DPI,
    icc: IccSeparator | None = None,
    max_pages: int = MAX_PAGES,
) -> DocumentAnalysis:
    """Analyse un document PDF page par page."""
    if not data.lstrip()[:5].startswith(b"%PDF-"):
        raise AnalysisError("Le fichier n'est pas un PDF.")
    try:
        document = pdfium.PdfDocument(io.BytesIO(data))
    except pdfium.PdfiumError as error:
        message = str(error).lower()
        if "password" in message:
            raise AnalysisError("Le PDF est protégé par un mot de passe.") from error
        raise AnalysisError("Le PDF est illisible ou endommagé.") from error

    try:
        count = len(document)
        if count == 0:
            raise AnalysisError("Le PDF ne contient aucune page.")
        if count > max_pages:
            raise AnalysisError(f"Le PDF compte {count} pages : {max_pages} au maximum.")
        separate = icc if icc is not None else separate_reference
        pages: list[PageAnalysis] = []
        for index in range(count):
            page = document[index]
            try:
                width_pt, height_pt = page.get_size()
                bitmap = page.render(
                    scale=dpi / 72,
                    fill_color=(255, 255, 255, 255),
                    rev_byteorder=True,
                    draw_annots=True,
                )
                rgb = bitmap.to_numpy()[..., :3]
            finally:
                page.close()
            rgb = np.ascontiguousarray(rgb)
            cyan, magenta, yellow, black = separate(rgb)
            luminance = (rgb.astype(np.float64) / 255.0) @ np.array([0.2126, 0.7152, 0.0722])
            gray = float((1.0 - luminance).mean()) * 100
            width_mm = width_pt * MM_PER_POINT
            height_mm = height_pt * MM_PER_POINT
            name, orientation = detect_format(width_mm, height_mm)
            coverage = [float(channel.mean()) * 100 for channel in (cyan, magenta, yellow, black)]
            pages.append(
                PageAnalysis(
                    number=index + 1,
                    width_mm=round(width_mm, 1),
                    height_mm=round(height_mm, 1),
                    format=name,
                    orientation=orientation,
                    area_factor=round(width_mm * height_mm / A4_AREA_MM2, 4),
                    cyan=round(coverage[0], 3),
                    magenta=round(coverage[1], 3),
                    yellow=round(coverage[2], 3),
                    black=round(coverage[3], 3),
                    gray=round(gray, 3),
                    is_color=coverage[0] + coverage[1] + coverage[2] > COLOR_THRESHOLD,
                )
            )
    finally:
        document.close()
    return DocumentAnalysis(
        pages=pages,
        method=icc.name if icc is not None else REFERENCE_METHOD,
        dpi=dpi,
    )
