# Minimal g++ toolchain image used as the ephemeral execution sandbox.
# We compile with -static so the produced binary needs no shared libs at run
# time — which lets the run-phase container stay locked down (read-only rootfs).
FROM gcc:13.2

# A non-root user exists in the image, but at run time we additionally pass
# --user <host uid:gid> from the runner so files created in the bind-mounted
# work dir are owned correctly and nothing runs as root.
RUN useradd --create-home --uid 10001 sandbox

USER sandbox
WORKDIR /work

# No ENTRYPOINT: the runner supplies the exact argv (g++ ... / the binary).
