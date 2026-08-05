FROM httpd:2.4

# Habilita los módulos de proxy/balanceo que el httpd.conf oficial trae comentados.
RUN sed -i \
    -e 's/^#\(LoadModule proxy_module .*\)/\1/' \
    -e 's/^#\(LoadModule proxy_http_module .*\)/\1/' \
    -e 's/^#\(LoadModule proxy_balancer_module .*\)/\1/' \
    -e 's/^#\(LoadModule lbmethod_byrequests_module .*\)/\1/' \
    -e 's/^#\(LoadModule slotmem_shm_module .*\)/\1/' \
    -e 's/^#\(LoadModule headers_module .*\)/\1/' \
    conf/httpd.conf \
 && echo "Include conf/extra/lb.conf" >> conf/httpd.conf

COPY lb.conf /usr/local/apache2/conf/extra/lb.conf
