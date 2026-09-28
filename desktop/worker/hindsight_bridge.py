"""Private stdio access to pinned Hindsight; no API port is published."""
import concurrent.futures
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

lock = threading.Lock()


def send(value):
    with lock:
        print(json.dumps(value, separators=(",", ":")), flush=True)


def main():
    settings = json.loads(sys.stdin.readline())
    env = dict(os.environ)
    env.update(settings["environment"])
    # Pin reviewed local weights; model names alone track a moving repository.
    from huggingface_hub import snapshot_download
    for variable, model, revision in [
        ("HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL", "BAAI/bge-small-en-v1.5", "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a"),
        ("HINDSIGHT_API_RERANKER_LOCAL_MODEL", "cross-encoder/ms-marco-MiniLM-L6-v2", "233902d25c440f23af6f7d6e94d2946bac0bee0a"),
    ]:
        send({"progress": "Preparing pinned " + model})
        env[variable] = snapshot_download(repo_id=model, revision=revision,
            cache_dir="/home/hindsight/.cache/huggingface/hub",
            allow_patterns=["*.json", "*.txt", "*.safetensors", "LICENSE*", "README.md", "1_Pooling/*"])
    server = subprocess.Popen(
        ["hindsight-api", "--host", "127.0.0.1", "--port", "8888"],
        env=env, stdout=sys.stderr, stderr=sys.stderr,
    )
    try:
        for _ in range(300):
            if server.poll() is not None:
                raise RuntimeError("Hindsight stopped during setup")
            try:
                with urllib.request.urlopen("http://127.0.0.1:8888/health/ready", timeout=2) as response:
                    if response.status == 200:
                        break
            except (OSError, urllib.error.URLError):
                time.sleep(1)
        else:
            raise RuntimeError("Hindsight setup timed out")
        send({"ready": True})

        def request(value):
            try:
                path = value["path"]
                if not path.startswith("/v1/default/banks/") or ".." in path or "?" in path:
                    raise ValueError("Unsupported memory path")
                body = json.dumps(value["body"]).encode() if "body" in value else None
                req = urllib.request.Request("http://127.0.0.1:8888" + path, data=body,
                                             method=value["method"], headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=120) as response:
                    data = response.read(2 * 1024 * 1024 + 1)
                    if len(data) > 2 * 1024 * 1024:
                        raise ValueError("Memory response exceeded limit")
                    result = json.loads(data) if data else None
                send({"id": value["id"], "result": result})
            except urllib.error.HTTPError as error:
                send({"id": value["id"], "error": "Hindsight HTTP " + str(error.code)})
            except Exception:
                send({"id": value.get("id"), "error": "Memory request failed; inspect runtime health"})

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for line in sys.stdin:
                if len(line) > 2 * 1024 * 1024:
                    raise ValueError("Memory request exceeded limit")
                pool.submit(request, json.loads(line))
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    main()
