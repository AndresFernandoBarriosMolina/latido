# Despliegue de Latido en Coolify (VPS Hostinger)

VPS: `31.97.100.240` · KVM 8 (8 vCPU / 32 GB / 400 GB) · Ubuntu 24.04 + Coolify.
Coolify clona este repo y **construye** las imágenes `api` y `web` en el servidor
(no necesitas registro de contenedores) y gestiona el **reverse proxy + SSL**.

## 0. Prerrequisitos
- Un **dominio** apuntando al VPS: registro DNS `A  @ → 31.97.100.240` (y `A  www`).
  Para LiveKit conviene además `A  livekit → 31.97.100.240`.
- Un **remoto git PRIVADO** (GitHub/GitLab) con este proyecto. **No** subas `.env`
  (ya está en `.gitignore`); los secretos van en la UI de Coolify.

## 1. Subir el repo al remoto privado
```bash
cd C:/latido/latido-platform
git remote add origin git@github.com:TU_USUARIO/latido.git   # repo PRIVADO
git push -u origin main
```

## 2. Abrir Coolify
Entra a `http://31.97.100.240:8000` (primer acceso: crea tu usuario admin de Coolify).
Conecta tu fuente git (GitHub App o deploy key) para que Coolify pueda clonar el repo.

## 3. Crear el recurso Docker Compose
- **+ New Resource → Docker Compose** (Based on a Git Repository).
- Repo: tu remoto privado · Branch: `main`.
- **Compose file:** `docker-compose.prod.yml`.

## 4. Variables de entorno
En la pestaña **Environment Variables** del recurso, pega las de
`.env.production.example` con tus valores reales. Claves que **debes copiar EXACTO**
de tu `.env` local si vas a migrar datos: `DATA_ENCRYPTION_KEY`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `WATERMARK_SALT`, y las credenciales de MinIO.

## 5. Dominio + SSL
- Asigna tu dominio al servicio **`web`** (puerto 80) en Coolify → genera el
  certificado Let's Encrypt automáticamente (HTTPS).
- `PUBLIC_URL` y `CORS_ORIGINS` deben ser ese mismo `https://tudominio.com`.

## 6. Puertos de LiveKit (video)
LiveKit necesita puertos propios (no pasan por el proxy):
- **7880/tcp** (signaling+ws), **7881/tcp**, **7882/udp** (media).
- Ábrelos en el **firewall del VPS** (te lo puedo configurar por el MCP de Hostinger,
  o con `ufw allow 7880,7881/tcp` y `ufw allow 7882/udp`).
- `LIVEKIT_URL` = `wss://tudominio.com:7880` (o expón LiveKit tras un subdominio con
  SSL en Coolify si prefieres 443).

## 7. Desplegar
Pulsa **Deploy**. Coolify construye api+web, levanta db/redis/minio/livekit y
publica el sitio. Los `db/init` crean el esquema y siembran regalos/paquetes.

## 8. (Opcional) Migrar tus datos locales
El VPS arranca **vacío** (sin tus usuarios/contenido). Para migrarlos:
```bash
# BD (usa el dump de tu backup):
cat latido_db_backup.sql | docker exec -i <container_db> psql -U latido_app -d latido
# MinIO: replicar objetos con `mc mirror` desde tu MinIO local al del VPS.
```
Si migras, **reusa los mismos secretos** (paso 4) o los datos cifrados no se leerán.

## 9. Pagos (Wompi)
- Pon las llaves **reales** de producción en las variables `WOMPI_*`.
- En el panel de Wompi, configura el **webhook** a: `https://tudominio.com/api/payments/webhook`.

## Notas
- Verifica la **política de uso (AUP)** de Hostinger para contenido adulto.
- Consolas: usuario `https://tudominio.com/` · creadora `/estudio/` · admin `/admin/`.
- Actualizar tras cambios: `git push` → Coolify **Redeploy** (conserva los volúmenes).
