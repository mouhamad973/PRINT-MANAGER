import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

/** Contrat de `POST /v1/pdf/analyze` (`services/analytics`). */
export interface PdfAnalysis {
  method: string;
  dpi: number;
  page_count: number;
  color_pages: number;
  average: { cyan: number; magenta: number; yellow: number; black: number; total: number };
  pages: {
    number: number;
    width_mm: number;
    height_mm: number;
    format: string;
    orientation: 'portrait' | 'landscape' | 'square';
    area_factor: number;
    cyan: number;
    magenta: number;
    yellow: number;
    black: number;
    total: number;
    gray: number;
    is_color: boolean;
  }[];
}

const TIMEOUT_MS = 120_000;
const UNAVAILABLE = 'Le service d’analyse est indisponible. Réessayez dans un instant.';

/** Envoie un PDF au service d'analyse. Le fichier n'est conservé ni ici ni là-bas. */
@Injectable()
export class AnalysisClient {
  private readonly logger = new Logger(AnalysisClient.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async analyze(file: Buffer, filename: string): Promise<PdfAnalysis> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)], { type: 'application/pdf' }), filename);
    let response: Response;
    try {
      response = await fetch(new URL('/v1/pdf/analyze', this.config.ANALYTICS_URL), {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`Analyse PDF injoignable : ${(error as Error).message}`);
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
    if (response.status === 422) {
      const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
      throw new BadRequestException(
        typeof body?.detail === 'string' ? body.detail : 'Le fichier ne peut pas être analysé.',
      );
    }
    if (response.status === 413) {
      throw new PayloadTooLargeException('Le fichier dépasse 50 Mo.');
    }
    if (!response.ok) {
      this.logger.error(`Analyse PDF : HTTP ${response.status}`);
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
    return (await response.json()) as PdfAnalysis;
  }
}
