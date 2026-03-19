#!/bin/bash
set -e

echo "Running poll contract tests..."
python3 -m pytest tests/test_poll.py -v
