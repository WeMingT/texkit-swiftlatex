#!/usr/bin/env bash
# Release publication is performed only by the exact-tag CI workflow.
printf '%s\n' 'Retired: publish.sh is disabled. Push the authorized engine-v2 tag to run .github/workflows/pdftex-build.yml.' >&2
exit 1
