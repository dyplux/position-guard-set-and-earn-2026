"""Minimal JSON-line MCP transport exposing read-only tools, without a wallet."""
import json
import sys
from collector import collect
from policy import assess, verify_receipt
from server import parse_json


def handle(message):
    ident, method = message.get("id"), message.get("method")
    if ident is None:
        return None
    if method == "initialize":
        result = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}},
                  "serverInfo": {"name": "dyplux-position-guard-local", "version": "0.2.0"}}
    elif method == "tools/list":
        result = {"tools": [
            {"name": "observe_venus_testnet_position", "description": "Read chain 97 Venus Core at a fixed block. No signing; runtime pins and exact LT/VAI reconciliation are required.",
             "inputSchema": {"type": "object", "properties": {"wallet": {"type": "string", "pattern": "^0x[0-9a-fA-F]{40}$"}}, "required": ["wallet"], "additionalProperties": False}},
            {"name": "assess_position_snapshot", "description": "Deterministic calculation over supplied evidence. Input authenticity isn't established by a hash.",
             "inputSchema": {"type": "object", "properties": {"snapshot": {"type": "object"}}, "required": ["snapshot"], "additionalProperties": False}},
            {"name": "verify_position_receipt", "description": "Check canonical receipt integrity, not source authenticity.",
             "inputSchema": {"type": "object", "properties": {"receipt": {"type": "object"}}, "required": ["receipt"], "additionalProperties": False}}]}
    elif method == "tools/call":
        params = message.get("params", {})
        name, args = params.get("name"), params.get("arguments", {})
        if not isinstance(args, dict):
            return {"jsonrpc": "2.0", "id": ident, "error": {"code": -32602, "message": "Arguments must be an object"}}
        if name not in {"observe_venus_testnet_position", "assess_position_snapshot", "verify_position_receipt"}:
            return {"jsonrpc": "2.0", "id": ident, "error": {"code": -32602, "message": "Unknown read-only tool"}}
        try:
            if name == "observe_venus_testnet_position":
                value = assess(collect(args.get("wallet")), collector_attested=True)
            elif name == "assess_position_snapshot":
                value = assess(args.get("snapshot"))
            elif name == "verify_position_receipt":
                value = {"integrity_match": verify_receipt(args.get("receipt")), "authenticity_proven": False}
            else:
                raise ValueError("UNKNOWN_READ_ONLY_TOOL")
            result = {"content": [{"type": "text", "text": json.dumps(value, ensure_ascii=True)}], "isError": False}
        except (ValueError, TypeError, OSError) as error:
            result = {"content": [{"type": "text", "text": str(error)[:160]}], "isError": True}
    else:
        return {"jsonrpc": "2.0", "id": ident, "error": {"code": -32601, "message": "Unsupported method"}}
    return {"jsonrpc": "2.0", "id": ident, "result": result}


if __name__ == "__main__":
    for line in sys.stdin:
        if len(line) > 12000:
            continue
        try:
            message = parse_json(line)
            result = handle(message)
            if result is not None:
                print(json.dumps(result, ensure_ascii=True), flush=True)
        except (ValueError, TypeError, AttributeError, RecursionError):
            print(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Invalid request"}}), flush=True)
