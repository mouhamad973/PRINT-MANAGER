"""Point d'entrée HTTP du moteur CMJN : calculs par lots, sans aucune donnée conservée."""

from __future__ import annotations

from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from arksen_analytics.cmyk import (
    Channel,
    EngineError,
    Observation,
    TonerSpec,
    calibrate,
    cost_of_grams,
    relevant_pages,
    theoretical_grams,
    variance,
)

router = APIRouter(prefix="/v1/cmyk", tags=["Moteur CMJN"])

PaperFormat = Literal["A4", "A3", "SRA3"]


class ChannelInput(BaseModel):
    channel: Channel
    capacity_g: float = Field(gt=0)
    yield_pages: int = Field(gt=0)
    reference_coverage: float = Field(gt=0, le=100)
    #: Couverture réelle, en pourcentage : l'aplat du canal.
    coverage: float = Field(ge=0, le=100)
    unit_price: float | None = Field(default=None, ge=0)
    manual_coefficient: float | None = Field(default=None, gt=0)


class MeasurementInput(BaseModel):
    id: str
    channel: Channel
    total_pages: float = Field(ge=0)
    color_pages: float = Field(ge=0)
    #: Consommation réelle mesurée ou estimée, en grammes.
    real_g: float = Field(ge=0)


class EstimateItem(BaseModel):
    key: str
    #: Machines d'un même modèle : leurs mesures calibrent ensemble le coefficient du modèle.
    group: str | None = None
    total_pages: float = Field(ge=0)
    color_pages: float = Field(ge=0)
    paper_format: PaperFormat = "A4"
    media_factor: float = Field(default=1.0, gt=0)
    channels: list[ChannelInput] = Field(min_length=1, max_length=4)
    measurements: list[MeasurementInput] = Field(default_factory=list)

    @model_validator(mode="after")
    def check(self) -> EstimateItem:
        if self.color_pages > self.total_pages:
            raise ValueError("Les pages couleur ne peuvent pas dépasser le total des pages.")
        if len({channel.channel for channel in self.channels}) != len(self.channels):
            raise ValueError("Chaque canal ne peut figurer qu'une fois.")
        return self


class EstimateRequest(BaseModel):
    items: list[EstimateItem] = Field(min_length=1, max_length=2000)


class CalibrationOutput(BaseModel):
    coefficient: float
    source: Literal["manual", "printer", "model", "default"]
    observations: int
    confidence: Literal["none", "low", "medium", "high"]


class ChannelOutput(BaseModel):
    channel: Channel
    relevant_pages: float
    reference_g_per_page: float
    coverage: float
    #: Consommation théorique, sans calibration.
    theoretical_g: float
    #: Consommation estimée : la théorique corrigée par la calibration.
    estimated_g: float
    estimated_g_per_1000_pages: float
    calibration: CalibrationOutput
    cost_theoretical: float | None
    cost_estimated: float | None


class TotalsOutput(BaseModel):
    theoretical_g: float
    estimated_g: float
    cost_theoretical: float | None
    cost_estimated: float | None
    #: Coût toner estimé par page imprimée, tous canaux confondus.
    cost_per_page: float | None
    #: Faux si le prix d'au moins un canal manque : les coûts sont alors partiels.
    complete_cost: bool


class MeasurementOutput(BaseModel):
    id: str
    channel: Channel
    theoretical_g: float
    real_g: float
    deviation_g: float
    deviation_ratio: float | None
    overconsumption_ratio: float | None


class ItemOutput(BaseModel):
    key: str
    channels: list[ChannelOutput]
    totals: TotalsOutput
    measurements: list[MeasurementOutput]


class EstimateResponse(BaseModel):
    items: list[ItemOutput]


def _round(value: float | None, digits: int) -> float | None:
    return None if value is None else round(value, digits)


def _spec(channel: ChannelInput) -> TonerSpec:
    return TonerSpec(
        channel=channel.channel,
        capacity_g=channel.capacity_g,
        yield_pages=channel.yield_pages,
        reference_coverage=channel.reference_coverage,
        unit_price=channel.unit_price,
    )


def _observations(item: EstimateItem) -> dict[Channel, list[tuple[MeasurementInput, Observation]]]:
    """Consommation théorique de chaque mesure, avec les paramètres de sa machine."""
    specs = {channel.channel: (channel, _spec(channel)) for channel in item.channels}
    result: dict[Channel, list[tuple[MeasurementInput, Observation]]] = defaultdict(list)
    for measurement in item.measurements:
        if measurement.color_pages > measurement.total_pages:
            raise EngineError("Les pages couleur d'une mesure dépassent le total de ses pages.")
        entry = specs.get(measurement.channel)
        if entry is None:
            raise EngineError(f"Mesure sur le canal {measurement.channel}, absent de la machine.")
        channel, spec = entry
        pages = relevant_pages(
            measurement.channel, measurement.total_pages, measurement.color_pages
        )
        theoretical = theoretical_grams(
            spec, channel.coverage, pages, item.paper_format, item.media_factor
        )
        result[measurement.channel].append(
            (measurement, Observation(theoretical_g=theoretical, real_g=measurement.real_g))
        )
    return result


def estimate(request: EstimateRequest) -> EstimateResponse:
    observations = {item.key: _observations(item) for item in request.items}

    items: list[ItemOutput] = []
    for item in request.items:
        own = observations[item.key]
        siblings = [
            other
            for other in request.items
            if item.group is not None and other.group == item.group and other.key != item.key
        ]
        channels: list[ChannelOutput] = []
        known_costs = True
        for channel in item.channels:
            spec = _spec(channel)
            pages = relevant_pages(channel.channel, item.total_pages, item.color_pages)
            theoretical = theoretical_grams(
                spec, channel.coverage, pages, item.paper_format, item.media_factor
            )
            model_observations = [
                observation
                for sibling in siblings
                for _, observation in observations[sibling.key].get(channel.channel, [])
            ]
            calibration = calibrate(
                [observation for _, observation in own.get(channel.channel, [])],
                model_observations,
                channel.manual_coefficient,
            )
            estimated = theoretical * calibration.coefficient
            cost_theoretical = cost_of_grams(spec, theoretical)
            cost_estimated = cost_of_grams(spec, estimated)
            known_costs = known_costs and cost_estimated is not None
            channels.append(
                ChannelOutput(
                    channel=channel.channel,
                    relevant_pages=round(pages, 2),
                    reference_g_per_page=round(spec.reference_g_per_page, 6),
                    coverage=channel.coverage,
                    theoretical_g=round(theoretical, 3),
                    estimated_g=round(estimated, 3),
                    estimated_g_per_1000_pages=round(estimated / pages * 1000, 3) if pages else 0.0,
                    calibration=CalibrationOutput(
                        coefficient=round(calibration.coefficient, 4),
                        source=calibration.source,  # type: ignore[arg-type]
                        observations=calibration.observations,
                        confidence=calibration.confidence,  # type: ignore[arg-type]
                    ),
                    cost_theoretical=_round(cost_theoretical, 4),
                    cost_estimated=_round(cost_estimated, 4),
                )
            )

        total_estimated_cost = sum(channel.cost_estimated or 0 for channel in channels)
        totals = TotalsOutput(
            theoretical_g=round(sum(channel.theoretical_g for channel in channels), 3),
            estimated_g=round(sum(channel.estimated_g for channel in channels), 3),
            cost_theoretical=round(sum(channel.cost_theoretical or 0 for channel in channels), 4)
            if any(channel.cost_theoretical is not None for channel in channels)
            else None,
            cost_estimated=round(total_estimated_cost, 4)
            if any(channel.cost_estimated is not None for channel in channels)
            else None,
            cost_per_page=round(total_estimated_cost / item.total_pages, 6)
            if item.total_pages and any(channel.cost_estimated is not None for channel in channels)
            else None,
            complete_cost=known_costs,
        )
        measurements = [
            MeasurementOutput(
                id=measurement.id,
                channel=measurement.channel,
                theoretical_g=round(result.theoretical_g, 3),
                real_g=round(result.real_g, 3),
                deviation_g=round(result.deviation_g, 3),
                deviation_ratio=_round(result.deviation_ratio, 4),
                overconsumption_ratio=_round(result.overconsumption_ratio, 4),
            )
            for channel_observations in own.values()
            for measurement, observation in channel_observations
            for result in [variance(observation.theoretical_g, observation.real_g)]
        ]
        items.append(
            ItemOutput(key=item.key, channels=channels, totals=totals, measurements=measurements)
        )
    return EstimateResponse(items=items)


@router.post("/estimate")
def estimate_route(request: EstimateRequest) -> EstimateResponse:
    """Consommation théorique et estimée, coûts, calibration et écarts, canal par canal."""
    try:
        return estimate(request)
    except EngineError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
