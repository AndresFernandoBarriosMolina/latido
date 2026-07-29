FROM nginx:alpine
# Consolas web independientes + PWA. En dev se sobreescriben por bind-mount.
COPY html/     /usr/share/nginx/html/
COPY admin/    /usr/share/nginx/admin/
COPY estudio/  /usr/share/nginx/estudio/
COPY default.conf /etc/nginx/conf.d/default.conf
