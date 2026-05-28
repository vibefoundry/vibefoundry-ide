#!/bin/bash
set -e

cd "$(dirname "$0")"

python3 app_core/prepare_dev_assets.py
python3 app_core/serve.py
