"""
Diagnostico del optimizer: carga el preset late-game vainilla en la app,
ejecuta Optimize y captura energy + Adjacency Report + screenshot.

La app debe estar corriendo en http://localhost:3000.
"""
from playwright.sync_api import sync_playwright
import time
import sys
import io

# Force UTF-8 stdout so unicode arrows from optimize logs don't crash on Windows.
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

console_messages = []

def handle_console(msg):
    console_messages.append(f"[{msg.type}] {msg.text}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()
    page.on("console", handle_console)

    # Auto-accept window.confirm dialogs
    page.on("dialog", lambda d: d.accept())

    page.goto("http://localhost:3000")
    page.wait_for_load_state("networkidle")

    print("=== STATE: app loaded ===")
    page.screenshot(path="C:/tmp/diag-01-initial.png", full_page=True)

    # Click "Cargar preset: Late-game vainilla"
    print("Clicking 'Cargar preset'...")
    page.get_by_role("button", name="Cargar preset: Late-game vainilla").click()
    page.wait_for_timeout(500)
    page.screenshot(path="C:/tmp/diag-02-preset-loaded.png", full_page=True)

    # Click Optimize (no_wait_after: the async optimizer makes Playwright
    # confuse the long-running click handler with a pending navigation)
    print("Clicking 'Optimize'...")
    page.get_by_role("button", name="Optimize", exact=True).click(no_wait_after=True)

    # Wait for optimization to finish (button text returns to "Optimize")
    print("Waiting for optimization to finish...")
    start = time.time()
    while time.time() - start < 300:
        text = page.locator("button").filter(has_text="Optimiz").first.inner_text()
        if text.strip() == "Optimize":
            break
        print(f"  ... still: {text!r}")
        page.wait_for_timeout(2000)
    elapsed = time.time() - start
    print(f"Optimization done in {elapsed:.1f}s")

    page.screenshot(path="C:/tmp/diag-03-optimized.png", full_page=True)

    # Extract energy
    energy_text = page.locator("text=/Current energy:/").first.inner_text()
    print(f"\n{energy_text}")

    # Extract Adjacency Report from localStorage instead of DOM (avoids encoding issues)
    print("\n=== ADJACENCY REPORT (from runtime state) ===")
    report = page.evaluate("""() => {
      const b = JSON.parse(localStorage.getItem('base'));
      const byId = Object.fromEntries(b.rooms.map(r => [r.id, r.name]));
      return b.linkReports.map(r => ({
        a: byId[r.roomIds[0]],
        b: byId[r.roomIds[1]],
        weight: r.weight,
        hard: r.hard,
        sharedSides: r.sharedSides,
        satisfied: r.satisfied,
      }));
    }""")
    sat = sum(1 for r in report if r['satisfied'])
    print(f"  {sat}/{len(report)} links satisfied")
    print(f"\n  Unsatisfied:")
    for r in report:
      if not r['satisfied']:
        flag = "[HARD]" if r['hard'] else ""
        print(f"    {flag:>7} {r['a']} <-> {r['b']}  (w={r['weight']})")

    # Extract any room warnings
    print("\n=== ROOM WARNINGS ===")
    warnings = page.locator("small").all()
    for w in warnings:
        t = w.inner_text().strip()
        if t.startswith("⚠"):
            print(f"  {t}")

    # Dump full state: per-room cell positions and component count
    print("\n=== ROOMS AND COMPONENTS ===")
    summary = page.evaluate("""() => {
      const b = JSON.parse(localStorage.getItem('base'));
      const counts = {};
      const positions = {};
      for (let i = 0; i < b.cells.length; i++) {
        for (let j = 0; j < b.cells[i].length; j++) {
          const id = b.cells[i][j].roomId;
          if (!id) continue;
          counts[id] = (counts[id] || 0) + 1;
          (positions[id] ||= []).push([i, j]);
        }
      }
      // BFS to count components
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
      return b.rooms.map(r => ({
        name: r.name,
        size: r.size,
        assigned: counts[r.id] || 0,
        components: countComponents(positions[r.id] || []),
        positions: positions[r.id] || [],
      }));
    }""")
    fragmented = []
    for r in summary:
      flag = ""
      if r['components'] > 1:
        flag = f"  *** FRAGMENTED into {r['components']} pieces ***"
        fragmented.append(r['name'])
      print(f"  {r['name']:<28} size={r['size']} assigned={r['assigned']} comp={r['components']}  pos={r['positions']}{flag}")
    print(f"\n=== FRAGMENTED ROOMS: {fragmented or 'none'} ===")

    print("\n=== CONSOLE MESSAGES ===")
    for msg in console_messages[-30:]:
        print(msg)

    browser.close()

print("\nScreenshots at C:/tmp/diag-0{1,2,3}-*.png")
