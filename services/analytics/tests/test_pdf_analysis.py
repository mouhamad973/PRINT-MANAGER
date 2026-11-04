"""Analyse PDF sur des documents fabriqués : chaque couverture attendue se calcule à la main."""

from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from arksen_analytics.main import app
from arksen_analytics.pdf_analysis import (
    AnalysisError,
    IccSeparator,
    analyze_pdf,
    detect_format,
    separate_reference,
)

from .pdf_builder import A3, A4, Page, build_pdf, fill

# L'anticrénelage du bord d'un aplat déplace la mesure de quelques centièmes de point.
TOLERANCE = 0.5


def coverage(page: Page) -> dict[str, float]:
    analysed = analyze_pdf(build_pdf([page])).pages[0]
    return {
        "cyan": analysed.cyan,
        "magenta": analysed.magenta,
        "yellow": analysed.yellow,
        "black": analysed.black,
    }


class TestSeparation:
    def test_reference_separation_of_primaries(self) -> None:
        pixels = np.array(
            [[[255, 255, 255], [0, 0, 0], [0, 255, 255], [255, 0, 255], [255, 255, 0]]],
            dtype=np.uint8,
        )
        cyan, magenta, yellow, black = separate_reference(pixels)
        assert cyan[0].tolist() == [0, 0, 1, 0, 0]
        assert magenta[0].tolist() == [0, 0, 0, 1, 0]
        assert yellow[0].tolist() == [0, 0, 0, 0, 1]
        assert black[0].tolist() == [0, 1, 0, 0, 0]

    def test_grey_becomes_black_only(self) -> None:
        # Génération du noir à 100 % : un gris neutre ne consomme que du noir.
        cyan, magenta, yellow, black = separate_reference(np.full((1, 1, 3), 128, np.uint8))
        assert (cyan[0, 0], magenta[0, 0], yellow[0, 0]) == (0, 0, 0)
        assert black[0, 0] == pytest.approx(1 - 128 / 255)

    def test_dark_color_mixes_black_and_color(self) -> None:
        # Bleu marine (0, 0, 128) : N = 1 − 128/255, C = M = 1, J = 0.
        cyan, magenta, yellow, black = separate_reference(np.array([[[0, 0, 128]]], np.uint8))
        assert black[0, 0] == pytest.approx(1 - 128 / 255)
        assert (cyan[0, 0], magenta[0, 0], yellow[0, 0]) == (1, 1, 0)


class TestCoverage:
    def test_blank_page_has_no_coverage(self) -> None:
        result = analyze_pdf(build_pdf([Page()])).pages[0]
        assert result.total == 0
        assert result.is_color is False

    def test_coverage_is_mean_tone_over_the_page_area(self) -> None:
        # Moitié de la page en cyan plein : 50 %.
        assert coverage(fill("0 1 1", fraction=0.5))["cyan"] == pytest.approx(50, abs=TOLERANCE)
        # Toute la page à 20 % de noir (gris 0,8) : 20 %, et non 100 % de « pixels colorés ».
        assert coverage(fill("0.8 0.8 0.8"))["black"] == pytest.approx(20, abs=TOLERANCE)

    def test_full_black_page(self) -> None:
        assert coverage(fill("0 0 0")) == pytest.approx(
            {"cyan": 0, "magenta": 0, "yellow": 0, "black": 100}, abs=TOLERANCE
        )

    def test_cmyk_content_is_measured(self) -> None:
        # Cyan CMJN pur : PDFium le rend en sRGB, puis il est séparé ; le cyan domine largement.
        result = coverage(Page(content="1 0 0 0 k 0 0 595.28 841.89 re f"))
        assert result["cyan"] > 90
        assert result["cyan"] > 3 * max(result["magenta"], result["yellow"], result["black"])

    def test_gray_coverage_follows_luminance(self) -> None:
        # Cyan pur (0, 255, 255) : luminance 0,7874, donc 21,26 % de noir en niveaux de gris.
        page = analyze_pdf(build_pdf([fill("0 1 1")])).pages[0]
        assert page.gray == pytest.approx(21.26, abs=TOLERANCE)
        assert analyze_pdf(build_pdf([fill("0 0 0")])).pages[0].gray == pytest.approx(100, abs=0.1)

    def test_transparency_is_flattened(self) -> None:
        # Noir à 50 % d'opacité sur fond blanc : gris 127,5, donc environ 50 % de noir.
        page = Page(
            content="/GS1 gs 0 0 0 rg 0 0 595.28 841.89 re f",
            resources="/ExtGState << /GS1 << /Type /ExtGState /ca 0.5 >> >>",
        )
        assert coverage(page)["black"] == pytest.approx(50, abs=1)

    def test_spot_color_uses_its_alternate_space(self) -> None:
        # Couleur spéciale dont l'espace de substitution donne un magenta pur à 100 % de teinte.
        page = Page(
            content="/CS1 cs 1 scn 0 0 595.28 841.89 re f",
            resources=(
                "/ColorSpace << /CS1 [/Separation /Rose#20Test /DeviceRGB "
                "<< /FunctionType 2 /Domain [0 1] /C0 [1 1 1] /C1 [1 0 1] /N 1 >>] >>"
            ),
        )
        result = coverage(page)
        assert result["magenta"] == pytest.approx(100, abs=TOLERANCE)
        assert result["cyan"] == pytest.approx(0, abs=TOLERANCE)

    def test_document_average_is_weighted_by_page_area(self) -> None:
        # A4 noir à 100 % et A3 blanc : 100 × 1 / (1 + 2) = 33,3 %.
        analysis = analyze_pdf(build_pdf([fill("0 0 0"), Page(size=A3)]))
        assert analysis.average()["black"] == pytest.approx(100 / 3, abs=TOLERANCE)


class TestFormats:
    @pytest.mark.parametrize(
        ("size", "expected"),
        [
            ((210, 297), ("A4", "portrait")),
            ((420, 297), ("A3", "landscape")),
            ((450, 320), ("SRA3", "landscape")),
            ((215.9, 279.4), ("Letter", "portrait")),
            ((148, 210), ("A5", "portrait")),
            ((200, 200), ("Personnalisé", "square")),
            ((211.5, 296), ("A4", "portrait")),
        ],
    )
    def test_detects_formats_with_tolerance(
        self, size: tuple[float, float], expected: tuple[str, str]
    ) -> None:
        assert detect_format(*size) == expected

    def test_reports_size_and_area_of_each_page(self) -> None:
        analysis = analyze_pdf(build_pdf([Page(size=A4), Page(size=(A3[1], A3[0]))]))
        first, second = analysis.pages
        assert (first.width_mm, first.height_mm, first.format) == (210.0, 297.0, "A4")
        assert first.area_factor == pytest.approx(1, abs=1e-3)
        assert (second.format, second.orientation) == ("A3", "landscape")
        assert second.area_factor == pytest.approx(2, abs=1e-3)


class TestErrors:
    def test_rejects_a_file_that_is_not_a_pdf(self) -> None:
        with pytest.raises(AnalysisError, match="n'est pas un PDF"):
            analyze_pdf(b"bonjour")

    def test_rejects_a_damaged_pdf(self) -> None:
        with pytest.raises(AnalysisError, match="illisible"):
            analyze_pdf(b"%PDF-1.7\nfichier tronque")

    def test_limits_the_number_of_pages(self) -> None:
        with pytest.raises(AnalysisError, match="3 pages : 2 au maximum"):
            analyze_pdf(build_pdf([Page(), Page(), Page()]), max_pages=2)


class TestHttp:
    client = TestClient(app)

    def test_analyzes_an_uploaded_pdf(self) -> None:
        pdf = build_pdf([fill("0 1 1", fraction=0.5), Page()])
        response = self.client.post(
            "/v1/pdf/analyze", files={"file": ("essai.pdf", pdf, "application/pdf")}
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["page_count"] == 2
        assert body["color_pages"] == 1
        assert body["method"] == "pdfium-srgb/separation-reference-gcr100"
        assert body["pages"][0]["cyan"] == pytest.approx(50, abs=TOLERANCE)
        # Deux A4 : la moyenne vaut la moitié de la première page.
        assert body["average"]["cyan"] == pytest.approx(25, abs=TOLERANCE)

    def test_explains_why_a_file_is_refused(self) -> None:
        response = self.client.post(
            "/v1/pdf/analyze", files={"file": ("note.txt", b"texte", "text/plain")}
        )
        assert response.status_code == 422
        assert response.json()["detail"] == "Le fichier n'est pas un PDF."


# Profil CMJN « SWOP » livré avec Windows : absent ailleurs, le test est alors ignoré.
RSWOP = Path("C:/Windows/System32/spool/drivers/color/RSWOP.icm")


@pytest.mark.skipif(not RSWOP.exists(), reason="profil ICC CMJN de Windows absent")
class TestIccSeparation:
    def test_separates_through_an_output_profile(self) -> None:
        icc = IccSeparator(RSWOP)
        analysis = analyze_pdf(build_pdf([fill("0 1 1", fraction=0.5), fill("1 1 1")]), icc=icc)
        cyan_page, white_page = analysis.pages

        assert analysis.method == "pdfium-srgb/icc:RSWOP.icm"
        # Un profil de presse sépare le cyan sRGB sur plusieurs encres, cyan en tête.
        assert cyan_page.cyan > 25
        assert cyan_page.cyan > max(cyan_page.yellow, cyan_page.black)
        assert white_page.total == pytest.approx(0, abs=0.5)

    def test_rejects_an_unreadable_profile(self, tmp_path: Path) -> None:
        broken = tmp_path / "faux.icc"
        broken.write_bytes(b"pas un profil")
        with pytest.raises(ValueError, match="Profil ICC illisible"):
            IccSeparator(broken)
