import json
from pathlib import Path

import pytest

from arksen_collector import __version__
from arksen_collector.__main__ import main


def test_version_flag_prints_version(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["--version"])

    assert exit_info.value.code == 0
    assert __version__ in capsys.readouterr().out


def test_a_command_is_required() -> None:
    with pytest.raises(SystemExit) as exit_info:
        main([])

    assert exit_info.value.code == 2


def test_status_of_a_new_agent(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["--home", str(tmp_path), "status"])
    assert exit_info.value.code == 0
    status = json.loads(capsys.readouterr().out)
    assert status["enrolled"] is False
    assert status["pending"] == 0


def test_insecure_server_is_refused(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(
            [
                "--home",
                str(tmp_path),
                "enroll",
                "--server",
                "http://print.exemple.com",
                "--code",
                "X",
            ]
        )
    assert exit_info.value.code == 1
    assert "HTTPS" in capsys.readouterr().err
