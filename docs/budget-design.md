# Budget UI — design direction

Target: **ledger / financial print**. It should look like a book of accounts,
not a dashboard. Columns and rules do the organising; cards mostly disappear.

The existing dark values stay. The problem was never the hues — it was five
grays used interchangeably with no hierarchy.

## Type scale

Five sizes, real jumps between them. Today everything sits between 11 and 14px,
which is why nothing reads as important.

| Token | Size / weight | Use |
|---|---|---|
| `--fs-hero` | 44px / 600, tabular | The one number per screen (net worth) |
| `--fs-figure` | 22px / 600, tabular | Stat values, account balances |
| `--fs-body` | 15px / 400 | Entry rows, labels |
| `--fs-meta` | 13px / 400 | Amounts in dense tables, secondary |
| `--fs-label` | 11px / 500, 0.08em tracking, uppercase | Column headers, section labels |

Money is **always** `tabular-nums lining-nums`. Column alignment is the whole
point of the direction.

## Ink

Three levels, not five. Pick one and commit.

| Token | Value | Use |
|---|---|---|
| `--ink` | `#e6edf3` | Figures, entry descriptions |
| `--ink-2` | `#8b949e` | Labels, dates, account names |
| `--rule` | `#21262d` | Hairlines |
| `--rule-strong` | `#30363d` | Section dividers, totals |

Reserve `#3fb950` / `#f85149` **strictly for money direction** — never for
decoration, status chips, or buttons. A green button is a decorative green and
it dilutes the signal. Buttons become bordered/ghost.

## Structure

Kill the six identical `rounded-lg border p-4` panels. Replace with:

1. **Masthead** — month, hero net-worth figure, goal progress as a single thin
   rule. No box.
2. **Summary band** — income / spending / surplus / savings rate as four
   columns separated by vertical hairlines. No individual boxes.
3. **The register** — the entry list, full-bleed, ruled rows, no container
   border. This is the centrepiece and should look like a ledger page:
   date | description | from → to | amount, right-aligned and aligned across
   every row.
4. **Everything else collapsed** — accounts, allocation, budgets and charts
   become sections reachable by tab or disclosure, not six always-open panels
   stacked vertically.

Only surface that keeps a border is a modal.

## Rules for rows

- Hairline between rows, none above the first or below the last
- Negative amounts get a true minus (`−`, U+2212), not a hyphen
- Totals sit under a `--rule-strong` with extra top padding
- No rounded corners anywhere except the modal and progress fills

## Reorganising the page

Current order is arbitrary and everything is always expanded. Target:

```
JULY 2026                                    ‹ › today   [export] [?] [lock]
──────────────────────────────────────────────────────────────────────────
NET WORTH                                                       $47,983.28
48% of $100,000 · 27 months left            ▔▔▔▔▔▔▔▔▔▔░░░░░░░░░░░░░░░░░░░░

INCOME          SPENDING         SURPLUS          SAVINGS RATE
5,751.84    │   2,341.21     │   3,410.63     │   59%
──────────────────────────────────────────────────────────────────────────
[ Register ]  Accounts   Allocation   Budgets   Trends

 DATE   DESCRIPTION            FROM → TO                          AMOUNT
 07/24  Paycheck               Paycheck → Chase Checking        2,875.92
 07/24  Zelle Jane Insurance   Chase Checking → One-off          −200.00
```

## What to delete

- `Tile` component in `Dashboard.tsx` — replaced by the summary band
- Hint captions: "click a target to edit", "Enter to add · date & accounts
  stick", "j/k select · e edit · x-x delete". Move the keyboard reference
  entirely into the `?` overlay; make edit affordances visible on hover
  instead of captioned.
- `rounded-lg` on every section

## Order of work

1. Design tokens in `index.css` under `.budget-app` (type scale + ink)
2. Masthead + summary band (replaces the `Tile` grid)
3. Register restyle — biggest visual payoff
4. Tabs, moving accounts / allocation / budgets / charts behind them
5. Sweep remaining components for the old card class string
