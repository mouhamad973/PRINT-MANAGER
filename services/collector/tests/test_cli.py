import pytest

from arksen_collector import __version__
from arksen_collector.__main__ import main


def test_version_flag_prints_version(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["--version"])

    assert exit_info.value.code == 0
    assert __version__ in capsys.readouterr().out


def test_agent_refuses_to_run_until_collection_exists() -> None:
    # L'agent ne doit jamais laisser croire qu'il collecte des données.
    with pytest.raises(SystemExit) as exit_info:
        main([])

    assert exit_info.value.code == 2
