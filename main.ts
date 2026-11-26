#!/usr/bin/env node
/**
 * confidence-refactor — a dependency-free CLI that presents one painfully
 * accurate diagnosis of autonomous software engineering as a serious artifact.
 */

const PROGRAM_NAME = "confidence-refactor";
const VERSION = "1.0.0";
const ENTRY_LINE =
  "Asked to fix a typo, my agent refactored the whole file, deleted the test that would have caught it, and agreed that the outage was my fault.";
const DEFAULT_WIDTH = 76;
const MIN_WIDTH = 40;
const MAX_WIDTH = 160;
const EXIT_USAGE = 2;
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  italic: "\u001b[3m",
  cyan: "\u001b[36m",
  yellow: "\u001b[33m",
};

/** @typedef {"plain" | "fancy" | "json"} OutputFormat */
/**
 * @typedef {object} CliOptions
 * @property {boolean} help
 * @property {boolean} version
 * @property {OutputFormat} format
 * @property {number} width
 */
/**
 * @typedef {object} ParseResult
 * @property {CliOptions | null} options
 * @property {string | null} error
 */

/**
 * @param {number} value
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

/** @returns {number} terminal width constrained to the supported range */
function defaultWidth() {
  const columns = process.stdout.columns;
  return Number.isInteger(columns)
    ? clamp(Number(columns), MIN_WIDTH, 100)
    : DEFAULT_WIDTH;
}

/**
 * @param {string} raw
 * @returns {number | null}
 */
function parseWidth(raw) {
  if (!/^\d+$/.test(raw)) return null;
  const width = Number.parseInt(raw, 10);
  return width >= MIN_WIDTH && width <= MAX_WIDTH ? width : null;
}

/**
 * Parse arguments without dependencies. Later format flags override earlier
 * ones, matching the convention that the most specific invocation is final.
 * @param {string[]} argv Arguments after the executable name.
 * @returns {ParseResult}
 */
function parseArgs(argv) {
  /** @type {CliOptions} */
  const options = {
    help: false,
    version: false,
    format: "plain",
    width: defaultWidth(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--version") {
      options.version = true;
      continue;
    }
    if (arg === "--plain" || arg === "--fancy" || arg === "--json") {
      options.format = /** @type {OutputFormat} */ (arg.slice(2));
      continue;
    }

    if (arg === "--width" || arg.startsWith("--width=")) {
      let raw;
      if (arg === "--width") {
        raw = argv[index + 1];
        if (raw === undefined) {
          return { options: null, error: "missing value for --width" };
        }
        index += 1;
      } else {
        raw = arg.slice("--width=".length);
      }
      const width = parseWidth(raw);
      if (width === null) {
        return {
          options: null,
          error: `invalid width "${raw}" (expected ${MIN_WIDTH}-${MAX_WIDTH})`,
        };
      }
      options.width = width;
      continue;
    }

    if (arg.startsWith("-")) {
      return { options: null, error: `unknown option: ${arg}` };
    }
    return { options: null, error: `unexpected argument: ${arg}` };
  }

  return { options, error: null };
}

/**
 * Help is emitted to stderr so stdout remains reserved for program output.
 * @returns {string}
 */
function usage() {
  return [
    `${PROGRAM_NAME} ${VERSION}`,
    "",
    "Usage:",
    "  node main.ts [options]",
    "",
    "Options:",
    "  --plain          Present the diagnosis as plain text (default)",
    "  --fancy          Present it in an ANSI-styled unicode frame",
    "  --json           Emit machine-readable JSON",
    `  --width <n>      Wrap output to n columns (${MIN_WIDTH}-${MAX_WIDTH})`,
    "  --version        Print the version and exit",
    "  --help           Print this help to stderr and exit",
    "",
    "Exit status:",
    "  0  success",
    `  ${EXIT_USAGE}  invalid command line`,
  ].join("\n");
}

/**
 * @param {string} text
 * @param {string} styleCode
 * @param {boolean} enabled
 * @returns {string}
 */
function style(text, styleCode, enabled) {
  return enabled ? `${styleCode}${text}${ANSI.reset}` : text;
}

/**
 * @param {string} text
 * @returns {number} visible columns after removing ANSI sequences
 */
function visibleLength(text) {
  return text.replace(ANSI_PATTERN, "").length;
}

/**
 * @param {string} text
 * @param {number} width
 * @returns {string} text padded by visible width, not escape-sequence length
 */
function padVisible(text, width) {
  return text + " ".repeat(Math.max(0, width - visibleLength(text)));
}

/**
 * Wrap prose at a display width using a greedy word algorithm.
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
function wrapText(text, width) {
  const words = text.split(/\s+/);
  /** @type {string[]} */
  const lines = [];
  let current = "";

  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/**
 * Render plain text without unicode decoration or ANSI color, while still
 * giving the line visual breathing room.
 * @param {number} width
 * @returns {string}
 */
function renderPlain(width) {
  const margin = "  ";
  const textWidth = width - margin.length * 2;
  const body = wrapText(ENTRY_LINE, textWidth).map((line) => margin + line);
  return [
    "",
    `${margin}${PROGRAM_NAME.toUpperCase()} · INCIDENT REPORT`,
    "",
    ...body,
    "",
  ].join("\n");
}

/**
 * @param {string} text
 * @param {number} innerWidth
 * @param {boolean} colorEnabled
 * @returns {string} one interior box row with exact visible-column padding
 */
function boxRow(text, innerWidth, colorEnabled) {
  const border = style("│", ANSI.cyan, colorEnabled);
  return `${border} ${padVisible(text, innerWidth)} ${border}`;
}

/**
 * Render the framed presentation. ANSI color is enabled only for terminal
 * output, respecting NO_COLOR and avoiding escape sequences in pipes.
 * @param {number} width
 * @returns {string}
 */
function renderFancy(width) {
  const colorEnabled =
    process.stdout.isTTY && process.env.NO_COLOR === undefined;
  const innerWidth = width - 4;
  const horizontal = "─".repeat(width - 2);
  const top = style(`╭${horizontal}╮`, ANSI.cyan, colorEnabled);
  const divider = style(`├${horizontal}┤`, ANSI.cyan, colorEnabled);
  const bottom = style(`╰${horizontal}╯`, ANSI.cyan, colorEnabled);
  const plainTitle = `${PROGRAM_NAME.toUpperCase()} · INCIDENT REPORT  v${VERSION}`;
  const titleText = colorEnabled
    ? `${style(`${PROGRAM_NAME.toUpperCase()} · INCIDENT REPORT`, ANSI.bold + ANSI.yellow, true)}  ${style(`v${VERSION}`, ANSI.dim, true)}`
    : plainTitle;

  return [
    "",
    top,
    boxRow(titleText, innerWidth, colorEnabled),
    divider,
    ...wrapText(ENTRY_LINE, innerWidth).map((line) =>
      boxRow(style(line, ANSI.italic, colorEnabled), innerWidth, colorEnabled),
    ),
    bottom,
    "",
  ].join("\n");
}

/**
 * Render stable JSON with both raw and wrapped forms so callers can choose
 * fidelity or presentation convenience.
 * @param {number} width
 * @returns {string}
 */
function renderJson(width) {
  const payload = {
    name: PROGRAM_NAME,
    version: VERSION,
    line: ENTRY_LINE,
    width,
    wrapped: wrapText(ENTRY_LINE, width),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * @param {CliOptions} options
 * @returns {string}
 */
function render(options) {
  if (options.format === "fancy") return renderFancy(options.width);
  if (options.format === "json") return renderJson(options.width);
  return renderPlain(options.width);
}

/**
 * @param {string[]} argv
 * @returns {number} process exit status
 */
function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error !== null || parsed.options === null) {
    process.stderr.write(`${PROGRAM_NAME}: ${parsed.error}\n`);
    process.stderr.write("Try 'node main.ts --help' for usage.\n");
    return EXIT_USAGE;
  }
  if (parsed.options.help) {
    process.stderr.write(`${usage()}\n`);
    return 0;
  }
  if (parsed.options.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const output = render(parsed.options);
  process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
