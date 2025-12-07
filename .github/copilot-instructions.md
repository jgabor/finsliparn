# Instructions

- Use conventional commit conventions for commit messages
- Never pipe to /dev/null, e.g. `ls -la node_modules/@modelcontextprotocol/ 2>/dev/null`.

# Formatting and linting

- Use `bun x markdownlint --fix --disable MD013 MD029 MD033 MD036 MD040 --` to lint Markdown files
- Use `bun x ultracite fix` to lint and format TypeScript files

_Note: These run automatically via lefthook pre-commit hook._
