# Envoltorio de MinIO.
# MinIO cerró el acceso público a minio/minio en Docker Hub (exige login) y quay
# no sirve el tag de forma anónima. La imagen base YA está cacheada en el host
# (el contenedor minio está corriendo), así que al construir este servicio Docker
# reutiliza la capa local sin descargar nada. Coolify, además, NO hace "pull" de
# los servicios que se construyen (los marca "Image can be built"), lo que evita
# el fallo de pull que rompía el despliegue.
FROM minio/minio:latest
