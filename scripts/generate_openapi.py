"""Generate OpenAPI JSON from the FastAPI app."""

from pathlib import Path
import json

from myloware.api.server import app


def main() -> None:
    spec = app.openapi()
    output = Path("openapi.json")
    output.write_text(json.dumps(spec, indent=2))
    print(f"Wrote OpenAPI spec to {output}")


if __name__ == "__main__":
    main()
