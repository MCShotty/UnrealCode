"""Optional local decision and extraction worker. JSONL only; no project access is needed."""

import json
import sys


router = None
extractor = None


def evaluate(payload):
    global router
    if router is None:
        from laya import Router

        router = Router()
    response = router.predict(payload["state"], payload["questions"])
    return {
        "model": response.get("routing", {}).get("model", "laya"),
        "answers": response["answers"],
        "usage": response.get("usage"),
    }


def extract(payload):
    global extractor
    if extractor is None:
        from gliner import GLiNER

        extractor = GLiNER.from_pretrained("gliner-community/gliner_small-v2.5")
    results = extractor.predict_entities(payload["text"], payload["labels"], threshold=0.5)
    return [
        {
            "text": item["text"],
            "label": item["label"],
            "start": item["start"],
            "end": item["end"],
            "score": item["score"],
        }
        for item in results
    ]


def main():
    for line in sys.stdin:
        try:
            request = json.loads(line)
            method = request.get("method")
            if method == "evaluate":
                result = evaluate(request["payload"])
            elif method == "extract":
                result = extract(request["payload"])
            else:
                raise ValueError("unsupported worker method")
            response = {"ok": True, "result": result}
        except Exception as error:  # Keep the worker alive for the next request.
            response = {"ok": False, "error": f"{type(error).__name__}: {error}"}
        sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
