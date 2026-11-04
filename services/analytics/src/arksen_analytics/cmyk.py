"""Moteur de consommation toner CMJN.

Fonctions pures : elles ne lisent ni n'écrivent aucune donnée, et chaque canal (cyan, magenta,
jaune, noir) est calculé indépendamment des autres.

Formules (cahier des charges, section 6) :

    consommation de référence par page = capacité du toner (g) / rendement constructeur (pages)
    consommation théorique = référence × (couverture réelle / couverture de référence)
                             × pages × facteur de format × facteur de support

Le rendement constructeur est mesuré à une couverture de référence (ISO/IEC 19752 et 19798 :
5 % par couleur sur une page A4) : la couverture réelle se rapporte à celle-ci.

Pages concernées : le noir s'imprime sur toutes les pages ; le cyan, le magenta et le jaune
seulement sur les pages couleur.

La consommation théorique n'est jamais confondue avec la consommation réelle (mesurée par pesée
ou estimée d'après les cartouches) ni avec un niveau de toner rapporté par la machine.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Channel(StrEnum):
    CYAN = "CYAN"
    MAGENTA = "MAGENTA"
    YELLOW = "YELLOW"
    BLACK = "BLACK"


#: Surface d'une feuille rapportée à l'A4 (210 × 297 mm). SRA3 : 320 × 450 mm.
FORMAT_FACTORS: dict[str, float] = {
    "A4": 1.0,
    "A3": 2.0,
    "SRA3": (320 * 450) / (210 * 297),
}

#: Couverture de référence des normes de rendement ISO/IEC 19752 et 19798, en pourcentage.
ISO_REFERENCE_COVERAGE = 5.0

#: Poids, en mesures fictives, du coefficient de référence dans la calibration progressive.
CALIBRATION_PRIOR_WEIGHT = 2.0


class EngineError(ValueError):
    """Paramètre impossible : le message est rédigé pour l'utilisateur."""


@dataclass(frozen=True)
class TonerSpec:
    channel: Channel
    #: Masse de toner d'une cartouche, en grammes.
    capacity_g: float
    #: Rendement constructeur, en pages, à la couverture de référence.
    yield_pages: int
    #: Couverture de référence du rendement, en pourcentage.
    reference_coverage: float = ISO_REFERENCE_COVERAGE
    #: Prix d'une cartouche, ou None s'il n'est pas connu.
    unit_price: float | None = None

    def __post_init__(self) -> None:
        if self.capacity_g <= 0:
            raise EngineError(f"{self.channel} : la capacité du toner doit être positive.")
        if self.yield_pages <= 0:
            raise EngineError(f"{self.channel} : le rendement constructeur doit être positif.")
        if not 0 < self.reference_coverage <= 100:
            raise EngineError(
                f"{self.channel} : la couverture de référence est comprise entre 0 et 100 %."
            )
        if self.unit_price is not None and self.unit_price < 0:
            raise EngineError(f"{self.channel} : le prix ne peut pas être négatif.")

    @property
    def reference_g_per_page(self) -> float:
        """Consommation de référence par page : capacité / rendement."""
        return self.capacity_g / self.yield_pages


def format_factor(paper_format: str) -> float:
    try:
        return FORMAT_FACTORS[paper_format]
    except KeyError as error:
        raise EngineError(f"Format de papier inconnu : {paper_format}.") from error


def relevant_pages(channel: Channel, total_pages: float, color_pages: float) -> float:
    """Pages qui consomment ce canal : toutes pour le noir, les pages couleur pour les autres."""
    if total_pages < 0 or color_pages < 0:
        raise EngineError("Un nombre de pages ne peut pas être négatif.")
    if color_pages > total_pages:
        raise EngineError("Les pages couleur ne peuvent pas dépasser le total des pages.")
    return total_pages if channel is Channel.BLACK else color_pages


def theoretical_grams(
    spec: TonerSpec,
    coverage: float,
    pages: float,
    paper_format: str = "A4",
    media_factor: float = 1.0,
) -> float:
    """Consommation théorique d'un canal, en grammes."""
    if not 0 <= coverage <= 100:
        raise EngineError(f"{spec.channel} : la couverture est comprise entre 0 et 100 %.")
    if media_factor <= 0:
        raise EngineError("Le facteur de support doit être positif.")
    if pages < 0:
        raise EngineError("Un nombre de pages ne peut pas être négatif.")
    return (
        spec.reference_g_per_page
        * (coverage / spec.reference_coverage)
        * pages
        * format_factor(paper_format)
        * media_factor
    )


def cost_of_grams(spec: TonerSpec, grams: float) -> float | None:
    """Coût d'une masse de toner, au prix de la cartouche rapporté à sa capacité."""
    if spec.unit_price is None:
        return None
    return spec.unit_price / spec.capacity_g * grams


@dataclass(frozen=True)
class Variance:
    theoretical_g: float
    real_g: float
    #: Réel moins théorique, en grammes.
    deviation_g: float
    #: Écart rapporté au théorique, ou None si le théorique est nul.
    deviation_ratio: float | None
    #: Part de l'écart au-delà du théorique : nulle en cas de sous-consommation.
    overconsumption_ratio: float | None


def variance(theoretical_g: float, real_g: float) -> Variance:
    """Écart entre la consommation réelle (ou estimée) et la consommation théorique."""
    if theoretical_g < 0 or real_g < 0:
        raise EngineError("Une consommation ne peut pas être négative.")
    deviation = real_g - theoretical_g
    ratio = deviation / theoretical_g if theoretical_g > 0 else None
    return Variance(
        theoretical_g=theoretical_g,
        real_g=real_g,
        deviation_g=deviation,
        deviation_ratio=ratio,
        overconsumption_ratio=None if ratio is None else max(0.0, ratio),
    )


@dataclass(frozen=True)
class Observation:
    """Une consommation réelle et la consommation théorique de la même période."""

    theoretical_g: float
    real_g: float


@dataclass(frozen=True)
class Calibration:
    coefficient: float
    #: manual, printer, model ou default.
    source: str
    observations: int
    #: none, low, medium ou high.
    confidence: str


def _confidence(count: int) -> str:
    if count == 0:
        return "none"
    if count <= 2:
        return "low"
    if count <= 5:
        return "medium"
    return "high"


def smoothed_ratio(observations: list[Observation], prior: float) -> float:
    """Rapport réel / théorique, lissé vers `prior`.

    k = (Σ réel + m × prior × T̄) / (Σ théorique + m × T̄), où T̄ est la consommation théorique
    moyenne d'une observation et m le poids du coefficient de référence. Une seule mesure ne
    peut donc pas emporter le coefficient : il s'en rapproche à mesure qu'elles s'accumulent.
    """
    usable = [item for item in observations if item.theoretical_g > 0]
    if not usable:
        return prior
    total_theoretical = sum(item.theoretical_g for item in usable)
    total_real = sum(item.real_g for item in usable)
    mean = total_theoretical / len(usable)
    weight = CALIBRATION_PRIOR_WEIGHT * mean
    return (total_real + prior * weight) / (total_theoretical + weight)


def calibrate(
    printer_observations: list[Observation],
    model_observations: list[Observation],
    manual: float | None = None,
) -> Calibration:
    """Coefficient de calibration d'un canal d'une machine, de façon progressive.

    1. Un coefficient saisi à la main l'emporte.
    2. Sinon, les mesures du modèle (toutes machines confondues) donnent un coefficient de
       modèle, lissé vers 1.
    3. Les mesures de la machine donnent son coefficient, lissé vers celui du modèle.
    """
    count = len([item for item in printer_observations if item.theoretical_g > 0])
    if manual is not None:
        if manual <= 0:
            raise EngineError("Le coefficient de calibration doit être positif.")
        return Calibration(manual, "manual", count, "high")
    model_count = len([item for item in model_observations if item.theoretical_g > 0])
    model_coefficient = smoothed_ratio(model_observations, 1.0)
    if count:
        return Calibration(
            smoothed_ratio(printer_observations, model_coefficient),
            "printer",
            count,
            _confidence(count),
        )
    if model_count:
        return Calibration(model_coefficient, "model", 0, _confidence(model_count))
    return Calibration(1.0, "default", 0, "none")
