# Salesforce quiz bank: daily run playbook

This repo is a bank of paired true/false questions generated from [john1hsu/salesforce-knowledge-graph](https://github.com/john1hsu/salesforce-knowledge-graph). A daily scheduled run handles up to **100 pairs**: it refreshes stale pairs first, then spends the rest of the budget on new ones, at most **3 per article**. Everything goes to `main` as **one combined commit** with one push, and only when every check passes. Read `SCHEMA.md` before writing.

## 1. Sync

```bash
git pull --rebase origin main
rm -rf .source && git clone --depth 1 https://github.com/john1hsu/salesforce-knowledge-graph .source/salesforce-knowledge-graph
python3 scripts/validate.py   # the repo's own checks, without the source; must print OK; fix the repo first if not
```

Don't pass `--source` here: source articles change between runs, and step 2 is what handles that.

## 2. Mark stale pairs

```bash
python3 scripts/refresh.py mark-stale
python3 scripts/validate.py --source .source/salesforce-knowledge-graph   # must print OK now; fix the repo first if not
```

`mark-stale` marks active pairs stale when they were verified for an older release than the current one, when their source article changed since they were verified (drift), or when the article was removed or renamed. The current release is the newest `release` on any source article. Always run it before validating against the source: a changed or missing article is an error on an active pair, but expected on a stale one that is waiting for step 4a.

## 3. Pick this run's work

The budget is 100 pairs per run (refreshed plus new). Repeat this step until the budget is used or `pick` returns `"none"`:

```bash
python3 scripts/generate.py pick --n 3
```

- `"mode": "refresh"` → do step 4a for every pair in `batch`.
- `"mode": "generate"` → do step 4b for `article`, writing `n` pairs.
- `"mode": "none"` → stop picking and go to step 5. If nothing was refreshed or added but step 2 marked pairs stale, commit that with the message `quiz: mark <n> pairs stale`; if nothing changed at all, stop without committing.

Don't commit between picks. Run `python3 scripts/validate.py --source .source/salesforce-knowledge-graph` after roughly every 15 new pairs to catch problems early.

Stale pairs always come before new ones. Pairs whose article hasn't been refreshed for the current release yet are skipped ("blocked on source") until it has.

## 4a. Refresh a stale pair

Read the pair (`questions/*/<id>.yaml`) and the **current** source article in full. Decide:

| Outcome | Command |
| --- | --- |
| Both statements are still correct (true one true, false one false) per the article | `python3 scripts/refresh.py verify <id>` |
| The fact changed (e.g. a new limit) | Write one replacement pair to a JSON file (format in 4b), then `python3 scripts/refresh.py supersede <id> --input <file>` |
| The feature was retired or the article is gone | `python3 scripts/refresh.py retire <id> --reason "<why>"` |

If the article now says something that makes the explanation wrong but both statements still hold, supersede rather than verify.

## 4b. Write new pairs

Read the whole article (`.source/salesforce-knowledge-graph/<path>`). Check `existing_pairs_for_article` and `related_pairs_in_other_articles` so you don't repeat a fact: the second list holds the true statements already written from neighbouring articles, and a fact any of them tests is taken, even if this article words it differently. Write `n` pairs to a JSON file outside the repo (the scratchpad):

```json
{"article": "articles/<domain>/<slug>.md",
 "pairs": [{"true_statement": "...", "false_statement": "...", "explanation": "...",
            "difficulty": 2, "concepts": ["kt:<article-id>", "kt:<other-node>"]}]}
```

Rules for each pair:
- **Grounding:** every pair must be answerable from this article alone. Don't add facts from memory, even true ones.
- **One fact per pair**, and a different fact for each pair in the run and from every pair already in the bank, whichever article it came from. Prefer facts a practitioner needs: limits, defaults, which feature does what, editions, permissions, lifecycle, trade-offs.
- **Plausible false twin:** change a limit, a default, an edition, a permission, a scope, or which feature does the job (for example sharing rules vs. role hierarchy). Never make the false statement by just adding "not". Keep the wording otherwise parallel so the reader must know the fact.
- **Statements:** declarative, 20–280 characters, readable on a phone card. No exam phrasing ("Which of the following", "Choose two") and no exam case companies (Universal Containers, Cloud Kicks).
- **Explanation:** 1–3 sentences saying why the true statement is true and what's wrong with the false one, in your own words.
- **GA first:** prefer facts about GA (`current`) features; beta or pilot facts are fine when the article covers them, and the status is recorded automatically.
- **Difficulty:** 1 = core definition, 2 = practitioner detail or limit, 3 = architect-level trade-off or edge case.
- **Concepts:** the article's own id plus any graph node ids the fact involves (from the article's edges).

Then add them:

```bash
python3 scripts/generate.py add --input <file>
```

## 5. Validate, build, commit, push

```bash
python3 scripts/validate.py --source .source/salesforce-knowledge-graph
python3 scripts/build_index.py
git add -A
git commit -m "<message>"
git pull --rebase origin main && git push origin main
```

- Make **one** commit for the whole run, containing every refresh and new pair, and push it once.
- If validation fails on a new or replacement pair, delete that pair's file, rewrite it once, and validate again. If it still fails, drop just that pair (remove its new file, or undo that refresh) and carry on, so the final commit always validates. Report dropped pairs in the run output.
- If validation says a new pair states the same fact as an existing one, the rewrite must test a different fact from the article, not the same fact reworded. If it flags two pairs that were both already in the bank, keep the older one and run `python3 scripts/refresh.py retire <newer id> --reason "duplicate of <older id>"`.
- Commit message subject: `quiz: refresh <r> pairs, +<n> pairs from <k> articles` (drop the part that is zero). In the body, list one line per pair (`sf-000123: verified` / `superseded by sf-000130` / `retired: <why>` / `added`).
- If the push is rejected, pull --rebase, re-run `build_index.py`, amend that same commit (don't add a second one) and push again (once).

## Don'ts

- Don't handle more than 100 pairs in one run, or write more than 3 pairs from one article in one run.
- Don't make more than one commit or push per run.
- Don't edit `index/` or `coverage/` by hand; `build_index.py` writes them.
- Don't delete question files or reuse an id; retire instead.
- Don't edit salesforce-knowledge-graph from this run.
- Don't commit if validation fails.
