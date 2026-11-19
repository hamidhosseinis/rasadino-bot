import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import app as downloader

client = TestClient(downloader.app)
VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


@pytest.fixture(autouse=True)
def credentials(monkeypatch):
    monkeypatch.setenv("DOWNLOAD_API_KEY", "only-for-tests")
    monkeypatch.setenv("BOT_TOKEN", "fake-token")


def test_strict_video_url_validation():
    assert downloader.canonical_video_url("https://youtu.be/dQw4w9WgXcQ?t=10") == VIDEO
    for url in (
        "http://youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com.evil.org/watch?v=dQw4w9WgXcQ",
        "https://youtube.com/playlist?list=abcd",
        "https://youtu.be/invalid",
        "file:///etc/passwd",
        "https://youtube.com:8443/watch?v=dQw4w9WgXcQ"
    ):
        assert downloader.canonical_video_url(url) is None


def test_public_endpoint_requires_shared_secret_and_valid_link():
    body = {"chat_id":"1234","youtube_url":VIDEO}
    assert client.post("/jobs",json=body).status_code == 401
    assert client.post("/jobs",json=body,headers={"X-Download-Key":"wrong"}).status_code == 401
    body = {"chat_id":"5678","youtube_url":"https://notyoutube.org/v/aaa"}
    assert client.post("/jobs",json=body,headers={"X-Download-Key":"only-for-tests"}).status_code == 400


def test_authorized_job_returns_202_and_runs_task():
    def fake_task(job):
        assert job.chat_id == "5678"
        assert job.youtube_url == VIDEO
        downloader._slot.release()
    with patch.object(downloader, "_process_job", fake_task):
        response=client.post("/jobs",json={"chat_id":"5678","youtube_url":VIDEO},
                             headers={"X-Download-Key":"only-for-tests"})
    assert response.status_code == 202
    assert response.json() == {"accepted":True}
