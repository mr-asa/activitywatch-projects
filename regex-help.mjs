// A collapsed regex cheat sheet, shown wherever a rule can be switched to
// regex. Hidden until `help.hidden = false`.
const LINES = [
  ["figma|sketch", "either word"],
  ["^Inbox", "the title starts with it"],
  ["Code$", "the title ends with it"],
  ["Report.*2026", "anything in between"],
  ["Ticket-\\d+", "digits (a number)"],
  ["v1\\.2", "a literal dot; escape . ? ( ) [ ] + * with \\"],
  ["^(?!.*Draft).*Report", "contains Report but not Draft"],
];
export function regexHelp() {
  const help = document.createElement("details");
  help.className = "regex-help";
  help.hidden = true;
  const summary = document.createElement("summary");
  summary.textContent = "Regex cheat sheet";
  const intro = document.createElement("p");
  intro.className = "field-help";
  intro.textContent =
    "JavaScript syntax, written without / delimiters. A pattern matches anywhere in the text unless anchored with ^ or $.";
  const list = document.createElement("ul");
  for (const [pattern, meaning] of LINES) {
    const item = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = pattern;
    item.append(code, " \u2014 " + meaning);
    list.append(item);
  }
  help.append(summary, intro, list);
  return help;
}
