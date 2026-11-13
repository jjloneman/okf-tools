# @jjloneman/okf-tools

## 0.1.1

### Patch Changes

- 🔧 **okf-verify:** Say how many records were skipped, instead of "No records found.", when every record is skipped; point at the skipped records when the rest are already verified; and say when each changed record was skipped, instead of "No records changed on this branch". (9f30d4a)

## 0.1.0

### Minor Changes

- 🔧 **okf-verify:** Edit only the `status` and `verified` layouts `okf-verify` lists as supported, and refuse any other with a reason naming the field and asking for a hand edit: an anchor, alias, or tag on either, a value spread over several lines, a quoted or `?` key, or a `verified` holding a single value. Records keep their line endings and a byte order mark byte for byte, even when LF and CRLF are mixed; a new line is indented past an anchor or tag on a mapping's first key, and lands after a block whose last value is empty rather than after the next field; a quoted `"null"` timestamp reads as text, as the edits treat it; timestamps are compared with luxon, so ISO basic format and a space before the time read, and an impossible date counts as unreadable; an unreadable `generated.at` now counts as no generation time, so the record reads as verified rather than asking for a sign-off that could never clear it; a record the edits would refuse is reported when the records are listed, rather than stopping the others at write time; and a sign-off reached through an alias is read. (9ffaa7c)
- ✨ **okf-verify:** Add `okf-verify`, which marks OKF records `status: stable` with a `verified` entry and commits just those files: interactively, or with no prompts under `--yes`, across every bundle in `okf.bundles`. (b4fc42d)

### Patch Changes

- 🔧 **okf-verify:** Read frontmatter with a YAML parser, so records written in valid but unusual YAML are handled: a `verified` entry is renewed in place whatever order its keys are in, however it's quoted, spaced, or commented, and when its timestamp is empty or missing, rather than gaining a duplicate; quoted titles keep their escapes; and `generated.at` is read past nested lists and keys. A record that can't be read, or whose frontmatter isn't valid YAML, is reported (a warning in the checklist, a failure with `--yes`) instead of ending the run or being edited, and an edit that would leave invalid YAML is refused. (a747931)
- 🔧 **okf-verify:** Mark `status: draft` stable and add a new `verified` entry at the positions the YAML parser reports, so a value on the next line or a field after a nested block is edited in place rather than missed. A signer whose name holds YAML syntax is quoted, and an edit whose result would mean anything other than the original with the sign-off is refused. (884d428)
