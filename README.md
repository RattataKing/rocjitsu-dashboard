# RocJitsu Performance Dashboard

A React + Vite dashboard for official RocJitsu `develop`-branch benchmark data. MUI provides the UI system and responsive layout; ECharts renders the performance visualizations.

## Development

```bash
npm install
npm run dev
```

Run `npm run build` to create a static site in `dist/` and `npm run preview` to inspect that build locally.

Use `npm run lint` for static checks and `npm run test:e2e` for desktop/mobile browser smoke tests.

## Data file contract

Benchmark facts live under `public/data/` as plain JSON:

| Path | Purpose | Update when |
| --- | --- | --- |
| `data/metadata.json` | Dataset-level schema and site settings | The contract or site settings change |
| `data/index.json` | Publication timestamp and available run filenames | A run is added or removed |
| `data/test-catalogs/<catalog-id>.json` | Immutable test definitions and target applicability | The planned test set changes |
| `data/runs/<run-id>.json` | One plugin execution containing grouped results for every catalog target | That plugin run is first published |

Vite copies the directory to `dist/data/` without bundling it. The application fetches, assembles, and validates the files at startup; no browser global is created. `src/data/dashboardData.js` owns file loading and snapshot preparation, while selectors derive chart series, regressions, completeness, and KPIs.

An invalid, missing, or unreadable indexed run file is skipped without blocking valid history. A missing or invalid catalog also invalidates each referencing run. The dashboard displays a warning containing the skipped filename and validation reason. Invalid dataset-level `metadata.json` or `index.json`, or a dataset with no usable completed Vanilla runs, still produces the data-unavailable state because there is no safe dashboard snapshot to render.

Standard JSON has no comment syntax, so file responsibilities are documented here rather than embedded in the data files.

Each run references one immutable catalog and carries target-grouped results for a single RocJitsu plugin such as Vanilla, ASan, TSan, or UBSan. Every target group must contain exactly one completed, failed, or timed-out result for each applicable catalog test. Catalog versions are complete snapshots, so a five-test historical run stays 5/5 after a seven-test catalog is introduced.

Overview, Benchmarks, Run Comparison, and Failures use only Vanilla runs. Plugin Comparison lists only controlled comparisons containing Vanilla and at least one non-Vanilla plugin, defaults to Vanilla as the baseline, and renders per-test runtime overhead, geometric-mean overhead, coverage, and sanitizer findings separately for each globally selected target. A starred overall overhead measures the passed plugin/baseline pairs and assumes that overhead for the whole selected test set. There is no second target picker inside the page. Runs in one controlled comparison must share their catalog, source, trigger, machine, environment, and target set.

Overview snapshot cards and Latest Results use the newest execution attempt belonging to the newest commit. A later execution of an older commit never replaces that Overview candidate. If the newest attempt is incomplete, Overview exposes its real coverage and failures and leaves aggregate duration change unavailable.

The Overview duration chart defaults to `ALL` and also provides `1D`, `1W`, `1M`, `3M`, `6M`, and `YTD` timeframes. The 1D view uses execution time and shows completed primary runs from the latest commit-run day in at least eight ordinal slots. Longer windows use commit time, choose the first completed primary run per UTC commit day, preserve missing commit days as smoothly connected gaps, and omit late historical reruns.

Recent Runs is ordered by benchmark execution time. Its historical-rerun action opens the Aggregate Benchmark Explorer centered on that exact run. Aggregate mode includes every official Vanilla attempt as a distinct commit-ordered slot, uses mouse-wheel/trackpad zoom, and calculates each run's selected-test total against the latest completed attempt of the nearest earlier commit. Benchmark Explorer and automatic baseline lookup are ordered by tested commit chronology, so manually testing an older commit does not make that commit appear to be the newest source revision. See `DATA_CONTRACT.md` for the schema-version-1 run format.

Overview run-level automatic changes use the latest fully completed attempt belonging to the nearest earlier commit in the same branch and environment values. Recent Runs evaluates completeness only for results included by the active global filters. Benchmark Run History uses the latest completed result for the same stable test ID from an earlier commit, so unrelated failures do not discard valid scoped baselines. Run Comparison remains explicitly user-selected.

Only records with `source.branch: "develop"` and `execution.trigger: "auto"` or `"manual"` are valid. Experimental and feature-branch results must be rejected before publication.

See [DATA_CONTRACT.md](./DATA_CONTRACT.md) for the complete production schema, raw-output normalization rules, identity requirements, and publishing checklist.

```json
{
  "schemaVersion": 1,
  "repository": "https://github.com/ROCm/rocm-systems",
  "isBeta": true
}
```

`public/data/index.json` contains only changing index data:

```json
{
  "generatedAt": "ISO-8601 timestamp",
  "runFiles": ["runs/github-123456789-vanilla.json"]
}
```

Each listed run file contains `plugin`, `source`, shared `execution` and `environment`, and a `targets` array of result groups. The run references a catalog that defines its tests and each target's applicable set. The included files contain explicit deterministic facts, with no runtime data generator. To publish normally, upload a new catalog when needed, upload the new run files, and then update `index.json`; `metadata.json` remains unchanged.

## Source layout

```text
src/
  components/      reusable layout, chart, overview, and view components
  data/            data-file loading, validation, and pure selectors
  hooks/           dashboard interaction state
  theme/           shared MUI design tokens and component defaults
  utils/           display formatting only
public/data/       site metadata, run index, immutable catalogs, and merged run JSON
```
