FROM nginx:alpine
# Cache-bust: cambiar WEB_BUILD fuerza recopiar los estaticos (Coolify reusa imagen cacheada).
ARG WEB_BUILD=6
RUN echo "WEB_BUILD=${WEB_BUILD}"
# Consolas web independientes + PWA. En dev se sobreescriben por bind-mount.
COPY html/     /usr/share/nginx/html/
COPY admin/    /usr/share/nginx/admin/
COPY estudio/  /usr/share/nginx/estudio/
COPY default.conf /etc/nginx/conf.d/default.conf
