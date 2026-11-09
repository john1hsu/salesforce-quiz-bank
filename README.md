# Salesforce quiz bank

A bank of paired true/false Salesforce questions, generated hourly from the cited articles in [salesforce-knowledge-graph](https://github.com/john1hsu/salesforce-knowledge-graph). Each pair holds a true statement and a plausible false twin; quizzes show one side at random.

## Practice on your phone

The app in `app/` is published with GitHub Pages: **swipe right for true, left for false** (or tap the buttons). After each answer you see the explanation, the release it was verified for, and a link to the source article. Questions are drawn completely at random. Scores stay on your phone; "Copy score history" exports them. Add it to your home screen to use it offline.

## Practice in the terminal

```bash
pip install pyyaml
python3 scripts/quiz.py                                   # 10 random questions
python3 scripts/quiz.py --area security-and-sharing --n 25
python3 scripts/quiz.py --cert kt:integration-architect-certification
python3 scripts/quiz.py --list                            # areas and certifications
```

Scores go to a git-ignored `.quiz-progress.jsonl`, or `--progress <path>` (for example a file in your private study repo).

## How it works

| Piece | What it does |
| --- | --- |
| `questions/<area>/sf-000123.yaml` | One pair per file; areas match the source repo's domains. Format in `SCHEMA.md` |
| `index/questions.json` | Generated list the app and `quiz.py` read |
| `coverage/coverage.json` | Generated pair counts per article and area |
| `scripts/validate.py` | All quality checks; runs before every commit and in CI |
| `scripts/generate.py` | Picks the next article and turns drafted pairs into files |
| `scripts/refresh.py` | Marks pairs stale after a release or source change, and verifies, supersedes or retires them |
| `scripts/build_index.py` | Writes the index and coverage files |
| `CLAUDE.md` | The hourly run's playbook |

### Hourly run

Each run commits up to 3 pairs directly to `main`, only if every check passes:

1. Mark stale any pair verified for an older release, or whose source article changed.
2. If stale pairs are ready (their article was already refreshed for the new release), re-verify 3 of them: beta/pilot facts first, then limits and numbers.
3. Otherwise write 3 new pairs from the article with the fewest pairs (up to 6 per article).

### Release updates

When a new release goes GA, salesforce-knowledge-graph re-verifies its articles and stamps them with the new release. This repo then marks older pairs stale and refreshes them:

| Outcome | Action | ID |
| --- | --- | --- |
| Still true | `verified_release` updated, back to active | Same |
| Fact changed | Old pair retired; new pair with `supersedes` | New |
| Feature retired | Pair retired | Same |
| Article not yet refreshed | Stays stale until it is | Same |

Stale pairs are left out of quizzes.

## Local setup

```bash
pip install pyyaml
git clone --depth 1 https://github.com/john1hsu/salesforce-knowledge-graph .source/salesforce-knowledge-graph
python3 scripts/validate.py --source .source/salesforce-knowledge-graph
python3 -m http.server   # then open http://localhost:8000/app/
```
