# Salesforce quiz bank

A bank of paired true/false Salesforce questions, generated daily from the cited articles in [salesforce-knowledge-graph](https://github.com/john1hsu/salesforce-knowledge-graph). Each pair holds a true statement and a plausible false twin; quizzes show one side at random.

## Practice on your phone

**Open the app: [john1hsu.github.io/salesforce-quiz-bank](https://john1hsu.github.io/salesforce-quiz-bank/)**

The app in `app/` is published with GitHub Pages. It works like Instagram Reels: an endless, full-screen feed with one question per screen.

| Gesture | What it does |
| --- | --- |
| Swipe right | Answer **true** |
| Swipe left | Answer **false** |
| Swipe up | Next question |
| Double-tap | Save the question (or tap **Save** on the right rail) |

After each answer the explanation slides up with the true version (if you were shown the false one), the release it was verified for, and a **Source** link to the article. The top bar shows your streak of correct answers in a row, today's score, and a progress bar toward your daily goal. Tap the filter chip to switch to your saved questions, narrow by area or certification, or change the goal. **Share** sends a question to a friend.

Questions are drawn completely at random with no weighting; each one shows once before any repeats. Scores and saved questions stay on your phone; "Copy scores" exports them. On a computer, use ← / → to answer, ↑ / ↓ to move, and S to save. Add it to your home screen to use it offline.

## Practice in the terminal

```bash
pip install -r requirements.txt
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
| `CLAUDE.md` | The daily run's playbook |

### Daily run

Once a day, a scheduled run handles up to 100 pairs and pushes them to `main` as one combined commit, only if every check passes:

1. Mark stale any pair verified for an older release, or whose source article changed.
2. Re-verify every stale pair that is ready (its article was already refreshed for the new release): beta/pilot facts first, then limits and numbers.
3. Spend the rest of the 100-pair budget on new pairs, up to 3 per article per run, starting with the articles that have the fewest pairs (up to 6 per article).

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
pip install -r requirements.txt
git clone --depth 1 https://github.com/john1hsu/salesforce-knowledge-graph .source/salesforce-knowledge-graph
python3 scripts/validate.py --source .source/salesforce-knowledge-graph
python3 -m http.server   # then open http://localhost:8000/app/
```
