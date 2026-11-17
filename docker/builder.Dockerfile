FROM texlive/texlive@sha256:f25ee2dcd00f58198f918064f4a1c8562410b33e84155bd55b02b419d73d9391 AS texlive
FROM emscripten/emsdk@sha256:8714ed3a9fb585e662c931259a996bac36a57a8dd34b81e8277436fd77364475
COPY --from=texlive /usr/local/texlive /usr/local/texlive
COPY requirements.txt /tmp/texkit-requirements.txt
RUN if ls /usr/lib/python3*/EXTERNALLY-MANAGED >/dev/null 2>&1; then \
      python3 -m pip install --no-deps --require-hashes --break-system-packages -r /tmp/texkit-requirements.txt; \
    else \
      python3 -m pip install --no-deps --require-hashes -r /tmp/texkit-requirements.txt; \
    fi
