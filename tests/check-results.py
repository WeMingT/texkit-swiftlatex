#!/usr/bin/env python3
"""Judge saved compile results from their actual log, PDF, SVG and metadata."""
import argparse
import json
import math
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
import zlib

REASON_CODES = frozenset({
    'exit-code', 'empty-pdf', 'page-count', 'byte-count', 'missing-character',
    'font-substitution', 'unresolved-reference', 'rerun-requested', 'svg-parse',
    'svg-size', 'svg-pageset', 'font-required-missing', 'font-forbidden-present',
})
BASE_FAILURES = frozenset({'exit-code', 'empty-pdf', 'byte-count'})
OUTPUT = re.compile(r'^Output written on .+ \((\d+) pages?, (\d+) bytes\)\.?$', re.M)


def output_record(log):
    records = OUTPUT.findall(log)
    return tuple(map(int, records[-1])) if records else None


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def patterns(expectation, key):
    return [re.compile(item['pattern']) for item in expectation.get(key, [])]


def validate_expectation(expectation):
    try:
        if not isinstance(expectation, dict) or expectation.get('expect') not in ('success', 'limitation', 'failure'):
            return False
        if set(expectation) - {'expect', 'fonts', 'allowWarnings', 'allowRerunWarnings', 'reasons', 'logPattern'}:
            return False
        for key in ('allowWarnings', 'allowRerunWarnings'):
            entries = expectation.get(key, [])
            if not isinstance(entries, list):
                return False
            for item in entries:
                if not isinstance(item, dict) or not isinstance(item.get('pattern'), str) or not item['pattern']:
                    return False
                if not isinstance(item.get('reason'), str) or not item['reason'].strip():
                    return False
                re.compile(item['pattern'])
        fonts = expectation.get('fonts', {})
        if not isinstance(fonts, dict) or set(fonts) - {'require', 'forbid'}:
            return False
        for key in ('require', 'forbid'):
            if not isinstance(fonts.get(key, []), list):
                return False
            for pattern in fonts.get(key, []):
                if not isinstance(pattern, str) or not pattern:
                    return False
                re.compile(pattern)
        if expectation['expect'] == 'limitation':
            reasons = expectation.get('reasons')
            if not isinstance(reasons, list) or not reasons or any(type(code) is not str for code in reasons):
                return False
            if len(set(reasons)) != len(reasons) or set(reasons) - REASON_CODES or set(reasons) & BASE_FAILURES:
                return False
        if expectation['expect'] == 'failure':
            pattern = expectation.get('logPattern')
            if not isinstance(pattern, str) or not pattern:
                return False
            re.compile(pattern)
        return True
    except (KeyError, TypeError, re.error):
        return False


def embedded_fonts(pdf):
    sources = [pdf]
    for match in re.finditer(rb'(?<![A-Za-z])stream\r?\n', pdf):
        start = match.end()
        end = pdf.find(b'endstream', start)
        header_start = pdf.rfind(b'endobj', 0, match.start())
        header = pdf[max(0, header_start):match.start()]
        if end >= 0 and b'/FlateDecode' in header:
            try:
                sources.append(zlib.decompress(pdf[start:end]))
            except zlib.error:
                continue
    names = set()
    for source in sources:
        for name in re.findall(rb'/BaseFont\s*/([^\s/<>\[\]()]+)', source):
            name = re.sub(rb'#([0-9a-fA-F]{2})', lambda m: bytes([int(m[1], 16)]), name)
            names.add(re.sub(r'^[A-Z]{6}\+', '', name.decode('latin-1')))
    return names


def dimension(value):
    if not isinstance(value, str):
        return False
    match = re.fullmatch(r'\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:[a-zA-Z%]+)?\s*', value)
    return bool(match and math.isfinite(float(match[1])) and float(match[1]) > 0)


def check_case(log, pdf, svg, meta, expectation, disabled=frozenset()):
    if set(disabled) - REASON_CODES:
        raise ValueError('unknown disabled reason')
    reasons = set()

    def report(code, failed):
        if failed and code not in disabled:
            reasons.add(code)

    report('exit-code', meta.get('ok') is not True or not number(meta.get('status')) or meta['status'] != 0)
    report('empty-pdf', not pdf)
    output = output_record(log)
    report('page-count', output is None or output[0] != 1)
    report('byte-count', output is not None and output[1] != len(pdf))
    report('missing-character', 'Missing character:' in log)
    allowed_fonts = patterns(expectation, 'allowWarnings')
    font_lines = [line for line in log.splitlines() if line.startswith('LaTeX Font Warning: Font shape')
                  or 'Some font shapes were not available' in line]
    report('font-substitution', any(not any(pattern.search(line) for pattern in allowed_fonts) for line in font_lines))
    report('unresolved-reference', bool(re.search(r'LaTeX Warning: Reference .* undefined|There were undefined references', log)))
    allowed_reruns = patterns(expectation, 'allowRerunWarnings')
    reruns = [line for line in log.splitlines() if 'Label(s) may have changed' in line]
    report('rerun-requested', any(not any(pattern.search(line) for pattern in allowed_reruns) for line in reruns))
    try:
        if not svg:
            raise ET.ParseError('missing SVG')
        root = ET.fromstring(svg)
        if root.tag.rsplit('}', 1)[-1] != 'svg':
            raise ET.ParseError('root is not SVG')
    except ET.ParseError:
        report('svg-parse', True)
    else:
        report('svg-size', not dimension(root.get('width')) or not dimension(root.get('height')))
        report('svg-pageset', any(element.tag.rsplit('}', 1)[-1] == 'pageSet' for element in root.iter()))
    fonts = embedded_fonts(pdf)
    rules = expectation.get('fonts', {})
    report('font-required-missing', any(not any(re.search(pattern, name) for name in fonts) for pattern in rules.get('require', [])))
    report('font-forbidden-present', any(re.search(pattern, name) for pattern in rules.get('forbid', []) for name in fonts))
    return sorted(reasons)


def verdict(reasons, meta, log, expectation):
    if not validate_expectation(expectation) or not isinstance(reasons, list) or any(type(code) is not str for code in reasons):
        return False
    if set(reasons) - REASON_CODES or len(set(reasons)) != len(reasons):
        return False
    status = meta.get('status')
    if not number(status):
        return False
    kind = expectation['expect']
    if kind == 'failure':
        return meta.get('ok') is False and status != 0 and bool(re.search(expectation['logPattern'], log))
    output = output_record(log)
    pdf_bytes = meta.get('pdfBytes')
    if (meta.get('ok') is not True or status != 0 or not number(pdf_bytes) or pdf_bytes <= 0
            or output is None or output[0] < 1 or output[1] <= 0 or output[1] != pdf_bytes
            or set(reasons) & BASE_FAILURES):
        return False
    if kind == 'success':
        return output[0] == 1 and not reasons
    return bool(reasons) and set(reasons) == set(expectation['reasons'])


def read_case(directory, name):
    if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_.-]+', name):
        raise ValueError('invalid case name')
    directory = Path(directory)
    return ((directory / (name + '.log')).read_text(),
            (directory / (name + '.pdf')).read_bytes(),
            (directory / (name + '.svg')).read_bytes(),
            json.loads((directory / (name + '.meta.json')).read_text()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--expect', required=True, type=Path)
    args = parser.parse_args()
    expectations = json.loads(args.expect.read_text())['cases']
    if not isinstance(expectations, dict) or not expectations:
        raise ValueError('expectations must contain a nonempty cases object')
    actual = {p.name[:-len('.meta.json')] for p in args.out.glob('*.meta.json')}
    if actual != set(expectations):
        raise ValueError(f'case sets differ: missing={sorted(set(expectations)-actual)}, undeclared={sorted(actual-set(expectations))}')
    result = {}
    for name, expectation in sorted(expectations.items()):
        if not validate_expectation(expectation):
            raise ValueError(f'invalid expectation: {name}')
        log, pdf, svg, meta = read_case(args.out, name)
        reasons = check_case(log, pdf, svg, meta, expectation)
        result[name] = {'expect': expectation['expect'], 'reasons': reasons,
                        'pass': verdict(reasons, meta, log, expectation)}
    print(json.dumps(result, indent=2, sort_keys=True))
    return int(any(not row['pass'] for row in result.values()))


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError, re.error, ET.ParseError) as error:
        print('check-results: ' + str(error), file=sys.stderr)
        sys.exit(2)
