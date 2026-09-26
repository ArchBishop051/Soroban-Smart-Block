# Soroban Smart Block Explorer Python Client

This package provides a typed Python client generated from the OpenAPI specification in [docs/api/openapi.yaml](../../docs/api/openapi.yaml).

## Install

```bash
pip install soroban-smart-block-explorer
```

## Usage

```python
from soroban_smart_block_explorer import SorobanExplorerClient

client = SorobanExplorerClient(base_url="http://localhost:3001")
health = client.get_health()
print(health)
```

## Regenerate

```bash
docker run --rm -v "$(pwd):/workspace" openapitools/openapi-generator-cli generate \
  -i /workspace/docs/api/openapi.yaml \
  -g python \
  -o /workspace/packages/python-client \
  --additional-properties=packageName=soroban_smart_block_explorer,packageVersion=0.1.0
```
