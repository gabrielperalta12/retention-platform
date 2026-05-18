# Retention Monitoring

Lightweight weekly churn-risk monitoring app for KAM follow-up.

## Run

```bash
node server.js
```

Then open:

```text
http://localhost:3000
```

For a shared internal server, run with a reachable host:

```bash
HOST=0.0.0.0 PORT=3000 node server.js
```

## Local CSV Without Uploading

Put the weekly file here:

```text
data/current.csv
```

When the server starts, it automatically imports that file if it exists. You can also click **Sync local CSV** in the app after replacing the file.

By default, the imported week is the file's modified date. To force a week:

```bash
LOCAL_CSV_WEEK=2026-05-17 node server.js
```

To use a different local file path:

```bash
LOCAL_CSV_FILE=/absolute/path/to/my-weekly-risk-file.csv node server.js
```

## CSV Columns

The app accepts common column names and maps them automatically.

Required:

- `lead_id` or `id`
- `account_name`, `account`, `company`, or `client`
- `kam_name`, `kam`, `executive`, `owner`, or `assigned_to`

Recommended:

- `risk_score`, `score`, `churn_score`, or `probability`
- `risk_reason`, `reason`, `driver`, or `churn_reason`
- `revenue`, `arr`, `mrr`, `gmv`, or `value`
- `segment`, `customer_segment`, or `market_segment`
- `risk_level`, `risk_segment`, or `churn_level`

## Workflow

1. Upload the weekly CSV and select the week date.
2. Filter by week, KAM, status, or account search.
3. Click a lead to update status, action taken, next follow-up, notes, and outcome.
4. Data is stored locally in `data/store.json`.

If you upload the same week again, the app replaces that week's prediction rows while preserving existing actions for matching `lead_id` values.
