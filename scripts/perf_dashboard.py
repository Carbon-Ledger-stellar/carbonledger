#!/usr/bin/env python3
"""
scripts/perf_dashboard.py

Generate an HTML trend-analysis dashboard from benchmarks/history.csv.

Reads the history CSV (produced by run_perf_benchmarks.py) and generates a
self-contained HTML file with Chart.js time-series charts for each tracked
metric.  No external dependencies beyond the Python standard library.

Usage:
    python3 scripts/perf_dashboard.py \
        [--history benchmarks/history.csv] \
        [--out benchmarks/dashboard.html]

Options:
    --history   Path to history.csv       (default: benchmarks/history.csv)
    --out       Output HTML file path     (default: benchmarks/dashboard.html)
    --baseline  Path to baseline.json     (default: benchmarks/baseline.json)
    --title     Dashboard title           (default: CarbonLedger Performance Trends)

The generated HTML is completely self-contained — Chart.js is loaded from
cdnjs (with an integrity hash). It renders correctly when opened from the
GitHub Actions artifact download.

Closes #1056
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
BENCHMARKS_DIR = REPO_ROOT / "benchmarks"

# Colour palette for chart lines (one per metric series)
COLOURS = [
    "#4e79a7", "#f28e2b", "#e15759", "#76b7b2",
    "#59a14f", "#edc948", "#b07aa1", "#ff9da7",
    "#9c755f", "#bab0ac",
]

# Metrics to render — maps column header aliases to chart labels
# history.csv schema: date, function, cpu_instructions, mem_bytes, reads, writes, note
# The note column encodes dimension: "contract ...", "api_p95_ms ...", "db_p95_ms ..."
DIMENSION_PREFIX = {
    "contract":   "Contract cpu_instructions",
    "api_p95_ms": "API p95 (ms)",
    "db_p95_ms":  "DB query p95 (ms)",
}


def parse_history(path: Path) -> dict[str, list[tuple[str, float]]]:
    """
    Returns: {metric_label: [(iso_date, value), ...]} sorted by date ascending.
    """
    series: dict[str, list[tuple[str, float]]] = defaultdict(list)

    if not path.exists():
        return {}

    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            date = row.get("date", "").strip()
            function = row.get("function", "").strip()
            note = row.get("note", "").strip()
            cpu_val = row.get("cpu_instructions", "").strip()

            if not date or not function or not cpu_val:
                continue

            try:
                value = float(cpu_val)
            except (ValueError, TypeError):
                continue

            # Determine dimension from note prefix
            dim = "contract"  # default
            for prefix in DIMENSION_PREFIX:
                if note.startswith(prefix):
                    dim = prefix
                    break

            label = f"{DIMENSION_PREFIX[dim]} — {function}"
            series[label].append((date, value))

    # Sort each series by date
    for label in series:
        series[label].sort(key=lambda x: x[0])

    return dict(series)


def load_baseline(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def build_chartjs_dataset(
    label: str,
    points: list[tuple[str, float]],
    colour: str,
) -> dict:
    return {
        "label": label,
        "data": [{"x": date, "y": value} for date, value in points],
        "borderColor": colour,
        "backgroundColor": colour + "33",
        "tension": 0.3,
        "pointRadius": 4,
        "pointHoverRadius": 6,
        "fill": False,
    }


def build_html(
    title: str,
    series: dict[str, list[tuple[str, float]]],
    baseline: dict,
    generated_at: str,
) -> str:
    # Group series by dimension prefix for separate charts
    groups: dict[str, dict[str, list]] = {}
    for label, points in series.items():
        for prefix, dim_label in DIMENSION_PREFIX.items():
            if label.startswith(dim_label):
                groups.setdefault(prefix, {})[label] = points
                break

    charts_html = []
    charts_js = []

    for gi, (prefix, dim_series) in enumerate(groups.items()):
        dim_label = DIMENSION_PREFIX[prefix]
        chart_id = f"chart_{gi}"

        # Build baseline annotation lines
        baseline_annotations: dict[str, float] = {}
        if prefix == "contract":
            for fn, data in baseline.get("contract", {}).items():
                val = data.get("cpu_instructions")
                if val:
                    baseline_annotations[f"baseline_{fn}"] = val
        elif prefix == "api_p95_ms":
            for ep, data in baseline.get("api", {}).items():
                val = data.get("p95_ms")
                if val:
                    baseline_annotations[f"baseline_{ep}"] = val
        elif prefix == "db_p95_ms":
            for q, data in baseline.get("db", {}).items():
                val = data.get("p95_ms")
                if val:
                    baseline_annotations[f"baseline_{q}"] = val

        datasets = []
        for ci, (lbl, pts) in enumerate(dim_series.items()):
            colour = COLOURS[ci % len(COLOURS)]
            datasets.append(build_chartjs_dataset(lbl, pts, colour))

        datasets_json = json.dumps(datasets)

        charts_html.append(f"""
        <div class="chart-container">
          <h2>{dim_label}</h2>
          <canvas id="{chart_id}"></canvas>
        </div>""")

        # Threshold annotation line (10% above each baseline)
        annotations_js_parts = []
        for i, (key, val) in enumerate(baseline_annotations.items()):
            threshold = val * 1.10
            annotations_js_parts.append(f"""
            '{key}_threshold': {{
              type: 'line',
              yMin: {threshold:.2f},
              yMax: {threshold:.2f},
              borderColor: 'rgba(255,80,80,0.5)',
              borderWidth: 1,
              borderDash: [4, 4],
              label: {{
                content: '{key} +10%',
                display: true,
                position: 'end',
                font: {{ size: 9 }},
              }}
            }}""")

        annotations_block = "{" + ",".join(annotations_js_parts) + "}" if annotations_js_parts else "{}"

        charts_js.append(f"""
        new Chart(document.getElementById('{chart_id}'), {{
          type: 'line',
          data: {{ datasets: {datasets_json} }},
          options: {{
            responsive: true,
            interaction: {{ mode: 'index', intersect: false }},
            scales: {{
              x: {{
                type: 'time',
                time: {{ unit: 'day', tooltipFormat: 'yyyy-MM-dd' }},
                title: {{ display: true, text: 'Date' }},
              }},
              y: {{
                title: {{ display: true, text: '{dim_label}' }},
                beginAtZero: false,
              }},
            }},
            plugins: {{
              legend: {{ position: 'bottom', labels: {{ boxWidth: 12 }} }},
              annotation: {{
                annotations: {annotations_block},
              }},
            }},
          }},
        }});""")

    if not charts_html:
        charts_html = ["<p><em>No history data yet. Run the benchmarks to populate history.csv.</em></p>"]

    total_runs = sum(len(pts) for pts in series.values())
    metric_count = len(series)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <script
    src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.3/chart.umd.min.js"
    integrity="sha512-VgBmhsZnmqN9oFvVNSSxWNFuRTELj3oeKpWdMn8mxIuL4SrpF33F1bIB0wUWjvnVlHJE2H5E7HnGJO0M2iiw=="
    crossorigin="anonymous"
    referrerpolicy="no-referrer"
  ></script>
  <script
    src="https://cdnjs.cloudflare.com/ajax/libs/chartjs-adapter-date-fns/3.0.0/chartjs-adapter-date-fns.bundle.min.js"
    integrity="sha512-H9P+KoUJxbMzBL+FJiWMpXa9Pw+mBhG6aZwJhLIfM8HNvD/b6p6xtqyjYBbpVBJUMLvFuqobBd2zcKEWJhgA=="
    crossorigin="anonymous"
    referrerpolicy="no-referrer"
  ></script>
  <script
    src="https://cdnjs.cloudflare.com/ajax/libs/chartjs-plugin-annotation/3.0.1/chartjs-plugin-annotation.min.js"
    integrity="sha512-Qgwn3rSfE4BvQhOk53hnJxaexLLAVidA9EWIM5kQWEniQtc5Y1BWBD7K8w8TFzKDq8hThVHJK2YQi2hbUFKZg=="
    crossorigin="anonymous"
    referrerpolicy="no-referrer"
  ></script>
  <style>
    :root {{
      --bg: #0d1117;
      --surface: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --accent: #58a6ff;
      --red: #f85149;
      --green: #3fb950;
    }}
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 24px;
    }}
    header {{ margin-bottom: 32px; }}
    header h1 {{ font-size: 1.6rem; color: var(--accent); margin-bottom: 6px; }}
    header p {{ font-size: 0.85rem; opacity: 0.7; }}
    .stats {{
      display: flex;
      gap: 16px;
      margin-bottom: 32px;
      flex-wrap: wrap;
    }}
    .stat-card {{
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 20px;
      min-width: 140px;
    }}
    .stat-card .value {{ font-size: 1.5rem; font-weight: 700; color: var(--accent); }}
    .stat-card .label {{ font-size: 0.75rem; opacity: 0.6; margin-top: 2px; }}
    .chart-container {{
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }}
    .chart-container h2 {{
      font-size: 1rem;
      margin-bottom: 16px;
      color: var(--text);
      opacity: 0.85;
    }}
    canvas {{ max-height: 320px; }}
    .threshold-note {{
      margin-top: 12px;
      font-size: 0.75rem;
      opacity: 0.5;
    }}
    footer {{
      margin-top: 32px;
      font-size: 0.75rem;
      opacity: 0.4;
      text-align: center;
    }}
  </style>
</head>
<body>
  <header>
    <h1>🚀 {title}</h1>
    <p>Generated: {generated_at} · Dashed red lines mark the +10% regression threshold above each baseline value.</p>
  </header>

  <div class="stats">
    <div class="stat-card">
      <div class="value">{metric_count}</div>
      <div class="label">Tracked metrics</div>
    </div>
    <div class="stat-card">
      <div class="value">{total_runs}</div>
      <div class="label">Data points</div>
    </div>
    <div class="stat-card">
      <div class="value">10%</div>
      <div class="label">Regression threshold</div>
    </div>
    <div class="stat-card">
      <div class="value">3</div>
      <div class="label">Dimensions tracked</div>
    </div>
  </div>

  {''.join(charts_html)}

  <p class="threshold-note">
    Dimensions: Contract (Soroban cpu_instructions) · API (HTTP p95 response ms) · DB (query p95 ms)<br>
    Red dashed lines = baseline × 1.10 (>10% increase triggers CI failure).
    See <code>docs/benchmarking.md</code> for full methodology.
  </p>

  <footer>CarbonLedger performance dashboard · generated by scripts/perf_dashboard.py</footer>

  <script>
    Chart.register(ChartAnnotation);
    {''.join(charts_js)}
  </script>
</body>
</html>"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate performance trend dashboard")
    parser.add_argument("--history",  type=Path, default=BENCHMARKS_DIR / "history.csv")
    parser.add_argument("--out",      type=Path, default=BENCHMARKS_DIR / "dashboard.html")
    parser.add_argument("--baseline", type=Path, default=BENCHMARKS_DIR / "baseline.json")
    parser.add_argument("--title",    default="CarbonLedger Performance Trends")
    args = parser.parse_args()

    series = parse_history(args.history)
    baseline = load_baseline(args.baseline)
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    html = build_html(args.title, series, baseline, generated_at)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(html, encoding="utf-8")
    print(f"Dashboard written to {args.out}")

    metric_count = len(series)
    total_points = sum(len(v) for v in series.values())
    print(f"  {metric_count} metric series, {total_points} total data points")

    if total_points == 0:
        print("  NOTE: history.csv has no data points yet. Run benchmarks first.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
