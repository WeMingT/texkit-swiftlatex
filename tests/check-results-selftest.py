#!/usr/bin/env python3
"""Prove complete result reasons, individual gates, and category boundaries."""
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('result_checker', HERE / 'check-results.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def main():
    expected = json.loads((HERE / 'gate-selfcheck/expected.json').read_text())
    fixture_dir = HERE / 'gate-selfcheck/fixtures'
    data = {name: checker.read_case(fixture_dir, name) for name in expected['fixtures']}
    failures = []
    coverage = {code: [] for code in checker.REASON_CODES}
    for name, record in expected['fixtures'].items():
        reasons = checker.check_case(*data[name], record['expectation'])
        if reasons != record['reasons']:
            failures.append(f'{name}: expected {record["reasons"]}, got {reasons}')
        if reasons and checker.verdict(reasons, data[name][3], data[name][0], record['expectation']):
            failures.append(f'{name}: negative fixture accepted as success')
        for reason in record['reasons']:
            if reason not in coverage:
                failures.append(f'{name}: unknown reason {reason}')
            else:
                coverage[reason].append(name)
    for code, names in sorted(coverage.items()):
        if not names:
            failures.append(f'uncovered reason: {code}')
        detected = any(checker.check_case(*data[name], record['expectation'], disabled=frozenset({code}))
                       != record['reasons'] for name, record in expected['fixtures'].items())
        if not detected:
            failures.append(f'disabling {code} escaped fixture comparisons')
        print(f'{code}: {", ".join(names)}; disabling detected={detected}')
    for name, record in expected['verdictCases'].items():
        log, pdf, svg, meta = data[record['fixture']]
        reasons = checker.check_case(log, pdf, svg, meta, record['expectation'])
        actual = checker.verdict(reasons, meta, log, record['expectation'])
        if actual is not record['pass']:
            failures.append(f'{name}: expected verdict {record["pass"]}, got {actual}, reasons={reasons}')
    record = expected['fixtures']['derived-undefined-reference-with-allowance']
    reasons = checker.check_case(*data['derived-undefined-reference-with-allowance'], {'expect': 'success'})
    if reasons != ['rerun-requested', 'unresolved-reference']:
        failures.append(f'removing rerun allowance lost a reason: {reasons}')
    for field, value in [('status', True), ('status', '0'), ('pdfBytes', 0), ('ok', 1)]:
        log, pdf, svg, meta = data['16-chemfig']
        meta = dict(meta, **{field: value})
        expectation = expected['fixtures']['16-chemfig']['expectation']
        reasons = checker.check_case(log, pdf, svg, meta, expectation)
        if checker.verdict(reasons, meta, log, expectation):
            failures.append(f'invalid success metadata accepted: {field}={value!r}')
    for failure in failures:
        print('FAIL: ' + failure, file=sys.stderr)
    print(f'result selftest: {len(data)} fixtures, {len(expected["verdictCases"])} verdict controls, {len(failures)} failures')
    return int(bool(failures))


if __name__ == '__main__':
    sys.exit(main())
