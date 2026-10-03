# ============================================================================
#  MinIO compilado desde el código fuente (open source, AGPL-3.0).
#  MinIO cerró en 2025 la distribución pública de su imagen en Docker Hub, quay
#  y ECR Public (requieren login / repos privados). Para no depender de esos
#  registros, compilamos el binario desde el repositorio oficial usando bases
#  públicas (golang / alpine). Se fija una versión concreta y reproducible,
#  igual a la que el host venía ejecutando, para garantizar compatibilidad con
#  el formato de datos del volumen minio_data existente.
# ============================================================================
FROM golang:1.24-alpine AS build
# GOTOOLCHAIN=auto permite que Go descargue el toolchain exacto que pida go.mod.
ENV CGO_ENABLED=0 GOTOOLCHAIN=auto GOFLAGS=-trimpath
RUN apk add --no-cache git ca-certificates
WORKDIR /src
# Versión a compilar (última release pública de MinIO). Cambiable por --build-arg.
ARG MINIO_REF=RELEASE.2025-10-15T17-29-55Z
RUN git clone --depth 1 --branch "${MINIO_REF}" https://github.com/minio/minio.git . \
 && go build -o /out/minio . \
 && /out/minio --version || true

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget
COPY --from=build /out/minio /usr/bin/minio
# Los datos existentes fueron escritos por el MinIO oficial como root; corremos
# como root (por defecto) para no romper los permisos del volumen montado en /data.
EXPOSE 9000 9001
ENTRYPOINT ["/usr/bin/minio"]
# El `command:` del docker-compose aporta: server /data --console-address :9001
