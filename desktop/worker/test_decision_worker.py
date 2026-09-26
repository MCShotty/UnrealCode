"""Contract checks for the optional JSONL worker without downloading model weights."""

import importlib.util
from pathlib import Path
import sys
import types
import unittest
import io
import json
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("decision_worker", Path(__file__).with_name("decision_worker.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerContractTests(unittest.TestCase):
    def test_library_stdout_does_not_corrupt_jsonl(self):
        class Router:
            def predict(self, state, questions):
                print("Loading local model")
                return {"answers": {"ok": {"type": "noul", "noul": 0.8}}}

        sys.modules["laya"] = types.SimpleNamespace(Router=Router)
        output, logs = io.StringIO(), io.StringIO()
        request = {"method": "evaluate", "payload": {"state": "fixture", "questions": {}}}
        with patch.object(sys, "stdin", io.StringIO(json.dumps(request) + "\n")), patch.object(sys, "stdout", output), patch.object(sys, "stderr", logs):
            worker.main()
        self.assertTrue(json.loads(output.getvalue())["ok"])
        self.assertIn("Loading local model", logs.getvalue())

    def tearDown(self):
        worker.router = None
        worker.extractor = None
        sys.modules.pop("laya", None)
        sys.modules.pop("gliner", None)

    def test_laya_preserves_answers_model_and_usage(self):
        class Router:
            def predict(self, state, questions):
                self.last_state = state
                self.last_questions = questions
                return {"routing": {"model": "english"}, "answers": {"route": {"type": "choice", "choice": "code", "confidence": 0.8}}, "usage": {"input_tokens": 12}}

        sys.modules["laya"] = types.SimpleNamespace(Router=Router)
        result = worker.evaluate({"state": {"text": "fix code"}, "questions": {"route": {"type": "choice"}}})
        self.assertEqual(result["model"], "english")
        self.assertEqual(result["answers"]["route"]["confidence"], 0.8)
        self.assertEqual(result["usage"]["input_tokens"], 12)

    def test_gliner_extracts_spans_without_decision_labels(self):
        class GLiNER:
            @classmethod
            def from_pretrained(cls, model):
                assert model == "gliner-community/gliner_small-v2.5"
                return cls()

            def predict_entities(self, text, labels, threshold):
                self.last = (text, labels, threshold)
                return [{"text": "Alice", "label": "person", "start": 0, "end": 5, "score": 0.9}]

        sys.modules["gliner"] = types.SimpleNamespace(GLiNER=GLiNER)
        result = worker.extract({"text": "Alice writes code", "labels": ["person"]})
        self.assertEqual(result, [{"text": "Alice", "label": "person", "start": 0, "end": 5, "score": 0.9}])


if __name__ == "__main__":
    unittest.main()
