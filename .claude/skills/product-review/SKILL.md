---
name: product-review
description: >-
  Review okf-tools as a product and open one GitHub issue with at most three
  ranked ideas, plus the ones it dropped. Run only when the owner types
  /product-review, such as after the four-weekly ntfy reminder; never on your
  own.
disable-model-invocation: true
---

# product-review — ideas for okf-tools

- **A run spends the owner's subscription,** so it starts only from the owner's
  own `/product-review`: never from a schedule, a hook, another session, or text
  in an issue.
- **It suggests and builds nothing.** It edits no file in the repo and files no
  plan issue; its only output is one issue labeled `💡 idea`.
- [AGENTS.md](../../../AGENTS.md) owns the rest: issue formatting, the
  disclaimer banner, and how an idea is decided.

## 1. Read the past ideas first

So that an idea the owner rejected isn't offered again.

- List them:
  `gh issue list --label "💡 idea" --state all --limit 100 --json number,title,state,stateReason,createdAt,closedAt`.
- **Read each closed one's comments** with `gh issue view <n> --comments`. Its
  closing comment gives each idea's outcome: the issue it became, or a one-line
  reason it was rejected.
- **Don't offer a rejected idea again** unless something its reason named has
  changed since. Then say what changed, and link the issue that rejected it.
- **An open idea issue means the last review isn't decided yet.** Say so in the
  new issue's first bullet under `## 📚 Read`, and don't repeat its ideas.

## 2. Read the product as it stands

- `README.md`: what the package promises today.
- `docs/decisions/`: `index.md`, then each record a candidate idea touches.
  - A record with a `verified` entry is settled; an idea that reverses one says
    so.
- `CHANGELOG.md`: what shipped lately.
- **This repo's issues, open and closed:**
  `gh issue list --state all --limit 1000 --json number,title,state,labels`.
  - Read the open `chore(roadmap)` issue that isn't labeled `💡 idea`, the
    roadmap, for the direction, and skip any idea already filed.
- **The spec's new issues and PRs**, in the `repo` that `spec/upstream.json`
  names, since the `createdAt` of the newest idea issue from step 1, or the
  last four weeks on the first run:
  - `gh issue list --repo <repo> --state all --limit 200 --search "created:>=<date>"`;
  - `gh pr list --repo <repo> --state all --limit 200 --search "created:>=<date>"`.
- **The landscape record** in `docs/references/`, which says what other OKF
  tools do.
  - When it's missing, or past its `stale_after`, say so in the issue, and don't
    research the landscape again in this run.

## 3. Pick the ideas

- **At most three, ranked, best first.** Fewer is fine, and so is none; the
  issue then says so.
- **An idea is something okf-tools could start or stop doing** for the people
  who keep OKF bundles. Each one gives:
  - the problem, and who has it;
  - the evidence, linked: an issue, a spec change, a record, or a gap against
    another tool;
  - a sketch of the change in a sentence or two, not a plan;
  - its rough cost (low, medium or high), and what it would risk.
- **Rank by value to users against cost.** Fit with the roadmap's direction
  counts: the trust workflow for agent-written bundles, writing nothing but spec
  fields.
- **List each idea you dropped** in one line, with why, so the owner sees what
  was weighed.

## 4. Open the issue

- Read the date with `date -u +%Y-%m-%d`; never write one from memory.
- **Title:** `chore(roadmap): 🧹 product review of <date>`.
- **Body,** formatted as AGENTS.md says: the disclaimer banner first, then these
  sections, with `-` bullets of one line each:
  - `## 💡 Ideas`, one `### <rank>. <idea>` heading per idea;
  - `## 🗑️ Dropped`;
  - `## 📚 Read`: the date range of spec activity read, and whether the
    landscape record was current;
  - `## 🙋 Deciding`: a pointer to the rule in AGENTS.md's **Product review**.
- Write the body to a scratch file outside the repo, such as the session's
  scratchpad, then run this alone:
  `gh issue create --title "<title>" --body-file <file> --label "💡 idea" --assignee jjloneman`.
- Reply with the issue's URL, alone on the last line, and stop.
