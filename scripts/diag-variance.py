"""
Mide variabilidad del optimizer: ejecuta Optimize N veces y reporta
energías + tiempos + links satisfechos.

App debe estar corriendo en localhost:3000.
"""
from playwright.sync_api import sync_playwright
import time
import sys
import io
import statistics

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

N_RUNS = 3  # default; override with sys.argv[1]
if len(sys.argv) > 1:
    N_RUNS = int(sys.argv[1])

console_log = []

def log(msg):
    if "[optimize] done" in msg.text:
        console_log.append(msg.text)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()
    page.on("console", log)
    page.on("dialog", lambda d: d.accept())

    results = []
    for run in range(N_RUNS):
        # Full reload + fresh preset each run so each Optimize starts from a
        # different initial state (preset assigns new room UUIDs every load,
        # which changes Map iteration order and the reconcileCells output).
        page.goto("http://localhost:3000")
        page.wait_for_load_state("networkidle")
        page.get_by_role("button", name="Cargar preset: Late-game vainilla").click()
        page.wait_for_timeout(500)
        print(f"\n=== RUN {run + 1}/{N_RUNS} ===")
        start = time.time()
        page.get_by_role("button", name="Optimize", exact=True).click(no_wait_after=True)
        while time.time() - start < 600:
            try:
                text = page.locator("button").filter(has_text="Optimiz").first.inner_text(timeout=2000)
                if text.strip() == "Optimize":
                    break
            except Exception:
                pass
            page.wait_for_timeout(2000)
        elapsed = time.time() - start

        snapshot = page.evaluate("""() => {
          const b = JSON.parse(localStorage.getItem('base'));
          const sat = b.linkReports.filter(r => r.satisfied).length;
          // count fragmented rooms
          const positions = {};
          for (let i = 0; i < b.cells.length; i++) {
            for (let j = 0; j < b.cells[i].length; j++) {
              const id = b.cells[i][j].roomId;
              if (id) (positions[id] ||= []).push([i, j]);
            }
          }
          function countComponents(coords) {
            const set = new Set(coords.map(([i,j]) => i+','+j));
            const seen = new Set();
            let comps = 0;
            for (const [si, sj] of coords) {
              if (seen.has(si+','+sj)) continue;
              comps++;
              const stack = [[si, sj]];
              while (stack.length) {
                const [i, j] = stack.pop();
                const k = i+','+j;
                if (seen.has(k)) continue;
                seen.add(k);
                for (const [ni, nj] of [[i-1,j],[i+1,j],[i,j-1],[i,j+1]]) {
                  if (set.has(ni+','+nj) && !seen.has(ni+','+nj)) stack.push([ni, nj]);
                }
              }
            }
            return comps;
          }
          let frag = 0;
          for (const id in positions) {
            if (countComponents(positions[id]) > 1) frag++;
          }
          return {
            energy: Math.round(b.energy),
            satisfied: sat,
            total: b.linkReports.length,
            fragmented: frag,
          };
        }""")
        results.append({**snapshot, "elapsed": elapsed})
        print(f"  energy={snapshot['energy']:>10,}  sat={snapshot['satisfied']}/{snapshot['total']}  frag={snapshot['fragmented']}  time={elapsed:.0f}s")

    browser.close()

print("\n=== SUMMARY ===")
print(f"{'run':>4} {'energy':>10} {'sat':>8} {'frag':>5} {'time':>6}")
for i, r in enumerate(results, 1):
    print(f"{i:>4} {r['energy']:>10,} {r['satisfied']:>4}/{r['total']:<3} {r['fragmented']:>5} {r['elapsed']:>5.0f}s")

energies = [r['energy'] for r in results]
sats = [r['satisfied'] for r in results]
print(f"\nenergy:  min={min(energies):,} max={max(energies):,} mean={statistics.mean(energies):,.0f} stdev={statistics.stdev(energies) if len(energies) > 1 else 0:,.0f}")
print(f"satisfied: min={min(sats)} max={max(sats)} mean={statistics.mean(sats):.1f}")
print(f"fragmented (total): {sum(r['fragmented'] for r in results)}")
