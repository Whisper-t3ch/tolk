# Проверка доступности ТОЛК из текущей сети (Windows PowerShell 5.1+). Запуск (из корня репозитория):
#   powershell -ExecutionPolicy Bypass -File deploy\availability\check_availability.ps1 -Network "дом-Ростелеком"
# Лучше всего — БЕЗ VPN; запишите, был ли VPN. Результат: экран + availability_<Network>.txt (секретов нет).
param([Parameter(Mandatory=$true)][string]$Network, [string]$Vpn = "нет")
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$sb = "gprmbaiacvchtovzpeqa.supabase.co"
# Любой HTTP-ответ (200/401/404) = хост достижим; важны DNS, TCP 443, TLS и время.
$targets = @(
  @{ n="Vercel prod";        h="tolk-three.vercel.app";  p="/login" },
  @{ n="tolkplace.ru";       h="tolkplace.ru";           p="/login" },
  @{ n="staging (ASR-ВМ)";   h="stage.tolkplace.ru";     p="/api/health" },
  @{ n="Jitsi";              h="meet.tolkplace.ru";      p="/" },
  @{ n="ASR healthz";        h="asr.tolkplace.ru";       p="/healthz" },
  @{ n="Supabase REST";      h=$sb;                      p="/rest/v1/" },
  @{ n="Supabase Auth";      h=$sb;                      p="/auth/v1/health" },
  @{ n="Supabase Storage";   h=$sb;                      p="/storage/v1/" }
)
$out = @()
$out += "Сеть: $Network   VPN: $Vpn   Время: $(Get-Date -Format s)"
try { $ip = (Invoke-RestMethod -Uri "https://api.ipify.org" -TimeoutSec 8); $out += "Внешний IP: $ip" } catch { $out += "Внешний IP: не удалось определить" }
function Probe($h, $p) {
  $res = @()
  for ($i = 1; $i -le 3; $i++) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
      $r = Invoke-WebRequest -Uri "https://$h$p" -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 3 -ErrorAction Stop
      $res += "$($r.StatusCode)/$($sw.ElapsedMilliseconds)мс"
    } catch {
      $code = $null; if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
      if ($code) { $res += "$code/$($sw.ElapsedMilliseconds)мс" } else { $res += "ОШИБКА($($_.Exception.Message.Substring(0,[Math]::Min(60,$_.Exception.Message.Length))))" }
    }
  }
  return ($res -join "  ")
}
foreach ($t in $targets) {
  $out += "---- $($t.n): $($t.h)$($t.p)"
  try { $dns = (Resolve-DnsName $t.h -Type A -ErrorAction Stop | Where-Object {$_.Type -eq 'A'} | Select-Object -ExpandProperty IPAddress) -join ","; $out += "DNS: $dns" } catch { $out += "DNS: ОШИБКА $($_.Exception.Message)" }
  try { $c = Test-NetConnection $t.h -Port 443 -WarningAction SilentlyContinue; $out += "TCP 443: $($c.TcpTestSucceeded)" } catch { $out += "TCP 443: ОШИБКА" }
  $out += "HTTPS x3 (код/время): $(Probe $t.h $t.p)"
}
# Прямые IP Vercel (справка для выбора DNS-записей; значения из панели Vercel: A @ 216.198.79.1, legacy 76.76.21.21 и cname.vercel-dns.com)
$out += "---- Vercel: TCP 443 напрямую по IP"
foreach ($ip in @("216.198.79.1","76.76.21.21")) {
  try { $c = Test-NetConnection $ip -Port 443 -WarningAction SilentlyContinue; $out += "$ip : TCP 443 = $($c.TcpTestSucceeded)" } catch { $out += "$ip : ОШИБКА" }
}
try { $d = (Resolve-DnsName "cname.vercel-dns.com" -Type A -ErrorAction Stop | Where-Object {$_.Type -eq 'A'} | Select-Object -ExpandProperty IPAddress) -join ","; $out += "cname.vercel-dns.com -> $d" } catch { $out += "cname.vercel-dns.com: DNS ОШИБКА" }
# Крупный запрос к Supabase Storage (2 МБ мусора, без ключа — сервер отклонит, ничего не сохраняется):
# показывает, проходят ли в этой сети крупные POST к Supabase так же, как будущие аудиочанки.
$out += "---- Supabase Storage: POST 2 МБ без ключа (ожидаем 400/401/403 быстро, не обрыв)"
try {
  $buf = New-Object byte[] (2MB); (New-Object Random).NextBytes($buf)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try { $r = Invoke-WebRequest -Uri "https://$sb/storage/v1/object/session-recordings/_availability_probe" -Method Post -Body $buf -ContentType "application/octet-stream" -UseBasicParsing -TimeoutSec 40 -ErrorAction Stop; $out += "код $($r.StatusCode), $($sw.ElapsedMilliseconds) мс" }
  catch { $code = $null; if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }; $out += "код $code, $($sw.ElapsedMilliseconds) мс  ($($_.Exception.Message.Substring(0,[Math]::Min(80,$_.Exception.Message.Length))))" }
} catch { $out += "ОШИБКА подготовки: $($_.Exception.Message)" }
$out += "---- Google Fonts (справка; сейчас шрифты самохостятся через next/font)"
try { $r = Invoke-WebRequest -Uri "https://fonts.googleapis.com/css2?family=Inter&display=swap" -UseBasicParsing -TimeoutSec 15; $out += "fonts.googleapis.com: $($r.StatusCode)" } catch { $out += "fonts.googleapis.com: ОШИБКА" }
$file = "availability_$($Network -replace '[^\w\-]','_').txt"
$out | Tee-Object -FilePath $file
Write-Host "`nСохранено в $file — пришлите вывод целиком."
