"""Basic tests for watch recognition data integrity."""
import json
import os

def test_enhanced_pricing_file_exists():
    path = os.path.join(os.path.dirname(__file__), '..', 'src', 'enhanced-pricing.js')
    assert os.path.isfile(path), "enhanced-pricing.js must exist"

def test_enhanced_pricing_syntax():
    path = os.path.join(os.path.dirname(__file__), '..', 'src', 'enhanced-pricing.js')
    with open(path) as f:
        content = f.read()
    # Basic syntax checks
    assert 'ENHANCED_PRICING' in content, "Must export ENHANCED_PRICING"
    assert 'detectVariant' in content, "Must have detectVariant function"
    assert 'specialVariants' in content, "Must have specialVariants map"

def test_worker_file_exists():
    path = os.path.join(os.path.dirname(__file__), '..', 'src', 'worker.js')
    assert os.path.isfile(path), "worker.js must exist"

def test_refs_data_valid_json():
    path = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'refs.json')
    if not os.path.isfile(path):
        return  # skip if no data yet
    with open(path) as f:
        data = json.load(f)
    assert isinstance(data, (list, dict)), "refs.json must be valid JSON"

def test_bundle_data_valid_json():
    path = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'bundle.json')
    if not os.path.isfile(path):
        return  # skip if no data yet
    with open(path) as f:
        data = json.load(f)
    assert isinstance(data, dict), "bundle.json must be a JSON object"
