for p in /colibri/stats /colibri/v2/stats /about/health /metrics /colibri/debug; do
  echo "$p -> $(curl -s -o /dev/null -w '%{http_code}' localhost:8080$p)"
done
docker ps --format '{{.Names}} {{.Ports}}' | grep jvb
sudo ss -ltnp | grep -E ':8080|:9090'
