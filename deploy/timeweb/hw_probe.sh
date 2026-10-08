#!/usr/bin/env bash
# Быстрая проверка нового сервера (Таймвеб и др.): процессор, память, диск, скорость CPU и "шум соседей" (steal).
#   ./hw_probe.sh [минут_наблюдения=5] [метка]     пример: ./hw_probe.sh 5 premium33
# Пишет отчёт в hw_<метка>.txt и в консоль. Ничего не устанавливает, нужен python3. Запускать на простаивающем сервере.
# steal% = доля времени, когда виртуальному CPU не дали физическое ядро (соседи). Стабильно >5% - линейка не подходит для ASR.
set -u
MIN="${1:-5}"; TAG="${2:-run}"; OUT="hw_${TAG}.txt"
N="$(nproc)"
{
echo "== $(date -Is) метка=$TAG"
echo "CPU: $(lscpu | awk -F: '/Model name/{gsub(/^ +/,"",$2);print $2; exit}')  vCPU=$N"
echo "Частота (МГц, из /proc/cpuinfo, средняя): $(awk -F: '/cpu MHz/{s+=$2;n++} END{if(n)printf "%.0f",s/n}' /proc/cpuinfo)"
echo "Память: $(free -h | awk '/Mem:/{print $2" всего, "$7" доступно"}')   Swap: $(free -h | awk '/Swap:/{print $2}')"
echo "Диск /: $(df -h / | awk 'NR==2{print $2" всего, "$4" свободно"}')"
echo "== Запись на диск (1 ГБ, sync):"
dd if=/dev/zero of=./.hw_probe_tmp bs=1M count=1024 conv=fdatasync 2>&1 | tail -1; rm -f ./.hw_probe_tmp
echo "== Скорость CPU (меньше секунд = быстрее; сравнивать между линейками):"
python3 - "$N" <<'PY'
import sys, time, hashlib, multiprocessing as mp
def work(_):
    h = b"x"
    for _ in range(1_500_000): h = hashlib.sha256(h).digest()
    return 1
def run(k):
    t = time.time()
    with mp.Pool(k) as p: p.map(work, range(k))
    return time.time() - t
n = int(sys.argv[1])
t1 = run(1); tn = run(n)
print(f"1 поток: {t1:.2f} с; {n} потоков параллельно: {tn:.2f} с (идеально = как 1 поток; масштабирование {t1/tn*n:.1f} из {n})")
PY
echo "== Steal за $MIN мин (каждые 10 с, при нагрузке на все vCPU):"
python3 - "$N" "$MIN" <<'PY' &
import sys, multiprocessing as mp, time
def burn(sec):
    t = time.time()
    while time.time() - t < sec: pass
if __name__ == "__main__":
    n, m = int(sys.argv[1]), int(sys.argv[2])
    ps = [mp.Process(target=burn, args=(m*60,)) for _ in range(n)]
    [p.start() for p in ps]; [p.join() for p in ps]
PY
BURN=$!
prev=($(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8+$9, $9, $5}' /proc/stat))
mx=0; sum=0; k=0; end=$((SECONDS + MIN*60))
while [ $SECONDS -lt $end ]; do
  sleep 10
  cur=($(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8+$9, $9, $5}' /proc/stat))
  d=$((cur[0]-prev[0])); st=$((cur[1]-prev[1]))
  [ "$d" -gt 0 ] && v=$(awk -v s=$st -v d=$d 'BEGIN{printf "%.1f",100*s/d}') || v=0
  sum=$(awk -v a=$sum -v b=$v 'BEGIN{print a+b}'); k=$((k+1))
  mx=$(awk -v a=$mx -v b=$v 'BEGIN{print (b>a)?b:a}'); prev=("${cur[@]}")
done
wait "$BURN" 2>/dev/null
echo "steal: среднее $(awk -v a=$sum -v k=$k 'BEGIN{printf "%.1f",a/k}')%, максимум ${mx}% (замеров $k)"
} | tee "$OUT"
echo "Отчёт: $OUT"
