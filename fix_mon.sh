sed -i 's/printf "%.1f", d>0?100\*(1-(ci-pi)\/d):0/printf "%.1f", (d>0 ? 100*(1-(ci-pi)\/d) : 0)/' ~/vm_load_monitor.sh
grep -c 'd>0 ?' ~/vm_load_monitor.sh
timeout 12 bash ~/vm_load_monitor.sh test.csv 3
cat test.csv
