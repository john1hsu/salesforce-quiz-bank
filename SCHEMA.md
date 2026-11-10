# Question schema

Each true/false **pair** is one YAML file: `questions/<product_area>/<id>.yaml`. The folder names match the article domains in [salesforce-knowledge-graph](https://github.com/john1hsu/salesforce-knowledge-graph). The quiz serves one side of a pair at random and never both sides in one session.

```yaml
id: sf-000002                     # stable, never reused
product_area: integration         # = source article's domain = folder
true_statement: High-volume platform event messages are retained on the event bus for 72 hours.
false_statement: High-volume platform event messages are retained on the event bus for 24 hours.
explanation: High-volume platform event messages stay on the event bus for 72 hours. The 24-hour window applies only to legacy standard-volume events defined before Spring '19, ...
source:
  repo: john1hsu/salesforce-knowledge-graph
  path: articles/integration/platform-events.md
  commit: <source repo HEAD when written or last verified>
  blob: <git blob of the article at that point>
verified_release: Winter '27      # last release this pair was checked against
feature_status: current           # current (GA) | beta | pilot | deprecated | retired | concept, from the article
certs: []                         # from the article's coveredBy edges, e.g. kt:integration-architect-certification
concepts: [kt:platform-events]    # graph node ids; the source article's id comes first
related: []                       # optional: other pair ids
supersedes: sf-000041             # only on a pair that replaced an outdated one
difficulty: 2                     # 1-3
created: '2026-11-09'
status: active                    # active | stale | retired
stale_reason: ...                 # only while stale
retired_reason: ...               # optional, on retired pairs
```

`schema/question.schema.json` has the same rules as a JSON Schema for editors.

## Lifecycle

| Status | Meaning | In the quiz? |
| --- | --- | --- |
| active | Verified against the current release and the article's latest version | Yes |
| stale | A newer release shipped, or the source article changed, since the pair was verified | Only with `--include-stale` |
| retired | The fact changed (a newer pair `supersedes` it), the feature/article is gone, or the pair repeated a fact another pair already tests | No |

The **current release** is the newest `release` stamped on any salesforce-knowledge-graph article. That repo re-verifies each article against the new release notes, so a pair is refreshed only after its article has been.

## Checks (`scripts/validate.py`)

| Check | Fails when |
| --- | --- |
| Schema | A required field is missing, malformed or unknown |
| Unique ID | An ID repeats, or the file name or folder doesn't match |
| Duplicate | A statement closely matches one in another non-retired pair |
| Same fact | Two non-retired pairs, from any articles, have true statements that state one fact in different words: most of their words match, or they share their numbers and most of the shorter statement's words |
| Pair quality | The two statements are identical or differ only by negation |
| Explanation | Shorter than 60 characters |
| Statement form | A statement is a question, under 20 or over 280 characters |
| Source | Repo, path, commit or blob is malformed; with `--source`, the article's domain differs, or an active pair's article is missing or changed (run `refresh.py mark-stale` first; stale pairs are exempt because they are waiting to be refreshed or retired) |
| Release tag | `verified_release` or `feature_status` is missing or invalid |
| Supersedes | Points to an ID that is missing or not retired |
| Exam-like wording | "Which of the following", "Choose two", exam case companies such as Universal Containers or Cloud Kicks |
