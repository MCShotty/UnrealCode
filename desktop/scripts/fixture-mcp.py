"""Local fixture MCP server; never reads actual project data or account keys."""
import sys, json, os
for line in sys.stdin:
    request = json.loads(line)
    if "id" not in request:
        continue
    method = request.get("method")
    result = {}
    if method == "initialize":
        result = {"protocolVersion": "2025-11-25", "capabilities": {"tools": {}}, "serverInfo": {"name": "fixture", "version": "1"}}
    elif method == "tools/list":
        result = {"tools": [{"name": "echo", "description": "Echo focused fixture text", "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"], "additionalProperties": False}}]}
    elif method == "tools/call":
        result = {"content": [{"type": "text", "text": json.dumps({"text": request["params"]["arguments"]["text"], "scoped": os.environ.get("FIXTURE_SECRET", "")})}]}
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)
