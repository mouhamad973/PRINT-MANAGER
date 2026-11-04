import type { CalibrationConfidence, CalibrationSource, CmykChannel } from '@arksen/shared-types';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

/** Contrat du moteur CMJN (`services/analytics`, `POST /v1/cmyk/estimate`). */
export interface EngineChannel {
  channel: CmykChannel;
  capacity_g: number;
  yield_pages: number;
  reference_coverage: number;
  coverage: number;
  unit_price: number | null;
  manual_coefficient: number | null;
}

export interface EngineMeasurement {
  id: string;
  channel: CmykChannel;
  total_pages: number;
  color_pages: number;
  real_g: number;
}

export interface EngineItem {
  key: string;
  group: string | null;
  total_pages: number;
  color_pages: number;
  paper_format: 'A4' | 'A3' | 'SRA3';
  media_factor: number;
  channels: EngineChannel[];
  measurements: EngineMeasurement[];
}

export interface EngineChannelResult {
  channel: CmykChannel;
  relevant_pages: number;
  reference_g_per_page: number;
  coverage: number;
  theoretical_g: number;
  estimated_g: number;
  estimated_g_per_1000_pages: number;
  calibration: {
    coefficient: number;
    source: CalibrationSource;
    observations: number;
    confidence: CalibrationConfidence;
  };
  cost_theoretical: number | null;
  cost_estimated: number | null;
}

export interface EngineItemResult {
  key: string;
  channels: EngineChannelResult[];
  totals: {
    theoretical_g: number;
    estimated_g: number;
    cost_theoretical: number | null;
    cost_estimated: number | null;
    cost_per_page: number | null;
    complete_cost: boolean;
  };
  measurements: {
    id: string;
    channel: CmykChannel;
    theoretical_g: number;
    real_g: number;
    deviation_g: number;
    deviation_ratio: number | null;
    overconsumption_ratio: number | null;
  }[];
}

const TIMEOUT_MS = 15_000;

/** Appels au moteur de calcul. Il ne conserve aucune donnée : il reçoit tout ce qu'il calcule. */
@Injectable()
export class EngineClient {
  private readonly logger = new Logger(EngineClient.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async estimate(items: EngineItem[]): Promise<Map<string, EngineItemResult>> {
    if (items.length === 0) return new Map();
    let response: Response;
    try {
      response = await fetch(new URL('/v1/cmyk/estimate', this.config.ANALYTICS_URL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`Moteur CMJN injoignable : ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'Le moteur de calcul est indisponible. Réessayez dans un instant.',
      );
    }
    if (response.status === 422) {
      const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
      // Le moteur rédige ses messages métier ; une erreur de format reste interne.
      const detail =
        typeof body?.detail === 'string' ? body.detail : 'Paramètres de calcul invalides.';
      throw new BadRequestException(detail);
    }
    if (!response.ok) {
      this.logger.error(`Moteur CMJN : HTTP ${response.status}`);
      throw new ServiceUnavailableException(
        'Le moteur de calcul est indisponible. Réessayez dans un instant.',
      );
    }
    const body = (await response.json()) as { items: EngineItemResult[] };
    return new Map(body.items.map((item) => [item.key, item]));
  }
}
