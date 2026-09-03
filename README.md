# RocJitsu Performance Dashboard

A React + Vite dashboard for official RocJitsu `develop`-branch benchmark data. MUI provides the UI system and responsive layout; ECharts renders the performance visualizations.

## Development

```bash
npm install
npm run dev
```

Run `npm run build` to create a static site in `dist/` and `npm run preview` to inspect that build locally.

Use `npm run lint` for static checks and `npm run test:e2e` for desktop/mobile browser smoke tests.

## Data deployment contract

The UI and benchmark facts have separate release lifecycles:

- Vite builds the application assets and HTML.
- `public/data.js` is copied to `dist/data.js` without being bundled.
- `index.html` loads `data.js` before the React entry point.
- Application selectors in `src/data/selectors.js` derive chart series, regressions, completeness, and KPIs at runtime.
- UI components never contain benchmark records or generated data.

Benchmark result details separate status and duration from an ordered, generic `configuration` key/value list. New configuration keys render automatically, while older data without that list continues to use the legacy benchmark fields as a compatibility fallback.

Overview snapshot cards and Latest Results use the newest execution attempt belonging to the newest commit. A later execution of an older commit never replaces that Overview candidate. If the newest attempt is incomplete, Overview exposes its real coverage and failures and leaves aggregate duration change unavailable.

The Overview duration chart owns its `1D`, `1W`, `1M`, `3M`, `6M`, `YTD`, and `All` timeframes. The 1D view uses execution time and shows completed primary runs from the latest commit-run day in at least eight ordinal slots. Longer windows use commit time, choose the first completed primary run per UTC commit day, preserve missing commit days as null discontinuities, and omit late historical reruns.

Recent Runs is ordered by benchmark execution time. Its historical-rerun action opens the Aggregate Benchmark Explorer centered on that exact run. Aggregate mode includes every official attempt as a distinct commit-ordered slot, uses mouse-wheel/trackpad zoom, and calculates each run's selected-test total against the latest completed attempt of the nearest earlier commit. Benchmark Explorer and automatic baseline lookup are ordered by tested commit chronology, so manually testing an older commit does not make that commit appear to be the newest source revision. See `DATA_CONTRACT.md` for the schema-version-3 metadata required for this behavior and the generic provenance-detail format.

Overview run-level automatic changes use the latest fully completed attempt belonging to the nearest earlier commit in the same branch, environment, and configuration. Recent Runs evaluates completeness only for results included by the active global filters. Benchmark Run History uses the latest completed result for the same stable test ID from an earlier commit, so unrelated failures do not discard valid scoped baselines. Run Comparison remains explicitly user-selected.

Only records with `branch: 'develop'` and `trigger: 'auto'` or `trigger: 'manual'` are valid. Experimental and feature-branch results must be rejected before `data.js` is published; the payload no longer needs a `canonical` field.

This means the web application can be built and pushed to a publishing branch once, while GitHub Actions subsequently replaces only `data.js`.

`data.js` must assign a serializable object to `window.ROCJITSU_BENCHMARK_DATA`. The expected top-level fields are:

See [DATA_CONTRACT.md](./DATA_CONTRACT.md) for the complete production schema, raw-output normalization rules, identity requirements, and publishing checklist.

```js
window.ROCJITSU_BENCHMARK_DATA = {
  schemaVersion: 3,
  generatedAt: 'ISO-8601 timestamp',
  repository: 'https://github.com/ROCm/rocm-systems',
  targets: [],
  testCatalog: [],
  runs: [],
};
```

The included file generates deterministic demo facts and can be replaced directly by the production workflow. Keep layout labels, colors, and other presentation values out of this file.

## Source layout

```text
src/
  components/      reusable layout, chart, overview, and view components
  data/            data loading and pure selectors
  hooks/           dashboard interaction state
  theme/           shared MUI design tokens and component defaults
  utils/           display formatting only
public/data.js     replaceable browser data payload
```
