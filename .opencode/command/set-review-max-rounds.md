---
description: "Set the maximum number of keeper review rounds for auto-fix mode"
---

Set `review_max_rounds` in `.vuhitra/settings.json` to the value provided:

$ARGUMENTS

Steps:

1. Validate that `$ARGUMENTS` is a positive integer. If not, report an error and stop.
2. Read `.vuhitra/settings.json` (create it as `{}` if it does not exist).
3. Note the previous value of `review_max_rounds` (or `default 7` if absent).
4. Set `review_max_rounds` to the parsed integer and write the file back.
5. Confirm: `✓ review_max_rounds set to <N> (was: <previous>)`
