import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request


SCRIPT = Path(__file__).with_name("subtitle_companion_bridge.py")
SPEC = importlib.util.spec_from_file_location("subtitle_companion_bridge", SCRIPT)
assert SPEC and SPEC.loader
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


class SubtitleCompanionBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="wwp-subtitle-bridge-")
        self.workspace = Path(self.temporary.name)
        self.request = {
            "work": {
                "title": "盗梦空间",
                "originalTitle": "Inception",
                "year": 2010,
                "imdbId": "tt1375666",
                "type": "movie",
            },
            "source": {
                "fileName": "Inception.2010.1080p.BluRay.REMUX.mkv",
                "durationSeconds": 8880.5,
                "fps": "23.976",
                "release": "BluRay REMUX",
            },
            "languages": ["zh-Hant", "zh-Hans"],
            "providers": ["subhd"],
        }
        self.task = bridge.create_task(self.workspace, self.request)
        self.server = bridge.BridgeServer(("127.0.0.1", 0), self.workspace, "test-instance", "test-token")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    def request_json(self, path, method="GET", body=None, token="test-token"):
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"X-WWP-Subtitle-Token": token}
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        with urllib.request.urlopen(request, timeout=2) as response:
            return response.status, json.loads(response.read() or b"{}")

    def test_create_task_is_content_addressed_and_idempotent(self):
        repeated = bridge.create_task(self.workspace, self.request)
        self.assertEqual(repeated["id"], self.task["id"])
        self.assertEqual(repeated["hash"], self.task["hash"])
        self.assertEqual(len(bridge.all_tasks(self.workspace)), 1)

    def test_health_and_provider_filtered_list(self):
        with urllib.request.urlopen(self.base + "/health", timeout=2) as response:
            health = json.loads(response.read())
        self.assertEqual(health["service"], bridge.SERVICE_NAME)
        self.assertEqual(
            health["installUrl"],
            f"{self.base}/install/wwp-subtitle-companion.user.js",
        )
        status, payload = self.request_json("/v1/tasks?provider=subhd")
        self.assertEqual(status, 200)
        self.assertEqual([item["id"] for item in payload["tasks"]], [self.task["id"]])

    def test_serves_userscript_install_artifact_without_bridge_token(self):
        with urllib.request.urlopen(
            self.base + "/install/wwp-subtitle-companion.user.js", timeout=2
        ) as response:
            content = response.read().decode("utf-8")
            content_type = response.headers.get("Content-Type")
        self.assertIn("application/javascript", content_type)
        self.assertIn("// ==UserScript==", content)
        self.assertIn("@name         WWP Subtitle Companion", content)

    def test_task_routes_require_token(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request_json("/v1/tasks", token="wrong")
        self.assertEqual(caught.exception.code, 401)

    def test_claim_and_candidates_flow(self):
        common = {
            "hash": self.task["hash"],
            "provider": "subhd",
            "clientId": "browser-a",
        }
        status, claimed = self.request_json(
            f"/v1/tasks/{self.task['id']}/claim", method="POST", body=common
        )
        self.assertEqual(status, 200)
        self.assertEqual(claimed["status"], "claimed")
        candidates = [{
            "id": "subhd:58k0EQ",
            "title": "Inception.2010.BluRay",
            "detailUrl": "https://subhd.com/a/58k0EQ",
            "languageLabels": ["简体", "繁体"],
            "badges": ["官方字幕"],
        }]
        status, captured = self.request_json(
            f"/v1/tasks/{self.task['id']}/candidates",
            method="POST",
            body={**common, "query": "Inception 2010", "pageUrl": "https://subhd.com/search/Inception", "candidates": candidates},
        )
        self.assertEqual(status, 200)
        self.assertEqual(captured, {"status": "candidates_ready", "count": 1})
        stored = bridge.read_json(bridge.task_path(self.workspace, self.task["id"]))
        self.assertEqual(stored["status"], "candidates_ready")
        self.assertEqual(stored["providerResults"]["subhd"]["candidates"], candidates)

    def test_wrong_client_cannot_submit_candidates(self):
        common = {"hash": self.task["hash"], "provider": "subhd", "clientId": "browser-a"}
        self.request_json(f"/v1/tasks/{self.task['id']}/claim", method="POST", body=common)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request_json(
                f"/v1/tasks/{self.task['id']}/candidates",
                method="POST",
                body={**common, "clientId": "browser-b", "candidates": []},
            )
        self.assertEqual(caught.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
